import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalBytes, parseCanonical } from '../../src/systems/replay/canonicalJson.js';
import {initWallet,checkEquipment,persistEquipment,readEquipment,equipmentProjection,equipmentDigest} from './publicWallet.mjs';
import {prepareReplayEvidence} from './replayEvidence.mjs';
import {digestOf} from '../../src/systems/replay/canonicalSha256.js';
import { adjudicateDualProof } from '../../src/systems/trust/dualProof.js';

// Server-only reference boundary. Never import from browser code.
// Transport authentication, authoritative issuers and public rollout are separate.
const ROLES = ['simulation','authorization','consent'];
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ID = /^[\w.\-:@/]{1,120}$/;
const MAX = 256 * 1024;
const integer = n => Number.isSafeInteger(n) && n >= 0;
const id = x => typeof x === 'string' && ID.test(x);
const digest = x => typeof x === 'string' && DIGEST.test(x);
const keys = (x, names) => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  Object.keys(x).length === names.length && names.every(k => Object.hasOwn(x,k));
const hash = b => 'sha256:' + createHash('sha256').update(b).digest('hex');
const fail = reason => ({ admitted:false, reason });
const COURSE = ['runId','buildId','rulesetId','seed','biomeMask','lane','loadoutDigest','assistance'];
const courseOf = r => Object.fromEntries(COURSE.map(k=>[k,r[k]]));
function read(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX)
    throw new Error('bounded canonical bytes required');
  return parseCanonical(Buffer.from(bytes));
}
function trustedKeys(entries) {
  const map = new Map(), seen = new Set();
  for (const {keyId,role,publicKey} of entries) {
    if (!id(keyId) || !ROLES.includes(role) || map.has(keyId)) throw Error('invalid issuer registry');
    const key = publicKey?.type === 'public' ? publicKey : createPublicKey(publicKey);
    if (key.asymmetricKeyType !== 'ed25519') throw Error('Ed25519 required');
    const fp = hash(key.export({type:'spki',format:'der'}));
    if (seen.has(fp)) throw Error('issuer roles must use distinct keys');
    seen.add(fp);
    map.set(keyId,{role,key});
  }
  if (!ROLES.every(role=>[...map.values()].some(k=>k.role===role))) throw Error('all issuer roles required');
  return map;
}
function verifyReceipt(envelope, role, context, registry, now) {
  if (!keys(envelope,['body','signature'])) return null;
  const b = envelope.body;
  const fields=['format','version','role','keyId','accountId','challengeId','claimDigest','issuedAt','expiresAt','payload'];
  if(context.evidenceDigest!==null)fields.push('evidenceDigest');
  if (!keys(b,fields) || (context.evidenceDigest!==null&&b.evidenceDigest!==context.evidenceDigest) ||
      b.format!=='bb-authority-receipt' || b.version!==1 || b.role!==role || !id(b.keyId) ||
      b.accountId!==context.accountId || b.challengeId!==context.challengeId || b.claimDigest!==context.claimDigest ||
      !integer(b.issuedAt) || !integer(b.expiresAt) || b.issuedAt<context.createdAt || b.issuedAt>now ||
      b.expiresAt<=now || b.expiresAt>context.expiresAt || b.expiresAt<=b.issuedAt ||
      typeof envelope.signature!=='string' || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) return null;
  const issuer=registry.get(b.keyId);
  if (!issuer || issuer.role!==role) return null;
  const sig=Buffer.from(envelope.signature,'base64url');
  if (sig.length!==64 || sig.toString('base64url')!==envelope.signature ||
      !verify(null,canonicalBytes(b),issuer.key,sig)) return null;
  return b.payload;
}

/** The caller is a trusted server coordinator, not a client request handler.
 * authenticatedAccount comes from transport authentication; issueChallenge's
 * course comes from server policy. No public API or private signing keys here.
 */
export function openAdmissionLedger({databasePath, issuers, clock=Date.now, challengeTtlMs=15*60*1000, trustedRuleset=null, allowUnboundTestClaims=false}) {
  if (typeof databasePath!=='string' || !databasePath || !integer(challengeTtlMs) ||
      challengeTtlMs===0 || challengeTtlMs>24*60*60*1000) throw Error('invalid ledger configuration');
  if(!allowUnboundTestClaims&&(!trustedRuleset||digestOf(trustedRuleset.ruleset)!==trustedRuleset.rulesetId))throw Error('trusted ruleset required');
  const registry=trustedKeys(issuers);
  const db=new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA busy_timeout=5000;
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS challenges(
      id TEXT PRIMARY KEY, account TEXT NOT NULL, course TEXT NOT NULL,
      verifier TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS admissions(
      challenge TEXT PRIMARY KEY REFERENCES challenges(id),
      account TEXT NOT NULL, run TEXT NOT NULL UNIQUE, claim TEXT NOT NULL,
      tape TEXT NOT NULL UNIQUE, accepted INTEGER NOT NULL, verdict TEXT NOT NULL, receipt_audit TEXT NOT NULL, evidence_digest TEXT
    ) STRICT;
  `);
  initWallet(db);
  const nowOf=()=>{const now=clock();if(!integer(now))throw Error('invalid server clock');return now;};
  const transaction=fn=>{
    db.exec('BEGIN IMMEDIATE');
    try { const result=fn(); db.exec('COMMIT'); return result; }
    catch(e){db.exec('ROLLBACK');throw e;}
  };
  function issueChallenge(authenticatedAccount, courseBytes, pinnedVerifierBuildId, loadoutBytes) {
    if (!id(authenticatedAccount) || !digest(pinnedVerifierBuildId)) throw Error('invalid challenge identity');
    const course=read(courseBytes);
    if (!keys(course,COURSE)) throw Error('invalid course shape');
    // Reuse the strict request validator through its stable malformed status.
    const probe={format:'bb-dual-proof',version:1,...course,manifestDigest:pinnedVerifierBuildId,
      tapeDigest:pinnedVerifierBuildId,score:0,endTick:0,intent:'verified-public',challengeId:null};
    if (adjudicateDualProof({request:probe}).proof.reason!=='trusted-evidence-missing')
      throw Error('invalid or nonhuman course');
    return transaction(()=>{
    const equipment=allowUnboundTestClaims?null:checkEquipment(db,authenticatedAccount,course,loadoutBytes);
    if(!allowUnboundTestClaims&&(course.rulesetId!==trustedRuleset.rulesetId||!equipment.ok))throw Error('equipment refused: '+(equipment?.reason??'ruleset'));
    const now=nowOf(), expires=now+challengeTtlMs;
    if (!integer(expires)) throw Error('invalid expiry');
    const challengeId=randomUUID();
    db.prepare('INSERT INTO challenges VALUES (?,?,?,?,?,?)').run(challengeId,authenticatedAccount,
      Buffer.from(canonicalBytes(course)).toString('utf8'),pinnedVerifierBuildId,now,expires);
    if(equipment)persistEquipment(db,challengeId,authenticatedAccount,equipment);
    return {challengeId,createdAt:now,expiresAt:expires};
    });
  }
  function admit(authenticatedAccount, bundleBytes, evidenceBytes) {
    if (!id(authenticatedAccount)) return fail('account-required');
    let bundle;
    try {bundle=read(bundleBytes);} catch {return fail('malformed-bundle');}
    if (!keys(bundle,['request','receipts']) || !keys(bundle.receipts,ROLES)) return fail('malformed-bundle');
    const r=bundle.request;
    if (r?.intent!=='verified-public' || !id(r?.challengeId) ||
        adjudicateDualProof({request:r}).proof.reason!=='trusted-evidence-missing')
      return fail('invalid-request');
    const claimDigest=hash(canonicalBytes(r));
    // Validate and derive identity before opening a write transaction.
    const evidence=allowUnboundTestClaims?null:prepareReplayEvidence(evidenceBytes,trustedRuleset);
    if(!allowUnboundTestClaims&&(!evidence.ok||evidence.identity.manifestDigest!==r.manifestDigest||
      evidence.identity.tapeDigest!==r.tapeDigest||evidence.identity.rulesetId!==r.rulesetId||
      evidence.tape.seed!==r.seed||evidence.tape.biomeMask!==r.biomeMask||evidence.expected.score!==r.score||
      evidence.expected.endTick!==r.endTick||equipmentDigest(equipmentProjection(evidence.causal))!==r.loadoutDigest))return fail('evidence-identity-mismatch');
    return transaction(()=>{
      const now=nowOf();
      const challenge=db.prepare('SELECT * FROM challenges WHERE id=?').get(r.challengeId);
      if (!challenge || challenge.account!==authenticatedAccount) return fail('challenge-not-owned');
      if (now<challenge.created || now>=challenge.expires) return fail('challenge-expired');
      if (challenge.course!==Buffer.from(canonicalBytes(courseOf(r))).toString('utf8')) return fail('challenge-course-mismatch');
      if(!allowUnboundTestClaims){
        const frozen=readEquipment(db,r.challengeId,authenticatedAccount);
        if(!frozen||frozen.digest!==r.loadoutDigest||equipmentDigest(frozen.loadout)!==frozen.digest)return fail('equipment-not-pinned');
      }
      if (db.prepare('SELECT 1 FROM admissions WHERE challenge=? OR run=? OR tape=?').get(r.challengeId,r.runId,r.tapeDigest))
        return fail('already-admitted');
      const context={accountId:authenticatedAccount,challengeId:r.challengeId,claimDigest,
        createdAt:challenge.created,expiresAt:challenge.expires,evidenceDigest:evidence?.identity.bundleDigest??null};
      const proofs={};
      for(const role of ROLES){
        const payload=verifyReceipt(bundle.receipts[role],role,context,registry,now);
        if (!payload) return fail('unauthenticated-'+role);
        proofs[role]=payload;
      }
      if (proofs.simulation.verifierBuildId!==challenge.verifier ||
          proofs.authorization.pinnedVerifierBuildId!==challenge.verifier)
        return fail('challenge-verifier-mismatch');
      const verdict=adjudicateDualProof({request:r,...proofs});
      if (!verdict.verifiedRankEligible || !verdict.publicRewardEligible) return {admitted:false,reason:'policy-denied',verdict};
      const audit=ROLES.map(role=>({role,keyId:bundle.receipts[role].body.keyId,receiptDigest:hash(canonicalBytes(bundle.receipts[role]))}));
      db.prepare('INSERT INTO admissions VALUES (?,?,?,?,?,?,?,?,?)').run(r.challengeId,authenticatedAccount,
        r.runId,claimDigest,r.tapeDigest,now,Buffer.from(canonicalBytes(verdict)).toString('utf8'),
        Buffer.from(canonicalBytes(audit)).toString('utf8'),context.evidenceDigest);
      return {admitted:true,verdict};
    });
  }
  return Object.freeze({issueChallenge,admit,close:()=>db.close()});
}
