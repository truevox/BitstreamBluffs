import fs from 'node:fs';
import {encodeSceneRemainderState,decodeSceneRemainderState,SCENE_REMAINDER_FIELDS} from '../../src/systems/savestate/sceneRemainderState.js';
import {canonicalBytes,parseCanonical,f64Encode} from '../../src/systems/replay/canonicalJson.js';
import {FP_SUBSYSTEMS,FP_VERSION} from '../../src/systems/replay/fingerprint.js';
import {combineFingerprints} from '../../src/systems/replay/canonicalBinary.js';
const fixture=JSON.parse(fs.readFileSync(new URL('../fixtures/savestate/scene-remainder-stock-936.json',import.meta.url),'utf8'));
const ctx={runId:'1234-sim-05',tick:936,buildId:'sha256:'+'a'.repeat(64),seed:'sim-05'};
const config={seed:'"sim-05"',biomeMask:'0'};
const subsystems=Object.fromEntries(FP_SUBSYSTEMS.map(x=>[x,'xxh32x2:1234567890abcdef']));
const fingerprint={fp:FP_VERSION,tick:ctx.tick,subsystems,combined:combineFingerprints(ctx.tick,subsystems,FP_SUBSYSTEMS)};
const fresh=()=>JSON.parse(JSON.stringify(fixture));
const encode=x=>encodeSceneRemainderState(x.game,{camera:x.camera,telegraph:x.telegraph,ghost:x.ghost,config,fingerprint},ctx);
const wire=encode(fresh());
const decode=(w=wire,c=ctx,f=config)=>decodeSceneRemainderState(w,c,f);
const changed=fn=>{const d=parseCanonical(wire);fn(d);return canonicalBytes(d);};
test('actual stock completed tick remainder roundtrips including safe samples and telegraph history',()=>{
 const d=decode();
 expect(d).toEqual({...fixture,fingerprint});expect(encode(d)).toEqual(wire);
 expect(SCENE_REMAINDER_FIELDS).toContain('_teleMarks');
 expect(d.game.safeSamples.__arr.length).toBeGreaterThan(0);
 expect(d.telegraph.hazards.length).toBe(1);
});
test('config is a witness only, not arbitrary settings; foreign fresh config refuses',()=>{
 expect(parseCanonical(wire)).not.toHaveProperty('config');
 expect(()=>decode(wire,ctx,{...config,biomeMask:'1'})).toThrow(/config/);
});
test('active effect, ward, zone and boost variants use fixed schema (synthetic projection)',()=>{
 const d=fresh(),g=d.game;
 g.slowMs=123.25;g.glideMs=320.5;g.glideId='maple';g.glideMul=.5;
 g.wards.__obj.wards.__arr.push({__id:900001,__c:null,__obj:{id:'waxSpray',msLeft:4200,mods:{__id:900002,__arr:['sticky']},
 hazards:{__id:900003,__arr:[]},effects:{__id:900004,__arr:['slow']},speedFactor:1.1}});
 g.activeZones.__map.push(['sticky:1300',{__alias:123}]);
 g.lastBoost={__id:900005,__c:null,__obj:{amountPxS:35,t:6000}};
 g.magnetEff={__content:'/powerups/shardMagnet/effect'};g.magnetId='shardMagnet';g.magnetMs=250;
 const w=encode(d);expect(decode(w)).toEqual({...d,fingerprint});
});
test.each([
 ['unknown root',d=>d.state.newField=1],['missing root',d=>delete d.state.runTimeMs],
 ['negative timer',d=>d.state.slowMs=f64Encode(-1)],
 ['nonfinite timer',d=>d.state.slowMs=f64Encode(Infinity)],
 ['wrong tick',d=>d.tick++],['wrong build',d=>d.buildId='sha256:'+'b'.repeat(64)],
 ['wrong seed',d=>d.seed='other'],['wrong config',d=>d.configDigest='sha256:'+'b'.repeat(64)],
 ['pending crash',d=>d.state.pendingCrash={}],['terminal run',d=>d.state.crashed=true],
 ['pending contact',d=>d.state._contactQueue.items.push(f64Encode(1))],
 ['pending despawn',d=>d.state._despawn.items.push(f64Encode(1))],
 ['duplicate node',d=>d.state.safeSamples.id=d.state.shieldSources.id],
 ['bad recovery time',d=>d.state.safeSamples.items[0].fields.t=f64Encode(1000000)],
 ['bad marker alias',d=>d.state._teleMarks.items[0].fields.ref=-1],
 ['invalid marker kind',d=>d.state._teleMarks.items[0].fields.kind='unknown'],
 ['invalid marker urgency',d=>d.state._teleMarks.items[0].fields.urgency=f64Encode(2)],
 ['arbitrary content path',d=>d.state.magnetEff='/settings/__proto__/effect'],
 ['wrong telegraph version',d=>d.telegraph.v++],
 ['duplicate tracker entry',d=>d.telegraph.hazards.push(d.telegraph.hazards[0])],
 ['negative camera zoom',d=>d.camera.zoom=f64Encode(-1)],
 ['invalid camera geometry',d=>d.camera._view.left=d.camera._view.right],
 ['wrong ghost tick',d=>d.ghost[0]++],
 ['wrong fingerprint combined',d=>d.fingerprint.combined='xxh32x2:0000000000000000'],
 ['foreign fingerprint subsystem',d=>d.fingerprint.subsystems.unknown='xxh32x2:0000000000000000'],
])('refuses %s',(_n,fn)=>expect(()=>decode(changed(fn))).toThrow());
test('exact signed zero and subnormal camera and recovery values',()=>{
 const w=changed(d=>{d.camera.rotation=f64Encode(-0);d.state.safeSamples.items[0].fields.vx=f64Encode(Number.MIN_VALUE);});
 const out=decode(w);
 expect(Object.is(out.camera.rotation,-0)).toBe(true);
 expect(out.game.safeSamples.__arr[0].__obj.vx).toBe(Number.MIN_VALUE);
 expect(encode(out)).toEqual(w);
});
test('hidden and accessor fields refuse without evaluation; no untyped legacy roots',()=>{
 const a=fresh();Object.defineProperty(a.game,'runTimeMs',{get(){throw Error('GETTER EXECUTED');},enumerable:true});
 expect(()=>encode(a)).toThrow(/scene-remainder/);
 const b=fresh();b.game._flow=1;expect(()=>encode(b)).toThrow(/root-fields/);
 expect(()=>decode(new Uint8Array([...wire,32]))).toThrow();
});
