/** #119: exact, fail-closed adapters for TWO causal primitives only.
 *
 * This is NOT a production savestate layout/registry, world-restorer, save UI
 * or proof of official play. No current scene imports it. It is a reviewed
 * building block for an eventual atomic fresh-world Matter restore transaction.
 * Restores require fresh seeded instances and preflight every field before
 * mutating a single value. Never trust these plain snapshots as authority.
 */
import { Rng } from '../Rng.js';
import { RUN_RANDOM_VERSION, RUN_STREAMS } from '../RunRandom.js';
import { SimClock } from '../SimClock.js';
import { f64Encode, f64Decode } from '../replay/canonicalJson.js';

export const PRIMITIVE_STATE_VERSION = 1;
const RUN_KEYS = Object.keys(RUN_STREAMS);
const RNG_FIELDS = ['baseSeed', 'state'];
const CLOCK_FIELDS = ['tickMs','maxTicks','accMs','tick','droppedMs','_edges','_timeline'];
const UINT32_MAX = 0xffffffff;

export class PrimitiveStateError extends Error {
 constructor(code, field='') { super(`primitive-state:${code}${field?`:${field}`:''}`); this.code=code; this.field=field; }
}
const fail=(code,field)=>{throw new PrimitiveStateError(code,field);};
const u32=v=>Number.isInteger(v)&&v>=0&&v<=UINT32_MAX&&!Object.is(v,-0);
const uint=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&!Object.is(v,-0);

/** Reject symbols, hidden extras and accessors before inspecting any value. */
function exactOwn(obj,keys,path,prototype){
 if(obj===null||typeof obj!=='object'||Array.isArray(obj))fail('shape',path);
 if(Object.getPrototypeOf(obj)!==prototype)fail('prototype',path);
 const props=Object.getOwnPropertyDescriptors(obj);
 const own=Reflect.ownKeys(props);
 if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))fail('fields',path);
 for(const k of keys){
  const prop=props[k];
  if(!prop||!Object.hasOwn(prop,'value')||!prop.enumerable)fail('fields',`${path}.${k}`);
 }
 return props;
}
/** Canonical parser may produce objects in a separate JS realm (Jest/iframe).
 * Accept only ordinary plain-data prototypes (or null), never class prototypes.
 * The own-field/accessor check below remains exact across all realms.
 */
const plain=(obj,keys,path)=>{
 if(obj===null||typeof obj!=='object'||Array.isArray(obj))fail('shape',path);
 const proto=Object.getPrototypeOf(obj);
 if(proto!==null && (typeof proto!=='object'||Object.getPrototypeOf(proto)!==null))fail('prototype',path);
 const props=Object.getOwnPropertyDescriptors(obj), own=Reflect.ownKeys(props);
 if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))fail('fields',path);
 for(const k of keys){const d=props[k];if(!d||!Object.hasOwn(d,'value')||!d.enumerable)fail('fields',`${path}.${k}`);}
 return props;
};
function streamData(stream,key,requireMutable){
 const p=exactOwn(stream,RNG_FIELDS,key,Rng.prototype);
 const baseSeed=p.baseSeed.value,state=p.state.value;
 if(!u32(baseSeed)||!u32(state))fail('rng-u32',key);
 if(requireMutable&&p.state.writable!==true)fail('readonly',`${key}.state`);
 return {baseSeed,state};
}
function validateStreamTarget(streams,fresh){
 const p=plain(streams,['version',...RUN_KEYS],'runRandom');
 if(p.version.value!==RUN_RANDOM_VERSION)fail('rng-version','runRandom.version');
 const out={},refs=new Set();
 for(const key of RUN_KEYS){
  const stream=p[key].value;
  if(refs.has(stream))fail('alias',key);
  refs.add(stream);
  out[key]=streamData(stream,`runRandom.${key}`,fresh);
  if(fresh&&out[key].state!==out[key].baseSeed)fail('not-fresh',key);
 }
 return out;
}

export function captureRunRandomState(streams){
 const data=validateStreamTarget(streams,false),copy={};
 for(const key of RUN_KEYS)copy[key]={...data[key]};
 return {kind:'bb-primitive-run-random',version:PRIMITIVE_STATE_VERSION,streams:copy};
}

/** Restore *only* into fresh seed-matched stream objects, atomically preflighted. */
export function restoreRunRandomState(streams,snapshot){
 const target=validateStreamTarget(streams,true);
 const p=plain(snapshot,['kind','version','streams'],'snapshot');
 if(p.kind.value!=='bb-primitive-run-random'||p.version.value!==PRIMITIVE_STATE_VERSION)fail('version','snapshot');
 const data=plain(p.streams.value,RUN_KEYS,'snapshot.streams');
 const next={};
 for(const key of RUN_KEYS){
  const d=plain(data[key].value,RNG_FIELDS,`snapshot.streams.${key}`);
  if(!u32(d.baseSeed.value)||!u32(d.state.value))fail('rng-u32',key);
  if(d.baseSeed.value!==target[key].baseSeed)fail('seed-mismatch',key);
  next[key]=d.state.value;
 }
 // No allocation, getter or validation after this point. All target and
 // snapshot fields have been preflighted before the first state write.
 for(const key of RUN_KEYS)streams[key].state=next[key];
 return true;
}

function clockData(clock, fresh){
 const p=exactOwn(clock,CLOCK_FIELDS,'clock',SimClock.prototype);
 const v=Object.fromEntries(CLOCK_FIELDS.map(k=>[k,p[k].value]));
 if(!finite(v.tickMs)||v.tickMs<=0||!uint(v.maxTicks)||v.maxTicks===0||!uint(v.tick)||
   !finite(v.accMs)||v.accMs<0||v.accMs>=v.tickMs||!finite(v.droppedMs)||v.droppedMs<0)
  fail('clock-value');
 if(v._edges!==null||v._timeline!==null)fail('pending-inputs');
 if(fresh&&['tick','accMs','droppedMs'].some(k=>p[k].writable!==true))fail('readonly','clock');
 if(fresh&&(v.tick!==0||v.accMs!==0||v.droppedMs!==0))fail('not-fresh','clock');
 return v;
}

export function captureSimClockState(clock){
 const c=clockData(clock,false);
 return {kind:'bb-primitive-sim-clock',version:PRIMITIVE_STATE_VERSION,
  tickMs:f64Encode(c.tickMs),maxTicks:c.maxTicks,tick:c.tick,
  accMs:f64Encode(c.accMs),droppedMs:f64Encode(c.droppedMs),
  _edges:null,_timeline:null};
}

/** Refuse to overwrite active clocks or pending input edges/timelines. */
export function restoreSimClockState(clock,snapshot){
 const current=clockData(clock,true);
 const keys=['kind','version','tickMs','maxTicks','tick','accMs','droppedMs','_edges','_timeline'];
 const p=plain(snapshot,keys,'snapshot');
 if(p.kind.value!=='bb-primitive-sim-clock'||p.version.value!==PRIMITIVE_STATE_VERSION)fail('version','snapshot');
 const decode=(k)=>{
  if(typeof p[k].value!=='string')fail('f64',k);
  try{return f64Decode(p[k].value);}catch{fail('f64',k);}
 };
 const t=decode('tickMs'),acc=decode('accMs'),dropped=decode('droppedMs');
 if(!Object.is(t,current.tickMs)||p.maxTicks.value!==current.maxTicks)fail('clock-config');
 if(!uint(p.tick.value)||!finite(acc)||acc<0||acc>=t||!finite(dropped)||dropped<0||
   p._edges.value!==null||p._timeline.value!==null)fail('clock-value');
 const tick=p.tick.value;
 clock.tick=tick;clock.accMs=acc;clock.droppedMs=dropped;
 return true;
}
