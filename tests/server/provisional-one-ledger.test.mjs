import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {canonicalBytes,parseCanonical} from '../../src/systems/replay/canonicalJson.js';
import {openAdmissionLedger} from '../../server/trust/admission.mjs';
import {openPublicWallet,equipmentDigest,equipmentProjection} from '../../server/trust/publicWallet.mjs';
import {openProvisionalLedger} from '../../server/trust/provisional.mjs';
import {openBlindPeerCoordinator} from '../../server/trust/blindPeerCoordinator.mjs';
import {prepareReplayEvidence} from '../../server/trust/replayEvidence.mjs';
import {KODIAK_VERSION} from '../../src/systems/Kodiaks.js';

const d=c=>'sha256:'+c.repeat(64);
const roles=['simulation','authorization','consent'];
const cur=JSON.parse(readFileSync(new URL('../../tools/ruleset/current.json',import.meta.url)));
const trustedRuleset={rulesetId:cur.rulesetId,
  ruleset:JSON.parse(readFileSync(new URL('../../'+cur.archivePath,import.meta.url)))};
const stock={upgradeRanks:{},boosts:[],magnetsDrop:false,
  kodiak:{enabled:false,packMode:'same',version:KODIAK_VERSION},
  syncLevel:1,dailyRuleId:'none',dailyRuleSource:'clock-at-start'};
const consent={consentAuthorized:true,audienceAllowed:true};
const evidence=canonicalBytes(parseCanonical(readFileSync(new URL('../fixtures/trust/peer-scripted-evidence.json',import.meta.url))));
const actual=parseCanonical(readFileSync(new URL('../fixtures/trust/peer-scripted-observation.json',import.meta.url)));
const prepared=prepareReplayEvidence(evidence,trustedRuleset);
assert.equal(prepared.ok,true);
const realStock=equipmentProjection(prepared.causal);


function fixture(t){
  let time=100000;
  const dir=mkdtempSync(join(tmpdir(),'bb-provisional-one-ledger-'));
  const databasePath=join(dir,'authority.sqlite');
  const issuers=roles.map(role=>({role,keyId:role+'-fixture',
    publicKey:generateKeyPairSync('ed25519').publicKey}));
  const ledger=openAdmissionLedger({databasePath,issuers,trustedRuleset,
    clock:()=>time,challengeTtlMs:1000});
  const wallet=openPublicWallet({databasePath,
    rewardPublicKey:generateKeyPairSync('ed25519').publicKey});
  const provisional=openProvisionalLedger({databasePath,trustedRuleset,clock:()=>time});
  const peers=openBlindPeerCoordinator({databasePath,trustedRuleset,pseudonymKey:randomBytes(32),
    verifierBuildId:d('e'),clock:()=>time});
  t.after(()=>{peers.close();provisional.close();wallet.close();ledger.close();rmSync(dir,{recursive:true,force:true});});
  let num=0;
  function issue(account='alice',{qualify=true}={}){
    const course={runId:'run-'+(++num),buildId:'test-build',
      rulesetId:cur.rulesetId,seed:prepared.tape.seed,biomeMask:prepared.tape.biomeMask,
      lane:'stock',loadoutDigest:equipmentDigest(realStock),assistance:'human'};
    const challenge=ledger.issueChallenge(account,canonicalBytes(course),d('e'),canonicalBytes(realStock));
    const pending=peers.begin(account,challenge.challengeId,evidence,{board:'human',optedIn:true});
    assert.equal(pending.ok,true,JSON.stringify(pending));
    const request={format:'bb-dual-proof',version:1,...course,manifestDigest:prepared.identity.manifestDigest,
      tapeDigest:prepared.identity.tapeDigest,score:prepared.expected.score,
      endTick:prepared.expected.endTick,intent:'provisional-public',
      challengeId:challenge.challengeId};
    if(qualify)assert.equal(complete(account,pending).status,'UNVERIFIED');
    return {request,challenge,pending};
  }
  function complete(account,pending,{mismatch=false}={}){
   const observation=mismatch?{...actual,score:actual.score+1}:actual;
   return peers.completeLocal(account,pending.submissionId,canonicalBytes({
    evidenceDigest:prepared.identity.bundleDigest,observation}));
  }
  return {issue,complete,peers,ledger,wallet,provisional,databasePath,
    setTime:value=>time=value,read:()=>new DatabaseSync(databasePath,{readOnly:true})};
}

test('one existing signed challenge creates a public-safe UNVERIFIED entry with no wallet, rank or verified admission',t=>{
  const s=fixture(t),{request}=s.issue();
  const accepted=s.provisional.submit('alice',canonicalBytes(request),consent);
  assert.equal(accepted.ok,true,JSON.stringify(accepted));
  assert.equal(accepted.status,'UNVERIFIED');
  assert.equal(accepted.verifiedRankEligible,false);
  assert.equal(accepted.publicRewardEligible,false);
  const view=s.provisional.publicView(accepted.submissionId);
  assert.deepEqual(view,{submissionId:accepted.submissionId,status:'UNVERIFIED',
    score:request.score,seed:request.seed,biomeMask:request.biomeMask,lane:'stock',receivedAtMs:100000,
    verifiedRankEligible:false,publicRewardEligible:false});
  for(const secret of ['alice','tapeDigest','manifestDigest','account','challengeId'])
    assert.equal(JSON.stringify(view).includes(secret),false,secret);
  assert.deepEqual(s.wallet.snapshot('alice'),{balance:0,ranks:{}});
  const db=s.read();
  try{
    assert.equal(db.prepare('SELECT count(*) AS n FROM admissions').get().n,0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM public_wallet').get().n,0);
    assert.throws(()=>db.prepare('UPDATE public_provisional_submissions SET status=?').run('VERIFIED'));
  }finally{db.close();}
  assert.equal(s.provisional.submit('alice',canonicalBytes(request),consent).reason,'already-published');
  assert.equal(s.ledger.admit('alice',canonicalBytes({
    request,receipts:{simulation:{},authorization:{},consent:{}}
  })).reason,'invalid-request');
});

test('forged local money, Verified flags and paid route never consume a real challenge',t=>{
  const s=fixture(t),{request}=s.issue();
  assert.equal(s.provisional.submit('alice',canonicalBytes(request),{}).reason,'consent-or-audience-required');
  assert.equal(s.provisional.submit('alice',canonicalBytes(request),{
    consentAuthorized:true,audienceAllowed:false}).reason,'consent-or-audience-required');
  for(const extra of [{bank:1000000000},{wallet:{serverShards:1e9}},
    {verified:true},{paidVerifier:true},{publicRewardEligible:true},
    {issuer:'server'},{ranked:true},{receivedAtMs:0}]){
    const result=s.provisional.submit('alice',canonicalBytes({...request,...extra}),consent);
    assert.equal(result.ok,false,JSON.stringify(extra));
  }
  for(const change of [{seed:'another-seed'},{lane:'modded'},
    {rulesetId:d('9')},{buildId:'fake-build'},{loadoutDigest:d('8')}]){
    assert.equal(s.provisional.submit('alice',canonicalBytes({...request,...change}),consent).ok,false);
  }
  assert.equal(s.provisional.submit('bob',canonicalBytes(request),consent).reason,'challenge-not-owned');
  assert.equal(s.provisional.submit('alice',canonicalBytes(request),consent).ok,true);
  assert.deepEqual(s.wallet.snapshot('alice'),{balance:0,ranks:{}});
});

test('two SQLite connections and a restart cannot publish the same challenge twice',t=>{
  const s=fixture(t),{request}=s.issue();
  const second=openProvisionalLedger({databasePath:s.databasePath,trustedRuleset,clock:()=>100000});
  try{
    const a=s.provisional.submit('alice',canonicalBytes(request),consent);
    assert.equal(a.ok,true);
    assert.equal(second.submit('alice',canonicalBytes(request),consent).reason,'already-published');
    assert.deepEqual(second.publicView(a.submissionId),s.provisional.publicView(a.submissionId));
  }finally{second.close();}
  const reopened=openProvisionalLedger({databasePath:s.databasePath,trustedRuleset,clock:()=>100000});
  try{
    assert.equal(reopened.submit('alice',canonicalBytes(request),consent).reason,'already-published');
  }finally{reopened.close();}
});

test('local publication gate rejects until check passes; original timely submission survives slow verification',t=>{
  const s=fixture(t),{request,challenge,pending}=s.issue('alice',{qualify:false});
  for(const data of [undefined,null,{},new Date(),new Map(),
    Buffer.from('not canonical'),new Uint8Array(256*1024+1),
    canonicalBytes({...request,score:-1}),
    canonicalBytes({...request,assistance:'tool-assisted'}),
    canonicalBytes({...request,intent:'verified-public'})]){
    assert.equal(s.provisional.submit('alice',data,consent).ok,false);
  }
  assert.equal(s.provisional.submit('alice',canonicalBytes(request),consent).reason,'local-qualification-required');
  s.setTime(challenge.expiresAt);
  assert.equal(s.provisional.submit('alice',canonicalBytes(request),consent).reason,'local-qualification-required');
  assert.equal(s.complete('alice',pending).status,'UNVERIFIED');
  const published=s.provisional.submit('alice',canonicalBytes(request),consent);
  assert.equal(published.ok,true);
  assert.equal(published.receivedAtMs,100000);
  assert.deepEqual(s.wallet.snapshot('alice'),{balance:0,ranks:{}});
  const db=s.read();
  try{assert.equal(db.prepare('SELECT count(*) AS n FROM public_provisional_submissions').get().n,1);}
  finally{db.close();}
});

test('unsupported or unowned equipment cannot obtain a valid server challenge',t=>{
  const s=fixture(t),{request}=s.issue();
  assert.throws(()=>s.ledger.issueChallenge('alice',
    canonicalBytes({...Object.fromEntries(['runId','buildId','rulesetId','seed','biomeMask','lane','loadoutDigest','assistance'].map(k=>[k,request[k]])),
      lane:'modded',loadoutDigest:d('f')}),
    d('e'),canonicalBytes({...stock,upgradeRanks:{speed:1000000}})),/unowned-upgrade/);
  const result=s.provisional.submit('alice',canonicalBytes(request),consent);
  assert.equal(result.ok,true);
  assert.equal(s.wallet.settle('alice',canonicalBytes({shards:1000000000})).ok,false);
  assert.deepEqual(s.wallet.snapshot('alice'),{balance:0,ranks:{}});
});

test('creator failed local playback is never provisional even if all peer work would match',t=>{
 const s=fixture(t),{request,pending}=s.issue('alice',{qualify:false});
 assert.deepEqual(s.complete('alice',pending,{mismatch:true}),{ok:true,status:'not-published'});
 assert.equal(s.provisional.submit('alice',canonicalBytes(request),consent).reason,'local-qualification-required');
 const db=s.read();
 try{assert.equal(db.prepare('SELECT count(*) AS n FROM public_provisional_submissions').get().n,0);}
 finally{db.close();}
});
test('locally qualified request cannot change claimed score, tape or manifest after replay',t=>{
 const s=fixture(t),{request}=s.issue();
 for(const change of [{score:request.score+1},{endTick:request.endTick+1},
   {manifestDigest:d('8')},{tapeDigest:d('7')}])
  assert.equal(s.provisional.submit('alice',canonicalBytes({...request,...change}),consent).ok,false);
 assert.equal(s.provisional.submit('alice',canonicalBytes(request),consent).ok,true);
});
