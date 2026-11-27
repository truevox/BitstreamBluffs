// #135 compiled-game LOCAL + 2 peer execution in parallel, no public network.
// Distinct Chromium replay contexts; all user accounts and keys are synthetic.
// A matching peer observation is NOT a cryptographic trusted issuer receipt.
import assert from 'node:assert/strict';
import {randomBytes,generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {boot,recordRun,closeHarness} from '../test-takeover-browser.mjs';
import {replay} from './test-real-independent-replay.mjs';
import {canonicalBytes,parseCanonical} from '../../src/systems/replay/canonicalJson.js';
import {prepareReplayEvidence} from '../../server/trust/replayEvidence.mjs';
import {equipmentDigest,equipmentProjection} from '../../server/trust/publicWallet.mjs';
import {openAdmissionLedger} from '../../server/trust/admission.mjs';
import {openProvisionalLedger} from '../../server/trust/provisional.mjs';
import {openBlindPeerCoordinator} from '../../server/trust/blindPeerCoordinator.mjs';
import {DatabaseSync} from 'node:sqlite';

const d=c=>'sha256:'+c.repeat(64);
const current=parseCanonical(readFileSync(new URL('../../tools/ruleset/current.json',import.meta.url)));
const trustedRuleset={rulesetId:current.rulesetId,ruleset:parseCanonical(readFileSync(new URL('../../'+current.archivePath,import.meta.url)))};
const dir=mkdtempSync(join(tmpdir(),'bb-triple-replay-'));
const databasePath=join(dir,'trust.sqlite');
let admission,peers,provisional;

try{
 await boot();
 const {P,info}=await recordRun({seed:'A',fixture:'hazard'});
 const stored=await P.page.evaluate(async()=>{
  const status=window.__bbGame.registry.get('lastEvidenceStatus');
  if(!status?.ok||!status?.durable)throw Error('evidence not durably stored');
  const db=await new Promise((resolve,reject)=>{
   const r=indexedDB.open('bitstream-replay-evidence');
   r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  try{
   const row=await new Promise((resolve,reject)=>{
    const r=db.transaction('bundles','readonly').objectStore('bundles').get(status.digest);
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
   });
   return Array.from(row.bytes);
  }finally{db.close();}
 });
 await P.close();
 const evidence=Uint8Array.from(stored),prepared=prepareReplayEvidence(evidence,trustedRuleset);
 assert.equal(prepared.ok,true,JSON.stringify(prepared));
 const issuerRoles=['simulation','authorization','consent'];
 const issuers=issuerRoles.map(role=>({role,keyId:role+'-fixture',
  publicKey:generateKeyPairSync('ed25519').publicKey}));
 const clock=()=>10000,verifierBuildId=d('e'),loadout=equipmentProjection(prepared.causal);
 admission=openAdmissionLedger({databasePath,trustedRuleset,issuers,clock,challengeTtlMs:600000});
 peers=openBlindPeerCoordinator({databasePath,trustedRuleset,pseudonymKey:randomBytes(32),
  verifierBuildId,peerTarget:2,maxConcurrent:1,clock,
  chooseIndex:()=>0}); // deterministic test picker; production default uses crypto random
 provisional=openProvisionalLedger({databasePath,trustedRuleset,clock});
 const queued=new Map();
 for(const account of ['alice','bob','carol']){
  const course={runId:'run-'+account,buildId:info.tape.buildId,rulesetId:current.rulesetId,
   seed:prepared.tape.seed,biomeMask:prepared.tape.biomeMask,lane:'stock',
   loadoutDigest:equipmentDigest(loadout),assistance:'human'};
  const challenge=admission.issueChallenge(account,canonicalBytes(course),verifierBuildId,canonicalBytes(loadout));
  const began=peers.begin(account,challenge.challengeId,evidence,{board:'human',optedIn:true});
  assert.equal(began.ok,true,JSON.stringify(began));
  queued.set(account,{course,challenge,began});
 }
 const source=queued.get('alice');
 assert.equal(peers.ownStatus('alice',source.began.submissionId).publication,'NONE');
 const assignedBob=peers.claimForAutomaticPeer('bob',{deviceReady:true});
 const assignedCarol=peers.claimForAutomaticPeer('carol',{deviceReady:true});
 assert.equal(assignedBob.ok,true,JSON.stringify(assignedBob));
 assert.equal(assignedCarol.ok,true,JSON.stringify(assignedCarol));
 assert.notEqual(assignedBob.job.id,assignedCarol.job.id);
 assert.equal(assignedBob.job.verifierBuildId,verifierBuildId);
 assert.equal(assignedCarol.job.verifierBuildId,verifierBuildId);
 // Concurrent real browser computation: creator + two independent peers.
 const [local,bob,carol]=await Promise.all([
  replay(evidence),replay(assignedBob.job.evidence),replay(assignedCarol.job.evidence)
 ]);
 for(const [who,result] of [['LOCAL',local],['PEER_BOB',bob],['PEER_CAROL',carol]]){
  assert.equal(result.ok,true,who+': '+JSON.stringify(result));
  console.log('PASS_COMPILED_'+who+' tick='+result.actual.seek.tick+
   ' score='+result.actual.score+' checkpoints='+result.actual.checked);
 }
 const report=result=>canonicalBytes({evidenceDigest:prepared.identity.bundleDigest,observation:result.actual});
 assert.equal(peers.completePeer('bob',assignedBob.job.id,assignedBob.job.leaseToken,report(bob)).ok,true);
 assert.equal(peers.completePeer('carol',assignedCarol.job.id,assignedCarol.job.leaseToken,report(carol)).ok,true);
 assert.equal(peers.ownStatus('alice',source.began.submissionId).publication,'NONE');
 const claim={format:'bb-dual-proof',version:1,...source.course,
  manifestDigest:prepared.identity.manifestDigest,tapeDigest:prepared.identity.tapeDigest,
  score:prepared.expected.score,endTick:prepared.expected.endTick,
  intent:'provisional-public',challengeId:source.challenge.challengeId};
 assert.equal(provisional.submit('alice',canonicalBytes(claim),
  {consentAuthorized:true,audienceAllowed:true}).reason,'local-qualification-required');
 assert.deepEqual(peers.completeLocal('alice',source.began.submissionId,report(local)),
  {ok:true,status:'UNVERIFIED'});
 const status=peers.ownStatus('alice',source.began.submissionId);
 assert.equal(status.publication,'UNVERIFIED');
 assert.equal(status.peerConsensus,true);
 const published=provisional.submit('alice',canonicalBytes(claim),
  {consentAuthorized:true,audienceAllowed:true});
 assert.equal(published.ok,true,JSON.stringify(published));
 const publicView=provisional.publicView(published.submissionId);
 assert.equal(publicView.status,'UNVERIFIED');
 assert.equal(publicView.verifiedRankEligible,false);
 assert.equal(publicView.publicRewardEligible,false);
 const db=new DatabaseSync(databasePath,{readOnly:true});
 try{
  assert.equal(db.prepare('SELECT count(*) AS n FROM admissions').get().n,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM public_rewards').get().n,0);
 }finally{db.close();}
 console.log('PASS_COMPILED_LOCAL_AND_TWO_PEERS_PRIVATE_GATE_PUBLIC_UNVERIFIED');
}finally{
 provisional?.close();peers?.close();admission?.close();
 await closeHarness();
 rmSync(dir,{recursive:true,force:true});
}
