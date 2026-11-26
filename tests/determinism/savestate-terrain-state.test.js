import {makeGen} from '../src/_helpers.js';
import {captureTerrainState,restoreTerrainState} from '../../src/systems/savestate/terrainState.js';
import {canonicalBytes,parseCanonical,f64Encode} from '../../src/systems/replay/canonicalJson.js';

const ctx={runId:'1234-terrain',tick:900,buildId:'sha256:'+'a'.repeat(64)};
function fixture(seed='terrain-persistence',biomeMask=0){
 const terrain=makeGen(seed,{biomeMask});
 let queue=new Map(),mesh=new Set();
 function update(x){
  const {added,removed}=terrain.update(x);
  for(const i of removed){queue.delete(i);mesh.delete(i);}
  for(const c of added)queue.set(c.index,c);
  // Mirror RunScene's streaming ownership with a deliberately partial queue.
  for(const [i,c] of queue)if(c.startX<x+1200){mesh.add(i);queue.delete(i);}
 }
 for(let x=0;x<=16000;x+=800){update(x);terrain.heightAt(x+100);}
 // Preserve real speculative/cache work, including a temp far behind and
 // pending-added terrain ahead of the live mesh.
 terrain.heightAt(100);terrain.heightAt(terrain.activeList.at(-1).endX+30);
 return {terrain,queue,meshOrder:[...mesh]};
}
const capture=s=>captureTerrainState(s.terrain,s.queue,s.meshOrder,ctx);
let source,wire;
beforeAll(()=>{source=fixture();wire=capture(source);});
test('detached native regeneration preserves pool, pending queues, aliases, raw scratch and exact bytes',()=>{
 const result=restoreTerrainState(wire,source.terrain.options,ctx);
 expect(result.terrain).not.toBe(source.terrain);
 expect(capture(result)).toEqual(wire);
 expect(capture(source)).toEqual(wire);
 for(const c of result.terrain.activeList)expect(result.terrain.active.get(c.index)).toBe(c);
 for(const [i,c] of result.queue)expect(result.terrain.active.get(i)).toBe(c);
 expect(result.meshOrder).toEqual(source.meshOrder);
 expect(result.terrain._tempChunk).not.toBeNull();
 expect(result.terrain.pool.length+result.terrain._pendingRelease.length).toBeGreaterThan(0);
 expect(result.terrain._pendingAdded.length).toBeGreaterThan(0);
});
test.each([0,1,3,0xffffffff])('continued generation and cache behavior is exact across mask %i',mask=>{
 const a=fixture('terrain-suffix',mask),b=restoreTerrainState(capture(a),a.terrain.options,ctx);
 expect(capture(b)).toEqual(capture(a));
 for(let x=16100;x<32000;x+=731){
  for(const probe of [x,x+600,x-50,100,x+40000]){
   expect(b.terrain.heightAt(probe)).toBe(a.terrain.heightAt(probe));
   expect(b.terrain.slopeDegAt(probe)).toBe(a.terrain.slopeDegAt(probe));
  }
  expect(b.terrain.update(x)).toEqual(a.terrain.update(x));
  expect(b.terrain.activeList).toEqual(a.terrain.activeList);
 }
 a.queue.clear();b.queue.clear();a.meshOrder=[];b.meshOrder=[];
 expect(capture(b)).toEqual(capture(a));
});
const bad=fn=>{const s=parseCanonical(wire);fn(s);return canonicalBytes(s);};
test.each([
 ['wrong build',s=>s.buildId='sha256:'+'b'.repeat(64)],
 ['wrong tick',s=>s.tick++],['wrong run',s=>s.runId+='x'],
 ['unknown field',s=>s.unclassified=1],['missing field',s=>delete s.rng],
 ['oversized regeneration',s=>s.boundsCount=1000000],
 ['incorrect bounds witness',s=>s.boundsDigest='sha256:'+'b'.repeat(64)],
 ['incorrect geometry witness',s=>s.slots[0].digest='sha256:'+'b'.repeat(64)],
 ['wrong RNG seed',s=>s.rng.baseSeed^=1],
 ['duplicate active reference',s=>s.roles.active.push(s.roles.active[0])],
 ['owner overlap',s=>s.roles.pool.push(s.roles.active[0])],
 ['bad queue reference',s=>s.roles.queue.push(s.roles.scratch)],
 ['queue/mesh overlap',s=>s.roles.queue.push(s.roles.mesh[0])],
 ['wrong active order',s=>s.roles.active.reverse()],
 ['bad scratch length',s=>s.scratch._raw.pop()],
 ['nonfinite scratch',s=>s.scratch._raw[0]=f64Encode(Infinity)],
])('rejects %s',(_n,fn)=>{
 expect(()=>restoreTerrainState(bad(fn),source.terrain.options,ctx)).toThrow();
 expect(capture(source)).toEqual(wire);
});
test('refuses foreign configuration and unknown native fields',()=>{
 expect(()=>restoreTerrainState(wire,{...source.terrain.options,seed:'other'},ctx)).toThrow(/config/);
 const a=fixture();a.terrain.futureState=true;expect(()=>capture(a)).toThrow(/inventory/);
});
test('geometry edits cannot survive independent deterministic rebuild',()=>{
 const a=fixture();a.terrain.activeList[0].points[0].y+=1;
 expect(()=>restoreTerrainState(capture(a),a.terrain.options,ctx)).toThrow(/chunk-witness/);
});
test('preserves signed zero and subnormal scratch exactly',()=>{
 const a=fixture();a.terrain._raw[0]=-0;a.terrain._raw[1]=Number.MIN_VALUE;
 const saved=capture(a),b=restoreTerrainState(saved,a.terrain.options,ctx);
 expect(Object.is(b.terrain._raw[0],-0)).toBe(true);
 expect(b.terrain._raw[1]).toBe(Number.MIN_VALUE);expect(capture(b)).toEqual(saved);
});
