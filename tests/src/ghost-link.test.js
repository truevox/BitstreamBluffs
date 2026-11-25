import {jest} from '@jest/globals';
import {ReadableStream,CompressionStream,DecompressionStream} from 'node:stream/web';
import {webcrypto} from 'node:crypto';
import {TextEncoder,TextDecoder} from 'node:util';
import {gzipSync} from 'node:zlib';
Object.defineProperty(globalThis,'ReadableStream',{value:ReadableStream,configurable:true});
Object.defineProperty(globalThis,'CompressionStream',{value:CompressionStream,configurable:true});
Object.defineProperty(globalThis,'DecompressionStream',{value:DecompressionStream,configurable:true});
Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true});
Object.defineProperty(globalThis,'TextEncoder',{value:TextEncoder,configurable:true});
Object.defineProperty(globalThis,'TextDecoder',{value:TextDecoder,configurable:true});
import {GHOST_TAPE_FORMAT,GHOST_TAPE_VERSION,GHOST_PHYSICS_VERSION} from '../../src/systems/ghost/GhostTape.js';
import {RUN_RANDOM_VERSION} from '../../src/systems/RunRandom.js';
import {SIM_REVISION} from '../../src/systems/replay/ruleset.js';
import {SIM_TICK_HZ} from '../../src/systems/SimClock.js';
import {createGhostLink,parseGhostLink,GhostLinkError,GHOST_LINK_MAX_URL,GHOST_LINK_RECOMMENDED_URL} from '../../src/systems/ghost/GhostLink.js';
const URL='https://simulate.sledhead.ing/?session=private#old-hash';
const floatTrace=(triples=[[42,170,0],[55,180,.1]])=>Buffer.from(new Float32Array(triples.flat()).buffer).toString('base64');
const valid=()=>({
 format:GHOST_TAPE_FORMAT,version:GHOST_TAPE_VERSION,physicsVersion:GHOST_PHYSICS_VERSION,
 simTickHz:SIM_TICK_HZ,runRandomVersion:RUN_RANDOM_VERSION,edgeRows:'every-tick',
 seed:'abc-123',biomeMask:17,simRevision:SIM_REVISION,mode:'normal',dailyRuleId:null,dailyRuleSource:'seed-date',
 syncLevel:1,bsod:{leftEdgeX:30,initial:{wallX:-4500,wallSpeedPxS:300,accelerationPxS2:4}},
 controlLayout:'tricksRight',boosts:[],upgradeRanks:null,magnetsDrop:false,kodiaksOn:false,kodiakPackMode:'same',kodiakVersion:3,
 startPose:[42,170,0,0,0,0],random:{version:RUN_RANDOM_VERSION,physicsScramble:1,visualSled:2,visualFx:3,visualCamera:4},distanceM:12,score:24,cause:'crash',
 endTick:240,inputs:[[1,0,0],[100,2,0],[39,0,0]],checkpoints:[[120,42,170,0,0,0,0,0],[240,55,180,.1,1,2,0,24]],
 trace:floatTrace(),runId:'private:PERSONAL-RUN-ID',startedAt:123456,endedAt:123999,
 ownerName:'PRIVATE_NICKNAME',cloudToken:'DO_NOT_EXPORT',privateHealth:'NO',wallet:{points:1e9},
});
const code=err=>err instanceof GhostLinkError?err.code:'unexpected';
const mustReject=async(p,want)=>{try{await p;throw Error('accepted invalid content');}catch(e){expect(code(e)).toBe(want);}};

test('explicit compact URL round-trip keeps only allowlisted replay fields, no private data, unverified',async()=>{
 const t=valid(),url=await createGhostLink(t,URL);expect(url).toMatch(/^https:\/\/simulate\.sledhead\.ing\/#bbghost=1\./);
 expect(url.length).toBeLessThanOrEqual(GHOST_LINK_RECOMMENDED_URL);expect(url).not.toMatch(/session=|private|PRIVATE_NICKNAME|DO_NOT_EXPORT/);
 const got=await parseGhostLink(url);expect(got.trust).toBe('unverified-local-practice');
 expect(got.tape.seed).toBe(t.seed);expect(got.tape.biomeMask).toBe(t.biomeMask);
 expect(got.tape.trace).toBe(t.trace);expect(got.tape.inputs).toEqual(t.inputs);expect(got.tape.checkpoints).toEqual(t.checkpoints);
 expect(got.tape.runId).toMatch(/^shared:[a-f0-9]{24}$/);expect(got.tape.runId).not.toBe(t.runId);
 for(const k of ['ownerName','cloudToken','privateHealth','wallet'])expect(got.tape).not.toHaveProperty(k);
 expect(got.tape.startedAt).toBe(0);expect(got.tape.endedAt).toBe(0);
 expect(got.tape.random).toEqual({version:RUN_RANDOM_VERSION,physicsScramble:1,visualSled:2,visualFx:3,visualCamera:4});
 expect(got).toMatchObject({canCreditScore:false,canCreditWallet:false,canSubmitOfficial:false});
 expect(GHOST_LINK_MAX_URL).toBe(8192);
});

test('encoding is deterministic, unkeyed checksum is NOT publisher authentication',async()=>{
 const t=valid(),a=await createGhostLink(t,URL),b=await createGhostLink(t,URL);
 expect(a).toBe(b);const got=await parseGhostLink(a);expect(got.trust).toBe('unverified-local-practice');
 const copy={...t,score:9999999};const forged=await parseGhostLink(await createGhostLink(copy,URL));
 expect(forged.tape.score).toBe(9999999);expect(forged.canSubmitOfficial).toBe(false);
});

test('rejects future versions, incompatible physics, malformed start and invalid course/input stream',async()=>{
 for(const [patch,want] of [
  [{version:99},'unsupported-tape'],[{simTickHz:60},'unsupported-tape'],
  [{simRevision:SIM_REVISION+1},'unsupported-ruleset'],[{biomeMask:2048},'invalid-course'],
  [{seed:'<script>'},'invalid-course'],[{startPose:[0,0,0]},'invalid-initial-state'],
  [{random:{version:1,physicsScramble:2,visualSled:3,evilKey:'secret'}},'invalid-initial-state'],
  [{inputs:[[241,0,0]]},'invalid-input'],[{inputs:[[1,0,0],[0,1,0]]},'invalid-input'],
  [{trace:'not base64!'},'invalid-trace'],[{trace:floatTrace([[0,0,Infinity]])},'invalid-trace'],
  [{checkpoints:[[0,1,2,3,4,5,6,7]]},'invalid-checkpoint'],
 ])await mustReject(createGhostLink({...valid(),...patch},URL),want);
});

test('does not accept wrong protocol, URL length, modified payload or hash, or unsupported fragment',async()=>{
 const t=valid(),link=await createGhostLink(t,URL);await mustReject(createGhostLink(t,'javascript:alert(1)'),'invalid-url');
 await mustReject(createGhostLink(t,'http://example.com/'),'invalid-url');
 await mustReject(createGhostLink(t,'https://user:pass@simulate.sledhead.ing/'),'invalid-url');
 await mustReject(createGhostLink(t,URL,{maxLength:20}),'url-too-long');
 const pos=link.lastIndexOf('.')+1;const altered=link.slice(0,pos)+(link[pos]==='A'?'B':'A')+link.slice(pos+1);await mustReject(parseGhostLink(altered),'corrupt-link');
 await mustReject(parseGhostLink(link.replace('bbghost=1.','bbghost=9.')),'unsupported-link');
 await mustReject(parseGhostLink(link+'&x=1'),'invalid-fragment');
 await mustReject(parseGhostLink('https://simulate.sledhead.ing/#bbghost=1.wrong'),'unsupported-link');
});

test('corrupted gzip and decompression bomb fail closed BEFORE import',async()=>{
 const zipped=new Uint8Array(gzipSync('A'.repeat(100000)));
 const sha=await crypto.subtle.digest('SHA-256',zipped),hex=[...new Uint8Array(sha)].map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,24);
 const b64=Buffer.from(zipped).toString('base64url');
 await mustReject(parseGhostLink(`https://simulate.sledhead.ing/#bbghost=1.${hex}.${b64}`),'oversize');
});

test('URI transport does not require a server, account, import side effect or writable storage',async()=>{
 const oldFetch=globalThis.fetch,fetcher=jest.fn(()=>{throw Error('Unexpected network');});globalThis.fetch=fetcher;
 try{const t=valid(),url=await createGhostLink(t,'https://simulate.sledhead.ing/');
  expect((await parseGhostLink(url)).tape.seed).toBe(t.seed);expect(fetcher).not.toHaveBeenCalled();
 }finally{if(oldFetch===undefined)delete globalThis.fetch;else globalThis.fetch=oldFetch;}
});
