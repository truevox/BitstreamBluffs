/**
 * #413: server-only UNVERIFIED publication against the existing #411 challenge
 * and equipment tables. This does not create accounts, Shards, gear, issuer
 * receipts, Verified rank, or a public endpoint.
 *
 * The caller MUST authenticate account, consent and audience OUTSIDE this
 * module. Request bytes are untrusted; account and consent flags are not.
 */
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {canonicalBytes,parseCanonical} from '../../src/systems/replay/canonicalJson.js';
import {adjudicateDualProof} from '../../src/systems/trust/dualProof.js';
import {equipmentDigest} from './publicWallet.mjs';

const ACCOUNT=/^[\w.\-:@/]{1,120}$/;
const COURSE=['runId','buildId','rulesetId','seed','biomeMask','lane','loadoutDigest','assistance'];
const MAX_BYTES=256*1024;
const deny=reason=>Object.freeze({ok:false,reason});
const safeTime=n=>Number.isSafeInteger(n)&&n>=0;
const ownCourse=r=>Object.fromEntries(COURSE.map(k=>[k,r[k]]));
const text=v=>Buffer.from(canonicalBytes(v)).toString('utf8');
const consentFor=r=>({
  kind:'trusted-consent-receipt',status:'granted',
  runId:r.runId,manifestDigest:r.manifestDigest,tapeDigest:r.tapeDigest,
  score:r.score,endTick:r.endTick,seed:r.seed,biomeMask:r.biomeMask,
  lane:r.lane,loadoutDigest:r.loadoutDigest,intent:r.intent,
  scope:'score-and-evidence',audienceGate:'passed',
});

/** A private adapter, not a browser request handler or a public verifier. */
export function openProvisionalLedger({databasePath,clock=Date.now}) {
  if(typeof databasePath!=='string'||!databasePath||typeof clock!=='function')
    throw Error('invalid provisional ledger configuration');
  const db=new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA busy_timeout=5000;
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS public_provisional_submissions(
      id TEXT PRIMARY KEY,
      challenge TEXT NOT NULL UNIQUE REFERENCES challenges(id),
      account TEXT NOT NULL,
      received INTEGER NOT NULL,
      request TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK(status='UNVERIFIED'),
      verified_rank_eligible INTEGER NOT NULL DEFAULT 0 CHECK(verified_rank_eligible=0),
      public_reward_eligible INTEGER NOT NULL DEFAULT 0 CHECK(public_reward_eligible=0)
    ) STRICT;
  `);
  const now=()=>{
    const value=clock();
    if(!safeTime(value))throw Error('invalid server clock');
    return value;
  };
  const tx=fn=>{
    db.exec('BEGIN IMMEDIATE');
    try {const result=fn();db.exec('COMMIT');return result;}
    catch(e){db.exec('ROLLBACK');throw e;}
  };
  function submit(authenticatedAccount,requestBytes,{consentAuthorized=false,audienceAllowed=false}={}) {
    if(typeof authenticatedAccount!=='string'||!ACCOUNT.test(authenticatedAccount))
      return deny('authenticated-account-required');
    if(!consentAuthorized||!audienceAllowed)
      return deny('consent-or-audience-required');
    if(!(requestBytes instanceof Uint8Array)||requestBytes.byteLength<1||requestBytes.byteLength>MAX_BYTES)
      return deny('malformed-request');
    let request,bytes;
    try {
      request=parseCanonical(Uint8Array.from(requestBytes));
      bytes=text(request);
    } catch{return deny('malformed-request');}
    if(!request||typeof request!=='object'||Array.isArray(request)||
       request.intent!=='provisional-public'||typeof request.challengeId!=='string'||
       !ACCOUNT.test(request.challengeId))
      return deny('invalid-provisional-request');
    const verdict=adjudicateDualProof({request,consent:consentFor(request),allowProvisional:true});
    if(verdict.publication!=='provisional-unverified'||
       verdict.verifiedRankEligible||verdict.publicRewardEligible)
      return deny('unverified-policy-refused');
    return tx(()=>{
      const challenge=db.prepare('SELECT account,course,created,expires FROM challenges WHERE id=?')
        .get(request.challengeId);
      if(!challenge||challenge.account!==authenticatedAccount)
        return deny('challenge-not-owned');
      const received=now();
      if(received<challenge.created||received>=challenge.expires)
        return deny('challenge-expired');
      if(challenge.course!==text(ownCourse(request)))
        return deny('challenge-course-mismatch');
      const frozen=db.prepare('SELECT loadout,digest FROM public_equipment WHERE challenge=? AND account=?')
        .get(request.challengeId,authenticatedAccount);
      if(!frozen||frozen.digest!==request.loadoutDigest||
         equipmentDigest(parseCanonical(frozen.loadout))!==frozen.digest)
        return deny('equipment-not-pinned');
      if(db.prepare('SELECT 1 FROM admissions WHERE challenge=?').get(request.challengeId))
        return deny('already-verified');
      if(db.prepare('SELECT 1 FROM public_provisional_submissions WHERE challenge=?')
        .get(request.challengeId))
        return deny('already-published');
      const submissionId='sub_'+randomUUID();
      db.prepare('INSERT INTO public_provisional_submissions(id,challenge,account,received,request) VALUES(?,?,?,?,?)')
        .run(submissionId,request.challengeId,authenticatedAccount,received,bytes);
      return Object.freeze({ok:true,submissionId,status:'UNVERIFIED',
        receivedAtMs:received,verifiedRankEligible:false,publicRewardEligible:false});
    });
  }
  function publicView(submissionId) {
    if(typeof submissionId!=='string'||!/^sub_[0-9a-f-]{36}$/.test(submissionId))return null;
    const row=db.prepare('SELECT id,received,request,status FROM public_provisional_submissions WHERE id=?')
      .get(submissionId);
    if(!row)return null;
    const request=parseCanonical(row.request);
    return Object.freeze({submissionId:row.id,status:row.status,
      score:request.score,seed:request.seed,biomeMask:request.biomeMask,lane:request.lane,
      receivedAtMs:row.received,verifiedRankEligible:false,publicRewardEligible:false});
  }
  return Object.freeze({submit,publicView,close:()=>db.close()});
}
