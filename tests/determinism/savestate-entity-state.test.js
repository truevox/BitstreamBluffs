import fs from 'node:fs';
import {encodeEntityState,decodeEntityState,ENTITY_STATE_DESCRIPTOR,ENTITY_STATE_FIELDS} from '../../src/systems/savestate/entityState.js';
import {canonicalBytes,parseCanonical,f64Encode} from '../../src/systems/replay/canonicalJson.js';
const fixture=JSON.parse(fs.readFileSync(new URL('../fixtures/savestate/entity-projection-stock-936.json',import.meta.url),'utf8'));
// The fixture predates the render-only shield mirror removal (#1D).
// Current Sled no longer stores 'shield'; shield visual is derived from
// RunScene.shieldCharges. Keep the raw recorded fixture for provenance.
delete fixture.sled.__obj.shield;
const ctx={runId:'1234-entity-fixture',tick:936,buildId:'sha256:'+'a'.repeat(64),randomId:1};
const fresh=()=>JSON.parse(JSON.stringify(fixture));
const wire=encodeEntityState(fresh(),ctx);
const altered=fn=>{const s=parseCanonical(wire);fn(s);return canonicalBytes(s);};
const sled=s=>s.state.sled.fields;
const hazard=s=>s.state.hazards.items[0][1].items[0].fields;
const shards=s=>s.state.shardField.fields;
test('real stock source projection roundtrip, frozen descriptor and fixed constructor tags',()=>{
 const d=decodeEntityState(wire,ctx);
 expect(d).toEqual(fixture);expect(encodeEntityState(d,ctx)).toEqual(wire);
 expect(d.sled.__obj.random.__alias).toBe(ctx.randomId);
 expect(Object.isFrozen(ENTITY_STATE_DESCRIPTOR.fields.sled.f)).toBe(true);
 expect(Object.keys(parseCanonical(wire).state)).toHaveLength(ENTITY_STATE_FIELDS.length);
 expect(parseCanonical(wire).state.sled).not.toHaveProperty('__c');
});
test('explicit nonempty pickup, pulled shard, moving hazard and held airbrake states',()=>{
 const g=fresh(),h=g.hazards.__map[0][1].__arr[0].__obj,s=g.sled.__obj;
 // Synthetic variants of native captured projections; not claims that this
 // particular stock seed has these pickups or motion.
 h.def.__content='/hazards/rollingBoulder';h.motion={__content:'/hazards/rollingBoulder/motion'};
 h.roll.__obj={activeAtMs:1000,offsetPx:10,vPxS:40,simMs:250,simDist:10,simV:40};
 h.rolling=true;h.rollDir=1;
 s.airBrakeActive=true;s.airBrakeKickUsed=true;s.airBrakeLiftProtected=true;
 s._protectedHopExtraVyPxS=12.345678901234;
 s._lastPad.__obj.airBrake=true;s._lastPad.__obj.pressed.__obj.airBrake=true;
 const power=(id,key,def,spawn)=>({__id:id,__c:'PowerUp',__obj:{
  scene:{__skip:'scene'},world:{__skip:'matterworld'},def:{__content:'/powerups/'+def},spawn,
  palette:{__skip:'presentation-field'},collected:false,destroyed:false,color:{__skip:'presentation-field'},
  radius:10,drawKind:'clock',body:{__body:'powerup:'+key},gfx:{__skip:'presentation-field'},_lastDraw:0,key
 }});
 g.powerups.__map.push([1,{__id:900000,__arr:[
  power(900001,'1:0','clockPulse',{__alias:190}),
  power(900002,'1:magnet','shardMagnet',{__id:900003,__c:null,__obj:{defId:'shardMagnet',x:3000,y:1000}})
 ]}]);
 g.collectedPowerups.__set.push('0:0');
 g.shardField.__obj.collected.__set.push('1:0'.replace(':','-').replace(/^/,'s'));
 g.shardField.__obj.byChunk.__map[0][1].__arr[0].__obj.pulled=true;
 const w=encodeEntityState(g,ctx);
 expect(decodeEntityState(w,ctx)).toEqual(g);
 expect(encodeEntityState(decodeEntityState(w,ctx),ctx)).toEqual(w);
});
test.each([
 ['wrong build',s=>s.buildId='sha256:'+'b'.repeat(64)],['wrong run',s=>s.runId+='x'],
 ['wrong tick',s=>s.tick++],['wrong RNG context',s=>s.randomId++],
 ['unknown root',s=>s.state.unknown=1],['missing root',s=>delete s.state.sled],
 ['wire class selection',s=>s.state.sled.__c='Rng'],
 ['obsolete shield mirror',s=>sled(s).shield=true],
 ['unknown sled field',s=>sled(s).unknown=1],['missing sled field',s=>delete sled(s).airtimeMs],
 ['wrong shared RNG',s=>sled(s).random=9],['duplicate node ID',s=>s.state.sled.id=s.state.hazards.id],
 ['wrong sled body',s=>sled(s).body='hazard:1:0'],['false active sled',s=>sled(s).inWorld=false],
 ['bad pad bit',s=>sled(s)._lastPad.fields.push=1],
 ['bad heli axis',s=>sled(s).heliInput=3],
 ['noncanonical float',s=>sled(s).vx=12],
 ['infinite velocity',s=>sled(s).vx=f64Encode(Infinity)],
 ['negative infinity ETA',s=>sled(s).airEtaMs=f64Encode(-Infinity)],
 ['negative ETA',s=>sled(s).airEtaMs=f64Encode(-1)],
 ['foreign hazard body',s=>hazard(s).body='hazard:2:0'],
 ['wrong hazard chunk',s=>hazard(s).hid='2:0'],
 ['unsafe content path',s=>hazard(s).def='/hazards/__proto__'],
 ['wrong motion reference',s=>hazard(s).motion='/hazards/other/motion'],
 ['internal spawn alias',s=>hazard(s).spawn=s.state.sled.id],
 ['duplicate chunk',s=>s.state.hazards.items.push(s.state.hazards.items[0])],
 ['duplicate shard',s=>shards(s).byChunk.items[0][1].items[1].fields.id=shards(s).byChunk.items[0][1].items[0].fields.id],
 ['collected live shard',s=>shards(s).collected.items.push(shards(s).byChunk.items[0][1].items[0].fields.id)],
 ['foreign shard chunk',s=>shards(s).byChunk.items[0][1].items[0].fields.id='s9-0'],
 ['invalid pickup ID',s=>s.state.collectedPowerups.items.push('arbitrary')],
])('rejects %s',(_n,fn)=>expect(()=>decodeEntityState(altered(fn),ctx)).toThrow());
test('signed zero, subnormal and declared positive infinity roundtrip',()=>{
 const w=altered(s=>{sled(s).vx=f64Encode(-0);sled(s).vy=f64Encode(Number.MIN_VALUE);hazard(s).phase=f64Encode(-0);});
 const d=decodeEntityState(w,ctx);
 expect(d.sled.__obj.vx).toEqual({__num:'-0'});
 expect(d.sled.__obj.vy).toBe(Number.MIN_VALUE);
 expect(d.sled.__obj.airEtaMs).toEqual({__num:'Infinity'});
 expect(encodeEntityState(d,ctx)).toEqual(w);
});
test('capture rejects accessor without invoking it, sparse map, hidden or extra properties',()=>{
 const g=fresh();Object.defineProperty(g.sled.__obj,'x',{get(){throw Error('GETTER CALLED');},enumerable:true});
 expect(()=>encodeEntityState(g,ctx)).toThrow(/entity-state/);
 const h=fresh();Object.defineProperty(h.sled.__obj,'hidden',{value:1});
 expect(()=>encodeEntityState(h,ctx)).toThrow();
 const k=fresh();delete k.hazards.__map[0];expect(()=>encodeEntityState(k,ctx)).toThrow();
});
test('wrong byte kind and noncanonical bytes refuse',()=>{
 expect(()=>decodeEntityState('not bytes',ctx)).toThrow();
 expect(()=>decodeEntityState(new Uint8Array([...wire,32]),ctx)).toThrow();
});
