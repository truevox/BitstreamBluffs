/** #135 trust-policy conformance: same synthetic separately-authenticated
 * fixture verdict bytes in local Node and real Chromium (peer/browser vs
 * hosted/Node runtime). No real authenticated backend or public scoreboard.
 * GAME_URL=http://127.0.0.1:18420/ node tools/trust/test-dual-proof-browser.mjs
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {adjudicateDualProof} from '../../src/systems/trust/dualProof.js';
import {canonicalBytes} from '../../src/systems/replay/canonicalJson.js';
import {digestOfBytes} from '../../src/systems/replay/canonicalSha256.js';
const d=c=>'sha256:'+c.repeat(64);
const make=(seed='terrain-seed-1')=>{
 const request={format:'bb-dual-proof',version:1,runId:'synthetic-run-1',buildId:'build-only-synthetic',
  rulesetId:d('a'),manifestDigest:d('b'),tapeDigest:d('c'),seed,biomeMask:7,lane:'stock',
  score:1000,endTick:240,loadoutDigest:d('d'),assistance:'human',intent:'verified-public',challengeId:'toy-challenge'};
 const simulation={kind:'trusted-replay-execution',runId:request.runId,buildId:request.buildId,
  verifierBuildId:d('e'),verifiedCourse:{seed:request.seed,biomeMask:request.biomeMask,lane:request.lane,
   loadoutDigest:request.loadoutDigest},score:request.score,endTick:request.endTick,tapeComplete:true,
  assistanceObserved:'human',record:{outcome:'match',verifiedUnder:request.rulesetId,verifierId:'in-game',
   tapeDigest:request.tapeDigest,manifestDigest:request.manifestDigest}};
 const authorization={kind:'trusted-eligibility-receipt',status:'authorized',runId:request.runId,
  buildId:request.buildId,rulesetId:request.rulesetId,seed:request.seed,biomeMask:request.biomeMask,
  lane:request.lane,loadoutDigest:request.loadoutDigest,manifestDigest:request.manifestDigest,
  tapeDigest:request.tapeDigest,score:request.score,endTick:request.endTick,
  challengeId:request.challengeId,challengeStatus:'fresh',economyStatus:'authorized',
  equipmentStatus:'authorized',modeStatus:'allowed',pinnedVerifierBuildId:d('e')};
 const consent={kind:'trusted-consent-receipt',status:'granted',runId:request.runId,
  manifestDigest:request.manifestDigest,tapeDigest:request.tapeDigest,score:request.score,
  endTick:request.endTick,seed:request.seed,biomeMask:request.biomeMask,lane:request.lane,
  loadoutDigest:request.loadoutDigest,intent:request.intent,scope:'score-only',audienceGate:'passed'};
 return {request,simulation,authorization,consent};
};
const baseline=make();
const cases=[
 ['valid-synthetic',baseline,'verified-eligible'],
 ['local-offline',{...make(),request:{...make().request,intent:'local'},consent:null},'none'],
 ['forged-wallet-denied',{...make(),authorization:{...baseline.authorization,economyStatus:'rejected'}},'none'],
 ['no-authority',{...make(),authorization:null},'none'],
 ['tool-assisted',{...make(),simulation:{...baseline.simulation,assistanceObserved:'tool-assisted'}},'none'],
 ['consent-denied',{...make(),consent:{...baseline.consent,status:'denied'}},'none'],
 ['score-edited',{...make(),request:{...baseline.request,score:123456}},'none'],
 ['unicode-seed',make('🌨️ Montréal 東京'),'verified-eligible'],
 ['provisional-no-proof',{...make(),request:{...baseline.request,intent:'provisional-public'},
  simulation:null,authorization:null,
  consent:{...baseline.consent,intent:'provisional-public'},allowProvisional:true},'provisional-unverified'],
];
const check=(result,expectPublication)=>{
 assert.equal(result.publication,expectPublication);
 return {publication:result.publication,competitive:result.competitiveness.status,
  proof:result.proof.status,eligibility:result.eligibility.status,
  privacy:result.privacy.status,rank:result.verifiedRankEligible,
  reward:result.publicRewardEligible,digest:digestOfBytes(canonicalBytes(result))};
};
const fromNode=cases.map(([name,input,expected])=>({name,...check(adjudicateDualProof(input),expected)}));
// Run the exact same hostile Proxy in both JS environments, not a Playwright
// structured clone of a Proxy (which is unsupported by the wire protocol).
const proxyCase=(original,adjudicate)=>{
 const denied={...original.authorization,status:'denied',economyStatus:'rejected'};
 let reads=0;
 const shifting=new Proxy({...original,authorization:denied},{get(target,key,receiver){
  if(key==='authorization'){reads++;return original.authorization;}
  return Reflect.get(target,key,receiver);
 }});
 const result=adjudicate(shifting);
 return {reads,...check(result,'none')};
};
const consentProxyCase=(original,adjudicate)=>{
 const denied={...original.consent,status:'denied',audienceGate:'failed'};
 let reads=0;
 const shifting=new Proxy({...original,consent:denied},{get(target,key,receiver){
  if(key==='consent'){reads++;return original.consent;}
  return Reflect.get(target,key,receiver);
 }});
 const result=adjudicate(shifting);
 return {reads,...check(result,'none')};
};
const nodeProxy=proxyCase(baseline,adjudicateDualProof);
const nodeConsent=consentProxyCase(baseline,adjudicateDualProof);
assert.equal(nodeProxy.reads,0,'Node must not read Proxy.get authorization');
assert.equal(nodeConsent.reads,0,'Node must not read Proxy.get consent');
const origin=process.env.GAME_URL;
if(!origin)throw Error('GAME_URL required');
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:process.env.CHROMIUM_EXECUTABLE||undefined});
const errors=[],writes=[];
try{
 const context=await browser.newContext({viewport:{width:960,height:540}});
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push(String(e.message)));
 page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))writes.push(r.method()+':'+r.url());});
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 const fromBrowser=await page.evaluate(async ({cases,baseline})=>{
  const [{adjudicateDualProof},{canonicalBytes},{digestOfBytes}]=await Promise.all([
   import('/src/systems/trust/dualProof.js'),import('/src/systems/replay/canonicalJson.js'),
   import('/src/systems/replay/canonicalSha256.js')]);
  const cv=r=>({publication:r.publication,competitive:r.competitiveness.status,
   proof:r.proof.status,eligibility:r.eligibility.status,privacy:r.privacy.status,
   rank:r.verifiedRankEligible,reward:r.publicRewardEligible,
   digest:digestOfBytes(canonicalBytes(r))});
  const vectors=cases.map(([name,input])=>({name,...cv(adjudicateDualProof(input))}));
  const denied={...baseline.authorization,status:'denied',economyStatus:'rejected'};
  let reads=0;
  const proxy=new Proxy({...baseline,authorization:denied},{get(target,key,receiver){
   if(key==='authorization'){reads++;return baseline.authorization;}
   return Reflect.get(target,key,receiver);
  }});
  const hostile={reads:0,...cv(adjudicateDualProof(proxy))};hostile.reads=reads;
  const deniedConsent={...baseline.consent,status:'denied',audienceGate:'failed'};
  let consentReads=0;
  const consentProxy=new Proxy({...baseline,consent:deniedConsent},{get(target,key,receiver){
   if(key==='consent'){consentReads++;return baseline.consent;}
   return Reflect.get(target,key,receiver);
  }});
  const consentHostile={reads:0,...cv(adjudicateDualProof(consentProxy))};
  consentHostile.reads=consentReads;
  return {vectors,hostile,consentHostile};
 },{cases,baseline});
 assert.deepEqual(fromBrowser.vectors,fromNode);
 assert.deepEqual(fromBrowser.hostile,nodeProxy);
 assert.deepEqual(fromBrowser.consentHostile,nodeConsent);
 assert.equal(fromBrowser.hostile.reads,0,'Chromium must not read Proxy.get authorization');
 assert.equal(fromBrowser.consentHostile.reads,0,'Chromium must not read Proxy.get consent');
 assert.deepEqual(errors,[]);
 assert.deepEqual(writes,[]);
 console.log('PASS_DUAL_PROOF_BROWSER_HOSTED_PARITY',JSON.stringify({
  caseCount:cases.length,vectors:fromNode,authorizationProxy:{reads:nodeProxy.reads,
   publication:nodeProxy.publication,rank:nodeProxy.rank,reward:nodeProxy.reward},
  consentProxy:{reads:nodeConsent.reads,publication:nodeConsent.publication,
   rank:nodeConsent.rank,reward:nodeConsent.reward},
  errors,writes,fixture:'synthetic-only',officialServiceEnabled:false,
 }));
 await context.close();
}finally{await browser.close();}
