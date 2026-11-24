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
    airBrakeActive:false,airBrakeKickUsed:false,
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

test('AirBrake without any vertical kick does not disable legitimate hop-release cutoff',()=>{
  const s=makeSled(20,-150); // too slow to pay for any lift
  step(s,{hop:false,variableHop:true,airBrake:true,noAutoNudge:true,pressed:{airBrake:true}});
  expect(s.airBrakeKickUsed).toBe(true);
  expect(s._playerHopActive).toBe(false); // original hop cutoff runs and ends launch
  expect(toPx(s.body.velocity.y)).toBe(0);
});
