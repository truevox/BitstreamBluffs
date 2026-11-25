/** #69: offline .bbghost is a transport, NEVER a sender signature or replay entitlement. */
import {jest} from '@jest/globals';
import {ReadableStream,CompressionStream,DecompressionStream} from 'node:stream/web';
import {webcrypto,createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {TextEncoder,TextDecoder} from 'node:util';
for(const [name,value] of Object.entries({ReadableStream,CompressionStream,DecompressionStream,crypto:webcrypto,TextEncoder,TextDecoder}))
 Object.defineProperty(globalThis,name,{value,configurable:true});
import {GHOST_TAPE_FORMAT,GHOST_TAPE_VERSION,GHOST_PHYSICS_VERSION} from '../../src/systems/ghost/GhostTape.js';
import {RUN_RANDOM_VERSION} from '../../src/systems/RunRandom.js';
import {SIM_REVISION} from '../../src/systems/replay/ruleset.js';
import {SIM_TICK_HZ} from '../../src/systems/SimClock.js';
import {createGhostLink,parseGhostLink,createGhostFile,parseGhostFile,GhostLinkError,
 GHOST_FILE_NAME,GHOST_FILE_HEADER,GHOST_FILE_MAX_BYTES,GHOST_LINK_MAX_URL,GHOST_LINK_MAX_GZIP,
 GHOST_LINK_MAX_JSON} from '../../src/systems/ghost/GhostLink.js';

const base='https://simulate.sledhead.ing/';
function tape(){return {
 format:GHOST_TAPE_FORMAT,version:GHOST_TAPE_VERSION,physicsVersion:GHOST_PHYSICS_VERSION,
 simTickHz:SIM_TICK_HZ,runRandomVersion:RUN_RANDOM_VERSION,edgeRows:'every-tick',
 seed:'slope-secret',biomeMask:17,simRevision:SIM_REVISION,mode:'normal',dailyRuleId:null,dailyRuleSource:'seed-date',
 syncLevel:1,bsod:{leftEdgeX:30,initial:{wallX:-4500,wallSpeedPxS:300,accelerationPxS2:4}},
 controlLayout:'tricksRight',boosts:[],upgradeRanks:null,magnetsDrop:false,kodiaksOn:false,kodiakPackMode:'same',
 startPose:[42,170,0,0,0,0],random:{version:RUN_RANDOM_VERSION,physicsScramble:1,visualSled:2,visualFx:3,visualCamera:4},
 distanceM:12,score:999999,cause:'crash',endTick:240,inputs:[[1,0,0],[100,2,0],[39,0,0]],
 checkpoints:[[120,42,170,0,0,0,0,0],[240,55,180,.1,1,2,0,24]],
 trace:Buffer.from(new Float32Array([42,170,0,55,180,.1]).buffer).toString('base64'),
 runId:'PRIVATE-ID-AND-PERSON',startedAt:123456,endedAt:78910,
 secretToken:'DO_NOT_LEAK',owner:'PRIVATE_NAME',wallet:{shards:800},email:'private@example.com',
};}
function longTape(){
 const t=tape();let state=0x31415926;
 const r=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/2**32;};
 const samples=Array.from({length:1200},()=>[r()*10000,r()*3000,r()*6.28]);
 t.trace=Buffer.from(new Float32Array(samples.flat()).buffer).toString('base64');
 t.endTick=6000;t.checkpoints=[[120,42,170,0,0,0,0,0]];
 return t;
}
const fail=async(p,expected)=>{await expect(p).rejects.toMatchObject({name:'GhostLinkError',code:expected});};

test('the exact short link and portable file have identical unverified sanitized replay data',async()=>{
 const t=tape();
 const link=await createGhostLink(t,base),file=await createGhostFile(t);
 expect(link.length).toBeLessThan(GHOST_LINK_MAX_URL);
 expect(file.filename).toBe(GHOST_FILE_NAME);
 expect(file.filename).not.toContain(t.seed);
 expect(file.bytes).toBeInstanceOf(Uint8Array);
 expect(file.bytes.length).toBeLessThanOrEqual(GHOST_FILE_MAX_BYTES);
 const fromLink=await parseGhostLink(link),fromFile=await parseGhostFile(file.bytes);
 expect(fromFile).toMatchObject({...fromLink,source:'user-chosen-local-file'});
 for(const key of ['secretToken','owner','wallet','email'])expect(fromFile.tape).not.toHaveProperty(key);
 expect(JSON.stringify(fromFile)).not.toContain('PRIVATE');
 expect(file.bytes.length).toBeLessThan(2*1024);
 expect(fromFile.tape).toMatchObject({runId:`shared:${file.digest}`,startedAt:0,endedAt:0,
  inputs:t.inputs,checkpoints:t.checkpoints,trace:t.trace});
 expect(fromFile).toMatchObject({trust:'unverified-local-practice',canCreditScore:false,canCreditWallet:false,canSubmitOfficial:false});
});

test('a legitimate large current-SIM replay cannot become an 8192-char URL, but can be saved and opened as a bounded local file',async()=>{
 const t=longTape();
 await fail(createGhostLink(t,base),'url-too-long');
 const file=await createGhostFile(t);
 expect(file.bytes.byteLength).toBeGreaterThan(8192);
 expect(file.bytes.byteLength).toBeLessThanOrEqual(GHOST_FILE_MAX_BYTES);
 const received=await parseGhostFile(file.bytes);
 expect(received.tape.trace).toBe(t.trace);
 expect(received.tape.endTick).toBe(6000);
 expect(received.canSubmitOfficial).toBe(false);
});

test('same ghost checksum and result are deterministic; tampering without recomputing the digest is rejected',async()=>{
 const t=tape();const a=await createGhostFile(t),b=await createGhostFile(t);
 expect(a.bytes).toEqual(b.bytes);
 const mutated=a.bytes.slice();mutated[mutated.length-2]^=0x03;
 await fail(parseGhostFile(mutated),'corrupt-file');
 await fail(parseGhostFile(a.bytes.slice(0,-5)),'corrupt-file');
});

test('rejects unsupported versions, corrupt header, empty/truncated/oversized and arbitrary byte types',async()=>{
 const f=(await createGhostFile(tape())).bytes;
 const other=f.slice();other[7]=50;
 await fail(parseGhostFile(other),'unsupported-file');
 const invalid=f.slice();invalid[GHOST_FILE_HEADER.length+24]=0;
 await fail(parseGhostFile(invalid),'invalid-file');
 await fail(parseGhostFile(new Uint8Array()),'invalid-file');
 await fail(parseGhostFile(new Uint8Array(GHOST_FILE_MAX_BYTES+1)),'invalid-file');
 await fail(parseGhostFile('not bytes'),'invalid-file');
 await fail(parseGhostFile(new DataView(f.buffer)),'invalid-file');
 await fail(parseGhostFile(f.slice(0,GHOST_FILE_HEADER.length+24+1)),'invalid-file');
});

test('cannot smuggle an overexpanded gzip bomb or malformed-but-correctly-hashed payload',async()=>{
 const h=new TextEncoder().encode(GHOST_FILE_HEADER);
 const assemble=(compressed)=>{
  const digest=createHash('sha256').update(compressed).digest('hex').slice(0,24);
  const head=new TextEncoder().encode(`${GHOST_FILE_HEADER}${digest}\n`);
  const bytes=new Uint8Array(head.length+compressed.length);bytes.set(head);bytes.set(compressed,head.length);return bytes;
 };
 const bomb=gzipSync(Buffer.from('x'.repeat(GHOST_LINK_MAX_JSON+1)));
 expect(bomb.length).toBeLessThan(GHOST_LINK_MAX_GZIP);
 await fail(parseGhostFile(assemble(bomb)),'oversize');
 await fail(parseGhostFile(assemble(new Uint8Array([1,2,3,4,5]))),'bad-gzip');
 const forgedPayload=gzipSync(Buffer.from('{"format":"bb-ghost-link","version":99,"tape":{}}'));
 await fail(parseGhostFile(assemble(forgedPayload)),'unsupported-link');
 expect(h.length).toBeGreaterThan(0);
});
