/** #119 typed remainder of the internal RunScene capture.
 * Every admitted root and nested shape is explicit. References are IDs of
 * regenerated terrain or already-typed entity records, checked separately.
 * This is still a candidate format, not the registered production layout.
 */
import {canonicalBytes,parseCanonical,f64Encode,f64Decode,asUint8Array} from '../replay/canonicalJson.js';
import {digestOf} from '../replay/canonicalSha256.js';
import {KODIAK_DEFS} from '../Kodiaks.js';
import {Rng} from '../Rng.js';
import {TelegraphTracker} from '../HazardTelegraph.js';
import {FP_SUBSYSTEMS,FP_VERSION} from '../replay/fingerprint.js';
import {combineFingerprints} from '../replay/canonicalBinary.js';

const KIND='bb-scene-remainder',VERSION=1,MAX_ID=1000000;
const need=(ok,p)=>{if(!ok)throw Error('scene-remainder:'+p);};
const uint=n=>Number.isSafeInteger(n)&&n>=0&&!Object.is(n,-0);
const hash=n=>typeof n==='string'&&/^sha256:[0-9a-f]{64}$/.test(n);
const fpHash=n=>typeof n==='string'&&/^xxh32x2:[0-9a-f]{16}$/.test(n);
function record(v,p){
 need(v&&typeof v==='object'&&!Array.isArray(v)&&[null,Object.prototype].includes(Object.getPrototypeOf(v)),p);
 const d=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(d);
 need(keys.every(k=>typeof k==='string'&&!['__proto__','prototype','constructor'].includes(k)&&d[k].enumerable&&Object.hasOwn(d[k],'value')),p);
 return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
function exact(v,keys,p){
 const x=record(v,p);need(Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k)),p);return x;
}
function dense(v,max,p,len){
 need(Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype&&v.length<=max&&(len===undefined||v.length===len),p);
 const d=Object.getOwnPropertyDescriptors(v);need(Reflect.ownKeys(d).length===v.length+1,p);
 return Array.from({length:v.length},(_,i)=>{need(d[i]&&d[i].enumerable&&Object.hasOwn(d[i],'value'),p);return d[i].value;});
}
const F='float',U='uint',B='bool',A='alias',N='nan-or-float';
const many=(keys,s)=>Object.fromEntries(keys.split(' ').filter(Boolean).map(k=>[k,s]));
const lit=value=>({type:'literal',value});
const one=(...values)=>({type:'enum',values});
const nullable=item=>({type:'nullable',item});
const obj=(fields,optional={},cls=null)=>({type:'obj',fields,optional,cls});
const array=(item,max)=>({type:'array',item,max});
const map=(key,item,max)=>({type:'map',key,item,max});
const path=pattern=>({type:'content',pattern});
const pattern=pattern=>({type:'pattern',pattern});
const anyOf=(...items)=>({type:'union',items});
const visual={type:'skip',value:'presentation-field'};
const id=pattern('^[A-Za-z0-9_-]{1,128}$'),hazardId=pattern('^(0|[1-9][0-9]{0,7}):(0|[1-9][0-9]{0,7})$');
const zoneKey=pattern('^[A-Za-z0-9_-]{1,128}:-?[0-9]{1,15}$');
const powerEffect=path('^/powerups/[A-Za-z0-9_-]{1,128}/effect$');
const launch=path('^/terrainMods/[A-Za-z0-9_-]{1,128}/launch$');
const phys=obj({...many('gravityPxS2 frictionAir groundFriction tiltTorqueDegS2 airControl bounceMul speedMul hopMul flipMul airbrakeLiftMul divebombMul steerMul groundResist quadDrag pushForceMul beltDrivePxS2 scrambleJitterDegS2 restitution landingRebound',F),
 tiltSign:one(-1,1),beltDirection:one(-1,1),geyserLaunch:nullable(launch)});
const ward=obj({id,msLeft:F,mods:array(id,128),hazards:array(id,128),effects:array(id,128),speedFactor:F});
const bearDef=anyOf(...Object.values(KODIAK_DEFS).map(d=>obj(Object.fromEntries(Object.entries(d).map(([k,v])=>[k,k==='color'?visual:lit(v)])))));
const bear=obj({kind:one(...Object.keys(KODIAK_DEFS)),n:U,member:U,def:anyOf(A,bearDef),x:F,speed:F,
 phase:one('approach','tele','lunge','recover','leave'),phaseMs:F,ageMs:F,
 rng:obj({baseSeed:U,state:U},{},'Rng'),feints:U,targetX:nullable(F),groundY:N,sledAhead:B,hit:B,done:B},{real:B});
const mark=obj({ref:A,kind:one('hop','brace'),state:one('clear','open','go','warn'),color:visual,
 clear:B,dx:F,etaS:F,arrivalMs:nullable(F),gate:one(null,'open','closed'),urgency:F});
const roots={
 ...many('runTimeMs _hudMs crashTimerMs bestCombo maxAirtimeMs lastTotal slowMs slowFactor scrambleMs boostMs boostFactor slowmoMs slowmoScale _safeTimer resetCooldownMs hitStopMs blinkMs shardChainAt shardTotal _steepMs glideMs glideMul stabilizeMs stabilizeDeg stabilizeBounce blindMs blindTotalMs blindVis magnetMs gymAttemptStartTimeMs gymAttemptStartX gymReadyMs gymBeatWaitMs kodiakShoveCdMs',F),
 ...many('shieldCharges openingGraces _airTricks shardChain shardCount nearMissCount _landings tuckShows kodiakNext _manualPauseSeq',U),
 ...many('newBestDone bsodCaught _hopped _pushed _manualPausePending',B),
 crashed:lit(false),_leaving:lit(false),pendingCrash:lit(null),gymBeatSnapshot:lit(null),
 ...many('boostId glideId stabilizeId magnetId',nullable(id)),_biomeId:id,_lastHopMs:nullable(F),
 shieldSources:array(id,128),activeZones:map(zoneKey,A,128),
 safeSamples:array(obj(many('t x y vx vy ang',F)),64),_contactQueue:array(F,0),_despawn:array(F,0),
 kodiaks:array(bear,8),currentPhys:nullable(phys),wards:obj({wards:array(ward,128)}),
 magnetEff:nullable(powerEffect),_teleMarks:array(mark,6),lastBoost:nullable(obj({amountPxS:F,t:F})),
};
const optional={_crashHazard:nullable(A)};
export const SCENE_REMAINDER_FIELDS=Object.freeze([...Object.keys(roots),...Object.keys(optional)]);
const context=v=>{
 const c=exact(v,['runId','tick','buildId','seed'],'context');
 need(typeof c.runId==='string'&&c.runId.length>0&&c.runId.length<=256&&uint(c.tick)&&hash(c.buildId)&&typeof c.seed==='string'&&c.seed.length>0&&c.seed.length<=256,'context');return c;
};
function transformGame(input,decode){
 const ids=new Set();
 function node(n,p){need(uint(n)&&n<MAX_ID&&!ids.has(n),p+'/id');ids.add(n);return n;}
 function cv(v,s,p){
  if(s===F||s===N){
   if(decode){let n;try{n=f64Decode(v);}catch{need(false,p);}
    need(Number.isFinite(n)||(s===N&&Number.isNaN(n)),p);
    return Object.is(n,-0)?{__num:'-0'}:Number.isNaN(n)?{__num:'NaN'}:n;}
   if(v&&typeof v==='object'){const n=exact(v,['__num'],p).__num;need(n==='-0'||(s===N&&n==='NaN'),p);v=n==='-0'?-0:NaN;}
   need(typeof v==='number'&&(Number.isFinite(v)||(s===N&&Number.isNaN(v))),p);return f64Encode(v);
  }
  if(s===U){need(uint(v),p);return v;}
  if(s===B){need(typeof v==='boolean',p);return v;}
  if(s===A){const n=decode?v:exact(v,['__alias'],p).__alias;need(uint(n)&&n<MAX_ID,p);return decode?{__alias:n}:n;}
  switch(s.type){
   case 'nullable':return v===null?null:cv(v,s.item,p);
   case 'literal':need(Object.is(v,s.value),p);return v;
   case 'enum':need(s.values.includes(v),p);return v;
   case 'pattern':need(typeof v==='string'&&new RegExp(s.pattern).test(v)&&!['__proto__','constructor','prototype'].includes(v),p);return v;
   case 'content':{
    const n=decode?v:exact(v,['__content'],p).__content;
    need(typeof n==='string'&&new RegExp(s.pattern).test(n)&&!n.split('/').some(k=>['__proto__','constructor','prototype'].includes(k)),p);
    return decode?{__content:n}:n;
   }
   case 'skip':need(decode?v===null:exact(v,['__skip'],p).__skip===s.value,p);return decode?{__skip:s.value}:null;
   case 'union':{
    if(decode){const x=exact(v,['variant','value'],p);need(uint(x.variant)&&x.variant<s.items.length,p);return cv(x.value,s.items[x.variant],p);}
    // Try each *fixed* schema without leaving stale IDs on failed variants.
    for(let i=0;i<s.items.length;i++){
     const saved=[...ids];try{return {variant:i,value:cv(v,s.items[i],p)};}catch{ids.clear();saved.forEach(x=>ids.add(x));}
    }need(false,p);break;
   }
   case 'obj':{
    const x=decode?exact(v,['id','fields'],p):exact(v,['__id','__c','__obj'],p);
    const n=node(decode?x.id:x.__id,p);
    if(!decode)need(x.__c===s.cls,p+'/class');
    const src=record(decode?x.fields:x.__obj,p),allowed={...s.fields,...s.optional};
    need(Object.keys(s.fields).every(k=>Object.hasOwn(src,k))&&Object.keys(src).every(k=>Object.hasOwn(allowed,k)),p+'/fields');
    const out=Object.fromEntries(Object.keys(src).map(k=>[k,cv(src[k],allowed[k],p+'/'+k)]));
    return decode?{__id:n,__c:s.cls,__obj:out}:{id:n,fields:out};
   }
   case 'array':case 'map':{
    const tag=s.type==='map'?'__map':'__arr';
    const x=decode?exact(v,['id','items'],p):exact(v,['__id',tag],p);
    const n=node(decode?x.id:x.__id,p);
    const items=dense(decode?x.items:x[tag],s.max,p).map((item,i)=>{
     if(s.type==='array')return cv(item,s.item,p+'/'+i);
     const pair=dense(item,2,p+'/'+i,2);return [cv(pair[0],s.key,p+'/key'),cv(pair[1],s.item,p+'/value')];
    });
    if(s.type==='map')need(new Set(items.map(i=>i[0])).size===items.length,p+'/duplicates');
    return decode?{__id:n,[tag]:items}:{id:n,items};
   }
   default:need(false,p+'/schema');
  }
 }
 const src=record(input,'game'),allowed={...roots,...optional};
 need(Object.keys(roots).every(k=>Object.hasOwn(src,k))&&Object.keys(src).every(k=>Object.hasOwn(allowed,k)),'root-fields');
 return Object.fromEntries(Object.keys(src).map(k=>[k,cv(src[k],allowed[k],k)]));
}
const num=n=>typeof n==='number'?n:n?.__num==='-0'?-0:NaN;
function relations(g,c){
 const timers='runTimeMs _hudMs crashTimerMs maxAirtimeMs slowMs scrambleMs boostMs slowmoMs _safeTimer resetCooldownMs hitStopMs blinkMs _steepMs glideMs stabilizeMs blindMs blindTotalMs magnetMs gymAttemptStartTimeMs gymReadyMs gymBeatWaitMs kodiakShoveCdMs';
 need(timers.split(' ').every(k=>num(g[k])>=0),'timer-range');
 need(num(g.crashTimerMs)===0&&num(g.gymReadyMs)===0&&num(g.gymBeatWaitMs)===0,'boundary');
 need(g.shieldSources.__arr.length<=g.shieldCharges,'shield-count');
 const samples=g.safeSamples.__arr.map(x=>x.__obj);
 need(samples.every((s,i)=>num(s.t)>=0&&num(s.t)<=num(g.runTimeMs)&&(!i||num(s.t)>num(samples[i-1].t))),'safe-sample-order');
 const wards=g.wards.__obj.wards.__arr.map(x=>x.__obj);
 need(new Set(wards.map(w=>w.id)).size===wards.length&&wards.every(w=>num(w.msLeft)>0&&num(w.msLeft)<=6000&&num(w.speedFactor)>=1&&num(w.speedFactor)<=1.2),'wards');
 for(const k of g.kodiaks.__arr.map(x=>x.__obj)){
  const rng=k.rng.__obj;
  need(rng.baseSeed===new Rng(c.seed).fork('kodiak/brain/'+k.n+'/'+k.member).baseSeed&&rng.state<=0xffffffff,'kodiak-rng');
  if(k.def.__obj)need(k.def.__obj.kind===k.kind,'kodiak-kind');
 }
 for(const m of g._teleMarks.__arr.map(x=>x.__obj))
  need(num(m.dx)>0&&num(m.etaS)>=0&&num(m.urgency)>=0&&num(m.urgency)<=1,'mark-range');
 return g;
}
function float(v,decode,p){let n=v;if(decode){try{n=f64Decode(v);}catch{need(false,p);}}
 need(typeof n==='number'&&Number.isFinite(n),p);return decode?n:f64Encode(n);}
const cameraKeys=['scrollX','scrollY','zoom','rotation','_view','_camX','_camY','_zoom','_zoomKick','shakeAmp','_landingShake'];
function camera(v,decode){
 const d=exact(v,cameraKeys,'camera');
 const out=Object.fromEntries(cameraKeys.map(k=>[k,k==='_view'?Object.fromEntries(Object.entries(exact(d[k],['left','right','top','bottom'],'view')).map(([a,b])=>[a,float(b,decode,'view/'+a)])):float(d[k],decode,'camera/'+k)]));
 if(decode)need(out.zoom>0&&out._zoom>0&&out._view.left<out._view.right&&out._view.top<out._view.bottom,'camera-range');
 return out;
}
function telegraph(v,decode){
 const d=exact(v,['v','lastWarnSoundMs','hazards'],'telegraph');
 need(d.v===1,'telegraph-version');
 const rows=dense(d.hazards,8192,'telegraph-rows').map(x=>{
  const [id,w,c,a]=dense(x,4,'telegraph-row',4);
  need(typeof id==='string'&&new RegExp(hazardId.pattern).test(id)&&typeof c==='boolean','telegraph-entry');
  return [id,w===null?null:float(w,decode,'warn'),c,a===null?null:float(a,decode,'arrival')];
 });
 need(rows.every((r,i)=>!i||rows[i-1][0]<r[0]),'telegraph-order');
 const out={v:1,lastWarnSoundMs:float(d.lastWarnSoundMs,decode,'warn-sound'),hazards:rows};
 if(decode)new TelegraphTracker().restore(out);
 return out;
}
function fingerprint(f,c){
 const x=exact(f,['fp','tick','combined','subsystems'],'fingerprint');
 const subsystems=exact(x.subsystems,FP_SUBSYSTEMS,'fingerprint-subsystems');
 need(x.fp===FP_VERSION&&x.tick===c.tick&&fpHash(x.combined)&&Object.values(subsystems).every(fpHash)&&
  combineFingerprints(c.tick,subsystems,FP_SUBSYSTEMS)===x.combined,'fingerprint-value');
 return x;
}
function ghost(v,decode,c){
 const a=dense(v,8,'ghost',8);
 need(a[0]===c.tick&&uint(a[7]),'ghost-identity');
 return [a[0],...a.slice(1,7).map(x=>float(x,decode,'ghost')),a[7]];
}
export function encodeSceneRemainderState(game,meta,expected){
 const c=context(expected),m=exact(meta,['camera','telegraph','ghost','fingerprint','config'],'metadata');
 const state=transformGame(game,false);
 relations(transformGame(state,true),c);
 const cam=camera(m.camera,false),tel=telegraph(m.telegraph,false);
 camera(cam,true);telegraph(tel,true);
 return canonicalBytes({kind:KIND,version:VERSION,...c,state,camera:cam,telegraph:tel,
  ghost:ghost(m.ghost,false,c),fingerprint:fingerprint(m.fingerprint,c),configDigest:digestOf(m.config)});
}
function decodeRemainder(bytes,expected){
 const c=context(expected),s=exact(parseCanonical(asUint8Array(bytes,'scene remainder')),['kind','version',...Object.keys(c),'state','camera','telegraph','ghost','fingerprint','configDigest'],'section');
 need(s.kind===KIND&&s.version===VERSION&&Object.keys(c).every(k=>Object.is(c[k],s[k])),'identity');
 need(hash(s.configDigest),'config');
 return {configDigest:s.configDigest,game:relations(transformGame(s.state,true),c),camera:camera(s.camera,true),telegraph:telegraph(s.telegraph,true),
  ghost:ghost(s.ghost,true,c),fingerprint:fingerprint(s.fingerprint,c)};
}

/** Pure format check, never accepts a digest as a fresh-world witness. */
export function inspectSceneRemainderState(bytes,expected){
 return decodeRemainder(bytes,expected);
}
export function decodeSceneRemainderState(bytes,expected,freshConfig){
 const {configDigest,...result}=decodeRemainder(bytes,expected);
 need(digestOf(freshConfig)===configDigest,'config');
 return result;
}
