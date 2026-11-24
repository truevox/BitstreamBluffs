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
