import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {canonicalBytes,parseCanonical} from '../../src/systems/replay/canonicalJson.js';
import {digestOf} from '../../src/systems/replay/canonicalSha256.js';
import {equipmentProjection,equipmentDigest} from './publicWallet.mjs';
import {prepareReplayEvidence} from './replayEvidence.mjs';
import {openAdmissionLedger} from './admission.mjs';
import {openBlindPeerCoordinator} from './blindPeerCoordinator.mjs';

const current=parseCanonical(readFileSync(new URL('../../tools/ruleset/current.json',import.meta.url)));
const trustedRuleset={rulesetId:current.rulesetId,ruleset:parseCanonical(readFileSync(new URL('../../'+current.archivePath,import.meta.url)))};
const base=parseCanonical(readFileSync(new URL('../../tests/fixtures/trust/peer-scripted-evidence.json',import.meta.url)));
const variant=n=>{
 const b=structuredClone(base);
 b.manifest.info.gameVersion='qa-peer-variant-'+n;
 b.manifestDigest=digestOf(b.manifest);
 return canonicalBytes(b);
};
const byVariant=Array.from({length:10},(_,n)=>variant(n));
for(const [i,bytes] of byVariant.entries())
 assert.equal(prepareReplayEvidence(bytes,trustedRuleset).ok,true,'fixture '+i);
const replayObservation=parseCanonical(readFileSync(new URL('../../tests/fixtures/trust/peer-scripted-observation.json',import.meta.url)));
const localReport=(digest,{mismatch=false}={})=>canonicalBytes({evidenceDigest:digest,
 observation:mismatch?{...replayObservation,score:replayObservation.score+1}:replayObservation});
const jobReport=(job,{mismatch=false}={})=>localReport(prepareReplayEvidence(job.evidence,trustedRuleset).identity.bundleDigest,{mismatch});

function harness(t,{peerTarget=2,maxConcurrent=1,chooseIndex=n=>0}={}){
 const dir=mkdtempSync(join(tmpdir(),'bsb-blind-peer-')),databasePath=join(dir,'ledger.sqlite');
 const issuers=['simulation','authorization','consent'].map(role=>({role,keyId:role+'-fixture',publicKey:generateKeyPairSync('ed25519').publicKey}));
 let now=10000;
 const admission=openAdmissionLedger({databasePath,issuers,trustedRuleset,clock:()=>now,challengeTtlMs:600000});
 const secret=randomBytes(32);
 const options={databasePath,trustedRuleset,pseudonymKey:secret,verifierBuildId:'sha256:'+'b'.repeat(64),clock:()=>now,peerTarget,maxConcurrent,chooseIndex};
 let peers=openBlindPeerCoordinator(options);
 t.after(()=>{peers.close();admission.close();rmSync(dir,{recursive:true,force:true});});
 function submit(account,index,{board='human',assistance='human',optedIn=true,manualTasChallenge=false}={}){
  const bytes=byVariant[index],p=prepareReplayEvidence(bytes,trustedRuleset);
  const loadout=equipmentProjection(p.causal),course={runId:'run-'+account+'-'+index,buildId:'build-fixture',
   rulesetId:current.rulesetId,seed:p.tape.seed,biomeMask:p.tape.biomeMask,lane:'stock',
   loadoutDigest:equipmentDigest(loadout),assistance};
  let challenge;
  if(manualTasChallenge){
   const created=peers.issueTasChallenge(account,canonicalBytes(course),'sha256:'+'b'.repeat(64),canonicalBytes(loadout));
   assert.equal(created.ok,true,JSON.stringify(created));
   challenge=created;
  }else{
   challenge=admission.issueChallenge(account,canonicalBytes(course),'sha256:'+'b'.repeat(64),canonicalBytes(loadout));
  }
  return {bytes,challengeId:challenge.challengeId,account,
    started:peers.begin(account,challenge.challengeId,bytes,{board,optedIn}),
    digest:p.identity.bundleDigest,board};
 }
 const pass=s=>peers.completeLocal(s.account,s.started.submissionId,localReport(s.digest));
 const fail=s=>peers.completeLocal(s.account,s.started.submissionId,localReport(s.digest,{mismatch:true}));
 const claim=account=>peers.claimForAutomaticPeer(account,{deviceReady:true});
 const complete=(account,job,outcome='match')=>peers.completePeer(account,job.id,job.leaseToken,jobReport(job,{mismatch:outcome==='mismatch'}));
 const status=s=>peers.ownStatus(s.account,s.started.submissionId);
 const inspect=fn=>{const db=new DatabaseSync(databasePath,{readOnly:true});try{return fn(db);}finally{db.close();}};
 const reopen=()=>{peers.close();peers=openBlindPeerCoordinator(options);};
 return {submit,pass,fail,claim,complete,status,inspect,reopen,advance:n=>{now+=n;},api:()=>peers,options,databasePath};
}

test('creator local check gates provisional publication; peers can check concurrently without awarding Verified',t=>{
 const h=harness(t),a=h.submit('alice',0),b=h.submit('bob',1),c=h.submit('carol',2);
 assert.equal(a.started.ok,true);assert.equal(b.started.ok,true);assert.equal(c.started.ok,true);
 assert.deepEqual(h.status(a),{ok:true,board:'human',local:'running',publication:'NONE',peerConsensus:false,disputed:false});
 const j1=h.claim('bob');const j2=h.claim('carol');
 assert.equal(j1.ok,true);assert.equal(j2.ok,true);
 for(const x of [j1.job,j2.job]){
  assert.deepEqual(Object.keys(x).sort(),['board','evidence','expiresAt','id','kind','leaseToken','rulesetId','verifierBuildId'].sort());
  assert.equal(x.kind,'exact-run');assert.equal(x.board,'human');
  assert.deepEqual(x.evidence,a.bytes);
 }
 assert.deepEqual(h.complete('bob',j1.job),{ok:true,accepted:true});
 assert.deepEqual(h.complete('carol',j2.job),{ok:true,accepted:true});
 assert.equal(h.status(a).publication,'NONE');
 assert.deepEqual(h.pass(a),{ok:true,status:'UNVERIFIED'});
 const view=h.status(a);
 assert.equal(view.publication,'UNVERIFIED');
 assert.equal(view.peerConsensus,true);
 assert.equal(view.disputed,false);
 assert.equal(h.inspect(db=>db.prepare('SELECT count(*) AS n FROM admissions').get().n),0);
 assert.equal(h.inspect(db=>db.prepare('SELECT count(*) AS n FROM public_rewards').get().n),0);
});

test('failed local qualification never publishes even after two peer matches',t=>{
 const h=harness(t),a=h.submit('alice',0),b=h.submit('bob',1),c=h.submit('carol',2);
 const j1=h.claim('bob'),j2=h.claim('carol');
 assert.equal(h.complete('bob',j1.job).ok,true);assert.equal(h.complete('carol',j2.job).ok,true);
 assert.deepEqual(h.fail(a),{ok:true,status:'not-published'});
 assert.equal(h.status(a).publication,'NONE');
 assert.equal(h.status(a).peerConsensus,false);
 assert.equal(h.pass(a).reason,'local-already-finished');
 assert.equal(h.inspect(db=>db.prepare('SELECT publication FROM private_verification WHERE id=?').get(a.started.submissionId).publication),'failed-local');
});

test('local must explicitly opt in and only a concurrently self-checking device can accept random work',t=>{
 const h=harness(t);
 const a=h.submit('alice',0,{optedIn:false});
 assert.equal(a.started.reason,'consent-or-identity-required');
 assert.equal(h.claim('alice').reason,'own-local-check-not-running');
 const b=h.submit('bob',1);
 assert.equal(h.api().claimForAutomaticPeer('bob',{deviceReady:false}).reason,'not-ready');
 assert.equal(h.claim('bob').reason,'no-background-work');
 const c=h.submit('carol',2);
 assert.equal(h.claim('bob').ok,true);
 assert.equal(h.claim('bob').reason,'device-budget-full');
 assert.equal(h.api().claimForAutomaticPeer('mallory',{deviceReady:true}).reason,'own-local-check-not-running');
 assert.equal(h.status(b).publication,'NONE');
 assert.equal(h.status(c).publication,'NONE');
});

test('workers cannot choose or retry target, and assignment is account/lease bound',t=>{
 const h=harness(t),a=h.submit('alice',0),b=h.submit('bob',1),c=h.submit('carol',2);
 const j=h.claim('bob');
 assert.equal(j.ok,true);
 const wrong=h.api().completePeer('carol',j.job.id,j.job.leaseToken,jobReport(j.job));
 assert.equal(wrong.reason,'not-assigned');
 assert.equal(h.api().completePeer('bob',j.job.id,'wrong',jobReport(j.job)).reason,'malformed-peer-result');
 assert.equal(h.api().completePeer('bob',j.job.id,j.job.leaseToken,canonicalBytes({evidenceDigest:'bogus',observation:replayObservation})).reason,'malformed-peer-result');
 assert.equal(h.complete('bob',j.job).ok,true);
 assert.equal(h.complete('bob',j.job).reason,'lease-not-active');
 // Replayed completed assignment is not offered again to the same worker.
 const next=h.claim('bob');
 assert.equal(next.ok,true);
 assert.notDeepEqual(next.job.evidence,j.job.evidence);
 assert.equal(h.status(a).publication,'NONE');
});

test('lease expiry opens a new slot without letting the expired verifier reroll',t=>{
 const h=harness(t),a=h.submit('alice',0),b=h.submit('bob',1),c=h.submit('carol',2),d=h.submit('dave',3);
 const j1=h.claim('bob'),j2=h.claim('carol');assert.equal(j1.ok&&j2.ok,true);
 h.advance(120001);
 assert.equal(h.complete('bob',j1.job).reason,'lease-not-active');
 const fresh=h.claim('dave');
 assert.equal(fresh.ok,true);
 assert.deepEqual(fresh.job.evidence,a.bytes);
 assert.equal(h.inspect(db=>db.prepare("SELECT count(*) AS n FROM private_peer_assignment WHERE submission=? AND state='expired'").get(a.started.submissionId).n),2);
 const reroll=h.claim('bob');assert.ok(!reroll.ok||!Buffer.from(reroll.job.evidence).equals(Buffer.from(a.bytes)));
});

test('persisted assignments and pseudonymous worker tokens survive restart without exposing participant mapping',t=>{
 const h=harness(t),a=h.submit('alice',0),b=h.submit('bob',1);
 const j=h.claim('bob');assert.equal(j.ok,true);
 h.reopen();
 assert.equal(h.complete('bob',j.job).ok,true);
 assert.equal(h.inspect(db=>db.prepare('SELECT verifier_tag FROM private_peer_assignment WHERE id=?').get(j.job.id).verifier_tag.length),64);
 assert.equal(h.status(a).publication,'NONE');
 assert.equal(h.status(b).publication,'NONE');
});

test('peer mismatches flag dispute but never unilaterally reclassify a Human claim as TAS',t=>{
 const h=harness(t),a=h.submit('alice',0),b=h.submit('bob',1),c=h.submit('carol',2);
 const j1=h.claim('bob'),j2=h.claim('carol');
 assert.equal(h.complete('bob',j1.job,'mismatch').ok,true);
 assert.equal(h.complete('carol',j2.job,'match').ok,true);
 h.pass(a);const status=h.status(a);
 assert.equal(status.board,'human');
 assert.equal(status.disputed,true);
 assert.equal(status.publication,'UNVERIFIED');
 assert.equal(status.peerConsensus,false);
});

test('TAS board is separate and cannot impersonate a Human challenge or mint a ranking',t=>{
 const h=harness(t),a=h.submit('alice',0),b=h.submit('tas-operator',1,{board:'tas',assistance:'ai',manualTasChallenge:true});
 assert.equal(b.started.ok,true);
 const byHuman=h.api().begin('tas-operator',b.challengeId,b.bytes,{board:'human',optedIn:true});
 assert.equal(byHuman.reason,'already-requested'); // challenge can only be used once
 const candidate=h.submit('tas-two',2,{board:'human',assistance:'ai',manualTasChallenge:true});
 assert.equal(candidate.started.reason,'course-or-board-mismatch');
 h.pass(b);assert.equal(h.status(b).board,'tas');assert.equal(h.status(b).publication,'UNVERIFIED');
 assert.equal(h.inspect(db=>db.prepare('SELECT count(*) AS n FROM admissions').get().n),0);
 assert.equal(h.status(a).publication,'NONE');
});

test('server challenge, ruleset, frozen gear and evidence must match before private queue admission',t=>{
 const h=harness(t),a=h.submit('alice',0),b=h.submit('bob',1);
 assert.equal(h.api().begin('bob',a.challengeId,a.bytes,{optedIn:true}).reason,'challenge-not-owned');
 assert.equal(h.api().begin('alice',a.challengeId,b.bytes,{optedIn:true}).reason,'already-requested');
 const invalid=Uint8Array.from([123,255,125]);
 assert.equal(h.api().begin('alice',b.challengeId,invalid,{optedIn:true}).reason,'invalid-evidence');
 assert.equal(h.api().completeLocal('bob',a.started.submissionId,localReport(a.digest)).reason,'not-owned');
 assert.equal(h.api().completeLocal('alice',a.started.submissionId,localReport(b.digest)).reason,'evidence-changed');
 assert.equal(h.status(a).publication,'NONE');
});

test('server-selected randomized among available candidates, never revealed as list',t=>{
 const sampled=[];
 const h=harness(t,{chooseIndex:n=>{sampled.push(n);return n-1;}});
 const first=h.submit('alice',0),second=h.submit('bob',1),worker=h.submit('carol',2);
 const got=h.claim('carol');
 assert.equal(got.ok,true);
 assert.ok(sampled[0]>=2);
 assert.deepEqual(got.job.evidence,second.bytes);
 assert.equal(h.status(first).publication,'NONE');
});


test('the coordinator refuses mere client votes and observations not bound to the exact bundle',t=>{
 const h=harness(t),a=h.submit('alice',0),b=h.submit('bob',1);
 const unbound=canonicalBytes({outcome:'match',evidenceDigest:a.digest});
 assert.equal(h.api().completeLocal('alice',a.started.submissionId,unbound).reason,'malformed-local-result');
 const j=h.claim('bob');assert.equal(j.ok,true);
 assert.equal(h.api().completePeer('bob',j.job.id,j.job.leaseToken,unbound).reason,'malformed-peer-result');
 assert.equal(h.api().completePeer('bob',j.job.id,j.job.leaseToken,localReport(b.digest)).reason,'evidence-changed');
 assert.equal(h.complete('bob',j.job).ok,true);
 assert.equal(h.status(a).publication,'NONE');
});
test('configurable three-verifier exact-run quorum never grants a Verified rank',t=>{
 const h=harness(t,{peerTarget:3}),a=h.submit('alice',0),b=h.submit('bob',1),c=h.submit('carol',2),d=h.submit('dave',3);
 const jobs=[h.claim('bob'),h.claim('carol'),h.claim('dave')];
 assert.ok(jobs.every(x=>x.ok));
 assert.ok(jobs.every(x=>Buffer.from(x.job.evidence).equals(Buffer.from(a.bytes))));
 assert.equal(h.complete('bob',jobs[0].job).ok,true);
 assert.equal(h.complete('carol',jobs[1].job).ok,true);
 h.pass(a);
 assert.equal(h.status(a).peerConsensus,false);
 assert.equal(h.complete('dave',jobs[2].job).ok,true);
 assert.equal(h.status(a).peerConsensus,true);
 assert.equal(h.status(a).publication,'UNVERIFIED');
 assert.equal(h.inspect(db=>db.prepare('SELECT count(*) AS n FROM admissions').get().n),0);
});
test('untrusted or mismatched pinned executable cannot enroll a private public-verification request',t=>{
 const h=harness(t),s=h.submit('alice',0,{optedIn:false});
 const db=new DatabaseSync(h.databasePath);
 try{db.prepare('UPDATE challenges SET verifier=? WHERE id=?').run('sha256:'+'f'.repeat(64),s.challengeId);}finally{db.close();}
 assert.equal(h.api().begin('alice',s.challengeId,s.bytes,{optedIn:true}).reason,'verifier-build-mismatch');
 assert.equal(h.api().begin('alice',s.challengeId,s.bytes,{board:'cross-track',optedIn:true}).reason,'consent-or-identity-required');
});

test('selection spans the entire population, including entries beyond the former oldest-32 window',t=>{
 const sizes=[];
 const h=harness(t,{chooseIndex:n=>{sizes.push(n);return n-1;}});
 const runs=[];
 for(let i=0;i<37;i++)runs.push(h.submit('creator-'+i,i%byVariant.length));
 const verifier=h.submit('peer-worker',8);
 const got=h.claim('peer-worker');
 assert.equal(got.ok,true,JSON.stringify(got));
 assert.equal(sizes[0],37);
 assert.deepEqual(got.job.evidence,runs[36].bytes);
 assert.equal(h.status(verifier).publication,'NONE');
});
