/** Regression #247: a variable-hop release cannot erase the paid AirBrake lift. */
import { jest } from '@jest/globals';

jest.unstable_mockModule('phaser', () => ({
  default: { Physics: { Matter: { Matter: { Bodies: {}, Body: {
    getVelocity: b => ({...b.velocity}),
    setVelocity: (b,v) => { b.velocity={...v}; },
    getAngularVelocity: b => b.angularVelocity || 0,
    setAngularVelocity: (b,v) => { b.angularVelocity=v; },
  } } } } },
}));
const { Sled } = await import('../../src/entities/Sled.js');
const { BASE_STEP_MS, TUNING } = await import('../../src/systems/PhysicsTuner.js');
const toMatter = x=>x*BASE_STEP_MS/1000;
const toPx = x=>x*1000/BASE_STEP_MS;
function makeSled(vx=530, vy=150){
  const s=Object.create(Sled.prototype);
  Object.assign(s, {
    inWorld:true,destroyed:false,
    world:{engine:{gravity:{y:0}}},
    body:{angle:0,angularVelocity:0,velocity:{x:toMatter(vx),y:toMatter(vy)}},
    msSinceContact:200, groundAngleDeg:0, _groundRunMs:0,dropAheadDeg:90,
    _sinceLaunchMs:200,_lastPad:null,_time:0,
    hopBufferMs:0,pushCooldownMs:0,geyserCooldownMs:0,invulnerableMs:0,
    parachuteFuelMs:880,canopyFuelFullMs:880,boostMs:0,
    airBrakeActive:false,airBrakeKickUsed:false,airBrakeLiftProtected:false,
    _playerHopActive:true,_playerHopElapsedMs:TUNING.hopMinimumHoldMs+10,
    _crawlMs:0,_nudging:false,airEtaMs:Infinity,airSlopeDeg:null,
  });
  return s;
}
const phys={gravityPxS2:900,frictionAir:0,groundFriction:0,restitution:0,
  quadDrag:0,groundResist:0,tiltTorqueDegS2:0,airControl:1,
  maxAngularVelDegS:900,airbrakeLiftMul:1,scrambleJitterDegS2:0,
  beltDrivePxS2:0};
const step=(s,pad)=>s.applyControls(pad,phys,8,{atmosphereDensity:1,relativeAirX:0,proximity01:0});

test('AirBrake pressed as variable hop is released gives both paid horizontal decel AND vertical kick',()=>{
  const s=makeSled();
  step(s,{hop:false,variableHop:true,airBrake:true,noAutoNudge:true,pressed:{airBrake:true}});
  expect(toPx(s.body.velocity.x)).toBeCloseTo(212,6);
  expect(toPx(s.body.velocity.y)).toBeCloseTo(-318,6);
  expect(s.airBrakeKickUsed).toBe(true);
  expect(s._playerHopActive).toBe(false);
  // Lift persists through later hop-release frames without repeated braking.
  step(s,{hop:false,variableHop:true,airBrake:false,noAutoNudge:true,pressed:{}});
  expect(toPx(s.body.velocity.y)).toBeCloseTo(-318,6);
  expect(toPx(s.body.velocity.x)).toBeCloseTo(212,6);
});

test('separate next-tick coyote Hop cannot reactivate cutoff after already-paid AirBrake lift',()=>{
  const s=makeSled(530,150);
  s.msSinceContact=60; // airborne, after grounded grace but before coyote expires
  step(s,{hop:false,variableHop:true,airBrake:true,noAutoNudge:true,pressed:{airBrake:true}});
  const paidVy=toPx(s.body.velocity.y);
  expect(paidVy).toBeLessThan(-100);
  expect(s.airBrakeLiftProtected).toBe(true);
  s.msSinceContact=68;
  step(s,{hop:true,variableHop:true,airBrake:false,noAutoNudge:true,pressed:{hop:true}});
  expect(s.hopPulse).toBe(1);
  expect(s._playerHopActive).toBe(true); // extra Hop lift is independently releasable
  expect(s._protectedHopExtraVyPxS).toBeGreaterThan(0);
  for(let i=0;i<25;i++){
    s.msSinceContact+=8;
    step(s,{hop:false,variableHop:true,airBrake:false,noAutoNudge:true,pressed:{}});
  }
  expect(toPx(s.body.velocity.y)).toBeCloseTo(paidVy,6); // extra Hop removed, paid brake remains
  expect(s._protectedHopExtraVyPxS).toBe(0);
  expect(s.airBrakeLiftProtected).toBe(true);
  // A physically registered landing is the only rearm/reset point.
  s._contactFlag=true;
  s._sync=()=>{};
  s.endStep(8);
  expect(s.airBrakeLiftProtected).toBe(false);
  expect(s._protectedHopExtraVyPxS).toBe(0);
  expect(s.airBrakeKickUsed).toBe(false);
});

test('AirBrake without any vertical kick does not disable legitimate hop-release cutoff',()=>{
  const s=makeSled(20,-150); // too slow to pay for any lift
  step(s,{hop:false,variableHop:true,airBrake:true,noAutoNudge:true,pressed:{airBrake:true}});
  expect(s.airBrakeKickUsed).toBe(true);
  expect(s._playerHopActive).toBe(false); // original hop cutoff runs and ends launch
  expect(toPx(s.body.velocity.y)).toBe(0);
});


test('simultaneous coyote Hop + AirBrake preserves the paid kick when Hop is later released',()=>{
  const s=makeSled(530,150);
  s.msSinceContact=60; // airborne, but within 90ms coyote launch window
  step(s,{hop:true,variableHop:true,airBrake:true,noAutoNudge:true,
    pressed:{hop:true,airBrake:true}});
  expect(s.airBrakeKickUsed).toBe(true);
  expect(s.hopPulse).toBe(1);
  expect(toPx(s.body.velocity.x)).toBeLessThan(300);
  expect(toPx(s.body.velocity.y)).toBeLessThan(-100);
  expect(s._playerHopActive).toBe(true); // Hop's own added velocity may still be cut
  expect(s._protectedHopExtraVyPxS).toBeGreaterThan(0);
  // Far beyond the minimum 150ms hold: the normal hop-release cutoff must
  // NOT zero the separate AirBrake climb. No second speed cut is permitted.
  const afterBrake=toPx(s.body.velocity.x);
  for(let i=0;i<25;i++){
    s.msSinceContact+=8;
    step(s,{hop:false,variableHop:true,airBrake:false,noAutoNudge:true,pressed:{}});
  }
  expect(toPx(s.body.velocity.y)).toBeCloseTo(-318,6); // original brake lift, not extra coyote-hop lift
  expect(s._protectedHopExtraVyPxS).toBe(0);
  expect(toPx(s.body.velocity.x)).toBeCloseTo(afterBrake,6);
});


test('low-speed paid brake -60, later Hop -360: release cuts Hop +300 but preserves brake -60',()=>{
  const s=makeSled(100,0);
  s.msSinceContact=60;
  step(s,{hop:false,variableHop:true,airBrake:true,noAutoNudge:true,pressed:{airBrake:true}});
  const paidVy=toPx(s.body.velocity.y);
  expect(paidVy).toBeCloseTo(-60,6);
  s.msSinceContact=68;
  step(s,{hop:true,variableHop:true,airBrake:false,noAutoNudge:true,pressed:{hop:true}});
  const hoppedVy=toPx(s.body.velocity.y);
  expect(hoppedVy).toBeCloseTo(-360,6);
  expect(s._protectedHopExtraVyPxS).toBeCloseTo(300,6);
  for(let i=0;i<25;i++){
    s.msSinceContact+=8;
    step(s,{hop:false,variableHop:true,airBrake:false,noAutoNudge:true,pressed:{}});
  }
  expect(toPx(s.body.velocity.y)).toBeCloseTo(-60,6);
  expect(s._protectedHopExtraVyPxS).toBe(0);
});

test('AirBrake AFTER player Hop: releasing Hop removes original Hop ascent but preserves newly paid AirBrake lift',()=>{
  const s=makeSled(530,0);
  s.msSinceContact=60;
  s._playerHopActive=false;
  step(s,{hop:true,variableHop:true,airBrake:false,noAutoNudge:true,pressed:{hop:true}});
  const fromHop=toPx(s.body.velocity.y);
  expect(fromHop).toBeCloseTo(-360,6);
  expect(s._playerHopActive).toBe(true);
  s.msSinceContact=68;
  // Brake is paid during a sustained Hop. The lift cap means AirBrake adds only
  // the incremental ascent from -360 to -420, not 318 free extra px/s.
  step(s,{hop:true,variableHop:true,airBrake:true,noAutoNudge:true,pressed:{airBrake:true}});
  expect(s.airBrakeLiftProtected).toBe(true);
  expect(s._playerHopActive).toBe(true);
  expect(s._protectedHopExtraVyPxS).toBeCloseTo(360,6);
  expect(toPx(s.body.velocity.y)).toBeCloseTo(-420,6);
  s._playerHopElapsedMs=TUNING.hopMinimumHoldMs+2;
  step(s,{hop:false,variableHop:true,airBrake:false,noAutoNudge:true,pressed:{}});
  expect(s._playerHopActive).toBe(false);
  expect(s._protectedHopExtraVyPxS).toBe(0);
  expect(toPx(s.body.velocity.y)).toBeCloseTo(-60,6);
  expect(s.airBrakeLiftProtected).toBe(true);
});

test('holding an already-spent AirBrake cannot suppress ordinary crest smoothing',()=>{
  const prepared=()=>{
    const s=makeSled(400,-50);
    s.airBrakeKickUsed=true;
    s.msSinceContact=80;
    s._sinceLaunchMs=500;
    s._groundRunMs=200;
    s.dropAheadDeg=0;
    s._playerHopActive=false;
    return s;
  };
  const held=prepared(),released=prepared();
  step(held,{hop:false,variableHop:true,airBrake:true,noAutoNudge:true,pressed:{}});
  step(released,{hop:false,variableHop:true,airBrake:false,noAutoNudge:true,pressed:{}});
  expect(toPx(held.body.velocity.y)).toBeCloseTo(0,6);
  expect(toPx(held.body.velocity.y)).toBeCloseTo(toPx(released.body.velocity.y),6);
  expect(toPx(held.body.velocity.x)).toBeCloseTo(toPx(released.body.velocity.x),6);
});

test('Hop release never creates a sudden downward shove after gravity has already spent most of Hop ascent',()=>{
  const s=makeSled(530,0);
  s.msSinceContact=60;
  s._playerHopActive=false;
  step(s,{hop:true,variableHop:true,airBrake:false,noAutoNudge:true,pressed:{hop:true}});
  s.msSinceContact=68;
  step(s,{hop:true,variableHop:true,airBrake:true,noAutoNudge:true,pressed:{airBrake:true}});
  expect(s._protectedHopExtraVyPxS).toBeGreaterThan(300);
  // Real Matter gravity advances BETWEEN the separate fixed input ticks;
  // before release, the remaining rising speed can be < stored Hop budget.
  s.body.velocity.y=toMatter(-140);
  s._playerHopElapsedMs=TUNING.hopMinimumHoldMs+2;
  step(s,{hop:false,variableHop:true,airBrake:false,noAutoNudge:true,pressed:{}});
  expect(toPx(s.body.velocity.y)).toBe(0);
  expect(s._protectedHopExtraVyPxS).toBe(0);
  expect(s._playerHopActive).toBe(false);
});


test('protected Hop release AFTER its apex does not pause or reverse existing descent',()=>{
  const s=makeSled(530,0);
  s.msSinceContact=60;
  s._playerHopActive=false;
  step(s,{hop:true,variableHop:true,airBrake:false,noAutoNudge:true,pressed:{hop:true}});
  s.msSinceContact=68;
  step(s,{hop:true,variableHop:true,airBrake:true,noAutoNudge:true,pressed:{airBrake:true}});
  expect(s._protectedHopExtraVyPxS).toBeGreaterThan(300);
  s.body.velocity.y=toMatter(45); // real gravity has already crossed apex
  s._playerHopElapsedMs=TUNING.hopMinimumHoldMs+2;
  step(s,{hop:false,variableHop:true,airBrake:false,noAutoNudge:true,pressed:{}});
  expect(toPx(s.body.velocity.y)).toBeCloseTo(45,6);
  expect(s._protectedHopExtraVyPxS).toBe(0);
  expect(s._playerHopActive).toBe(false);
});

test('removable Hop-added ascent uses the same Matter per-substep frictionAir damping',()=>{
  const s=makeSled(530,-100);
  s.airBrakeLiftProtected=true;
  s._protectedHopExtraVyPxS=300;
  s._contactFlag=false;
  s.body.frictionAir=0.12;
  s._sync=()=>{};
  s.endStep(8);
  const expected=300*(1-0.12*8/(1000/60));
  expect(s._protectedHopExtraVyPxS).toBeCloseTo(expected,9);
  s.endStep(8);
  expect(s._protectedHopExtraVyPxS).toBeCloseTo(expected*(1-0.12*8/(1000/60)),9);
});


test('endStep reports only genuine NEW Matter touchdown, not a continuous contact or an airborne step',()=>{
  const s=makeSled();
  s._sync=()=>{};
  s.msSinceContact=200;s._contactFlag=true;
  expect(s.endStep(8)).toBe(true);
  s._contactFlag=true;
  expect(s.endStep(8)).toBe(false);
  expect(s.airBrakeKickUsed).toBe(false);
  expect(s.endStep(8)).toBe(false);
});
