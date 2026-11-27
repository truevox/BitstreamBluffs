import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {canonicalBytes,parseCanonical} from '../../src/systems/replay/canonicalJson.js';
import {equipmentProjection,equipmentDigest} from './publicWallet.mjs';
import {prepareReplayEvidence} from './replayEvidence.mjs';
import {openAdmissionLedger} from './admission.mjs';
import {openBlindPeerCoordinator} from './blindPeerCoordinator.mjs';
import {openProvisionalLedger} from './provisional.mjs';
import {createPrivateVerificationHttpHandler,PRIVATE_VERIFICATION_CONTENT_TYPE as TYPE} from './privateVerificationHttp.mjs';

const current=parseCanonical(readFileSync(new URL('../../tools/ruleset/current.json',import.meta.url)));
const trustedRuleset={rulesetId:current.rulesetId,ruleset:parseCanonical(readFileSync(new URL('../../'+current.archivePath,import.meta.url)))};
const bytes=Uint8Array.from(readFileSync(new URL('../../tests/fixtures/trust/peer-scripted-evidence.json',import.meta.url)));
const observation=parseCanonical(readFileSync(new URL('../../tests/fixtures/trust/peer-scripted-observation.json',import.meta.url)));
const prepared=prepareReplayEvidence(bytes,trustedRuleset);
assert.equal(prepared.ok,true);
const b64=b=>Buffer.from(b).toString('base64url');
const report=canonicalBytes({evidenceDigest:prepared.identity.bundleDigest,observation});
const digest='sha256:'+'b'.repeat(64);
const loadout=equipmentProjection(prepared.causal);

async function setup(t,{maxRequestsPerMinute=60,allowedOrigins=[]}={}){
 const dir=mkdtempSync(join(tmpdir(),'bb-http-verifier-')),databasePath=join(dir,'authority.sqlite');
 let now=123456,sequence=0;
 const issuers=['simulation','authorization','consent'].map(role=>({
  role,keyId:'test-'+role,publicKey:generateKeyPairSync('ed25519').publicKey}));
 const admission=openAdmissionLedger({databasePath,trustedRuleset,issuers,clock:()=>now,challengeTtlMs:3600000});
 const peers=openBlindPeerCoordinator({databasePath,trustedRuleset,
  pseudonymKey:randomBytes(32),verifierBuildId:digest,clock:()=>now,
  chooseIndex:()=>0});
 const provisional=openProvisionalLedger({databasePath,trustedRuleset,clock:()=>now});
 const validTokens=new Map([['token-alice','alice'],['token-bob','bob'],['token-carol','carol']]);
 let publicationAllowed=false,authCalls=0,challengeCalls=0;
 const handler=createPrivateVerificationHttpHandler({
  peers,provisional,maxRequestsPerMinute,allowedOrigins,clock:()=>now,
  verifyBearer:async token=>{
   authCalls++;return validTokens.has(token)?{verified:true,accountId:validTokens.get(token)}:
    {verified:false,accountId:'attacker'};
  },
  issueTrustedChallenge:async({accountId,kind})=>{
   challengeCalls++;
   if(kind!=='human')return {ok:false};
   // In a real service, trusted policy resolves legal equipment + course
   // independently of client-declared account, wallet, score, or seed.
   const course={runId:'server-issued-'+accountId+'-'+(++sequence),
    buildId:'build-test',rulesetId:trustedRuleset.rulesetId,seed:prepared.tape.seed,
    biomeMask:prepared.tape.biomeMask,lane:'stock',loadoutDigest:equipmentDigest(loadout),
    assistance:'human'};
   const issued=admission.issueChallenge(accountId,canonicalBytes(course),digest,canonicalBytes(loadout));
   return {ok:true,challengeId:issued.challengeId};
  },
  authorizePublication:async({accountId,requestBytes})=>{
   assert.ok(validTokens.has('token-'+accountId));
   assert.ok(requestBytes instanceof Uint8Array);
   return {consentAuthorized:publicationAllowed,audienceAllowed:publicationAllowed};
  }
 });
 const server=createServer(handler);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const url='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{
  validTokens.clear();
  await new Promise(resolve=>server.close(resolve));
  peers.close();provisional.close();admission.close();rmSync(dir,{force:true,recursive:true});
 });
 async function post(route,value,token='token-alice',{origin=null,headers={},raw=null,method='POST'}={}){
  const resp=await fetch(url+route,{method,headers:{
   'Content-Type':TYPE,...(token?{Authorization:'Bearer '+token}:{}),
   ...(origin?{Origin:origin}:{}),...headers
  },...(method==='POST'?{body:raw===null?Buffer.from(canonicalBytes(value)):raw}:{}),
   signal:AbortSignal.timeout(15000)});
  let body=null;
  if(resp.status!==204){body=await resp.json();}
  return {status:resp.status,body,headers:resp.headers};
 }
 return {post,provisional,peers,admission,report,databasePath,validTokens,
  approve:()=>{publicationAllowed=true;},revoke:()=>{publicationAllowed=false;},
  authCalls:()=>authCalls,challengeCalls:()=>challengeCalls,advance:v=>{now+=v;},
  url};
}

test('network routes require actual token verification, reject forged identity and never have anonymous read',async t=>{
 const s=await setup(t);
 for(const [route,body] of [['/v1/private/challenge',{kind:'human'}],
  ['/v1/private/peer/claim',{deviceReady:true}],['/v1/private/publish',{requestB64:b64(report)}]]){
  assert.deepEqual((await s.post(route,body,null)).body,{ok:false,reason:'authentication-required'});
  assert.equal((await s.post(route,body,'invalid-token')).status,401);
 }
 assert.equal(s.challengeCalls(),0);
 assert.equal((await s.post('/v1/private/challenge',{kind:'human',accountId:'alice'},'token-bob')).body.reason,'malformed-request');
 assert.equal((await s.post('/v1/private/challenge',{kind:'human'},'token-bob')).body.ok,true);
 assert.equal((await s.post('/v1/private/status',{submissionId:'made-up'},'token-bob')).body.reason,'not-owned');
 assert.equal((await s.post('/v1/private/status',{submissionId:'made-up'},'token-alice',{method:'GET'})).status,405);
 assert.equal((await s.post('/v1/private/admin/settle',{},'token-alice')).status,404);
 assert.equal((await s.post('/v1/private/challenge',{kind:'human'},'token-alice',{origin:'https://evil.example'})).status,403);
 s.validTokens.delete('token-alice');
 assert.equal((await s.post('/v1/private/challenge',{kind:'human'},'token-alice')).status,401);
});

test('auth-protected end-to-end local creator and two blind peer HTTP transactions remain Unverified',async t=>{
 const s=await setup(t),tickets={};
 for(const account of ['alice','bob','carol']){
  const token='token-'+account;
  const c=await s.post('/v1/private/challenge',{kind:'human'},token);
  assert.equal(c.status,200,JSON.stringify(c.body));
  const began=await s.post('/v1/private/begin',{board:'human',challengeId:c.body.challengeId,
   optedIn:true,evidenceB64:b64(bytes)},token);
  assert.equal(began.body.ok,true,JSON.stringify(began.body));
  tickets[account]={challengeId:c.body.challengeId,submissionId:began.body.submissionId};
 }
 const a=tickets.alice;
 const pubRequest={format:'bb-dual-proof',version:1,runId:'server-issued-alice-1',
  buildId:'build-test',rulesetId:trustedRuleset.rulesetId,seed:prepared.tape.seed,
  biomeMask:prepared.tape.biomeMask,lane:'stock',loadoutDigest:equipmentDigest(loadout),
  assistance:'human',manifestDigest:prepared.identity.manifestDigest,
  tapeDigest:prepared.identity.tapeDigest,score:prepared.expected.score,
  endTick:prepared.expected.endTick,intent:'provisional-public',challengeId:a.challengeId};
 const payload={requestB64:b64(canonicalBytes(pubRequest))};
 assert.equal((await s.post('/v1/private/publish',payload)).body.reason,'consent-or-audience-required');
 s.approve();
 assert.equal((await s.post('/v1/private/publish',payload)).body.reason,'local-qualification-required');
 for(const account of ['bob','carol']){
  const token='token-'+account;
  const claim=await s.post('/v1/private/peer/claim',{deviceReady:true},token);
  assert.equal(claim.body.ok,true,JSON.stringify(claim.body));
  assert.equal(claim.body.job.board,'human');
  assert.equal(claim.body.job.kind,'exact-run');
  assert.equal(Buffer.from(claim.body.job.evidenceB64,'base64url').equals(Buffer.from(bytes)),true);
  const job=claim.body.job;
  assert.deepEqual(Object.keys(job).sort(),
   ['board','evidenceB64','expiresAt','id','kind','leaseToken','rulesetId','verifierBuildId'].sort());
  assert.equal(JSON.stringify(job).includes('alice'),false);
  const wrong=await s.post('/v1/private/peer/complete',{
   assignmentId:job.id,leaseToken:job.leaseToken,reportB64:b64(report)},'token-alice');
  assert.equal(wrong.body.reason,'not-assigned');
  const done=await s.post('/v1/private/peer/complete',{
   assignmentId:job.id,leaseToken:job.leaseToken,reportB64:b64(report)},token);
  assert.equal(done.body.ok,true,JSON.stringify(done.body));
 }
 const before=await s.post('/v1/private/status',{submissionId:a.submissionId});
 assert.equal(before.body.publication,'NONE');
 const denied=await s.post('/v1/private/status',{submissionId:a.submissionId},'token-bob');
 assert.deepEqual(denied.body,{ok:false,reason:'not-owned'});
 const done=await s.post('/v1/private/local',{submissionId:a.submissionId,reportB64:b64(report)});
 assert.deepEqual(done.body,{ok:true,status:'UNVERIFIED'});
 const status=await s.post('/v1/private/status',{submissionId:a.submissionId});
 assert.equal(status.body.publication,'UNVERIFIED');
 assert.equal(status.body.peerConsensus,true);
 assert.equal((await s.post('/v1/private/publish',{...payload,consentAuthorized:true})).body.reason,'malformed-request');
 const publicResult=await s.post('/v1/private/publish',payload);
 assert.equal(publicResult.body.ok,true,JSON.stringify(publicResult.body));
 assert.equal(publicResult.body.status,'UNVERIFIED');
 assert.equal(publicResult.body.verifiedRankEligible,false);
 assert.equal(publicResult.body.publicRewardEligible,false);
 const view=s.provisional.publicView(publicResult.body.submissionId);
 assert.equal(view.status,'UNVERIFIED');
 const db=new DatabaseSync(s.databasePath,{readOnly:true});
 try{
  assert.equal(db.prepare('SELECT count(*) AS n FROM admissions').get().n,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM public_rewards').get().n,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM public_provisional_submissions').get().n,1);
 }finally{db.close();}
 assert.equal((await s.post('/v1/private/publish',payload)).body.reason,'already-published');
});

test('strict canonical bytes, base64url, content type, origin, and non-cookie authentication gate',async t=>{
 const s=await setup(t,{allowedOrigins:['https://game.example']});
 assert.equal((await s.post('/v1/private/challenge',{kind:'human'},null,{
  headers:{Cookie:'accountId=alice'}})).status,401);
 assert.equal((await s.post('/v1/private/challenge',{kind:'human'},'token-alice',{
  headers:{'Content-Type':'application/json'}})).status,415);
 assert.equal((await s.post('/v1/private/challenge',{kind:'human'},'token-alice',{
  raw:Buffer.from('{"kind":"human","kind":"human"}')})).status,400);
 assert.equal((await s.post('/v1/private/challenge',{kind:'human'},'token-alice',{
  raw:Buffer.from('{ "kind":"human" }')})).status,400);
 assert.equal((await s.post('/v1/private/challenge',{kind:'human'},'token-alice',{
  raw:Buffer.alloc(2*1024*1024+1,65)})).status,413);
 assert.equal((await s.post('/v1/private/begin',{board:'human',challengeId:'x',optedIn:true,
  evidenceB64:b64(bytes)+'='})).body.reason,'malformed-evidence');
 assert.equal((await s.post('/v1/private/challenge',{kind:'human'},'token-alice',{
  origin:'https://evil.example'})).status,403);
 assert.equal((await s.post('/v1/private/challenge',{kind:'human'},'token-alice',{
  origin:'https://game.example'})).status,200);
 const cors=await s.post('/v1/private/challenge',{kind:'human'},'token-bob',{
  origin:'https://game.example'});
 assert.equal(cors.headers.get('access-control-allow-origin'),'https://game.example');
 // Preflight is explicitly limited to server allowlist.
 const preflight=await fetch(s.url+'/v1/private/challenge',{
  method:'OPTIONS',headers:{Origin:'https://game.example',
   'Access-Control-Request-Method':'POST',
   'Access-Control-Request-Headers':'authorization, content-type'}});
 assert.equal(preflight.status,204);
 assert.equal(preflight.headers.get('access-control-allow-origin'),'https://game.example');
 const blocked=await fetch(s.url+'/v1/private/challenge',{
  method:'OPTIONS',headers:{Origin:'https://evil.example'}});
 assert.equal(blocked.status,403);
});

test('per-account short-window limit fails closed without minting challenges; reset requires elapsed clock',async t=>{
 const s=await setup(t,{maxRequestsPerMinute:2});
 for(let i=0;i<2;i++)
  assert.equal((await s.post('/v1/private/challenge',{kind:'human'})).status,200);
 assert.equal((await s.post('/v1/private/challenge',{kind:'human'})).status,429);
 assert.equal(s.challengeCalls(),2);
 assert.equal((await s.post('/v1/private/challenge',{kind:'human'},'token-bob')).status,200);
 s.advance(60000);
 assert.equal((await s.post('/v1/private/challenge',{kind:'human'})).status,200);
});

test('no challenge/publish callback means no network route can invent trusted authorization',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'bb-http-no-policy-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const handler=createPrivateVerificationHttpHandler({
  peers:{begin:()=>{throw Error('should-not-run');},claimForAutomaticPeer:()=>{throw Error('should-not-run');}},
  provisional:{submit:()=>{throw Error('should-not-run');}},
  verifyBearer:async()=>({verified:true,accountId:'alice'})
 });
 const server=createServer(handler);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>server.close(r)));
 const url='http://127.0.0.1:'+server.address().port;
 for(const [route,body] of [['challenge',{kind:'human'}],['publish',{requestB64:b64(report)}]]){
  const r=await fetch(url+'/v1/private/'+route,{method:'POST',headers:{
   Authorization:'Bearer test','Content-Type':TYPE},body:Buffer.from(canonicalBytes(body))});
  assert.equal(r.status,400);
  assert.match((await r.json()).reason,/unavailable/);
 }
 assert.throws(()=>createPrivateVerificationHttpHandler({
  peers:{begin(){},claimForAutomaticPeer(){}},provisional:{submit(){}},verifyBearer:null
 }),/invalid/);
});

test('duplicate Authorization headers cannot select either account, and foreign challenge cannot be submitted',async t=>{
 const s=await setup(t);
 const challenge=await s.post('/v1/private/challenge',{kind:'human'});
 assert.equal(challenge.body.ok,true);
 const attempted=await s.post('/v1/private/begin',{board:'human',optedIn:true,
  challengeId:challenge.body.challengeId,evidenceB64:b64(bytes)},'token-bob');
 assert.deepEqual(attempted.body,{ok:false,reason:'challenge-not-owned'});
 const reply=await new Promise((resolve,reject)=>{
  const target=new URL(s.url);
  const req=httpRequest({hostname:target.hostname,port:target.port,
   path:'/v1/private/challenge',method:'POST',
   headers:['Authorization','Bearer token-alice','Authorization','Bearer token-bob',
    'Content-Type',TYPE]},res=>{
    const chunks=[];res.on('data',b=>chunks.push(b));
    res.on('end',()=>{const content=Buffer.concat(chunks).toString('utf8');
     resolve({status:res.statusCode,body:content.startsWith('{')?JSON.parse(content):null});});
  });
  req.once('error',reject);req.end(Buffer.from(canonicalBytes({kind:'human'})));
 });
 // Node's own HTTP parser may reject duplicate Authorization with a bare 400
 // before the handler sees it; either path must deny account selection.
 assert.ok([400,401].includes(reply.status),JSON.stringify(reply));
 if(reply.status===401)assert.deepEqual(reply.body,{ok:false,reason:'authentication-required'});
});
