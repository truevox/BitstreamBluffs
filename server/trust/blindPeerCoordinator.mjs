import {createHmac,randomBytes,randomInt,randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {canonicalBytes,parseCanonical} from '../../src/systems/replay/canonicalJson.js';
import {digestOf} from '../../src/systems/replay/canonicalSha256.js';
import {prepareReplayEvidence,compareReplayObservation} from './replayEvidence.mjs';
import {equipmentDigest,equipmentProjection,readEquipment,checkEquipment,persistEquipment} from './publicWallet.mjs';

// Private coordinator reference, NOT a public HTTP service.
// Authentication and actual sandboxed replay are external responsibilities.
const id=x=>typeof x==='string'&&/^[\w.\-:@/]{1,120}$/.test(x);
const ms=x=>Number.isSafeInteger(x)&&x>=0;
const no=reason=>({ok:false,reason});
const encode=x=>Buffer.from(canonicalBytes(x)).toString('utf8');
const sha=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
const read=x=>parseCanonical(x);
const BOARD=['human','tas'];
const words=x=>x&&typeof x==='object'&&!Array.isArray(x);
const fixed=(x,fields)=>words(x)&&Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const hashVerifier=(secret,account)=>createHmac('sha256',secret).update('bb-peer-verifier-v1\x00'+account).digest('hex');
function observationReport(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>32768)return null;
 try{
  const body=read(bytes);
  if(!fixed(body,['evidenceDigest','observation'])||
     typeof body.evidenceDigest!=='string'||
     !/^sha256:[0-9a-f]{64}$/.test(body.evidenceDigest)||
     !fixed(body.observation,['start','points','seek','score','distanceM','checked']))return null;
  return {body,digest:sha(bytes)};
 }catch{return null;}
}
function assess(evidence,report){
 try{
  const prepared=prepareReplayEvidence(Uint8Array.from(evidence),report.trustedRuleset);
  if(!prepared.ok||prepared.identity.bundleDigest!==report.body.evidenceDigest)return null;
  return compareReplayObservation(prepared.expected,report.body.observation).ok?'match':'mismatch';
 }catch{return null;}
}


export function openBlindPeerCoordinator({
 databasePath,trustedRuleset,pseudonymKey,verifierBuildId,clock=Date.now,
 peerTarget=2,maxConcurrent=1,leaseMs=120000,challengeTtlMs=15*60*1000,
 chooseIndex=n=>randomInt(n)
}){
 if(typeof databasePath!=='string'||!databasePath||!trustedRuleset||
    digestOf(trustedRuleset.ruleset)!==trustedRuleset.rulesetId||
    typeof verifierBuildId!=='string'||!/^sha256:[0-9a-f]{64}$/.test(verifierBuildId)||
    !Buffer.isBuffer(pseudonymKey)||pseudonymKey.length<32||
    !Number.isSafeInteger(peerTarget)||peerTarget<2||peerTarget>4||
    !Number.isSafeInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>2||
    !ms(leaseMs)||leaseMs<1000||leaseMs>3600000||
    !ms(challengeTtlMs)||challengeTtlMs<1000||challengeTtlMs>3600000)throw Error('invalid private coordinator config');
 const db=new DatabaseSync(databasePath);
 db.exec(`
 PRAGMA journal_mode=WAL;
 PRAGMA synchronous=FULL;
 PRAGMA busy_timeout=5000;
 PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS private_verification(
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL UNIQUE REFERENCES challenges(id),
  owner TEXT NOT NULL, board TEXT NOT NULL CHECK(board IN ('human','tas')),
  evidence BLOB NOT NULL, evidence_digest TEXT NOT NULL, causal_digest TEXT NOT NULL,
  local_state TEXT NOT NULL CHECK(local_state IN ('running','passed','failed')),
  publication TEXT NOT NULL CHECK(publication IN ('private','unverified','disputed','consensus-candidate','failed-local')),
  opted_in INTEGER NOT NULL CHECK(opted_in=1),
  created INTEGER NOT NULL, updated INTEGER NOT NULL,
  UNIQUE(owner,causal_digest)
 ) STRICT;
 CREATE TABLE IF NOT EXISTS private_peer_assignment(
  id TEXT PRIMARY KEY,
  submission TEXT NOT NULL REFERENCES private_verification(id),
  verifier_tag TEXT NOT NULL,
  lease_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('leased','expired','complete')),
  leased INTEGER NOT NULL, expires INTEGER NOT NULL,
  outcome TEXT, observation_digest TEXT,
  UNIQUE(submission,verifier_tag)
 ) STRICT;
 CREATE INDEX IF NOT EXISTS idx_peer_eligible ON private_verification(local_state,created);
 CREATE INDEX IF NOT EXISTS idx_peer_assigned ON private_peer_assignment(submission,state);
 `);
 const time=()=>{const n=clock();if(!ms(n))throw Error('invalid server clock');return n;};
 const tx=f=>{
  db.exec('BEGIN IMMEDIATE');
  try{const out=f();db.exec('COMMIT');return out;}
  catch(e){db.exec('ROLLBACK');throw e;}
 };
 // The existing dual-proof admission policy intentionally covers only
 // human public runs. TAS is an independently classified PRIVATE challenge:
 // it has frozen authoritative gear but cannot silently enter that policy.
 // Only a trusted server coordinator supplies course and authenticated user.
 function issueTasChallenge(account,courseBytes,pinnedVerifierBuildId,loadoutBytes){
  if(!id(account)||pinnedVerifierBuildId!==verifierBuildId)return no('challenge-identity-invalid');
  let c;
  try{
   if(!(courseBytes instanceof Uint8Array)||courseBytes.byteLength>65536)return no('malformed-course');
   c=read(courseBytes);
  }catch{return no('malformed-course');}
  const fields=['runId','buildId','rulesetId','seed','biomeMask','lane','loadoutDigest','assistance'];
  if(!fixed(c,fields)||!id(c.runId)||!id(c.buildId)||
     c.rulesetId!==trustedRuleset.rulesetId||
     typeof c.seed!=='string'||c.seed.length<1||c.seed.length>120||
     /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(c.seed)||
     !Number.isSafeInteger(c.biomeMask)||c.biomeMask<0||c.biomeMask>0xffffffff||
     !['stock','modded'].includes(c.lane)||
     typeof c.loadoutDigest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(c.loadoutDigest)||
     !['ai','tool-assisted'].includes(c.assistance))
   return no('tas-course-invalid');
  return tx(()=>{
   const equipment=checkEquipment(db,account,c,loadoutBytes);
   if(!equipment.ok)return no(equipment.reason);
   const now=time(),expires=now+challengeTtlMs;
   if(!ms(expires))return no('challenge-expiry-invalid');
   const challengeId=randomUUID();
   db.prepare('INSERT INTO challenges VALUES (?,?,?,?,?,?)')
    .run(challengeId,account,encode(c),pinnedVerifierBuildId,now,expires);
   persistEquipment(db,challengeId,account,equipment);
   return {ok:true,challengeId,createdAt:now,expiresAt:expires,board:'tas'};
  });
 }
 // Internal classification is NEVER exposed as public Verified.
 function progress(submission,now){
  const s=db.prepare('SELECT local_state,publication FROM private_verification WHERE id=?').get(submission);
  if(!s||s.local_state!=='passed')return;
  const matches=db.prepare("SELECT count(*) AS n FROM private_peer_assignment WHERE submission=? AND state='complete' AND outcome='match'").get(submission).n;
  const bad=db.prepare("SELECT count(*) AS n FROM private_peer_assignment WHERE submission=? AND state='complete' AND outcome='mismatch'").get(submission).n;
  const next=bad?'disputed':matches>=peerTarget?'consensus-candidate':'unverified';
  if(s.publication!==next)db.prepare('UPDATE private_verification SET publication=?,updated=? WHERE id=?').run(next,now,submission);
 }
 function begin(account,challengeId,evidenceBytes,{board='human',optedIn=false}={}){
  if(!id(account)||!id(challengeId)||!BOARD.includes(board)||optedIn!==true)return no('consent-or-identity-required');
  let prepared;
  try{prepared=prepareReplayEvidence(evidenceBytes,trustedRuleset);}catch{return no('invalid-evidence');}
  if(!prepared.ok)return no('invalid-evidence');
  return tx(()=>{
   const now=time(),c=db.prepare('SELECT * FROM challenges WHERE id=?').get(challengeId);
   if(!c||c.account!==account)return no('challenge-not-owned');
   if(c.verifier!==verifierBuildId)return no('verifier-build-mismatch');
   if(now<c.created||now>=c.expires)return no('challenge-expired');
   if(db.prepare('SELECT 1 FROM private_verification WHERE challenge=?').get(challengeId))return no('already-requested');
   if(db.prepare('SELECT 1 FROM private_verification WHERE owner=? AND causal_digest=?').get(account,prepared.identity.causalDigest))return no('already-submitted-causal-run');
   const course=read(c.course);
   if(course.rulesetId!==trustedRuleset.rulesetId||course.seed!==prepared.tape.seed||
      course.biomeMask!==prepared.tape.biomeMask||
      course.loadoutDigest!==equipmentDigest(equipmentProjection(prepared.causal))||
      !((board==='human'&&course.assistance==='human')||(board==='tas'&&
         (course.assistance==='ai'||course.assistance==='tool-assisted'))))
    return no('course-or-board-mismatch');
   const frozen=readEquipment(db,challengeId,account);
   if(!frozen||frozen.digest!==course.loadoutDigest||
      equipmentDigest(frozen.loadout)!==frozen.digest)return no('unbound-equipment');
   const submissionId=randomUUID();
   db.prepare("INSERT INTO private_verification VALUES (?,?,?,?,?,?,?,'running','private',1,?,?)")
    .run(submissionId,challengeId,account,board,Buffer.from(evidenceBytes),
      prepared.identity.bundleDigest,prepared.identity.causalDigest,now,now);
   return {ok:true,submissionId,status:'checking-locally',board};
  });
 }
 // Local check is a creator qualification (Mario Maker), not independent
 // authentication. It cannot mint a Verified badge or public rewards.
 function completeLocal(account,submissionId,reportBytes){
  if(!id(account)||!id(submissionId))return no('malformed-local-result');
  const parsed=observationReport(reportBytes);
  if(!parsed)return no('malformed-local-result');
  return tx(()=>{
   const now=time(),s=db.prepare('SELECT * FROM private_verification WHERE id=?').get(submissionId);
   if(!s||s.owner!==account)return no('not-owned');
   if(s.local_state!=='running')return no('local-already-finished');
   if(s.evidence_digest!==parsed.body.evidenceDigest)return no('evidence-changed');
   const outcome=assess(s.evidence,{...parsed,trustedRuleset});
   if(!outcome)return no('observation-not-verifiable');
   if(outcome==='mismatch'){
    db.prepare("UPDATE private_verification SET local_state='failed',publication='failed-local',updated=? WHERE id=?").run(now,submissionId);
    return {ok:true,status:'not-published'};
   }
   db.prepare("UPDATE private_verification SET local_state='passed',publication='unverified',updated=? WHERE id=?").run(now,submissionId);
   progress(submissionId,now);
   return {ok:true,status:'UNVERIFIED'};
  });
 }
 function claimForAutomaticPeer(account,{deviceReady=false}={}){
  if(!id(account)||deviceReady!==true)return no('not-ready');
  return tx(()=>{
   const now=time(),tag=hashVerifier(pseudonymKey,account);
   // Automatic participation only while checking one's OWN opted-in run.
   if(!db.prepare("SELECT 1 FROM private_verification WHERE owner=? AND local_state='running' LIMIT 1").get(account))return no('own-local-check-not-running');
   db.prepare("UPDATE private_peer_assignment SET state='expired' WHERE state='leased' AND expires<=?").run(now);
   const existing=db.prepare("SELECT count(*) AS n FROM private_peer_assignment WHERE verifier_tag=? AND state='leased'").get(tag).n;
   if(existing>=maxConcurrent)return no('device-budget-full');
   // Count the ENTIRE eligible population first. The old oldest-32
   // window systematically biased assignment and could starve newer runs.
   // BEGIN IMMEDIATE guarantees COUNT and OFFSET see the same snapshot.
   // Keep the selection predicate identical for COUNT and retrieval.
   const where=`
     FROM private_verification s
     WHERE s.owner<>? AND s.local_state IN ('running','passed')
       AND NOT EXISTS (SELECT 1 FROM private_peer_assignment p
           WHERE p.submission=s.id AND p.verifier_tag=?)
       AND (SELECT count(*) FROM private_peer_assignment p
            WHERE p.submission=s.id AND p.state IN ('leased','complete')) < ?
   `;
   const population=db.prepare('SELECT count(*) AS n '+where).get(account,tag,peerTarget).n;
   if(!population)return no('no-background-work');
   const selected=chooseIndex(population);
   if(!Number.isSafeInteger(selected)||selected<0||selected>=population)throw Error('bad trusted random picker');
   const job=db.prepare('SELECT s.id,s.board,s.evidence '+where+' ORDER BY s.created,s.rowid LIMIT 1 OFFSET ?')
     .get(account,tag,peerTarget,selected);
   if(!job)throw Error('eligible peer queue changed inside transaction');
   const assignmentId=randomUUID(),leaseToken=randomBytes(32).toString('base64url');
   const deadline=now+leaseMs;if(!ms(deadline))throw Error('invalid expiry');
   db.prepare("INSERT INTO private_peer_assignment (id,submission,verifier_tag,lease_digest,state,leased,expires) VALUES (?,?,?,?,'leased',?,?)")
     .run(assignmentId,job.id,tag,sha(Buffer.from(leaseToken)),now,deadline);
   // No owner, public ID, participant mapping, rank, or verifier pseudonym.
   return {ok:true,job:{id:assignmentId,leaseToken,kind:'exact-run',
     board:job.board,rulesetId:trustedRuleset.rulesetId,verifierBuildId,
     evidence:Uint8Array.from(job.evidence),expiresAt:deadline}};
  });
 }
 function completePeer(account,assignmentId,leaseToken,reportBytes){
  if(!id(account)||!id(assignmentId)||typeof leaseToken!=='string'||
     !/^[A-Za-z0-9_-]{43}$/.test(leaseToken))
   return no('malformed-peer-result');
  const parsed=observationReport(reportBytes);
  if(!parsed)return no('malformed-peer-result');
  return tx(()=>{
   const now=time(),tag=hashVerifier(pseudonymKey,account);
   const a=db.prepare('SELECT * FROM private_peer_assignment WHERE id=?').get(assignmentId);
   if(!a||a.verifier_tag!==tag||a.lease_digest!==sha(Buffer.from(leaseToken)))return no('not-assigned');
   if(a.state!=='leased'||a.expires<=now)return no('lease-not-active');
   const s=db.prepare('SELECT local_state,evidence,evidence_digest FROM private_verification WHERE id=?').get(a.submission);
   if(!s||s.local_state==='failed')return no('local-qualification-failed');
   if(s.evidence_digest!==parsed.body.evidenceDigest)return no('evidence-changed');
   const outcome=assess(s.evidence,{...parsed,trustedRuleset});
   if(!outcome)return no('observation-not-verifiable');
   db.prepare("UPDATE private_peer_assignment SET state='complete',outcome=?,observation_digest=? WHERE id=?")
    .run(outcome,parsed.digest,assignmentId);
   progress(a.submission,now);
   // A calculated peer observation is STILL untrusted browser computation.
   // No peer result here is a signed issuer receipt or public Verified verdict.
   return {ok:true,accepted:true};
  });
 }
 function ownStatus(account,submissionId){
  if(!id(account)||!id(submissionId))return no('not-owned');
  const s=db.prepare('SELECT owner,board,local_state,publication FROM private_verification WHERE id=?').get(submissionId);
  if(!s||s.owner!==account)return no('not-owned');
  return {ok:true,board:s.board,local:s.local_state,
    publication:s.publication==='private'||s.publication==='failed-local'?'NONE':'UNVERIFIED',
    peerConsensus:s.publication==='consensus-candidate',
    disputed:s.publication==='disputed'};
 }
 // Deliberately NO public-Verified or reward mutation. Peer reports remain
 // untrusted until separately audited by a trusted host execution.
 return Object.freeze({issueTasChallenge,begin,completeLocal,claimForAutomaticPeer,completePeer,ownStatus,close:()=>db.close()});
}
