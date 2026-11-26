import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {PublicChallengeLedger} from '../../server/trust/PublicChallengeLedger.mjs';
import {adjudicateDualProof} from '../../src/systems/trust/dualProof.js';

const d=c=>'sha256:'+c.repeat(64);
const STOCK=d('a'),UPGRADE=d('b'),RULESET=d('c');
const CATALOGUE={spark:{price:60,loadoutDigest:UPGRADE}};
const consent={consentAuthorized:true,audienceAllowed:true};
const spec=(lane='stock',receiptId=null)=>({seed:'course-🔥',biomeMask:7,lane,buildId:'bb-v2_25_3',
  rulesetId:RULESET,entitlementReceiptId:receiptId});
const req=(ch,extra={})=>({format:'bb-dual-proof',version:1,runId:'run_100',buildId:ch.buildId,rulesetId:ch.rulesetId,
  manifestDigest:d('d'),tapeDigest:d('e'),seed:ch.seed,biomeMask:ch.biomeMask,lane:ch.lane,
  score:170,endTick:600,loadoutDigest:ch.loadoutDigest,assistance:'human',intent:'provisional-public',
  challengeId:ch.challengeId,...extra});
const fixture=()=>{
  let time=1000_000;
  const folder=mkdtempSync(join(tmpdir(),'bsb135-ledger-'));
  const file=join(folder,'authority.sqlite');
  const db=new DatabaseSync(file),make=(handle)=>new PublicChallengeLedger({db:handle,now:()=>time,
    stockLoadoutDigest:STOCK,catalogue:CATALOGUE});
  const ledger=make(db);
  ledger.createAuthenticatedAccount('alice');ledger.createAuthenticatedAccount('bob');
  return {ledger,db,file,make,setTime:v=>{time=v;},cleanup:()=>{db.close();rmSync(folder,{recursive:true,force:true});}};
};
const err=(fn,code)=>assert.throws(fn,e=>e.code===code);

test('no account starts with verified credits; grant and purchase are server-authoritative, idempotent and charged once',()=>{
 const f=fixture();try{
  const {ledger:l}=f;
  assert.equal(l.serverBalance('alice'),0);
  err(()=>l.purchaseServerEquipment('alice','spark','receipt-1'),'insufficient-server-shards');
  assert.equal(l.serverBalance('alice'),0);
  assert.equal(l.creditFromTrustedIssuer('alice','grant-1',70).serverShards,70);
  err(()=>l.creditFromTrustedIssuer('bob','grant-1',100),'grant-replayed');
  assert.equal(l.serverBalance('bob'),0);
  assert.equal(l.purchaseServerEquipment('alice','spark','receipt-1').price,60);
  assert.equal(l.serverBalance('alice'),10);
  err(()=>l.purchaseServerEquipment('alice','spark','receipt-1'),'receipt-replayed');
  err(()=>l.purchaseServerEquipment('alice','spark','receipt-2'),'insufficient-server-shards');
  err(()=>l.issueServerChallenge('bob',spec('modded','receipt-1')),'server-entitlement-required');
  const ch=l.issueServerChallenge('alice',spec('modded','receipt-1'));
  assert.equal(ch.loadoutDigest,UPGRADE);
  assert.equal(ch.lane,'modded');
  err(()=>l.issueServerChallenge('alice',spec('modded')),'server-entitlement-required');
  err(()=>l.issueServerChallenge('alice',spec('stock','receipt-1')),'stock-cannot-use-purchased-gear');
  assert.equal(l.issueServerChallenge('alice',spec('stock')).loadoutDigest,STOCK);
  assert.equal(l.serverBalance('alice'),10);
 }finally{f.cleanup();}
});

test('provisional is immediately visible but always unverified; one challenge can be consumed exactly once, across restarts',()=>{
 const f=fixture();let other;
 try{
  const {ledger:l}=f,ch=l.issueServerChallenge('alice',spec());
  const before=l.publicSubmission('not-found');assert.equal(before,null);
  const r=req(ch);
  err(()=>l.submitProvisional('alice',r,{consentAuthorized:false,audienceAllowed:true}),'public-consent-or-audience-missing');
  err(()=>l.submitProvisional('alice',r,{consentAuthorized:true,audienceAllowed:false}),'public-consent-or-audience-missing');
  err(()=>l.submitProvisional('bob',r,consent),'challenge-account-mismatch');
  assert.equal(l.serverBalance('alice'),0);
  const accepted=l.submitProvisional('alice',r,consent);
  assert.equal(accepted.status,'UNVERIFIED');assert.equal(accepted.verifiedRankEligible,false);
  assert.equal(accepted.publicRewardEligible,false);assert.equal(accepted.receivedAtMs,1000_000);
  const pub=l.publicSubmission(accepted.submissionId);
  assert.deepEqual(pub,{submissionId:accepted.submissionId,status:'UNVERIFIED',score:170,
    seed:'course-🔥',biomeMask:7,lane:'stock',receivedAtMs:1000_000,
    verifiedRankEligible:false,publicRewardEligible:false});
  assert.equal(JSON.stringify(pub).includes('alice'),false);
  assert.equal(JSON.stringify(pub).includes('tapeDigest'),false);
  err(()=>l.submitProvisional('alice',r,consent),'challenge-already-consumed');
  const reopened=new DatabaseSync(f.file);
  other=reopened;
  const second=f.make(reopened);
  err(()=>second.submitProvisional('alice',r,consent),'challenge-already-consumed');
  assert.deepEqual(second.publicSubmission(accepted.submissionId),pub);
  // Even direct database tampering cannot promote eligibility through this schema.
  assert.throws(()=>reopened.exec("UPDATE public_submissions SET status='VERIFIED',verified_rank_eligible=1"));
  assert.equal(second.publicSubmission(accepted.submissionId).status,'UNVERIFIED');
  assert.equal(l.serverBalance('alice'),0);
 }finally{other?.close();f.cleanup();}
});

test('stale, invalid or forged local wallet/gear and client-claimed verified status fail closed without consuming challenge',()=>{
 const f=fixture();try{
  const {ledger:l}=f;const ch=l.issueServerChallenge('alice',spec());
  for(const forged of [
    {bank:1_000_000_000},{verified:true},{issuer:'server'},{publicRewardEligible:true},
    {wallet:{serverShards:1e9}},{paidVerifier:true},{ranked:true},
  ])err(()=>l.submitProvisional('alice',req(ch,forged),consent),'unverified-admission-refused');
  for(const change of [
    {seed:'different-seed'},{biomeMask:0},{lane:'modded'},
    {loadoutDigest:UPGRADE},{rulesetId:d('f')},{buildId:'other-build'},
  ])err(()=>l.submitProvisional('alice',req(ch,change),consent),'challenge-course-mismatch');
  for(const change of [
    {assistance:'ai'},{assistance:'tool-assisted'},{intent:'verified-public'},
    {intent:'local'},
  ])err(()=>l.submitProvisional('alice',req(ch,change),consent),'not-provisional-human-submission');
  const ok=l.submitProvisional('alice',req(ch),consent);
  assert.equal(ok.status,'UNVERIFIED');
  assert.equal(l.serverBalance('alice'),0);
  const exp=l.issueServerChallenge('alice',spec());
  f.setTime(exp.expiresAtMs+1);
  err(()=>l.submitProvisional('alice',req(exp),consent),'challenge-expired');
  assert.equal(l.serverBalance('alice'),0);
 }finally{f.cleanup();}
});

test('malformed and hostile request objects cannot mint an admission',()=>{
 const f=fixture();try{
  const l=f.ledger,ch=l.issueServerChallenge('alice',spec());
  for(const candidate of [null,undefined,'string',[],new Map(),new Date(),{
    ...req(ch),get score(){throw new Error('hostile getter');}},
    {...req(ch),score:NaN},{...req(ch),score:-1},
    {...req(ch),seed:'bad\nseed'},
    {...req(ch),runId:'not valid spaces'},
  ]){
    assert.throws(()=>l.submitProvisional('alice',candidate,consent),e=>
      e.code==='malformed-client-request'||e.code==='unverified-admission-refused'||e.code==='not-provisional-human-submission');
  }
  assert.equal(l.submitProvisional('alice',req(ch),consent).status,'UNVERIFIED');
 }finally{f.cleanup();}
});

test('server time and actual received timestamp control deadline, never user clock or payment lane',()=>{
 const f=fixture();try{
  const l=f.ledger,ch=l.issueServerChallenge('alice',spec());
  assert.equal(ch.issuedAtMs,1000_000);
  f.setTime(ch.expiresAtMs);
  const a=l.submitProvisional('alice',req(ch),consent);
  assert.equal(a.receivedAtMs,ch.expiresAtMs);
  const old=l.issueServerChallenge('alice',spec());
  f.setTime(old.expiresAtMs+1);
  err(()=>l.submitProvisional('alice',req(old,{receivedAtMs:1000_000}),consent),'unverified-admission-refused');
  err(()=>l.submitProvisional('alice',req(old),consent),'challenge-expired');
  // Exact same free/paid v1 adjudication: provider is NOT an input to the
  // authoritative decision, and paying cannot promote UNVERIFIED evidence.
  const p=req(old),c={kind:'trusted-consent-receipt',status:'granted',runId:p.runId,
    manifestDigest:p.manifestDigest,tapeDigest:p.tapeDigest,score:p.score,endTick:p.endTick,
    seed:p.seed,biomeMask:p.biomeMask,lane:p.lane,loadoutDigest:p.loadoutDigest,
    intent:p.intent,scope:'score-and-evidence',audienceGate:'passed'};
  const free=adjudicateDualProof({request:p,consent:c,allowProvisional:true});
  const paid=adjudicateDualProof({request:p,consent:c,allowProvisional:true});
  assert.deepEqual(free,paid);
  assert.equal(free.publication,'provisional-unverified');
  assert.equal(free.verifiedRankEligible,false);
 }finally{f.cleanup();}
});
