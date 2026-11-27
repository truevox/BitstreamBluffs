import {jest} from '@jest/globals';
import {ScoreManager} from '../../src/systems/ScoreManager.js';
import {TrickTracker} from '../../src/systems/TrickTracker.js';
import {GlitchDirector} from '../../src/systems/GlitchDirector.js';
import {BsodPursuit} from '../../src/systems/BsodPursuit.js';
import {BsodBluffTracker} from '../../src/systems/BsodBluffTracker.js';
import {HintScheduler} from '../../src/systems/HintScheduler.js';
import {PIXELS_PER_METER} from '../../src/constants.js';
import {canonicalBytes,parseCanonical,f64Encode} from '../../src/systems/replay/canonicalJson.js';
import {encodeSceneSubsystemState,decodeSceneSubsystemState,SCENE_SUBSYSTEM_DESCRIPTOR,SCENE_SUBSYSTEM_FIELDS} from '../../src/systems/savestate/sceneSubsystemState.js';
const ctx={runId:'1234-scene-fixture',tick:1200,buildId:'sha256:'+'a'.repeat(64),seed:'scene-fixture'};
/** Test-only diagnostic projection of live native pure classes, including
 * the intentional shared tutorial Set. Production codec is NOT reflective. */
function project(o){
 const ids=new Map();
 function enc(v){
  if(v===null||typeof v!=='object')return typeof v==='number'&&(!Number.isFinite(v)||Object.is(v,-0))?{__num:Object.is(v,-0)?'-0':String(v)}:v;
  if(ids.has(v))return {__alias:ids.get(v)};
  const id=ids.size;ids.set(v,id);
  if(Array.isArray(v))return {__id:id,__arr:v.map(enc)};
  if(v instanceof Set)return {__id:id,__set:[...v].map(enc)};
  return {__id:id,__c:Object.getPrototypeOf(v)===Object.prototype?null:v.constructor.name,__obj:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,enc(x)]))};
 }
 return Object.fromEntries(SCENE_SUBSYSTEM_FIELDS.map(k=>[k,enc(o[k])]));
}
function fixture(){
 const score=new ScoreManager({pxPerMeter:PIXELS_PER_METER});
 score.setDistance(513.125);score.checkMilestones(513.125);
 score.addBonus(15,'shard');score.addTrick({type:'frontflip',count:1,airtimeMs:900});
 score.addTrick({type:'backflip',count:2,airtimeMs:1300});
 score.addTrick({type:'frontflip',count:2,airtimeMs:1600});
 const tricks=new TrickTracker();
 tricks.update({grounded:true,timeMs:10,dtMs:8,angleDeg:0});
 tricks.update({grounded:false,timeMs:18,dtMs:8,angleDeg:10});
 tricks.update({grounded:false,timeMs:26,dtMs:8,angleDeg:20});
 const glitch=new GlitchDirector({seed:ctx.seed});glitch.update(glitch.next.startMs,513);
 const bsod=new BsodPursuit({sledLeftEdgeX:70,level:3});bsod.advance(900,90);
 const bsodState=bsod.state(90,310,0.8),bsodBluffs=new BsodBluffTracker();
 const tutDone=new Set(['push']),hints=new HintScheduler({done:tutDone});
 hints.update(3000,{flip:true});hints.update(9000,{flip:true});
 const state={trickCounts:{frontflip:2,backflip:2},tutShown:new Set(['flip']),tutTimers:{stall:0},
  tutDone,hints,score,tricks,glitch,bsod,bsodState,bsodBluffs};
 return project(state);
}
let graph,wire;
beforeAll(()=>{graph=fixture();wire=encodeSceneSubsystemState(graph,ctx);});
const alter=fn=>{const s=parseCanonical(wire);fn(s);return canonicalBytes(s);};
test('native classes including active glitch, nonempty combo, completed hint and sentinel roundtrip',()=>{
 const d=decodeSceneSubsystemState(wire,ctx);
 expect(d).toEqual(graph);expect(encodeSceneSubsystemState(d,ctx)).toEqual(wire);
 expect(d.hints.__obj.done.__alias).toBe(d.tutDone.__id);
 expect(d.score.__obj.comboTricks.__arr).toEqual(['frontflip','backflip']);
 expect(d.glitch.__obj.active).not.toBeNull();
 expect(d.bsodBluffs.__obj.lastAwardX).toEqual({__num:'-Infinity'});
 expect(Object.isFrozen(SCENE_SUBSYSTEM_DESCRIPTOR.fields.score.fields)).toBe(true);
});
test('wire cannot select constructor names; declared runtime tags recreated locally',()=>{
 const data=parseCanonical(wire);
 expect(data.state.score).not.toHaveProperty('__c');
 expect(data.state.score).not.toHaveProperty('classId');
 expect(decodeSceneSubsystemState(wire,ctx).score.__c).toBe(ScoreManager.name);
 expect(()=>decodeSceneSubsystemState(alter(s=>s.state.score.__c='Rng'),ctx)).toThrow();
});
test.each([
 ['wrong build',s=>s.buildId='sha256:'+'b'.repeat(64)],
 ['wrong run',s=>s.runId+='x'],['wrong tick',s=>s.tick++],['wrong seed',s=>s.seed+='x'],
 ['unknown root',s=>s.state.unknown=0],['missing root',s=>delete s.state.tricks],
 ['unknown class field',s=>s.state.score.fields.evil=0],
 ['missing class field',s=>delete s.state.score.fields.pending],
 ['duplicate node ID',s=>s.state.tricks.id=s.state.score.id],
 ['wrong alias',s=>s.state.hints.fields.done=s.state.tutShown.id],
 ['wrong enum',s=>s.state.tutDone.items.push('not-a-hint')],
 ['duplicate set item',s=>s.state.tutDone.items.push(s.state.tutDone.items[0])],
 ['invalid trick',s=>s.state.score.fields.comboTricks.items[0]='invented'],
 ['duplicate dictionary key',s=>s.state.score.fields.paid.entries.push(s.state.score.fields.paid.entries[0])],
 ['incorrect pending total',s=>s.state.score.fields.pending++],
 ['incorrect flow',s=>s.state.score.fields.flow=f64Encode(10)],
 ['noncanonical float',s=>s.state.score.fields.distanceM=2],
 ['infinite score',s=>s.state.score.fields.distanceM=f64Encode(Infinity)],
 ['wrong glitch seed',s=>s.state.glitch.fields.seed='other'],
 ['wrong glitch RNG',s=>s.state.glitch.fields.rng.fields.baseSeed^=1],
 ['unknown glitch kind',s=>s.state.glitch.fields.next.fields.kind='bad'],
 ['wrong next event',s=>s.state.glitch.fields.next.fields.id='g1234-abcd'],
 ['bad BSOD config',s=>s.state.bsod.fields.config.fields.initialGapPx++],
 ['wrong BSOD snapshot activity',s=>s.state.bsodState.fields.active=false],
 ['bad bluff sentinel',s=>s.state.bsodBluffs.fields.lastAwardX=f64Encode(Infinity)],
 ['modified hint definition',s=>s.state.hints.fields.defs.fields.hop.fields.minMs++],
])('rejects %s',(_name,fn)=>{expect(()=>decodeSceneSubsystemState(alter(fn),ctx)).toThrow();});
test('exact signed zero and subnormal values, only declared infinity sentinel',()=>{
 const b=alter(s=>{s.state.tricks.fields._prevAngle=f64Encode(-0);s.state.tricks.fields._tiltNet=f64Encode(Number.MIN_VALUE);
  s.state.bsodBluffs.fields.lastAwardX=f64Encode(-0);});
 const d=decodeSceneSubsystemState(b,ctx);
 expect(d.tricks.__obj._prevAngle).toEqual({__num:'-0'});
 expect(d.tricks.__obj._tiltNet).toBe(Number.MIN_VALUE);
 expect(d.bsodBluffs.__obj.lastAwardX).toEqual({__num:'-0'});
 expect(encodeSceneSubsystemState(d,ctx)).toEqual(b);
});
test('unknown native class, sparse arrays, hidden fields and accessors refuse capture',()=>{
 const d=fixture();d.score.__c='Rng';expect(()=>encodeSceneSubsystemState(d,ctx)).toThrow(/class/);
 const e=fixture(),get=jest.fn(()=>{throw Error('invoked');});
 Object.defineProperty(e.score.__obj,'distanceM',{get,enumerable:true,configurable:true});
 expect(()=>encodeSceneSubsystemState(e,ctx)).toThrow(/field/);expect(get).not.toHaveBeenCalled();
 const f=fixture();delete f.score.__obj.comboTricks.__arr[0];expect(()=>encodeSceneSubsystemState(f,ctx)).toThrow(/array-fields/);
 const g=fixture();Object.defineProperty(g.score.__obj,'hidden',{value:1});expect(()=>encodeSceneSubsystemState(g,ctx)).toThrow(/field/);
});
test('wrong context and noncanonical bytes refuse',()=>{
 expect(()=>decodeSceneSubsystemState(wire,{...ctx,tick:ctx.tick+1})).toThrow(/identity/);
 expect(()=>decodeSceneSubsystemState(new Uint8Array([...wire,32]),ctx)).toThrow();
 expect(()=>decodeSceneSubsystemState('not bytes',ctx)).toThrow();
});
