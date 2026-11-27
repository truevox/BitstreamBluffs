/** #119: typed section for six pure scene subsystems and their root state.
 * Input/output projections belong to the INTERNAL RunScene reconstruction kit.
 * No storage registration, generic constructor dispatch or trust of a full graph.
 */
import {canonicalBytes,parseCanonical,f64Encode,f64Decode,asUint8Array} from '../replay/canonicalJson.js';
import {ScoreManager} from '../ScoreManager.js';
import {TrickTracker,DEFAULT_MIN_AIRTIME_MS} from '../TrickTracker.js';
import {GlitchDirector} from '../GlitchDirector.js';
import {BsodPursuit,BSOD_DEFAULTS} from '../BsodPursuit.js';
import {BsodBluffTracker,BLUFF} from '../BsodBluffTracker.js';
import {HintScheduler,HINT_DEFS} from '../HintScheduler.js';
import {Rng} from '../Rng.js';
import {TRICK_TYPES,GLITCH,PIXELS_PER_METER,SCORING} from '../../constants.js';

export const SCENE_SUBSYSTEM_VERSION=1;
const KIND='bb-scene-subsystems';
const MAX_ID=1000000;
const HASH=/^sha256:[0-9a-f]{64}$/;
const uint=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const str=v=>typeof v==='string'&&v.length>0&&v.length<=256;
const unsafe=k=>['__proto__','constructor','prototype'].includes(k);
const fail=(path,why)=>{throw Error('scene-subsystem:'+why+':'+path);};
const req=(yes,path,why)=>{if(!yes)fail(path,why);};
function props(v,path){
 req(v&&typeof v==='object'&&!Array.isArray(v),path,'record');
 const proto=Object.getPrototypeOf(v);
 req(proto===Object.prototype||proto===null,path,'prototype');
 const p=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(p);
 for(const k of keys)req(typeof k==='string'&&!unsafe(k)&&p[k].enumerable&&Object.hasOwn(p[k],'value'),path,'field');
 return {p,keys};
}
function exact(v,keys,path){
 const d=props(v,path);
 req(d.keys.length===keys.length&&keys.every(k=>Object.hasOwn(d.p,k)),path,'fields');
 return Object.fromEntries(keys.map(k=>[k,d.p[k].value]));
}
function dense(v,max,path,len){
 req(Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype&&v.length<=max&&(len===undefined||len===v.length),path,'array');
 const p=Object.getOwnPropertyDescriptors(v);
 req(Reflect.ownKeys(p).length===v.length+1,path,'array-fields');
 const a=[];
 for(let i=0;i<v.length;i++){const d=p[i];req(d&&d.enumerable&&Object.hasOwn(d,'value'),path,'array-fields');a.push(d.value);}
 return a;
}
const F='finite-f64',U='uint',R='u32',B='boolean',S='string',N='negative-infinity-or-f64';
const nullable=item=>({type:'nullable',item});
const literal=value=>({type:'literal',value});
const enumeration=values=>({type:'enum',values:[...values]});
const obj=(classId,fields)=>({type:'object',classId,fields});
const plain=fields=>obj(null,fields);
const arr=(item,max)=>({type:'array',item,max});
const set=(item,max)=>({type:'set',item,max});
const dict=(keys,item)=>({type:'dictionary',keys:[...keys],item});
const alias=target=>({type:'alias',target});
const floats=keys=>Object.fromEntries(keys.map(k=>[k,F]));
const ints=keys=>Object.fromEntries(keys.map(k=>[k,U]));
const bools=keys=>Object.fromEntries(keys.map(k=>[k,B]));
const literals=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,literal(v)]));
const trick=enumeration(TRICK_TYPES),hint=enumeration(Object.keys(HINT_DEFS));
const trickMap=dict(TRICK_TYPES,U);
const bonus=plain(ints(['shard','nearMiss','milestone']));
const event=plain({id:S,kind:enumeration(GLITCH.kinds),startMs:U,durationMs:U,intensity:F});
const schemas={
 trickCounts:trickMap,
 tutShown:set(hint,Object.keys(HINT_DEFS).length),
 tutTimers:plain({stall:F}),
 tutDone:set(hint,Object.keys(HINT_DEFS).length),
 hints:obj('HintScheduler',{
  defs:plain(Object.fromEntries(Object.entries(HINT_DEFS).map(([k,v])=>[k,plain(literals(v))]))),
  done:alias('tutDone'),gapMs:literal(600),startMs:literal(2500),
  cur:nullable(plain({id:hint,since:F})),lastHideAt:F,
  latched:set(hint,Object.keys(HINT_DEFS).length),shows:dict(Object.keys(HINT_DEFS),U),
 }),
 score:obj('ScoreManager',{
  options:plain({pxPerMeter:literal(PIXELS_PER_METER)}),paid:trickMap,distanceM:F,
  ...ints(['trickPoints','penaltyPoints','bonusPoints']),bonusCounts:bonus,bonusByKind:bonus,
  pending:U,comboTricks:arr(trick,TRICK_TYPES.length),bestCombo:F,counts:trickMap,
  flow:F,flowRemainingMs:F,bestFlow:F,lastMilestoneSector:U,
 }),
 tricks:obj('TrickTracker',{
  options:plain({}),minAirtimeMs:literal(DEFAULT_MIN_AIRTIME_MS),_noTricks:arr(trick,0),
  _air:B,...floats(['_airStart','_tiltNet','_heliNet','_tiltDone','_heliDone','_corkscrewNet','_corkscrewDone','_brakeMs','_chuteMs']),
  ...bools(['_brakeDone','_chuteDone']),_heliMax:F,_heliHeld:B,_prevAngle:F,_prevHeli:nullable(F),_havePrev:B,
 }),
 glitch:obj('GlitchDirector',{
  seed:S,rng:obj('Rng',{baseSeed:R,state:R}),_count:U,active:nullable(event),next:event,
 }),
 bsod:obj('BsodPursuit',{
  config:plain({...literals(BSOD_DEFAULTS),accelerationPxS2:F}),
  wallX:F,wallSpeedPxS:F,accelerationPxS2:F,active:B,
 }),
 bsodState:plain({active:B,gapPx:nullable(F),...floats(['wallSpeedPxS','worldTailwindPxS','sledVelocityXPxS','relativeAirX','proximity01']),
  timeToImpactMs:nullable(F),atmosphereDensity:F}),
 bsodBluffs:obj('BsodBluffTracker',{
  config:plain(literals(BLUFF)),...bools(['armed','usedCanopy','usedAirbrake']),
  closestGapPx:nullable(F),previousGapPx:nullable(F),chain:U,lastAwardX:N,lastAwardTimeMs:N,
 }),
};
function freeze(v){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
export const SCENE_SUBSYSTEM_FIELDS=Object.freeze(Object.keys(schemas));
export const SCENE_SUBSYSTEM_DESCRIPTOR=freeze({kind:KIND,version:SCENE_SUBSYSTEM_VERSION,
 fields:schemas,header:['kind','version','buildId','runId','tick','seed','state'],
 maxNodeId:MAX_ID,numeric:'finite canonical F64; only declared bluff -Infinity sentinels',
 alias:'only HintScheduler.done -> tutDone',projection:'internal scene graph subset'});
const classNames=Object.freeze({ScoreManager:ScoreManager.name,TrickTracker:TrickTracker.name,
 GlitchDirector:GlitchDirector.name,Rng:Rng.name,BsodPursuit:BsodPursuit.name,
 BsodBluffTracker:BsodBluffTracker.name,HintScheduler:HintScheduler.name});
const runtimeName=id=>id===null?null:classNames[id];
function context(expected){
 const c=exact(expected,['runId','tick','buildId','seed'],'context');
 req(str(c.runId)&&str(c.seed)&&uint(c.tick)&&typeof c.buildId==='string'&&HASH.test(c.buildId),'context','identity');
 return c;
}
/** Transform only schema-selected nodes, no generic decoder. Class tags on
 * the projection are checked against imported class names; never stored.
 * IDs survive for the internal reconstruction graph, not executable input.
 */
function codec(input,decode){
 const ids=new Set(),roots={};
 function id(value,path){
  req(uint(value)&&value<MAX_ID&&!ids.has(value),path,'node-id');ids.add(value);return value;
 }
 function cv(v,s,path){
  if(s===F||s===N){
   if(s===N&&!decode&&v&&typeof v==='object'){
    const x=exact(v,['__num'],path);req(x.__num==='-Infinity'||x.__num==='-0',path,'sentinel');return f64Encode(x.__num==='-Infinity'?-Infinity:-0);
   }
   if(decode){
    let n;try{n=f64Decode(v);}catch{fail(path,'f64');}
    if(s===N&&n===-Infinity)return {__num:'-Infinity'};
    req(finite(n),path,'finite');return Object.is(n,-0)?{__num:'-0'}:n;
   }
   // The internal projection represents negative zero with its own marker.
   if(v&&typeof v==='object'){
    const x=exact(v,['__num'],path);req(x.__num==='-0',path,'numeric-marker');v=-0;
   }
   req(finite(v),path,'finite');return f64Encode(v);
  }
  if(s===U||s===R){req(uint(v)&&(s!==R||v<=0xffffffff),path,'integer');return v;}
  if(s===B){req(typeof v==='boolean',path,'boolean');return v;}
  if(s===S){req(str(v),path,'string');return v;}
  switch(s.type){
   case 'nullable':return v===null?null:cv(v,s.item,path);
   case 'literal':req(Object.is(v,s.value),path,'config');return v;
   case 'enum':req(s.values.includes(v),path,'enum');return v;
   case 'alias':{
    const n=decode?v:exact(v,['__alias'],path).__alias;
    req(uint(n)&&n===roots[s.target],path,'alias-target');
    return decode?{__alias:n}:n;
   }
   case 'object':{
    const fields=Object.keys(s.fields),p=decode?exact(v,['id','fields'],path):exact(v,['__id','__c','__obj'],path);
    const n=id(decode?p.id:p.__id,path);
    if(!decode)req(p.__c===runtimeName(s.classId),path,'class');
    const src=exact(decode?p.fields:p.__obj,fields,path+'/fields');
    const out=Object.fromEntries(fields.map(k=>[k,cv(src[k],s.fields[k],path+'/'+k)]));
    return decode?{__id:n,__c:runtimeName(s.classId),__obj:out}:{id:n,fields:out};
   }
   case 'array':case 'set':{
    const tag=s.type==='set'?'__set':'__arr';
    const p=decode?exact(v,['id','items'],path):exact(v,['__id',tag],path);
    const n=id(decode?p.id:p.__id,path);
    const items=dense(decode?p.items:p[tag],s.max,path).map((x,i)=>cv(x,s.item,path+'/'+i));
    req(new Set(items).size===items.length,path,'duplicate-item');
    return decode?{__id:n,[tag]:items}:{id:n,items};
   }
   case 'dictionary':{
    const p=decode?exact(v,['id','entries'],path):exact(v,['__id','__c','__obj'],path);
    const n=id(decode?p.id:p.__id,path);
    let entries;
    if(decode)entries=dense(p.entries,s.keys.length,path).map((x,i)=>dense(x,2,path+'/'+i,2));
    else {
     req(p.__c===null,path,'class');
     const d=props(p.__obj,path);
     entries=d.keys.map(k=>[k,d.p[k].value]);
    }
    req(new Set(entries.map(e=>e[0])).size===entries.length,path,'duplicate-key');
    const out=entries.map(([k,x])=>{req(s.keys.includes(k),path,'key');return [k,cv(x,s.item,path+'/'+k)];});
    return decode?{__id:n,__c:null,__obj:Object.fromEntries(out)}:{id:n,entries:out};
   }
   default:fail(path,'schema');
  }
 }
 const src=exact(input,SCENE_SUBSYSTEM_FIELDS,'state'),out={};
 for(const k of SCENE_SUBSYSTEM_FIELDS){
  out[k]=cv(src[k],schemas[k],k);
  roots[k]=decode?out[k].__id:out[k].id;
 }
 return out;
}
function relations(projection,ctx){
 const score=projection.score.__obj,tricks=projection.tricks.__obj,glitch=projection.glitch.__obj;
 const number=v=>typeof v==='number'?v:v?.__num==='-0'?-0:NaN;
 const d=score.distanceM,flow=score.flow,best=score.bestFlow;
 req(number(d)>=0&&number(flow)>=SCORING.flowStart&&number(flow)<=SCORING.flowMax&&
  number(best)>=number(flow)&&number(best)<=SCORING.flowMax&&number(score.flowRemainingMs)>=0,'score','range');
 const combo=score.comboTricks.__arr,paid=score.paid.__obj,counts=score.counts.__obj;
 req(Object.keys(paid).length===combo.length&&Object.keys(counts).length===combo.length&&
  combo.every(k=>Object.hasOwn(paid,k)&&Object.hasOwn(counts,k)&&counts[k]>0)&&
  Object.values(paid).reduce((a,b)=>a+b,0)===score.pending,'score','combo-consistency');
 req(number(tricks._brakeMs)>=0&&number(tricks._chuteMs)>=0,'tricks','range');
 const rng=glitch.rng.__obj;
 req(glitch.seed===ctx.seed&&rng.baseSeed===new Rng(ctx.seed).fork('glitch').baseSeed&&glitch._count>=1,'glitch','seed/count');
 function eventIndex(e){
  const x=e.__obj,m=/^g(0|[1-9][0-9]*)-[0-9a-f]{4}$/.exec(x.id);
  req(m&&Number.isSafeInteger(Number(m[1]))&&x.durationMs>=GLITCH.durationMs[0]&&x.durationMs<=GLITCH.durationMs[1]&&
   number(x.intensity)>=0&&number(x.intensity)<=1,'glitch','event');
  return Number(m[1]);
 }
 req(eventIndex(glitch.next)===glitch._count-1,'glitch','next-index');
 if(glitch.active)req(eventIndex(glitch.active)===glitch._count-2&&
  glitch.next.__obj.startMs>=glitch.active.__obj.startMs+glitch.active.__obj.durationMs,'glitch','active-index');
 const b=projection.bsod.__obj,bs=projection.bsodState.__obj;
 req(number(b.config.__obj.accelerationPxS2)>0&&number(b.accelerationPxS2)>0&&number(b.wallSpeedPxS)>0&&
  b.active===bs.active&&number(bs.proximity01)>=0&&number(bs.proximity01)<=1&&number(bs.atmosphereDensity)>=0&&number(bs.atmosphereDensity)<=1,'bsod','range');
 return projection;
}
/** Extract only known fields from a trusted internal capture. */
export function encodeSceneSubsystemState(game,expected){
 const c=context(expected);
 const d=props(game,'game'),subset=Object.fromEntries(SCENE_SUBSYSTEM_FIELDS.map(k=>{
  req(Object.hasOwn(d.p,k),k,'missing');return [k,d.p[k].value];
 }));
 const state=codec(subset,false);
 relations(codec(state,true),c);
 return canonicalBytes({kind:KIND,version:SCENE_SUBSYSTEM_VERSION,...c,state});
}
/** Returns a detached validated subset; caller must separately validate all
 * graph references, remaining classes, config, envelope and isolation.
 */
export function decodeSceneSubsystemState(bytes,expected){
 const c=context(expected);
 const s=exact(parseCanonical(asUint8Array(bytes,'scene subsystem section')),SCENE_SUBSYSTEM_DESCRIPTOR.header,'section');
 req(s.kind===KIND&&s.version===SCENE_SUBSYSTEM_VERSION&&Object.keys(c).every(k=>Object.is(c[k],s[k])),'section','identity');
 return relations(codec(s.state,true),c);
}
