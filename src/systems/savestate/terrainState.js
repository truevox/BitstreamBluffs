/** #119: compact native terrain recipe. Geometry is rebuilt by the shipped
 * deterministic generator, never supplied as arbitrary stored colliders.
 * This section is not yet registered as a complete scene layout. Callers
 * must rebind entity/spawn references and validate Matter before activation.
 */
import {TerrainGenerator} from '../TerrainGenerator.js';
import {Rng} from '../Rng.js';
import {canonicalBytes,parseCanonical,f64Encode,f64Decode,asUint8Array} from '../replay/canonicalJson.js';
import {digestOf} from '../replay/canonicalSha256.js';

const KIND='bb-native-terrain',VERSION=1;
const MAX_BOUNDS=1024,MAX_SLOTS=128,MAX_SCRATCH=8192;
const HASH=/^sha256:[0-9a-f]{64}$/;
const CONFIG=['options','screenW','ppm','seed','seedState','splineDefs','noiseDefs','bridgeDefs','hazardList',
 'airHazardList','powerupList','biomeHazards','biomePowerups','biomeHazardById','crashHazardIds','modMap','biomeDefs','biomeMask'];
const SCRATCH=['_raw','_ys','_cx','_cy','_tx','_ty'];
const MUTABLE=['rng','active','activeList','pool','_pendingRelease','_pendingAdded','_scratchChunk','_tempChunk','_lastChunk',
 'stats','bounds','_cap',...SCRATCH];
const ROLES=['active','pool','release','added','scratch','temp','last','queue','mesh'];
const STATE=['kind','version','runId','tick','buildId','config','boundsCount','boundsDigest','rng','slots','roles','stats','cap','scratch'];
const fail=(field)=>{throw Error('terrain-state:'+field);};
const need=(ok,f)=>{if(!ok)fail(f);};
const uint=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
const u32=v=>uint(v)&&v<=0xffffffff;
const digest=v=>typeof v==='string'&&HASH.test(v);
function exact(v,keys,label,proto=Object.prototype){
 need(v&&typeof v==='object'&&(Object.getPrototypeOf(v)===proto||
   (proto===Object.prototype&&Object.getPrototypeOf(v)===null))&&!Array.isArray(v),label);
 const d=Object.getOwnPropertyDescriptors(v),own=Reflect.ownKeys(d);
 need(own.length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&d[k].enumerable&&Object.hasOwn(d[k],'value')),label);
 return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
function list(v,max,label,strict=true){
 need(Array.isArray(v)&&(!strict||Object.getPrototypeOf(v)===Array.prototype)&&v.length<=max,label);
 const d=Object.getOwnPropertyDescriptors(v);
 need(Reflect.ownKeys(d).length===v.length+1,label);
 return Array.from({length:v.length},(_,i)=>{
  need(d[i]&&d[i].enumerable&&Object.hasOwn(d[i],'value'),label);return d[i].value;
 });
}
/** Hash only application-owned generated/config data. No wire objects are
 * accepted here. Encode numeric bits including signed zero, preserve Set
 * iteration and reject hidden/accessor/unknown runtime objects. */
function witness(v,depth=0){
 need(depth<=24,'witness-depth');
 if(v===null||typeof v==='string'||typeof v==='boolean')return v;
 if(typeof v==='number'){need(Number.isFinite(v),'witness-number');return ['f64',f64Encode(v)];}
 if(Array.isArray(v))return ['array',list(v,MAX_SCRATCH,'witness-array',false).map(x=>witness(x,depth+1))];
 if(v instanceof Set&&Object.getPrototypeOf(v)===Set.prototype){
  need(v.size<=MAX_SCRATCH&&Reflect.ownKeys(v).length===0,'witness-set');
  return ['set',[...v].map(x=>witness(x,depth+1))];
 }
 need(v&&typeof v==='object'&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null),'witness-object');
 const d=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(d);
 need(keys.every(k=>typeof k==='string'&&d[k].enumerable&&Object.hasOwn(d[k],'value')),'witness-field');
 // Explicit tagged records avoid collisions with tagged numeric/array values.
 return ['record',keys.sort().map(k=>[k,witness(d[k].value,depth+1)])];
}
const hash=v=>digestOf(witness(v));
function context(c){
 const x=exact(c,['runId','tick','buildId'],'context');
 need(typeof x.runId==='string'&&x.runId.length>0&&x.runId.length<=256&&uint(x.tick)&&digest(x.buildId),'context');
 return x;
}
function generator(g){
 return exact(g,[...CONFIG,...MUTABLE],'generator-inventory',TerrainGenerator.prototype);
}
function config(g){return hash(Object.fromEntries(CONFIG.map(k=>[k,g[k]])));}
function ids(a,len,label){
 return list(a,MAX_SLOTS,label).map(i=>{need(uint(i)&&i<len,label);return i;});
}
function unique(a,label){need(new Set(a).size===a.length,label);}
function stat(v){const s=exact(v,['created','reused','built'],'stats');need(Object.values(s).every(uint),'stats');return s;}
function floats(a){
 need(a instanceof Float64Array&&Object.getPrototypeOf(a)===Float64Array.prototype&&a.length<=MAX_SCRATCH,'scratch');
 return Array.from(a,x=>{need(Number.isFinite(x),'scratch');return f64Encode(x);});
}
function rngState(r){
 const v=exact(r,['baseSeed','state'],'rng',Rng.prototype);
 need(u32(v.baseSeed)&&u32(v.state),'rng');return v;
}
/** Capture a native generator and its scene's ordered chunk queue/mesh keys.
 * No getChunk(), streaming or writes on the live world. */
export function captureTerrainState(terrain,queue,meshOrder,expected){
 const c=context(expected),g=generator(terrain);
 need(g.bounds.length>=1&&g.bounds.length<=MAX_BOUNDS,'bounds-count');
 need(g.active instanceof Map&&Object.getPrototypeOf(g.active)===Map.prototype&&queue instanceof Map&&Object.getPrototypeOf(queue)===Map.prototype,'maps');
 const slots=[],byObject=new Map();
 function ref(chunk){
  if(chunk===null)return null;
  if(byObject.has(chunk))return byObject.get(chunk);
  need(chunk&&typeof chunk==='object'&&Number.isSafeInteger(chunk.index)&&chunk.index>=-1&&chunk.index<g.bounds.length-1,'chunk-index');
  need(slots.length<MAX_SLOTS,'slots');
  const i=slots.length;byObject.set(chunk,i);slots.push({index:chunk.index,digest:hash(chunk)});return i;
 }
 const active=list(g.activeList,MAX_SLOTS,'active').map(ref);
 need(g.active.size===active.length&&[...g.active].every(([i,v],n)=>i===v.index&&v===g.activeList[n]),'active-alias');
 const roles={active,pool:list(g.pool,6,'pool').map(ref),release:list(g._pendingRelease,MAX_SLOTS,'release').map(ref),
  added:list(g._pendingAdded,MAX_SLOTS,'added').map(ref),scratch:ref(g._scratchChunk),temp:ref(g._tempChunk),
  last:ref(g._lastChunk),queue:[...queue].map(([i,v])=>{need(i===v.index&&g.active.get(i)===v,'queue-alias');return ref(v);}),
  mesh:list(meshOrder,MAX_SLOTS,'mesh').map(i=>{need(g.active.has(i),'mesh-index');return ref(g.active.get(i));})};
 const rng=rngState(g.rng);
 const s={kind:KIND,version:VERSION,...c,config:config(g),boundsCount:g.bounds.length,boundsDigest:hash(g.bounds),
  rng,slots,roles,stats:stat(g.stats),cap:g._cap,scratch:Object.fromEntries(SCRATCH.map(k=>[k,floats(g[k])]))};
 // Verify structural admission now, without rebuilding or mutating live state.
 validate(s,c);
 return canonicalBytes(s);
}
function validate(input,c){
 const s=exact(input,STATE,'section');
 need(s.kind===KIND&&s.version===VERSION&&Object.keys(c).every(k=>Object.is(c[k],s[k])),'identity');
 need(digest(s.config)&&digest(s.boundsDigest)&&uint(s.boundsCount)&&s.boundsCount>=1&&s.boundsCount<=MAX_BOUNDS,'bounds');
 const r=exact(s.rng,['baseSeed','state'],'rng');need(u32(r.baseSeed)&&u32(r.state),'rng');
 s.slots=list(s.slots,MAX_SLOTS,'slots').map(x=>{
  const v=exact(x,['index','digest'],'slot');
  need(Number.isSafeInteger(v.index)&&!Object.is(v.index,-0)&&v.index>=-1&&v.index<s.boundsCount-1&&digest(v.digest),'slot');return v;
 });
 const roles=exact(s.roles,ROLES,'roles'),n=s.slots.length;
 for(const k of ['active','pool','release','added','queue','mesh']){roles[k]=ids(roles[k],n,k);unique(roles[k],k);}
 for(const k of ['scratch','temp','last'])need((k!=='scratch'&&roles[k]===null)||(uint(roles[k])&&roles[k]<n),k);
 need(roles.pool.length<=6,'pool');
 const owned=[...roles.active,...roles.pool,...roles.release,roles.scratch,...(roles.temp===null?[]:[roles.temp])];
 unique(owned,'owner-overlap');
 const present=new Set([...owned,...(roles.last===null?[]:[roles.last])]);
 need(present.size===n,'unused-slot');
 need([...roles.active,...roles.pool,...roles.release,...roles.added,...roles.queue,...roles.mesh,
   ...(roles.temp===null?[]:[roles.temp]),...(roles.last===null?[]:[roles.last])].every(i=>s.slots[i].index>=0),'unbuilt-chunk');
 const activeIndices=roles.active.map(i=>s.slots[i].index);
 need(activeIndices.every((i,k)=>k===0||i===activeIndices[k-1]+1),'active-order');
 const active=new Set(roles.active);
 need([...roles.added,...roles.queue,...roles.mesh].every(i=>active.has(i)),'active-reference');
 need(!roles.queue.some(i=>roles.mesh.includes(i)),'queue-mesh-overlap');
 s.roles=roles;s.stats=stat(s.stats);
 need(uint(s.cap)&&s.cap>=256&&s.cap<=MAX_SCRATCH,'cap');
 const scratch=exact(s.scratch,SCRATCH,'scratch');
 for(const k of SCRATCH)scratch[k]=list(scratch[k],MAX_SCRATCH,k).map(v=>{
  let n;try{n=f64Decode(v);}catch{fail(k);}need(Number.isFinite(n),k);return n;
 });
 need(scratch._raw.length===s.cap&&scratch._ys.length===s.cap&&scratch._cx.length===scratch._cy.length&&
  scratch._cx.length>=16&&scratch._tx.length===362&&scratch._ty.length===362,'scratch-length');
 s.scratch=scratch;return s;
}
/** Restore a detached generator from application-owned options. Geometry
 * and bounds must independently match the source witnesses. Never attach
 * this to a live scene without rebuilding all references. */
export function restoreTerrainState(bytes,options,expected){
 const c=context(expected),s=validate(parseCanonical(asUint8Array(bytes,'terrain section')),c);
 const terrain=new TerrainGenerator(options),g=generator(terrain);
 need(config(g)===s.config&&g.seedState===s.rng.baseSeed,'config');
 terrain._boundAt(s.boundsCount-1);
 need(terrain.bounds.length===s.boundsCount&&hash(terrain.bounds)===s.boundsDigest,'bounds-witness');
 const chunks=s.slots.map(slot=>{
  const chunk=slot.index===-1?terrain._newChunk():terrain.getChunk(slot.index);
  need(hash(chunk)===slot.digest,'chunk-witness');return chunk;
 });
 const r=s.roles,pick=i=>i===null?null:chunks[i],select=a=>a.map(pick);
 terrain.activeList=select(r.active);
 terrain.active=new Map(terrain.activeList.map(v=>[v.index,v]));
 terrain.pool=select(r.pool);terrain._pendingRelease=select(r.release);terrain._pendingAdded=select(r.added);
 terrain._scratchChunk=pick(r.scratch);terrain._tempChunk=pick(r.temp);terrain._lastChunk=pick(r.last);
 terrain.stats={...s.stats};terrain.rng.state=s.rng.state;terrain._cap=s.cap;
 for(const k of SCRATCH)terrain[k]=Float64Array.from(s.scratch[k]);
 const queue=new Map(select(r.queue).map(v=>[v.index,v])),meshOrder=select(r.mesh).map(v=>v.index);
 return {terrain,queue,meshOrder};
}
