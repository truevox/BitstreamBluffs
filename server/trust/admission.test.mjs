import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {canonicalBytes} from '../../src/systems/replay/canonicalJson.js';
import {openAdmissionLedger} from './admission.mjs';

const d=c=>'sha256:'+c.repeat(64);
const h=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const roles=['simulation','authorization','consent'];
const setup=t=>{
  const dir=mkdtempSync(join(tmpdir(),'bb-admission-'));
  const keys=Object.fromEntries(roles.map(role=>[role,generateKeyPairSync('ed25519')]));
  let now=10000;
  const cfg={databasePath:join(dir,'test.sqlite'),clock:()=>now,challengeTtlMs:1000,
    issuers:roles.map(role=>({role,keyId:role+'-1',publicKey:keys[role].publicKey}))};
  let ledger=openAdmissionLedger(cfg);
  t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true});});
  const course={runId:'run-1',buildId:'build-1',rulesetId:d('a'),seed:'terrain seed',biomeMask:15,lane:'modded',loadoutDigest:d('d'),assistance:'human'};
  function make(account='player-1', c=course){
    const challenge=ledger.issueChallenge(account,canonicalBytes(c),d('e'));
    const r={format:'bb-dual-proof',version:1,...c,manifestDigest:d('b'),tapeDigest:d('c'),score:1000,endTick:200,intent:'verified-public',challengeId:challenge.challengeId};
    const s={kind:'trusted-replay-execution',runId:r.runId,buildId:r.buildId,verifierBuildId:d('e'),verifiedCourse:{seed:r.seed,biomeMask:r.biomeMask,lane:r.lane,loadoutDigest:r.loadoutDigest},score:r.score,endTick:r.endTick,tapeComplete:true,assistanceObserved:'human',record:{outcome:'match',verifiedUnder:r.rulesetId,verifierId:'in-game',tapeDigest:r.tapeDigest,manifestDigest:r.manifestDigest}};
    const a={kind:'trusted-eligibility-receipt',status:'authorized',...Object.fromEntries(['runId','buildId','rulesetId','seed','biomeMask','lane','loadoutDigest','manifestDigest','tapeDigest','score','endTick','challengeId'].map(k=>[k,r[k]])),challengeStatus:'fresh',economyStatus:'authorized',equipmentStatus:'authorized',modeStatus:'allowed',pinnedVerifierBuildId:d('e')};
    const p={kind:'trusted-consent-receipt',status:'granted',...Object.fromEntries(['runId','manifestDigest','tapeDigest','score','endTick','seed','biomeMask','lane','loadoutDigest','intent'].map(k=>[k,r[k]])),scope:'score-only',audienceGate:'passed'};
    const bodies=Object.fromEntries(roles.map((role,i)=>[role,{format:'bb-authority-receipt',version:1,role,keyId:role+'-1',accountId:account,challengeId:r.challengeId,claimDigest:h(canonicalBytes(r)),issuedAt:now,expiresAt:challenge.expiresAt,payload:[s,a,p][i]}]));
    return {request:r,bodies};
  }
  const envelope=(body,role=body.role,key=keys[role].privateKey)=>({body,signature:sign(null,canonicalBytes(body),key).toString('base64url')});
  const bundle=x=>structuredClone({request:x.request,receipts:Object.fromEntries(roles.map(role=>[role,envelope(x.bodies[role])]))});
  return {cfg,keys,make,envelope,bundle,course,admit:(x,account='player-1')=>ledger.admit(account,canonicalBytes(x)),
    setNow:n=>now=n,reopen:()=>{ledger.close();ledger=openAdmissionLedger(cfg);}};
};
test('independent signed receipts admit once, survive restart, and reject duplicate tape/run on a new challenge',t=>{
 const s=setup(t), b=s.bundle(s.make());
 const first=s.admit(b);
 assert.equal(first.admitted,true);assert.equal(first.verdict.verifiedRankEligible,true);
 s.reopen();assert.equal(s.admit(b).reason,'already-admitted');
 const reader=new DatabaseSync(s.cfg.databasePath,{readOnly:true});
 try {
   const rows=reader.prepare('SELECT * FROM admissions').all();assert.equal(rows.length,1);
   assert.deepEqual(JSON.parse(rows[0].receipt_audit),roles.map(role=>({role,keyId:role+'-1',receiptDigest:h(canonicalBytes(b.receipts[role]))})));
 }finally{reader.close();}
 assert.equal(s.admit(s.bundle(s.make())).reason,'already-admitted');
 assert.equal(s.admit(s.bundle(s.make('player-2',{...s.course,runId:'run-2'})),'player-2').reason,'already-admitted');
});
test('forged or tampered signed wallet/gear receipt cannot admit',t=>{
 const s=setup(t), b=s.bundle(s.make());
 b.receipts.authorization.body.payload.economyStatus='rejected';
 assert.equal(s.admit(b).reason,'unauthenticated-authorization');
 const x=s.make();x.bodies.authorization.payload.equipmentStatus='rejected';
 assert.equal(s.admit(s.bundle(x)).reason,'policy-denied');
 const y=s.make();const f=s.bundle(y);f.request.walletBalance=1000000000;
 assert.equal(s.admit(f).reason,'invalid-request');
});
test('unknown issuer, role substitution, self-signed receipt and missing signature fail closed',t=>{
 const s=setup(t), x=s.make();
 for (const mode of ['unknown','role','self','missing']) {
  const b=s.bundle(x), body={...x.bodies.authorization};
  if(mode==='unknown'){body.keyId='unlisted';b.receipts.authorization=s.envelope(body);}
  if(mode==='role'){body.keyId='simulation-1';b.receipts.authorization=s.envelope(body,'simulation');}
  if(mode==='self')b.receipts.authorization=s.envelope(body,'authorization',generateKeyPairSync('ed25519').privateKey);
  if(mode==='missing')delete b.receipts.authorization.signature;
  assert.equal(s.admit(b).reason,'unauthenticated-authorization',mode);
 }
 assert.equal(s.admit(s.bundle(x)).admitted,true);
});
test('account, challenge, claim, expiry and executable pin are independently bound',t=>{
 const s=setup(t), x=s.make(), b=s.bundle(x);
 assert.equal(s.admit(b,'player-2').reason,'challenge-not-owned');
 const changed=s.bundle(x);changed.request.score++;
 assert.equal(s.admit(changed).reason,'unauthenticated-simulation');
 const wrong=s.make();wrong.bodies.simulation.payload.verifierBuildId=d('f');wrong.bodies.authorization.payload.pinnedVerifierBuildId=d('f');
 assert.equal(s.admit(s.bundle(wrong)).reason,'challenge-verifier-mismatch');
 const cross=s.bundle(x);cross.receipts.consent=s.bundle(s.make()).receipts.consent;
 assert.equal(s.admit(cross).reason,'unauthenticated-consent');
 s.setNow(11000);assert.equal(s.admit(b).reason,'challenge-expired');
});
test('expired receipt, future receipt, denied consent, unverified replay cannot admit',t=>{
 const s=setup(t), x=s.make();
 for (const mode of ['expired','future','denied','diverged']){
  const y=s.make();
  if(mode==='expired')y.bodies.consent.expiresAt=10000;
  if(mode==='future')y.bodies.consent.issuedAt=10001;
  if(mode==='denied')y.bodies.consent.payload.status='denied';
  if(mode==='diverged')y.bodies.simulation.payload.record.outcome='diverged';
  assert.equal(s.admit(s.bundle(y)).reason, ['expired','future'].includes(mode)?'unauthenticated-consent':'policy-denied',mode);
 }
 assert.equal(s.admit(s.bundle(x)).admitted,true);
});
test('issuer keys cannot be reused across roles; payment route is not an input',t=>{
 const s=setup(t);
 assert.throws(()=>openAdmissionLedger({...s.cfg,issuers:s.cfg.issuers.map(x=>({...x,publicKey:s.keys.simulation.publicKey}))}),/distinct keys/);
 const x=s.make(), b=s.bundle(x);b.paid=true;
 assert.equal(s.admit(b).reason,'malformed-bundle');
 assert.equal(s.admit(s.bundle(x)).admitted,true);
});
test('local and provisional intent never become verified admissions',t=>{
 const s=setup(t), x=s.make();
 for(const intent of ['local','provisional-public']){
  const b=s.bundle(x);b.request.intent=intent;
  assert.equal(s.admit(b).reason,'invalid-request');
 }
});
test('two independent database connections enforce same single admission',t=>{
 const s=setup(t), b=s.bundle(s.make()), second=openAdmissionLedger(s.cfg);
 try {assert.equal(second.admit('player-1',canonicalBytes(b)).admitted,true);
 assert.equal(s.admit(b).reason,'already-admitted');}finally{second.close();}
});


test('noncanonical bytes and malformed proof bundle cannot be admitted',t=>{
 const s=setup(t), b=s.bundle(s.make());
 const other=openAdmissionLedger(s.cfg);
 try {
  assert.equal(other.admit('player-1',Buffer.from(JSON.stringify(b))).reason,'malformed-bundle');
  assert.equal(other.admit('player-1',new Uint8Array(256*1024+1)).reason,'malformed-bundle');
  delete b.receipts.simulation;
  assert.equal(s.admit(b).reason,'malformed-bundle');
 }finally{other.close();}
});
test('concurrent workers cannot both admit the same challenge',{timeout:15000},async t=>{
 const s=setup(t), b=s.bundle(s.make());
 const {Worker}=await import('node:worker_threads');
 const barrier=new Int32Array(new SharedArrayBuffer(4));
 const issuers=s.cfg.issuers.map(x=>({...x,publicKey:x.publicKey.export({format:'pem',type:'spki'})}));
 const workerCode=`
   import {parentPort,workerData} from 'node:worker_threads';
   import {openAdmissionLedger} from ${JSON.stringify(new URL('./admission.mjs',import.meta.url).href)};
   const ledger=openAdmissionLedger({...workerData.cfg,clock:()=>10000});
   const barrier=new Int32Array(workerData.barrier);
   Atomics.add(barrier,0,1);Atomics.notify(barrier,0);
   while(Atomics.load(barrier,0)<2)Atomics.wait(barrier,0,1,5000);
   try {parentPort.postMessage(ledger.admit('player-1',workerData.bytes));}finally{ledger.close();}
 `;
 const workers=[0,1].map(()=>new Worker(new URL('data:text/javascript,'+encodeURIComponent(workerCode)),{
   workerData:{cfg:{databasePath:s.cfg.databasePath,challengeTtlMs:1000,issuers},barrier:barrier.buffer,bytes:canonicalBytes(b)}
 }));
 t.after(()=>Promise.all(workers.map(w=>w.terminate())));
 const results=await Promise.all(workers.map(w=>new Promise((resolve,reject)=>{
   w.once('message',resolve);w.once('error',reject);w.once('exit',code=>{if(code!==0)reject(Error('worker exit '+code));});
 })));
 assert.equal(results.filter(x=>x.admitted).length,1);
 assert.equal(results.filter(x=>x.reason==='already-admitted').length,1);
});
test('separate approved verifier keys produce byte-identical decisions (synthetic free/paid conformance)',t=>{
 const s=setup(t), x=s.make(), free=s.bundle(x);
 const paidKeys=generateKeyPairSync('ed25519');
 const paidBody={...x.bodies.simulation,keyId:'simulation-2'};
 const paid=structuredClone(free);paid.receipts.simulation=s.envelope(paidBody,'simulation',paidKeys.privateKey);
 const cfg={...s.cfg,issuers:[...s.cfg.issuers,{role:'simulation',keyId:'simulation-2',publicKey:paidKeys.publicKey}]};
 const a=openAdmissionLedger(cfg);
 try {
   const r1=a.admit('player-1',canonicalBytes(paid));assert.equal(r1.admitted,true);
   const y=s.make('player-1',{...s.course,runId:'run-2'});
   y.request.tapeDigest=d('9');
   for(const role of roles){
     y.bodies[role].claimDigest=h(canonicalBytes(y.request));
     if(role==='simulation')y.bodies[role].payload.record.tapeDigest=d('9');
     else y.bodies[role].payload.tapeDigest=d('9');
   }
   const r2=a.admit('player-1',canonicalBytes(s.bundle(y)));assert.equal(r2.admitted,true);
   assert.deepEqual(canonicalBytes(r1.verdict),canonicalBytes(r2.verdict));
 }finally{a.close();}
});

