/** #119: actual production Rng/SimClock objects; not an authorized player save. */
import { runRandomStreams, runRandomState, RUN_STREAMS } from '../../src/systems/RunRandom.js';
import { SimClock } from '../../src/systems/SimClock.js';
import { canonicalBytes, parseCanonical } from '../../src/systems/replay/canonicalJson.js';
import { captureRunRandomState, restoreRunRandomState,
 captureSimClockState, restoreSimClockState } from '../../src/systems/savestate/primitiveState.js';

const copy=o=>JSON.parse(JSON.stringify(o));
const state=r=>runRandomState(r);
const fresh=()=>new SimClock();
const pad=(pressed={})=>({push:true,tilt:0,pressed:{hop:false,...pressed}});

describe('explicit production Rng state primitives: fresh, full, fail-closed',()=>{
 test('same seed: round-trip the real run streams, then produce identical suffix in all domains',()=>{
  const uninterrupted=runRandomStreams('TEST-119'),target=runRandomStreams('TEST-119');
  for(let i=0;i<73;i++){
   uninterrupted.physicsScramble.next();
   if(i%3===0)uninterrupted.visualSled.next();
   if(i%5===0)uninterrupted.visualFx.next();
   if(i%7===0)uninterrupted.visualCamera.next();
  }
  const serialized=parseCanonical(canonicalBytes(captureRunRandomState(uninterrupted)));
  expect(restoreRunRandomState(target,serialized)).toBe(true);
  expect(state(target)).toEqual(state(uninterrupted));
  for(let i=0;i<120;i++)for(const key of Object.keys(RUN_STREAMS))
   expect(target[key].next()).toBe(uninterrupted[key].next());
 });
 test('refuses mismatched original seed without partially moving any target stream',()=>{
  const a=runRandomStreams('A'),b=runRandomStreams('B');
  a.physicsScramble.next();a.visualFx.next();
  const before=state(b);
  expect(()=>restoreRunRandomState(b,captureRunRandomState(a))).toThrow(/seed-mismatch/);
  expect(state(b)).toEqual(before);
 });
 test('refuses truncated, version-mismatched, unknown and forged stream states, without writes',()=>{
  const src=runRandomStreams('S'),target=runRandomStreams('S'),valid=captureRunRandomState(src);
  const examples=[
   {...valid,version:2},
   {...valid,streams:{physicsScramble:valid.streams.physicsScramble}},
   {...valid,streams:{...valid.streams,unexpected:{baseSeed:0,state:0}}},
   {...valid,streams:{...valid.streams,visualCamera:{...valid.streams.visualCamera,state:-1}}},
   {...valid,streams:{...valid.streams,visualCamera:{...valid.streams.visualCamera,state:2**32}}},
   {...valid,streams:{...valid.streams,visualCamera:{...valid.streams.visualCamera,state:NaN}}},
  ];
  for(const s of examples){const before=state(target);
   expect(()=>restoreRunRandomState(target,s)).toThrow();expect(state(target)).toEqual(before);}
 });
 test('refuses immutable or aliased targets before any stream restoration writes',()=>{
  const source=runRandomStreams('S');source.physicsScramble.next();
  const snap=captureRunRandomState(source);
  const target=runRandomStreams('S'),original=state(target);
  Object.defineProperty(target.visualCamera,'state',{writable:false});
  expect(()=>restoreRunRandomState(target,snap)).toThrow(/readonly/);
  expect(state(target)).toEqual(original);
  const aliased=runRandomStreams('S');aliased.visualFx=aliased.visualSled;
  expect(()=>restoreRunRandomState(aliased,snap)).toThrow();
 });
 test('refuses non-fresh destination, accessor injection or unclassified Rng fields',()=>{
  const r=runRandomStreams('S'),s=captureRunRandomState(r);
  r.physicsScramble.next();expect(()=>restoreRunRandomState(r,s)).toThrow(/not-fresh/);
  const freshRun=runRandomStreams('S');freshRun.physicsScramble.extra=2;
  expect(()=>captureRunRandomState(freshRun)).toThrow(/fields/);
  const bad=copy(s);
  Object.defineProperty(bad.streams.visualFx,'state',{get:()=>123,enumerable:true});
  const t=runRandomStreams('S'),before=state(t);
  expect(()=>restoreRunRandomState(t,bad)).toThrow(/fields/);
  expect(state(t)).toEqual(before);
 });
});

describe('explicit production SimClock state primitives: strict tick-boundary checkpoint',()=>{
 test('restore a real clock then match frame count, accumulator, and input pads on a suffix',()=>{
  const live=fresh(),target=fresh();
  for(const ms of [16,16,20,12,8.7,3.4,34.8]){
   const n=live.advance(ms);live.padsFor(pad(),n);live.tick+=n;
  }
  const serialized=parseCanonical(canonicalBytes(captureSimClockState(live)));
  expect(restoreSimClockState(target,serialized)).toBe(true);
  expect(target.tick).toBe(live.tick);
  expect(Object.is(target.accMs,live.accMs)).toBe(true);
  expect(Object.is(target.droppedMs,live.droppedMs)).toBe(true);
  for(const ms of [3,4,9,16.667,16.667,44,2400,2,1000/120]){
   const n=live.advance(ms),m=target.advance(ms);
   expect(m).toBe(n);
   const p=pad({hop:ms===44});
   expect(target.padsFor(p,m)).toEqual(live.padsFor(p,n));
   live.tick+=n;target.tick+=m;
   expect(target.tick).toBe(live.tick);
   expect(Object.is(target.accMs,live.accMs)).toBe(true);
   expect(Object.is(target.droppedMs,live.droppedMs)).toBe(true);
  }
 });
 test('rejects pending input edges and timeline, not silently dropping an input',()=>{
  const c=fresh();c.padsFor(pad({hop:true}),0);
  expect(()=>captureSimClockState(c)).toThrow(/pending-inputs/);
  const target=fresh();target.padsFor(pad({hop:true}),0);
  expect(()=>restoreSimClockState(target,captureSimClockState(fresh()))).toThrow(/pending-inputs/);
  const other=fresh();other.padsFor(pad(),0,{timeline:{base:{hop:false},events:[{t:1,name:'hop',down:true}],analog:0}});
  expect(()=>captureSimClockState(other)).toThrow(/pending-inputs/);
 });
 test('refuses nonfresh target, mismatched config, incomplete, negative or hostile double',()=>{
  const c=fresh();const valid=captureSimClockState(c);const target=fresh();
  const cases=[
   {...valid,version:999}, {...valid,tickMs:'f64:invalid'},
   {...valid,maxTicks:7}, {...valid,tick:-1},
   {...valid,accMs:'f64:7ff0000000000000'}, // +Infinity
   {...valid,droppedMs:'f64:7ff8000000000000'}, // NaN
   {...valid,_timeline:{}},
  ];
  for(const v of cases){const before=captureSimClockState(target);
   expect(()=>restoreSimClockState(target,v)).toThrow();
   expect(captureSimClockState(target)).toEqual(before);}
  const missing=copy(valid);delete missing.droppedMs;
  expect(()=>restoreSimClockState(target,missing)).toThrow(/fields/);
  target.advance(6);
  expect(()=>restoreSimClockState(target,valid)).toThrow(/not-fresh/);
 });
 test('refuses a non-writable fresh clock target before modifying its tick',()=>{
  const live=fresh();live.tick=123;
  const snap=captureSimClockState(live),target=fresh();
  Object.defineProperty(target,'droppedMs',{writable:false});
  const old=target.tick;
  expect(()=>restoreSimClockState(target,snap)).toThrow(/readonly/);
  expect(target.tick).toBe(old);
 });
 test('rejects newly unclassified clock fields on capture, preventing silent schema omissions',()=>{
  const c=fresh();c.newFuturePhysicsFlag=true;
  expect(()=>captureSimClockState(c)).toThrow(/fields/);
 });
});
