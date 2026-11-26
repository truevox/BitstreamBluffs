/** #119: explicit native GhostRecorder section. No world/layout registration.
 * Snapshot bytes are only an error-detecting cache, never evidence of play.
 * Capture accepts application-owned native instances, not foreign objects.
 * Restore parses canonical bytes and returns a NEW detached recorder; the
 * caller must preflight/restore the complete isolated world before attaching.
 */
import {GhostRecorder, GHOST_TAPE_FORMAT, GHOST_TAPE_VERSION, GHOST_PHYSICS_VERSION,
 CHECKPOINT_EVERY, TRACE_EVERY} from '../ghost/GhostTape.js';
import {SIM_TICK_HZ} from '../SimClock.js';
import {RUN_RANDOM_VERSION, RUN_STREAMS} from '../RunRandom.js';
import {BOOSTS} from '../Boosts.js';
import {UPGRADE_IDS} from '../PermanentUpgrades.js';
import {KODIAK_VERSION, KODIAK_PACK_MODES} from '../Kodiaks.js';
import {CONTROL_LAYOUTS} from '../ControlLayouts.js';
import {FP_SUBSYSTEMS, PAD_BITS_V1, validateInputRows, resolveReplaySetup} from '../replay/manifest.js';
import {combineFingerprints} from '../replay/canonicalBinary.js';
import {canonicalBytes, parseCanonical, f64Encode, f64Decode} from '../replay/canonicalJson.js';
import {digestOf} from '../replay/canonicalSha256.js';

export const RECORDER_STATE_VERSION = 1;
const KIND = 'bb-native-recorder-prefix';
const FIELDS = ['header','inputs','checkpoints','trace','fingerprints','fingerprintErrorCount',
 'fingerprintErrors','_last','_lastTick','lastTick'];
const HEADER = ['format','version','physicsVersion','simTickHz','runRandomVersion','edgeRows',
 'seed','biomeMask','simRevision','rulesetId','buildId','mode','dailyRuleId','dailyRuleSource',
 'syncLevel','bsod','controlLayout','boosts','upgradeRanks','magnetsDrop','kodiaksOn',
 'kodiakPackMode','kodiakVersion','startPose','random','startedAt'];
const SECTION = ['kind','version','runId','tick','recorder'];
const EDGE_MASK = ((1 << PAD_BITS_V1.edge.length)-1) << PAD_BITS_V1.bool.length;
const MAX_ITEMS = 1000000; // canonical envelope has a separate 16 MiB byte cap
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const FP = /^xxh32x2:[0-9a-f]{16}$/;
export class RecorderStateError extends Error {
 constructor(code,field=''){super('recorder-state:'+code+(field?':'+field:''));this.code=code;this.field=field;}
}
const fail=(code,field)=>{throw new RecorderStateError(code,field);};
const uint=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
const u32=v=>uint(v)&&v<=0xffffffff;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const string=v=>typeof v==='string'&&v.length>0;
const digest=v=>typeof v==='string'&&DIGEST.test(v);
const fp=v=>typeof v==='string'&&FP.test(v);
const need=(condition,field)=>{if(!condition)fail('invalid-field',field);};
function fields(obj,keys,path,prototype){
 if(!obj||typeof obj!=='object'||Array.isArray(obj))fail('shape',path);
 const proto=Object.getPrototypeOf(obj);
 if(prototype ? proto!==prototype : proto!==Object.prototype&&proto!==null)fail('prototype',path);
 const props=Object.getOwnPropertyDescriptors(obj),own=Reflect.ownKeys(props);
 if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))fail('fields',path);
 const copy={};
 for(const k of keys){
  const d=props[k];
  if(!d||!Object.hasOwn(d,'value')||!d.enumerable)fail('fields',path+'.'+k);
  copy[k]=d.value;
 }
 return copy;
}
function list(value,path,convert,expectedLength){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||
  value.length>MAX_ITEMS||(expectedLength!==undefined&&value.length!==expectedLength))fail('array',path);
 const props=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(props).length!==value.length+1)fail('array-fields',path);
 const out=[];
 for(let i=0;i<value.length;i++){
  const d=props[i];
  if(!d||!Object.hasOwn(d,'value')||!d.enumerable)fail('array-fields',path+'.'+i);
  out.push(convert(d.value,path+'.'+i));
 }
 return out;
}
const exactInt=(value,path)=>{need(uint(value),path);return value;};
function numberCodec(value,path,decode){
 const n=decode?f64Decode(value):value;
 need(finite(n),path);
 return decode?n:f64Encode(n);
}
function headerCodec(value,decode,ctx){
 const h=fields(value,HEADER,'header');
 need(h.format===GHOST_TAPE_FORMAT&&h.version===GHOST_TAPE_VERSION&&
  h.physicsVersion===GHOST_PHYSICS_VERSION&&h.simTickHz===SIM_TICK_HZ&&
  h.runRandomVersion===RUN_RANDOM_VERSION&&h.edgeRows==='every-tick','header.protocol');
 need(h.buildId===ctx.buildId&&h.rulesetId===ctx.rulesetId&&h.simRevision===ctx.simRevision,'header.build');
 need(string(h.seed)&&u32(h.biomeMask)&&uint(h.startedAt)&&
  ['normal','daily','daily-draft'].includes(h.mode),'header.run');
 need(h.dailyRuleId===null||string(h.dailyRuleId),'header.dailyRuleId');
 need(['seed-date','clock-at-start'].includes(h.dailyRuleSource),'header.dailyRuleSource');
 need(uint(h.syncLevel)&&h.syncLevel>=1&&Object.values(CONTROL_LAYOUTS).includes(h.controlLayout),'header.setup');
 need(typeof h.magnetsDrop==='boolean'&&typeof h.kodiaksOn==='boolean'&&
  KODIAK_PACK_MODES.includes(h.kodiakPackMode)&&h.kodiakVersion===KODIAK_VERSION,'header.kodiak');
 h.boosts=list(h.boosts,'header.boosts',(v,p)=>{need(BOOSTS.includes(v),p);return v;});
 need(h.boosts.every((v,i)=>i===0||h.boosts[i-1]<v),'header.boosts.order');
 if(h.upgradeRanks!==null){
  const r=h.upgradeRanks,keys=r&&typeof r==='object'?Reflect.ownKeys(r):[];
  need(keys.length>0&&keys.every(k=>UPGRADE_IDS.includes(k)),'header.upgradeRanks');
  h.upgradeRanks=fields(r,keys,'header.upgradeRanks');
  need(Object.values(h.upgradeRanks).every(v=>uint(v)&&v>0),'header.upgradeRanks.value');
 }
 h.random=fields(h.random,['version',...Object.keys(RUN_STREAMS)],'header.random');
 need(h.random.version===RUN_RANDOM_VERSION&&Object.keys(RUN_STREAMS).every(k=>u32(h.random[k])),'header.random');
 h.startPose=list(h.startPose,'header.startPose',(v,p)=>numberCodec(v,p,decode),6);
 h.bsod=fields(h.bsod,['leftEdgeX','initial'],'header.bsod');
 h.bsod.leftEdgeX=numberCodec(h.bsod.leftEdgeX,'header.bsod.leftEdgeX',decode);
 h.bsod.initial=fields(h.bsod.initial,['wallX','wallSpeedPxS','accelerationPxS2'],'header.bsod.initial');
 for(const k of Object.keys(h.bsod.initial))h.bsod.initial[k]=numberCodec(h.bsod.initial[k],'header.bsod.initial.'+k,decode);
 // Existing replay setup rejects an unknown daily rule. No legacy defaults
 // are admitted by the above mandatory header fields.
 resolveReplaySetup(h);
 return h;
}
function context(ctx){
 need(ctx&&string(ctx.runId)&&u32(ctx.tick)&&digest(ctx.buildId)&&digest(ctx.rulesetId)&&
  uint(ctx.simRevision)&&ctx.simRevision>0,'context');
 return {runId:ctx.runId,tick:ctx.tick,buildId:ctx.buildId,rulesetId:ctx.rulesetId,simRevision:ctx.simRevision};
}
function nativeData(rec){
 return fields(rec,FIELDS,'recorder',GhostRecorder.prototype);
}
function recorderCodec(value,decode,ctx){
 const r=fields(value,FIELDS,'recorder-data');
 r.header=headerCodec(r.header,decode,ctx);
 need(ctx.runId===r.header.startedAt+'-'+r.header.seed,'runId');
 need(r.lastTick===ctx.tick&&uint(r._lastTick)&&r._lastTick<=ctx.tick,'cursor.tick');
 need(r.fingerprintErrorCount===0,'fingerprint-errors');
 r.fingerprintErrors=list(r.fingerprintErrors,'fingerprintErrors',v=>v,0);
 r.inputs=list(r.inputs,'inputs',(row,p)=>list(row,p,(v,k)=>{
  need(Number.isSafeInteger(v)&&!Object.is(v,-0),k);return v;
 },3));
 validateInputRows(r.inputs,ctx.tick);
 let at=0;
 for(let i=0;i<r.inputs.length;i++){
  const row=r.inputs[i];at+=row[0];
  need(at<=ctx.tick&&(i>0||row[0]===1),'inputs.tick');
  if(i>0){
   const prev=r.inputs[i-1];
   need(row[1]!==prev[1]||row[2]!==prev[2]||(row[1]&EDGE_MASK)!==0,'inputs.redundant');
   // Native input() records every edge tick and its very next changed
   // (or repeated edge) tick. A gap after an edge cannot be genuine.
   need(!(prev[1]&EDGE_MASK)||row[0]===1,'inputs.edge-gap');
  }
 }
 need(at===r._lastTick&&(ctx.tick===0?r.inputs.length===0:r.inputs.length>0),'cursor.coverage');
 if(r.inputs.length===0)need(r._last===null,'cursor.empty');
 else {
  r._last=list(r._last,'cursor.last',(v,p)=>{need(Number.isSafeInteger(v)&&!Object.is(v,-0),p);return v;},2);
  need(r._last.every((v,i)=>v===r.inputs.at(-1)[i+1]),'cursor.last');
  need(!(r._last[0]&EDGE_MASK)||at===ctx.tick,'cursor.edge-gap');
 }
 const checkpoints=Math.floor(ctx.tick/CHECKPOINT_EVERY);
 r.trace=list(r.trace,'trace',(v,p)=>numberCodec(v,p,decode),Math.floor(ctx.tick/TRACE_EVERY)*3);
 r.checkpoints=list(r.checkpoints,'checkpoints',(row,p)=>{
  const vals=list(row,p,(v,k)=>k.endsWith('.0')?exactInt(v,k):numberCodec(v,k,decode),8);
  const i=Number(p.split('.').at(-1));
  need(vals[0]===(i+1)*CHECKPOINT_EVERY,'checkpoints.tick');
  const score=decode?vals[7]:f64Decode(vals[7]);
  need(uint(score),'checkpoints.score');
  const traceAt=(vals[0]/TRACE_EVERY-1)*3;
  need(vals.slice(1,4).every((v,k)=>Object.is(v,r.trace[traceAt+k])),'checkpoints.trace-mismatch');
  return vals;
 },checkpoints);
 r.fingerprints=list(r.fingerprints,'fingerprints',(entry,p)=>{
  const f=fields(entry,['tick','combined','subsystems'],p);
  const i=Number(p.split('.').at(-1));
  need(f.tick===(i+1)*CHECKPOINT_EVERY&&fp(f.combined),p+'.tick');
  f.subsystems=fields(f.subsystems,FP_SUBSYSTEMS,p+'.subsystems');
  need(Object.values(f.subsystems).every(fp)&&
   combineFingerprints(f.tick,f.subsystems,FP_SUBSYSTEMS)===f.combined,p+'.combined');
  return f;
 },checkpoints);
 return r;
}

/** Application-owned native instance, captured at a completed tick. */
export function captureRecorderState(rec,expected){
 const ctx=context(expected);
 const r=recorderCodec(nativeData(rec),false,ctx);
 return canonicalBytes({kind:KIND,version:RECORDER_STATE_VERSION,runId:ctx.runId,tick:ctx.tick,recorder:r});
}

/** Decode a validated, detached recorder section for the fresh-world setup.
 * The caller supplies exact build identity and envelope run/tick, never trusts
 * the section to choose those. This does not prove original play.
 */
export function decodeRecorderState(bytes,expected){
 const ctx=context(expected);
 const s=fields(parseCanonical(bytes),SECTION,'section');
 need(s.kind===KIND&&s.version===RECORDER_STATE_VERSION&&s.runId===ctx.runId&&s.tick===ctx.tick,'section.identity');
 return recorderCodec(s.recorder,true,ctx);
}

/** Preflight against a genuinely fresh native recorder with the same setup.
 * Returns a NEW recorder, preserving full raw double trace, fingerprints,
 * input cursor and original time. Neither argument is mutated. Caller must
 * separately bind runId/startedAt on the fresh world before any live tick.
 */
export function restoreRecorderState(bytes,fresh,expected){
 const ctx=context(expected),saved=decodeRecorderState(bytes,ctx);
 const freshData=nativeData(fresh);
 const freshHeader=fields(freshData.header,HEADER,'fresh.header');
 const freshCtx={...ctx,tick:0,runId:freshHeader.startedAt+'-'+freshHeader.seed};
 freshData.header=freshHeader;
 const reference=recorderCodec(freshData,false,freshCtx);
 const savedHeader=headerCodec(saved.header,false,ctx);
 reference.header.startedAt=savedHeader.startedAt;
 need(digestOf(reference.header)===digestOf(savedHeader),'fresh-header-mismatch');
 const result=new GhostRecorder(saved.header);
 for(const key of FIELDS)result[key]=saved[key];
 return result;
}
