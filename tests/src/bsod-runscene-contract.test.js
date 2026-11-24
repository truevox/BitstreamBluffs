import {readFileSync} from 'node:fs';
import { jest } from '@jest/globals';
import { BsodPursuit } from '../../src/systems/BsodPursuit.js';
import { BsodBluffTracker } from '../../src/systems/BsodBluffTracker.js';
import { EVT } from '../../src/events.js';
import { killerName } from '../../src/systems/CrashReport.js';

const FakePhaser = {
  Scene: class {},
  Physics: { Matter: { Matter: { Bodies: { rectangle: () => ({}), circle: () => ({}) }, Body: {} } } },
  Renderer: { WebGL: { Pipelines: { PostFXPipeline: class {} } } },
  GameObjects: { Container: class {}, Graphics: class {}, BitmapText: class {}, Zone: class {}, Image: class {}, Rectangle: class {}, Text: class {} },
  BlendModes: { ADD: 1 },
  Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown', DESTROY: 'destroy' } },
  Math: { Between: (a) => a, Clamp: (v, a, b) => Math.min(b, Math.max(a, v)) },
};
jest.unstable_mockModule('phaser', () => ({ default: FakePhaser }));
jest.unstable_mockModule('../../src/shaders/GlitchPipeline.js', () => ({ GlitchPipeline: { install() {} } }));
const { RunScene } = await import('../../src/scenes/RunScene.js');

describe('BSOD RunScene contract', () => {
  test('only RunScene owns emission; deactivate emits one complete inactive payload', () => {
    const r = Object.create(RunScene.prototype);
    const emitted = [];
    r.game = { events: { emit: (key, payload) => emitted.push({ key, payload }) } };
    r.bsod = new BsodPursuit({ sledLeftEdgeX: 2000 });
    r.deactivateBsod();
    r.deactivateBsod();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].key).toBe(EVT.BSOD_STATE_CHANGED);
    expect(emitted[0].payload).toEqual({
      active: false, gapPx: null, wallSpeedPxS: 0, worldTailwindPxS: 0,
      sledVelocityXPxS: 0, relativeAirX: 0, proximity01: 0,
      timeToImpactMs: null, atmosphereDensity: 0,
    });
  });

  test('BSOD catch beats shields and invulnerability, never consumes a charge', () => {
    const r = Object.create(RunScene.prototype);
    r.pendingCrash = { cause: 'bsod' };
    r.shieldCharges = 4;
    r.openingGraces = 0;
    r.sled = { invulnerableMs: 1800 };
    r.doCrash = jest.fn();
    const fs = { x: 50, y: 10, vx: 25, vy: 0 };
    r.resolveCrash(fs);
    expect(r.pendingCrash).toBeNull();
    expect(r.doCrash).toHaveBeenCalledWith({ cause: 'bsod' }, fs, 25);
    expect(r.shieldCharges).toBe(4);
    expect(killerName('bsod')).toBe('ERASED BY THE BSOD');
  });

  test('camera pullback stays within the horizontal rider safety band', () => {
    const scene = Object.create(RunScene.prototype);
    const rider = { x: 12000, y: 2000, vx: 0, vy: 0, speed: 0 };
    const cam = { zoom: 1, scrollX: 0, scrollY: 0, setZoom(z) { this.zoom = z; } };
    Object.assign(scene, {
      sled: rider, cameras: { main: cam },
      _camX: rider.x - 182, _camY: rider.y - 90, _zoom: 1, _zoomKick: 0,
      shakeAmp: 0, bsodState: { proximity01: 1 },
      bg: null, flashRect: null, blindRect: null,
    });
    for (let i = 0; i < 70; i++) scene.updateCamera(16);
    const riderScreenX = rider.x - scene._camX;
    expect(riderScreenX).toBeGreaterThan(182);
    expect(riderScreenX).toBeLessThanOrEqual(480 - 72);
  });

  test('vacuum is biome-specific and does not disable the pursuing wall', () => {
    const r = Object.create(RunScene.prototype);
    r.biomeMask = 32;
    r.terrain = {};
    r.sled = { x: 200 };
    r._biomeDefAt = () => ({ id: 'space-mountain' });
    expect(r.bsodAtmosphere()).toBe(0);
    r.bsod = new BsodPursuit({ sledLeftEdgeX: 200 });
    expect(r.bsod.state(201, 400, r.bsodAtmosphere()).worldTailwindPxS).toBe(0);
    expect(r.bsod.active).toBe(true);
    r._biomeDefAt = () => ({ id: 'forest' });
    expect(r.bsodAtmosphere()).toBe(1);
  });
});

describe('Wind pom-pom visual anchor', () => {
  test('RunScene tethers to helmet coordinates, not sled COM; clears on rider death', () => {
    const scene = Object.create(RunScene.prototype);
    const calls = [];
    const gfx = {
      clear() { calls.push(['clear']); return this; },
      lineStyle() { return this; },
      lineBetween(...coords) { calls.push(['lineBetween', ...coords]); return this; },
      fillStyle() { return this; },
      fillCircle(...coords) { calls.push(['fillCircle', ...coords]); return this; },
    };
    scene.sled = {
      x: 500, y: 200, inWorld: true, hidden: false,
      windPomAnchor: { x: 477, y: 153 },
    };
    scene._view = { left: 0, right: 600, top: 0, bottom: 320 };
    scene.bsodState = { active: true, relativeAirX: 500, atmosphereDensity: 1 };
    scene.windPom = gfx;
    scene.bsodEdge = null;
    scene.palette = { text: 0xffffff, amber: 0xffcc55 };
    scene.drawBsodCues();
    expect(calls.find(c => c[0] === 'lineBetween').slice(1,3)).toEqual([477, 153]);
    expect(calls.find(c => c[0] === 'fillCircle')[1]).toBeGreaterThan(477);
    calls.length = 0;
    scene.sled.hidden = true;
    scene.drawBsodCues();
    expect(calls).toEqual([['clear']]);
  });
});


describe('BSOD pom threat buildup from actual RunScene draw geometry', () => {
  test('far, medium and near-wall cues grow progressively with identical powerful airflow', () => {
    const scene=Object.create(RunScene.prototype);
    const calls=[];
    scene.windPom={clear(){calls.push(['clear']);},lineStyle(){},lineBetween(...a){calls.push(['line',...a]);},
      fillStyle(){},fillCircle(...a){calls.push(['circle',...a]);}};
    scene.bsodEdge=null;
    scene._view={left:0,right:600,top:0,bottom:300};
    scene.palette={text:0xffffff,amber:0xffcc00};
    scene.sled={hidden:false,inWorld:true,windPomAnchor:{x:100,y:80}};
    const sample=(proximity01,relativeAirX=1000,atmosphereDensity=1)=>{
      scene.bsodState={active:true,proximity01,relativeAirX,atmosphereDensity};
      calls.length=0;scene.drawBsodCues();
      const line=calls.find(c=>c[0]==='line');
      const dot=calls.find(c=>c[0]==='circle');
      return {extension:line[3]-line[1],height:line[4]-line[2],radius:dot[3]};
    };
    const far=sample(0),mid=sample(0.5),near=sample(1);
    expect(far.extension).toBeGreaterThan(5);
    expect(far.extension).toBeLessThan(10);
    expect(mid.extension).toBeGreaterThan(far.extension+3);
    expect(near.extension).toBeGreaterThan(mid.extension+12);
    expect(near.extension).toBeCloseTo(28);
    expect(far.height).toBeGreaterThan(mid.height);
    expect(mid.height).toBeGreaterThan(near.height);
    expect(far.radius).toBeLessThan(near.radius);
    const reversed=sample(1,-1000);
    expect(reversed.extension).toBeCloseTo(-28);
    const vacuum=sample(1,0,0);
    expect(vacuum.extension).toBe(0);
    expect(vacuum.height).toBe(5);
  });
});

describe('Bitstream Bluffing RunScene integration', () => {
  test('exactly one successful escape becomes existing near-miss scoring and one named bluff event', () => {
    const scene=Object.create(RunScene.prototype);
    const emitted=[],bonuses=[];
    scene.sled={x:1000,y:200,grounded:false,parachuteMs:0,airBrakeActive:false};
    scene.bsodState={active:true,gapPx:1000,relativeAirX:440,atmosphereDensity:1};
    scene.bsodBluffs=new BsodBluffTracker();
    scene.game={events:{emit:(key,payload)=>emitted.push([key,payload])}};
    scene.bonus=(points,kind)=>{ bonuses.push([points,kind]);return true; };
    scene.nearMissCount=0;
    scene.crashed=false;
    scene.bsodCaught=false;
    scene.runTimeMs=0;
    scene.updateBsodBluff();
    scene.bsodState.gapPx=200;
    scene.sled.parachuteMs=360;
    scene.sled.airBrakeActive=true;
    scene.runTimeMs=100;
    scene.updateBsodBluff(true); // an actual one-shot physical kick on this approach
    scene.sled.x=1300;
    scene.bsodState.gapPx=860;
    scene.runTimeMs=900;
    scene.updateBsodBluff();
    expect(bonuses).toEqual([[190,'nearMiss']]);
    expect(scene.nearMissCount).toBe(1);
    expect(emitted.map(([k])=>k)).toEqual([EVT.NEAR_MISS,EVT.BSOD_BLUFF]);
    expect(emitted[0][1]).toMatchObject({
      hazardType:'bsod',points:190,chain:1,surfing:false,closestGapPx:200,
    });
    scene.updateBsodBluff();
    expect(bonuses).toHaveLength(1);
  });

  test('holding spent AirBrake during BSOD approach cannot fraudulently earn the one-shot bonus', () => {
    const scene=Object.create(RunScene.prototype);
    const emitted=[],bonuses=[];
    scene.sled={x:1000,y:200,grounded:false,parachuteMs:0,airBrakeActive:true,airBrakeKickUsed:true};
    scene.bsodState={active:true,gapPx:1000,relativeAirX:440,atmosphereDensity:1};
    scene.bsodBluffs=new BsodBluffTracker();
    scene.game={events:{emit:(event,payload)=>emitted.push([event,payload])}};
    scene.bonus=(points,kind)=>{bonuses.push([points,kind]);return true;};
    scene.nearMissCount=0;scene.crashed=false;scene.bsodCaught=false;
    scene.runTimeMs=0;scene.updateBsodBluff();
    scene.bsodState.gapPx=200;
    scene.sled.parachuteMs=360;
    scene.runTimeMs=100;scene.updateBsodBluff(false);
    scene.sled.x=1300;scene.bsodState.gapPx=860;
    scene.runTimeMs=900;scene.updateBsodBluff(false);
    expect(bonuses).toEqual([[150,'nearMiss']]);
    expect(emitted.some(([event])=>event===EVT.BSOD_BLUFF)).toBe(true);
  });

  test('terminal collision never awards a last-frame BSOD bluff', () => {
    const scene=Object.create(RunScene.prototype);
    scene.sled={x:1200,y:200,grounded:false,parachuteMs:300,airBrakeActive:true};
    scene.bsodBluffs=new BsodBluffTracker();
    scene.bsodState={active:true,gapPx:1000,relativeAirX:440,atmosphereDensity:1};
    scene.game={events:{emit:jest.fn()}};
    scene.bonus=jest.fn();
    scene.runTimeMs=0;
    scene.updateBsodBluff();
    scene.bsodState.gapPx=210;
    scene.runTimeMs=100;
    scene.updateBsodBluff();
    scene.bsodCaught=true;
    scene.bsodState.gapPx=0;
    scene.runTimeMs=500;
    scene.updateBsodBluff();
    expect(scene.bonus).not.toHaveBeenCalled();
    expect(scene.bsodBluffs.chain).toBe(0);
  });
});

test('RunScene orders physical Matter substep touchdown ledger before the final presentation state',()=>{
  const source=readFileSync(new URL('../../src/scenes/RunScene.js',import.meta.url),'utf8');
  expect(source).toMatch(/const actualTouchdown=!!sled\.endStep\(stepMs\)/);
  expect(source).toMatch(/if\s*\(actualTouchdown\)\s*\{[\s\S]*?substepTouchdowns\.push/);
  expect(source).toMatch(/fs\.input\.airBrakeKicked=this\.replayMidtickTouchdowns\(/);
  expect(source).toMatch(/this\.handleTricksAndLanding\(upd,fs\)/);
});

describe('#247 touchdown-only paid AirBrake scoring settlement',()=>{
  test('ordered Matter substep touchdown banks a paid brake even when buffered Hop ends the fixed tick airborne',async()=>{
    const {TrickTracker}=await import('../../src/systems/TrickTracker.js');
    const {ScoreManager}=await import('../../src/systems/ScoreManager.js');
    const scene=Object.create(RunScene.prototype);
    const events=[];
    scene.game={events:{emit:(key,payload)=>events.push({key,payload})}};
    scene.tricks=new TrickTracker();scene.score=new ScoreManager();
    scene.trickCounts={};scene._airTricks=0;scene._landings=0;scene.maxAirtimeMs=0;
    scene.stabilizeMs=1000;scene.stabilizeDeg=45;scene.pendingCrash=null;
    scene.palette={amber:1,cyan:2,lime:3};
    scene.fx={sparks(){},ring(){}};
    scene.sled={x:1000,y:200,vx:200,vy:0};
    scene.emitCombo=()=>{};scene.emitFlow=()=>{};scene.emitScore=()=>{};
    scene._zoneScoreMulAt=()=>1;
    scene.applyLandingBoost=jest.fn();scene.applySpringRebound=jest.fn();
    const frame=(timeMs,grounded,kicked)=>({
      timeMs,dtMs:8,grounded,crashed:false,angleDeg:0,
      vx:200,vy:0,impactVx:200,impactVy:50,groundAngleDeg:0,x:1000,y:200,
      input:{airBrake:true,airBrakeKicked:kicked,parachute:false,heli:0},
    });
    // First substep: kick then a genuine new touchdown. Second substep:
    // buffered Hop relaunches, so the fixed-tick final frame is airborne.
    const touchdown=frame(10008,true,true);
    expect(scene.replayMidtickTouchdowns([{fs:touchdown,kicked:true}],false,false,true)).toBe(false);
    expect(scene._landings).toBe(1);
    expect(scene.trickCounts.airBrake).toBe(1);
    expect(scene.score.getSnapshot().pendingPoints).toBe(0);
    const banked=scene.score.trickPoints;
    expect(banked).toBeGreaterThan(0);
    const end=frame(10016,false,false);
    const update=scene.tricks.update(end);
    scene.handleTricksAndLanding(update,end);
    expect(update.tricks).toEqual([]);
    expect(scene._landings).toBe(1);
    expect(scene.score.trickPoints).toBe(banked);

    // A kick had instead happened on the previous fixed tick, with points
    // pending; new intermediate touchdown has NO new kick. It must STILL
    // settle the already-earned trick before a new buffered Hop relaunch.
    const prior=frame(10024,false,true);
    const paid=scene.tricks.update(prior);
    scene.handleTricksAndLanding(paid,prior);
    expect(paid.tricks).toMatchObject([{type:'airBrake'}]);
    expect(scene.score.getSnapshot().pendingPoints).toBeGreaterThan(0);
    expect(scene.replayMidtickTouchdowns(
      [{fs:frame(10032,true,false),kicked:false}],false,false,false)).toBe(false);
    expect(scene.score.getSnapshot().pendingPoints).toBe(0);
    expect(scene._landings).toBe(2);
    expect(scene.trickCounts.airBrake).toBe(2);
    const final=scene.tricks.update(frame(10040,false,false));
    scene.handleTricksAndLanding(final,frame(10040,false,false));
    expect(final.tricks).toEqual([]);
    expect(scene._landings).toBe(2);

    // If the final frame is itself grounded, do not replay its contact:
    // normal post-physics scoring must handle it once.
    expect(scene.replayMidtickTouchdowns(
      [{fs:frame(10048,true,true),kicked:true}],true,false,true)).toBe(true);
    expect(scene._landings).toBe(2);
    const last=frame(10048,true,true);
    const lastUpdate=scene.tricks.update(last);
    scene.handleTricksAndLanding(lastUpdate,last);
    expect(scene._landings).toBe(3);
    expect(scene.trickCounts.airBrake).toBe(3);
    expect(scene.score.getSnapshot().pendingPoints).toBe(0);
    expect(events.filter(x=>x.key===EVT.TRICK)).toHaveLength(3);
    expect(events.filter(x=>x.key===EVT.LANDING)).toHaveLength(3);
    const landings=events.filter(x=>x.key===EVT.LANDING);
    expect(landings.map(e=>e.payload.quality)).toEqual(['good','good','good']);
    expect(events.filter(x=>x.key===EVT.LANDING).every(x=>x.payload.quality==='good')).toBe(true);
    expect(scene.applyLandingBoost).not.toHaveBeenCalled();
    expect(scene.applySpringRebound).not.toHaveBeenCalled();
  });

  test('two true kick pulses after two missed short flights bank immediately, do not inflate airtime or leak provisional points',async()=>{
    const {TrickTracker}=await import('../../src/systems/TrickTracker.js');
    const {ScoreManager}=await import('../../src/systems/ScoreManager.js');
    const scene=Object.create(RunScene.prototype);
    const events=[];
    scene.game={events:{emit:(key,payload)=>events.push({key,payload})}};
    scene.tricks=new TrickTracker();
    scene.score=new ScoreManager();
    scene.trickCounts={};
    scene._airTricks=0;scene._landings=0;scene.maxAirtimeMs=0;
    scene.stabilizeMs=1000;scene.stabilizeDeg=45;scene.pendingCrash=null;
    scene.palette={amber:1,cyan:2,lime:3};
    scene.fx={sparks(){},ring(){}};
    scene.sled={x:1000,y:200,vx:200,vy:0};
    scene.emitCombo=()=>{};
    scene.emitFlow=()=>{};
    scene.emitScore=()=>{};
    scene._zoneScoreMulAt=()=>1;
    scene.applyLandingBoost=jest.fn();
    scene.applySpringRebound=jest.fn();
    const frame=(timeMs)=>({
      timeMs,dtMs:8,grounded:true,crashed:false,angleDeg:0,
      vx:200,vy:0,impactVx:200,impactVy:50,
      groundAngleDeg:0,x:1000,y:200,
      input:{airBrake:true,airBrakeKicked:true,parachute:false,heli:0},
    });
    for(const t of [10000,20000]){
      const fs=frame(t);
      const upd=scene.tricks.update(fs);
      expect(upd.tricks).toHaveLength(1);
      expect(upd.tricks[0]).toMatchObject({type:'airBrake',airtimeMs:8});
      expect(upd.landing).toMatchObject({quality:'good',airtimeMs:8,shortAirBrakeTouchdown:true});
      const prior=scene.score.trickPoints;
      scene.handleTricksAndLanding(upd,fs);
      expect(scene.score.getSnapshot().pendingPoints).toBe(0);
      expect(scene.score.trickPoints).toBeGreaterThan(prior);
      expect(scene._airTricks).toBe(0);
    }
    // Different timing: one genuinely paid kick during an airborne sample,
    // followed by landing 8ms later with NO new kick pulse. The pending
    // AirBrake trick must settle on THIS short landing, not leak to a later one.
    const airborne={...frame(30008),grounded:false};
    const paid=scene.tricks.update(airborne);
    expect(paid.tricks).toMatchObject([{type:'airBrake',airtimeMs:8}]);
    expect(paid.landing).toBe(null);
    scene.handleTricksAndLanding(paid,airborne);
    expect(scene.score.getSnapshot().pendingPoints).toBeGreaterThan(0);
    const landingFrame={...frame(30016),input:{
      airBrake:true,airBrakeKicked:false,parachute:false,heli:0,
    }};
    const settled=scene.tricks.update(landingFrame);
    expect(settled.tricks).toEqual([]); // no duplicate trick on landing
    expect(settled.landing).toMatchObject({
      quality:'good',shortAirBrakeTouchdown:true,airtimeMs:16,
    });
    const priorThird=scene.score.trickPoints;
    scene.handleTricksAndLanding(settled,landingFrame);
    expect(scene.score.getSnapshot().pendingPoints).toBe(0);
    expect(scene.score.trickPoints).toBeGreaterThan(priorThird);
    expect(scene._airTricks).toBe(0);

    expect(scene._landings).toBe(3);
    expect(scene.trickCounts.airBrake).toBe(3);
    expect(scene.applyLandingBoost).not.toHaveBeenCalled();
    expect(scene.applySpringRebound).not.toHaveBeenCalled();
    expect(events.filter(x=>x.key===EVT.LANDING)).toHaveLength(3);
    expect(events.filter(x=>x.key===EVT.LANDING).every(x=>
      x.payload.quality==='good' && x.payload.bonusPoints===0)).toBe(true);

    expect(events.filter(x=>x.key===EVT.TRICK)).toHaveLength(3);
    expect(events.filter(x=>x.key===EVT.TRICK).map(x=>x.payload.airtimeMs)).toEqual([8,8,8]);
  });
});
