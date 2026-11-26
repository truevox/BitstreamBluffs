import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {canonicalBytes} from '../../src/systems/replay/canonicalJson.js';
import {openAdmissionLedger} from '../../server/trust/admission.mjs';
import {openPublicWallet,equipmentProjection,equipmentDigest} from '../../server/trust/publicWallet.mjs';
import {prepareReplayEvidence} from '../../server/trust/replayEvidence.mjs';

// Ephemeral integration fixture only. The scripted inputs are NOT proof of
// human play; the synthetic authority receipts exercise the storage boundary.
export function exerciseBoundAdmission(bytes,trustedRuleset,buildId){
 const p=prepareReplayEvidence(bytes,trustedRuleset);
 assert.equal(p.ok,true);
 const dir=mkdtempSync(join(tmpdir(),'bb-bound-admission-'));
 const databasePath=join(dir,'test.sqlite');
 const roles=['simulation','authorization','consent'];
 const keys=Object.fromEntries(roles.map(role=>[role,generateKeyPairSync('ed25519')]));
 const reward=generateKeyPairSync('ed25519');
 const now=10000,account='fixture-player',pin='sha256:'+'e'.repeat(64);
 const digest=v=>'sha256:'+createHash('sha256').update(canonicalBytes(v)).digest('hex');
 const ledger=openAdmissionLedger({databasePath,trustedRuleset,clock:()=>now,issuers:roles.map(role=>({role,keyId:role+'-test',publicKey:keys[role].publicKey}))});
 const wallet=openPublicWallet({databasePath,rewardPublicKey:reward.publicKey});
 try{
  const loadout=equipmentProjection(p.causal);
  const course={runId:'fixture-run',buildId,rulesetId:p.identity.rulesetId,seed:p.tape.seed,biomeMask:p.tape.biomeMask,lane:'stock',loadoutDigest:equipmentDigest(loadout),assistance:'human'};
  const challenge=ledger.issueChallenge(account,canonicalBytes(course),pin,canonicalBytes(loadout));
  const r={format:'bb-dual-proof',version:1,...course,manifestDigest:p.identity.manifestDigest,tapeDigest:p.identity.tapeDigest,score:p.expected.score,endTick:p.expected.endTick,intent:'verified-public',challengeId:challenge.challengeId};
  const seal=(body,key)=>({body,signature:sign(null,canonicalBytes(body),key).toString('base64url')});
  function bundle(request){
   const q=request;
   const payloads={
    simulation:{kind:'trusted-replay-execution',runId:q.runId,buildId:q.buildId,verifierBuildId:pin,verifiedCourse:{seed:q.seed,biomeMask:q.biomeMask,lane:q.lane,loadoutDigest:q.loadoutDigest},score:q.score,endTick:q.endTick,tapeComplete:true,assistanceObserved:'human',record:{outcome:'match',verifiedUnder:q.rulesetId,verifierId:'in-game',tapeDigest:q.tapeDigest,manifestDigest:q.manifestDigest}},
    authorization:{kind:'trusted-eligibility-receipt',status:'authorized',...Object.fromEntries(['runId','buildId','rulesetId','seed','biomeMask','lane','loadoutDigest','manifestDigest','tapeDigest','score','endTick','challengeId'].map(k=>[k,q[k]])),challengeStatus:'fresh',economyStatus:'authorized',equipmentStatus:'authorized',modeStatus:'allowed',pinnedVerifierBuildId:pin},
    consent:{kind:'trusted-consent-receipt',status:'granted',...Object.fromEntries(['runId','manifestDigest','tapeDigest','score','endTick','seed','biomeMask','lane','loadoutDigest','intent'].map(k=>[k,q[k]])),scope:'score-only',audienceGate:'passed'}
   };
   return canonicalBytes({request:q,receipts:Object.fromEntries(roles.map(role=>[role,seal({format:'bb-authority-receipt',version:1,role,keyId:role+'-test',accountId:account,challengeId:q.challengeId,claimDigest:digest(q),evidenceDigest:p.identity.bundleDigest,issuedAt:now,expiresAt:challenge.expiresAt,payload:payloads[role]},keys[role].privateKey)]))});
  }
  const unowned={...loadout,upgradeRanks:{speed:1000000}};
  assert.throws(()=>ledger.issueChallenge(account,canonicalBytes({...course,lane:'modded',loadoutDigest:equipmentDigest(unowned)}),pin,canonicalBytes(unowned)),/unowned-upgrade/);
  const forged={...r,lane:'modded',loadoutDigest:equipmentDigest(unowned)};
  assert.equal(ledger.admit(account,bundle(forged),bytes).reason,'evidence-identity-mismatch');
  assert.equal(ledger.admit(account,bundle({...r,score:r.score+1}),bytes).reason,'evidence-identity-mismatch');
  assert.equal(ledger.admit('other-account',bundle(r),bytes).reason,'challenge-not-owned');
  const altered=JSON.parse(Buffer.from(bytes).toString('utf8'));
  altered.checkpoints[0][1]='0'.repeat(16);
  assert.equal(ledger.admit(account,bundle(r),canonicalBytes(altered)).reason,'unauthenticated-simulation');
  const accepted=ledger.admit(account,bundle(r),bytes);
  assert.equal(accepted.admitted,true,JSON.stringify(accepted));
  assert.equal(ledger.admit(account,bundle(r),bytes).reason,'already-admitted');
  const rewardBody={format:'bb-public-shard-settlement',version:1,account,runId:r.runId,claimDigest:digest(r),shards:28};
  const signed=canonicalBytes(seal(rewardBody,reward.privateKey));
  assert.deepEqual(wallet.settle(account,signed),{ok:true,balance:28});
  assert.equal(wallet.settle(account,signed).reason,'already-settled');
  assert.deepEqual(wallet.purchase(account,canonicalBytes({operationId:'test-purchase',upgradeId:'speed'})),{ok:true,rank:1,price:28,balance:0});
  assert.deepEqual(wallet.snapshot(account),{balance:0,ranks:{speed:1}});
  const owned={...loadout,upgradeRanks:{speed:1}};
  assert.doesNotThrow(()=>ledger.issueChallenge(account,canonicalBytes({...course,runId:'fixture-next',lane:'modded',loadoutDigest:equipmentDigest(owned)}),pin,canonicalBytes(owned)));
  console.log('PASS_BOUND_ADMISSION_WALLET_FIXTURE');
 }finally{wallet.close();ledger.close();rmSync(dir,{recursive:true,force:true});}
}
