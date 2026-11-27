/** #119: explicit typed entity projection section. No constructors or
 * arbitrary paths in the wire; this is NOT a registered whole-world layout.
 * External spawn aliases must be checked against regenerated terrain by the
 * eventual complete layout. Only internal QA candidates may use this seam.
 */
import {canonicalBytes,parseCanonical,f64Encode,f64Decode,asUint8Array} from '../replay/canonicalJson.js';
export const ENTITY_STATE_FIELDS=Object.freeze(['collectedPowerups','hazards','powerups','shardField','sled']);
const KIND='bb-entity-state',VERSION=1,MAX_ID=1000000,MAX_ROWS=8192;
const uint=n=>Number.isSafeInteger(n)&&n>=0&&!Object.is(n,-0);
const fail=(path)=>{throw Error('entity-state:'+path);};
const need=(v,p)=>{if(!v)fail(p);};
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
 need(Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype&&v.length<=max&&(len===undefined||len===v.length),p);
 const d=Object.getOwnPropertyDescriptors(v);need(Reflect.ownKeys(d).length===v.length+1,p);
 return Array.from({length:v.length},(_,i)=>{need(d[i]&&d[i].enumerable&&Object.hasOwn(d[i],'value'),p);return d[i].value;});
}
const F='float',B='bool',U='uint',S='string',ID='id',A='alias',I='undefined',P='positive-infinity-float';
const fields=(keys,s)=>Object.fromEntries(keys.split(' ').filter(Boolean).map(k=>[k,s]));
const obj=(classId,f,opt={})=>({type:'object',classId,f,opt});
const plain=(f,opt)=>obj(null,f,opt);
const arr=(item,max=MAX_ROWS,len)=>({type:'array',item,max,...(len===undefined?{}:{len})});
const set=item=>({type:'set',item,max:MAX_ROWS});
const map=item=>({type:'map',item});
const one=(...values)=>({type:'one',values});
const nullable=item=>({type:'nullable',item});
const maybe=item=>({type:'maybe',item});
const lit=value=>({type:'literal',value});
const skip=value=>({type:'skip',value});
const ref=pattern=>({type:'ref',pattern});
const body=pattern=>({type:'body',pattern});
const union=(a,b)=>({type:'union',a,b});
const point=plain({x:F,y:F});
const visual=skip('presentation-field'),scene=skip('scene'),world=skip('matterworld');
const tokenPattern='[A-Za-z0-9_-]{1,80}',chunkPattern='(?:0|[1-9][0-9]{0,7})';
const pickupKey=ref('^'+chunkPattern+':(?:'+chunkPattern+'|magnet)$');
const hazardKey=ref('^'+chunkPattern+':'+chunkPattern+'$');
const shardKey=ref('^s'+chunkPattern+'-'+chunkPattern+'$');
const content=(kind,tail='')=>({type:'content',pattern:'^/'+kind+'/'+tokenPattern+tail+'$'});
const buttons='push divebomb corkscrew tuck brake brakeHeld hop reset airBrake parachute pause';
const pad=plain({...fields(buttons,B),tilt:F,heli:one(-1,0,1),variableHop:B,noAutoNudge:B,
 pressed:plain(fields('hop reset pause airBrake parachute confirm',B)),lastSource:one('keyboard','gamepad','touch')});
const roll=plain({activeAtMs:nullable(F),...fields('offsetPx vPxS simMs simDist simV',F)});
const hazard=obj('Hazard',{
 scene,world,def:content('hazards'),spawn:A,palette:visual,hit:B,destroyed:lit(false),color:visual,drawKind:S,
 ...fields('w h cx cy seed x0 phase spin _lastDraw',F),_crashy:B,body:body('^hazard:'+chunkPattern+':'+chunkPattern+'$'),gfx:visual,
 motion:nullable(content('hazards','/motion')),roll,rolling:B,rollDir:one(-1,0,1),open:B,alert:B,hid:hazardKey,simStepped:lit(true),
},{lip:nullable(point),warned:B,_side:one(-1,0,1),nearMissed:B,teleAtMs:F});
const powerup=obj('PowerUp',{
 scene,world,def:content('powerups'),spawn:union(A,plain({defId:lit('shardMagnet'),x:F,y:F})),
 palette:visual,collected:lit(false),destroyed:lit(false),color:visual,radius:F,drawKind:S,
 body:body('^powerup:'+chunkPattern+':(?:'+chunkPattern+'|magnet)$'),gfx:visual,_lastDraw:F,key:pickupKey
});
const shard=plain({id:shardKey,x:F,y:F},{pulled:B});
const shardField=obj('ShardField',{scene,palette:visual,byChunk:map(arr(shard)),collected:set(shardKey),gfx:visual});
const drone=plain({rotors:arr(plain({ring:arr(point,10,10),blade:arr(F,4,4)}),2,2),
 lights:arr(plain({on:B,color:visual,x:F,y:F}),2,2)});
const sled=obj('Sled',{
 scene,world,palette:visual,look:visual,random:A,
 ...fields('x y vx vy msSinceContact groundAngleDeg airtimeMs hopBufferMs _playerHopElapsedMs pushCooldownMs parachuteMs parachuteFuelMs _protectedHopExtraVyPxS heliPhase heliVel invulnerableMs _time _lastTilt boostMs squash dropAheadDeg _groundRunMs _sinceLaunchMs _landSettleMs canopyFuelFullMs geyserCooldownMs _crawlMs _preVx _preVy',F),
 ...fields('_contactFlag _playerHopActive chuteUsed tucked airBrakeActive airBrakePressPending airBrakeKickUsed airBrakeLiftProtected corkscrewActive scrambled _nudging',B),
 destroyed:lit(false),inWorld:lit(true),hidden:lit(false),airBrakeKickPulse:one(0,1),heliInput:one(-1,0,1),_lastPad:nullable(pad),
 pose:plain(fields('phi chute brake tuck',F)),airEtaMs:P,airSlopeDeg:nullable(F),body:body('^sled$'),off:point,gfx:visual,
 touchdownVx:maybe(F),touchdownVy:maybe(F),hopPulse:one(0,1),pushPulse:one(0,1),
},{lastRiderShape:one('default','drone'),drone:nullable(drone),windPomAnchor:nullable(point),snapSteps:U});
const roots={collectedPowerups:set(pickupKey),hazards:map(arr(hazard)),powerups:map(arr(powerup)),shardField,sled};
function freeze(v){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
export const ENTITY_STATE_DESCRIPTOR=freeze({kind:KIND,version:VERSION,fields:roots,
 numeric:'canonical finite F64 except declared sled airEta positive infinity',
 maxNodeId:MAX_ID,maxRows:MAX_ROWS,projection:'internal entity graph only'});
function ctx(expected){
 const c=exact(expected,['runId','tick','buildId','randomId'],'context');
 need(typeof c.runId==='string'&&c.runId.length>0&&c.runId.length<=256&&uint(c.tick)&&
 typeof c.buildId==='string'&&/^sha256:[0-9a-f]{64}$/.test(c.buildId)&&uint(c.randomId)&&c.randomId<MAX_ID,'context');return c;
}
function convert(input,decode,context){
 const ids=new Set(),aliases=[];
 function node(n,p){need(uint(n)&&n<MAX_ID&&!ids.has(n)&&n!==context.randomId,p+'/id');ids.add(n);return n;}
 function value(v,s,p){
  if(s===F||s===P){
   if(decode){
    let n;try{n=f64Decode(v);}catch{fail(p);}
    need(Number.isFinite(n)||(s===P&&n===Infinity),p);
    return Object.is(n,-0)?{__num:'-0'}:n===Infinity?{__num:'Infinity'}:n;
   }
   if(v&&typeof v==='object'){
    const x=exact(v,['__num'],p).__num;
    need(x==='-0'||(s===P&&x==='Infinity'),p);v=x==='-0'?-0:Infinity;
   }
   need(typeof v==='number'&&(Number.isFinite(v)||(s===P&&v===Infinity)),p);return f64Encode(v);
  }
  if(s===B){need(typeof v==='boolean',p);return v;}
  if(s===U||s===ID){need(uint(v)&&(s!==ID||v<MAX_ID),p);return v;}
  if(s===S){need(typeof v==='string'&&v.length>0&&v.length<=256,p);return v;}
  if(s===A){const n=decode?v:exact(v,['__alias'],p).__alias;need(uint(n)&&n<MAX_ID,p);
   aliases.push([p,n]);return decode?{__alias:n}:n;}
  if(s===I){need(decode?v===null:exact(v,['__u'],p).__u===1,p);return decode?{__u:1}:null;}
  switch(s.type){
   case 'nullable':return v===null?null:value(v,s.item,p);
   case 'maybe':{
    if(decode){const x=exact(v,['present','value'],p);need(typeof x.present==='boolean',p);
     return x.present?value(x.value,s.item,p):value(x.value,I,p);}
    if(v&&typeof v==='object'&&Object.hasOwn(v,'__u'))return {present:false,value:value(v,I,p)};
    return {present:true,value:value(v,s.item,p)};
   }
   case 'union':{
    if(decode){const x=exact(v,['variant','value'],p);need(x.variant===0||x.variant===1,p);return value(x.value,x.variant===0?s.a:s.b,p);}
    const a=v&&typeof v==='object'&&Object.hasOwn(v,'__alias');
    return {variant:a?0:1,value:value(v,a?s.a:s.b,p)};
   }
   case 'literal':need(Object.is(v,s.value),p);return v;
   case 'one':need(s.values.includes(v),p);return v;
   case 'ref':need(typeof v==='string'&&new RegExp(s.pattern).test(v),p);return v;
   case 'skip':need(decode?v===null:exact(v,['__skip'],p).__skip===s.value,p);return decode?{__skip:s.value}:null;
   case 'body':case 'content':{
    const k=s.type==='body'?'__body':'__content',n=decode?v:exact(v,[k],p)[k];
    need(typeof n==='string'&&new RegExp(s.pattern).test(n)&&!n.split('/').some(x=>['__proto__','constructor','prototype'].includes(x)),p);
    return decode?{[k]:n}:n;
   }
   case 'object':{
    const x=decode?exact(v,['id','fields'],p):exact(v,['__id','__c','__obj'],p);
    const n=node(decode?x.id:x.__id,p);
    if(!decode)need(x.__c===s.classId,p+'/class');
    const src=record(decode?x.fields:x.__obj,p),required=Object.keys(s.f),allowed={...s.f,...s.opt};
    need(required.every(k=>Object.hasOwn(src,k))&&Object.keys(src).every(k=>Object.hasOwn(allowed,k)),p+'/fields');
    const o=Object.fromEntries(Object.keys(src).map(k=>[k,value(src[k],allowed[k],p+'/'+k)]));
    return decode?{__id:n,__c:s.classId,__obj:o}:{id:n,fields:o};
   }
   case 'array':case 'set':case 'map':{
    const tag=s.type==='set'?'__set':s.type==='map'?'__map':'__arr';
    const x=decode?exact(v,['id','items'],p):exact(v,['__id',tag],p);
    const n=node(decode?x.id:x.__id,p),a=dense(decode?x.items:x[tag],s.max??MAX_ROWS,p,s.len);
    const out=a.map((item,i)=>{
     if(s.type!=='map')return value(item,s.item,p+'/'+i);
     const pair=dense(item,2,p+'/'+i,2);
     need(uint(pair[0])&&pair[0]<=99999999,p+'/chunk');return [pair[0],value(pair[1],s.item,p+'/'+i)];
    });
    if(s.type==='map'||s.type==='set')need(new Set(out.map(x=>s.type==='map'?x[0]:x)).size===out.length,p+'/duplicate');
    return decode?{__id:n,[tag]:out}:{id:n,items:out};
   }
   default:fail(p+'/schema');
  }
 }
 const src=exact(input,ENTITY_STATE_FIELDS,'state'),out={};
 for(const k of ENTITY_STATE_FIELDS)out[k]=value(src[k],roots[k],k);
 // Sled's shared RNG is the only approved RNG reference. Spawn aliases
 // may refer to the external terrain section, never to these entity nodes.
 for(const [p,n] of aliases)need(p==='sled/random'?n===context.randomId:!ids.has(n)&&n!==context.randomId,p+'/alias');
 return out;
}
function relations(d){
 const number=v=>typeof v==='number'?v:v?.__num==='-0'?-0:v?.__num==='Infinity'?Infinity:NaN;
 const collected=new Set(d.collectedPowerups.__set);
 for(const [chunk,list] of d.hazards.__map){
  const seen=new Set();
  for(const [i,h] of list.__arr.entries()){
   const o=h.__obj;
   need(o.hid.startsWith(chunk+':')&&!seen.has(o.hid)&&o.body.__body==='hazard:'+chunk+':'+i,'hazards/body-identity');
   seen.add(o.hid);
   if(o.motion)need(o.motion.__content===o.def.__content+'/motion','hazards/motion-reference');
   need(number(o.phase)>=0&&number(o.phase)<=1&&number(o.w)>0&&number(o.h)>0,'hazards/config-range');
  }
 }
 for(const [chunk,list] of d.powerups.__map){
  const seen=new Set();
  for(const p of list.__arr){
   const o=p.__obj;
   need(o.key.startsWith(chunk+':')&&!seen.has(o.key)&&!collected.has(o.key)&&o.body.__body==='powerup:'+o.key&&number(o.radius)>0,'powerups/identity');
   seen.add(o.key);
   need(o.key.endsWith(':magnet')?(o.def.__content==='/powerups/shardMagnet'&&o.spawn.__obj?.defId==='shardMagnet'):Object.hasOwn(o.spawn,'__alias'),'powerups/spawn');
  }
 }
 const sf=d.shardField.__obj,all=new Set(sf.collected.__set);
 for(const [chunk,list] of sf.byChunk.__map)for(const s of list.__arr){
  const id=s.__obj.id;need(id.startsWith('s'+chunk+'-')&&!all.has(id),'shards/identity');all.add(id);
 }
 const s=d.sled.__obj;
 need(number(s.parachuteFuelMs)>=0&&number(s.canopyFuelFullMs)>=number(s.parachuteFuelMs)&&number(s.airtimeMs)>=0&&number(s.airEtaMs)>=0,'sled/range');
 return d;
}
export function encodeEntityState(game,expected){
 const c=ctx(expected),g=record(game,'game'),subset=Object.fromEntries(ENTITY_STATE_FIELDS.map(k=>{
  need(Object.hasOwn(g,k),k);return [k,g[k]];
 }));
 const state=convert(subset,false,c);relations(convert(state,true,c));
 return canonicalBytes({kind:KIND,version:VERSION,...c,state});
}
export function decodeEntityState(bytes,expected){
 const c=ctx(expected),s=exact(parseCanonical(asUint8Array(bytes,'entity section')),['kind','version',...Object.keys(c),'state'],'section');
 need(s.kind===KIND&&s.version===VERSION&&Object.keys(c).every(k=>Object.is(c[k],s[k])),'section/identity');
 return relations(convert(s.state,true,c));
}
