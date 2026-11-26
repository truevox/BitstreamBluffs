/** Canonical Matter section alone, not production whole-world admission. */
import {jest} from '@jest/globals';
import {loadDeps,buildWorld} from '../../tools/savestate-experiment/matter-node-experiment.mjs';
import {encodeMatterState,decodeMatterState,MATTER_SECTION_DESCRIPTOR} from '../../src/systems/savestate/matterState.js';
import {canonicalBytes,parseCanonical,f64Encode} from '../../src/systems/replay/canonicalJson.js';
let Matter,kit,source,projection,bytes;
const ctx={runId:'123456789-RUN',tick:300,buildId:'sha256:'+'a'.repeat(64)};
const capture=world=>kit.capture(world.engine,world.keyOf,{selectBody:()=>true});
beforeAll(async()=>{
 ({Matter,kit}=await loadDeps());
 source=buildWorld(Matter);
 for(let i=0;i<600;i++)Matter.Engine.update(source.engine,1000/240);
 projection=capture(source);
 expect(projection.pairs.some(p=>p.isActive&&p.contactCount>0)).toBe(true);
 bytes=encodeMatterState(projection,ctx,Matter);
});
const altered=mutate=>{const s=parseCanonical(bytes);mutate(s);return canonicalBytes(s);};
test('actual full-contact Matter state: exact binary64 roundtrip and canonical recapture',()=>{
 const decoded=decodeMatterState(bytes,ctx,Matter);
 expect(decoded).toEqual(projection);
 expect(encodeMatterState(decoded,ctx,Matter)).toEqual(bytes);
 const dest=buildWorld(Matter,'permuted');
 kit.restore(dest.engine,decoded,dest.keyOf,'full',{completePreflight:true});
 expect(encodeMatterState(capture(dest),ctx,Matter)).toEqual(bytes);
 // Verify isolated continuation in the already-built worlds. The fixture
 // does not spawn more bodies during this suffix (module IDs are shared).
 for(let i=0;i<240;i++){
  Matter.Engine.update(source.engine,1000/240);
  Matter.Engine.update(dest.engine,1000/240);
  expect(kit.digest(dest.engine,dest.keyOf)).toEqual(kit.digest(source.engine,source.keyOf));
 }
});
test('strictly frozen, explicit candidate descriptor; no layout registration',()=>{
 expect(Object.isFrozen(MATTER_SECTION_DESCRIPTOR)).toBe(true);
 expect(Object.isFrozen(MATTER_SECTION_DESCRIPTOR.schema.fields.bodies.item.fields)).toBe(true);
 expect(MATTER_SECTION_DESCRIPTOR.wireFloat).toBe('canonical-f64-finite');
 expect(()=>canonicalBytes(MATTER_SECTION_DESCRIPTOR)).not.toThrow();
});
test('signed zero and subnormal geometry/impulses do not disappear',()=>{
 const wire=altered(s=>{
  s.state.bodies.sled.v.velocity[0]=f64Encode(-0);
  s.state.bodies.sled.ci[1]=f64Encode(Number.MIN_VALUE);
  s.state.gravity.x=f64Encode(-0);
  s.state.pairs[0].contacts[0][1]=f64Encode(-0);
 });
 const d=decodeMatterState(wire,ctx,Matter);
 expect(Object.is(d.bodies.sled.v.velocity[0],-0)).toBe(true);
 expect(d.bodies.sled.ci[1]).toBe(Number.MIN_VALUE);
 expect(Object.is(d.gravity.x,-0)).toBe(true);
 expect(Object.is(d.pairs[0].contacts[0][1],-0)).toBe(true);
 expect(encodeMatterState(d,ctx,Matter)).toEqual(wire);
});
test.each([
 ['unknown section',s=>s.extra=true],
 ['missing header',s=>delete s.buildId],
 ['wrong version',s=>s.version=2],
 ['wrong Matter version',s=>s.matterVersion='0.20.1'],
 ['wrong run',s=>s.runId='other'],
 ['wrong tick',s=>s.tick++],
 ['wrong build',s=>s.buildId='sha256:'+'b'.repeat(64)],
 ['unknown body scalar',s=>s.state.bodies.sled.s.other=f64Encode(1)],
 ['missing body scalar',s=>delete s.state.bodies.sled.s.angle],
 ['float as number',s=>s.state.gravity.x=0],
 ['noncanonical float',s=>s.state.gravity.x='f64:3FF0000000000000'],
 ['infinite float',s=>s.state.gravity.x=f64Encode(Infinity)],
 ['NaN float',s=>s.state.gravity.x=f64Encode(NaN)],
 ['fractional ID',s=>s.state.ids.sled[0]=0.5],
 ['duplicate part ID',s=>s.state.ids.sled[1]=s.state.ids.sled[0]],
 ['missing body',s=>delete s.state.bodies.sled],
 ['unsafe body key',s=>s.state.bodies['invalid|key']=s.state.bodies.sled],
 ['wrong part geometry',s=>s.state.bodies.sled.parts[0].verts=[]],
 ['invalid bounds',s=>s.state.bodies.sled.parts[0].bounds[0]=f64Encode(1e50)],
 ['unknown statics',s=>s.state.statics.Resolver.evil=f64Encode(1)],
 ['missing statics',s=>delete s.state.statics.Constraint],
 ['nonboolean static',s=>s.state.statics.Body._timeCorrection=f64Encode(1)],
 ['orphan pair',s=>s.state.orphanPairs.push({})],
 ['audit finding',s=>s.state.audit.push('unsupported')],
 ['duplicate world order',s=>s.state.worldOrder.push('sled')],
 ['retired detector while unmodified',s=>{s.state.worldModified=false;s.state.detectorOrder[0]={retiredId:0,label:'terrain',minX:f64Encode(0),minY:f64Encode(0)};}],
 ['foreign pair reference',s=>s.state.pairs[0].a='missing#0'],
 ['bad support ref',s=>s.state.pairs[0].col.supports[0]=['missing#0',0]],
 ['missing support slot',s=>s.state.pairs[0].col.supports.pop()],
 ['support/count mismatch',s=>s.state.pairs.find(p=>p.isActive&&p.contactCount>0).contactCount=0],
 ['duplicate pair',s=>s.state.pairs.push(s.state.pairs[0])],
])('rejects %s',(_name,mutate)=>{
 expect(()=>decodeMatterState(altered(mutate),ctx,Matter)).toThrow();
});
test('capture refuses accessors, holes and hidden fields without evaluating them',()=>{
 const d=decodeMatterState(bytes,ctx,Matter),getter=jest.fn(()=>{throw Error('called');});
 Object.defineProperty(d.bodies.sled.s,'angle',{get:getter,enumerable:true,configurable:true});
 expect(()=>encodeMatterState(d,ctx,Matter)).toThrow(/field/);
 expect(getter).not.toHaveBeenCalled();
 const sparse=decodeMatterState(bytes,ctx,Matter);
 delete sparse.bodies.sled.parts[0].verts[0];
 expect(()=>encodeMatterState(sparse,ctx,Matter)).toThrow(/array-fields/);
 const hidden=decodeMatterState(bytes,ctx,Matter);
 Object.defineProperty(hidden.statics.Body,'extra',{value:1});
 expect(()=>encodeMatterState(hidden,ctx,Matter)).toThrow(/field/);
});
test('noncanonical bytes, foreign expected context, and old diagnostic wire all refuse',()=>{
 expect(()=>decodeMatterState(new Uint8Array([...bytes,32]),ctx,Matter)).toThrow();
 expect(()=>decodeMatterState(bytes,{...ctx,tick:301},Matter)).toThrow(/identity/);
 expect(()=>decodeMatterState(bytes,{...ctx,runId:'other'},Matter)).toThrow(/identity/);
 expect(()=>decodeMatterState(bytes,ctx,{version:'0.20.1'})).toThrow(/matter-version/);
 expect(()=>decodeMatterState('not bytes',ctx,Matter)).toThrow();
 expect(()=>decodeMatterState(canonicalBytes({kind:'bb-matter-diagnostic-snapshot',version:3}),ctx,Matter)).toThrow();
});
test('valid retired terrain projection preserves order and exact signed-zero coordinates',()=>{
 const d=decodeMatterState(bytes,ctx,Matter);
 const old=d.detectorOrder[0];
 const retiredId=d.nextId++;
 d.worldModified=true;
 d.detectorOrder.splice(0,1,{retiredId,label:'terrain',minX:-0,minY:1.2345678912345678},old);
 const wire=encodeMatterState(d,ctx,Matter),roundtrip=decodeMatterState(wire,ctx,Matter);
 expect(roundtrip.detectorOrder[1]).toBe(old);
 expect(Object.is(roundtrip.detectorOrder[0].minX,-0)).toBe(true);
 expect(encodeMatterState(roundtrip,ctx,Matter)).toEqual(wire);
});
