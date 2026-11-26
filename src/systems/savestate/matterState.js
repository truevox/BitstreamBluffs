/** #119: explicit canonical Matter V3 projection section.
 * Not a full savestate layout or a live-world restore capability. No generic
 * object materialization, prototype dispatch, or mutation of the engine.
 * The eventual transaction must rebuild/validate topology and config before
 * applying the decoded projection to an isolated candidate.
 */
import {canonicalBytes,parseCanonical,f64Encode,f64Decode,asUint8Array} from '../replay/canonicalJson.js';
import {preflightMatterSnapshot} from '../../../tools/savestate-experiment/matter-snapshot-kit.js';

export const MATTER_STATE_VERSION=1;
const KIND='bb-matter-state';
const DIAGNOSTIC_KIND='bb-matter-diagnostic-snapshot';
const MATTER_VERSION='0.20.0';
const MAX_BODIES=8192,MAX_PAIRS=32768,MAX_PARTS=64,MAX_VERTICES=256;
const KEY=/^[A-Za-z0-9_:-]{1,128}$/;
const PART=/^[A-Za-z0-9_:-]{1,128}#(?:0|[1-9][0-9]{0,2})$/;
const RUN=/^[A-Za-z0-9_.:-]{1,96}$/;
const HASH=/^sha256:[0-9a-f]{64}$/;
const forbidden=k=>k==='__proto__'||k==='prototype'||k==='constructor';
const uint=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
const int=v=>Number.isSafeInteger(v)&&!Object.is(v,-0);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export class MatterStateError extends Error{
 constructor(code,path=''){super('matter-state:'+code+(path?':'+path:''));this.code=code;this.path=path;}
}
const fail=(code,path)=>{throw new MatterStateError(code,path);};
const req=(ok,code,path)=>{if(!ok)fail(code,path);};

function ownRecord(value,path){
 req(value&&typeof value==='object'&&!Array.isArray(value),'record',path);
 const proto=Object.getPrototypeOf(value);
 req(proto===null||proto===Object.prototype,'prototype',path);
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
 for(const k of keys){
  const d=descriptors[k];
  req(typeof k==='string'&&!forbidden(k)&&d.enumerable&&Object.hasOwn(d,'value'),'field',path);
 }
 return {descriptors,keys};
}
function exact(value,keys,path){
 const r=ownRecord(value,path);
 req(r.keys.length===keys.length&&keys.every(k=>Object.hasOwn(r.descriptors,k)),'fields',path);
 return Object.fromEntries(keys.map(k=>[k,r.descriptors[k].value]));
}
function dense(value,max,path,length){
 req(Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&value.length<=max&&
  (length===undefined||value.length===length),'array',path);
 const descriptors=Object.getOwnPropertyDescriptors(value);
 req(Reflect.ownKeys(descriptors).length===value.length+1,'array-fields',path);
 const out=[];
 for(let i=0;i<value.length;i++){
  const d=descriptors[i];
  req(d&&d.enumerable&&Object.hasOwn(d,'value'),'array-fields',path+'/'+i);
  out.push(d.value);
 }
 return out;
}

const F='f64',U='uint',I='int',B='boolean',K='body-key',P='part-key';
const array=(item,max)=>({type:'array',item,max});
const tuple=(...items)=>({type:'tuple',items});
const record=fields=>({type:'record',fields});
const dict=(item,max)=>({type:'body-map',item,max});
const lit=value=>({type:'literal',value});
const vector=tuple(F,F);
const vertex={type:'vertex-ref'}; // null, [part,index], or the inactive dead sentinel
const detector={type:'detector-ref'};
const numbers=keys=>Object.fromEntries(keys.map(k=>[k,F]));
const part=record({pos:vector,ang:F,verts:array(vector,MAX_VERTICES),axes:array(vector,MAX_VERTICES),
 bounds:tuple(F,F,F,F)});
const body=record({
 s:record({...numbers(['angle','anglePrev','angularVelocity','angularSpeed','speed','motion','sleepCounter',
  'deltaTime','torque','totalContacts','timeScale']),isSleeping:B}),
 v:record(Object.fromEntries(['position','positionPrev','velocity','force','positionImpulse'].map(k=>[k,vector]))),
 ci:tuple(F,F,F),parts:array(part,MAX_PARTS),
});
const collision=record({collided:B,depth:F,normal:vector,tangent:vector,penetration:vector,
 supportCount:U,supports:tuple(vertex,vertex)});
const contact=tuple(vertex,F,F);
const pair=record({a:P,b:P,ca:P,cb:P,contacts:tuple(contact,contact),contactCount:U,isActive:B,isSensor:B,col:collision,
 ...numbers(['separation','timeCreated','timeUpdated','inverseMass','friction','frictionStatic','restitution','slop'])});
const staticSchema=record({
 Common:record(numbers(['_baseDelta','_seed'])),
 Body:record({_timeCorrection:B,...numbers(['_inertiaScale','_nextCollidingGroupId','_nextNonCollidingGroupId','_nextCategory','_baseDelta'])}),
 Engine:record(numbers(['_deltaMax'])),
 Resolver:record(numbers(['_restingThresh','_restingThreshTangent','_positionDampen','_positionWarming','_frictionNormalMultiplier','_frictionMaxStatic'])),
 Sleeping:record(numbers(['_motionWakeThreshold','_motionSleepThreshold','_minBias'])),
 Constraint:record(numbers(['_warming','_torqueDampen','_minLength'])),
 Pairs:record({}),Pair:record({}),Detector:record({}),Collision:record({}),Composite:record({}),
});
const stateSchema=record({
 bodies:dict(body,MAX_BODIES),ids:dict(array(U,MAX_PARTS),MAX_BODIES),nextId:U,
 pairs:array(pair,MAX_PAIRS),orphanPairs:tuple(),
 gravity:record(numbers(['x','y','scale'])),timing:record(numbers(['timestamp','timeScale','lastDelta'])),
 detectorOrder:array(detector,MAX_BODIES*2),worldOrder:array(K,MAX_BODIES),worldModified:B,audit:tuple(),
 statics:staticSchema,
});
const retiredSchema=record({retiredId:U,label:lit('terrain'),minX:F,minY:F});
function deepFreeze(v){if(v&&typeof v==='object'){for(const x of Object.values(v))deepFreeze(x);Object.freeze(v);}return v;}
/** Explicit candidate schema for future build-layout binding; not registered. */
export const MATTER_SECTION_DESCRIPTOR=deepFreeze({
 kind:KIND,version:MATTER_STATE_VERSION,matterVersion:MATTER_VERSION,
 header:['kind','version','matterVersion','runId','tick','buildId','state'],
 schema:stateSchema,retiredDetector:retiredSchema,
 bodyKeyPattern:KEY.source,partKeyPattern:PART.source,vertexRef:['null','[part-key,uint]','[<dead>,-1]'],
 wireFloat:'canonical-f64-finite',projection:'Matter V3',constraints:'unsupported',
});

function transform(value,schema,decode,path){
 if(schema===F){
  let n=value;
  if(decode){try{n=f64Decode(value);}catch{fail('f64',path);}}
  req(finite(n),'finite',path);return decode?n:f64Encode(n);
 }
 if(schema===U||schema===I){req((schema===U?uint:int)(value),'integer',path);return value;}
 if(schema===B){req(typeof value==='boolean','boolean',path);return value;}
 if(schema===K||schema===P){
  req(typeof value==='string'&&(schema===K?KEY:PART).test(value)&&!forbidden(value.split('#')[0]),'reference',path);return value;
 }
 switch(schema.type){
  case 'literal':req(value===schema.value,'literal',path);return value;
  case 'tuple':return dense(value,schema.items.length,path,schema.items.length).map((v,i)=>transform(v,schema.items[i],decode,path+'/'+i));
  case 'array':return dense(value,schema.max,path).map((v,i)=>transform(v,schema.item,decode,path+'/'+i));
  case 'record':{
   const fields=Object.keys(schema.fields),data=exact(value,fields,path);
   return Object.fromEntries(fields.map(k=>[k,transform(data[k],schema.fields[k],decode,path+'/'+k)]));
  }
  case 'body-map':{
   const {keys,descriptors}=ownRecord(value,path);
   req(keys.length>0&&keys.length<=schema.max,'body-count',path);
   return Object.fromEntries(keys.map(k=>{
    transform(k,K,decode,path+'/key');
    return [k,transform(descriptors[k].value,schema.item,decode,path+'/'+k)];
   }));
  }
  case 'vertex-ref':{
   if(value===null)return null;
   const [key,index]=dense(value,2,path,2);
   if(key==='<dead>'){req(index===-1,'dead-reference',path);return [key,index];}
   return [transform(key,P,decode,path+'/0'),transform(index,U,decode,path+'/1')];
  }
  case 'detector-ref':return typeof value==='string'?transform(value,K,decode,path):transform(value,retiredSchema,decode,path);
  default:fail('schema',path);
 }
}
const projectionKeys=['kind','version','matterVersion','diagnosticOnly',...Object.keys(stateSchema.fields)];
const sectionKeys=MATTER_SECTION_DESCRIPTOR.header;
function context(expected,Matter){
 const c=exact(expected,['runId','tick','buildId'],'context');
 req(typeof c.runId==='string'&&RUN.test(c.runId)&&uint(c.tick)&&typeof c.buildId==='string'&&HASH.test(c.buildId),'context','identity');
 req(Matter?.version===MATTER_VERSION,'matter-version','context');
 return c;
}
function projection(state){
 return {kind:DIAGNOSTIC_KIND,version:3,matterVersion:MATTER_VERSION,diagnosticOnly:true,...state};
}
function validateRelations(state,Matter){
 // Existing graph/geometry checks are intentionally retained, including BOTH
 // contact/support slots, ordered detector history and rebuilt part IDs.
 preflightMatterSnapshot(projection(state),Matter);
 req(Object.hasOwn(state.bodies,'sled'),'missing-sled','state/bodies');
 return state;
}
/** Encode application-owned complete diagnostic projection into explicit bytes. */
export function encodeMatterState(snapshot,expected,Matter){
 const c=context(expected,Matter);
 const s=exact(snapshot,projectionKeys,'projection');
 req(s.kind===DIAGNOSTIC_KIND&&s.version===3&&s.matterVersion===MATTER_VERSION&&s.diagnosticOnly===true,'projection-version','projection');
 const state=transform(Object.fromEntries(Object.keys(stateSchema.fields).map(k=>[k,s[k]])),stateSchema,false,'state');
 validateRelations(transform(state,stateSchema,true,'state'),Matter);
 return canonicalBytes({kind:KIND,version:MATTER_STATE_VERSION,matterVersion:MATTER_VERSION,...c,state});
}
/** Strict bytes only; expected build/run/tick come from the trusted envelope.
 * Result is detached numeric data, not authorized world mutation or trust.
 */
export function decodeMatterState(bytes,expected,Matter){
 const c=context(expected,Matter);
 const s=exact(parseCanonical(asUint8Array(bytes,'Matter section')),sectionKeys,'section');
 req(s.kind===KIND&&s.version===MATTER_STATE_VERSION&&s.matterVersion===MATTER_VERSION,'section-version','section');
 req(s.runId===c.runId&&s.tick===c.tick&&s.buildId===c.buildId,'identity','section');
 return projection(validateRelations(transform(s.state,stateSchema,true,'state'),Matter));
}
