import { PHYSICS } from '../../src/constants.js';
import { TUNING } from '../../src/systems/PhysicsTuner.js';
import { aerodynamicStep, airBrakeSpeedStep, canopyFuelStep, canopySailFactor, vacuumDivebombStep } from '../../src/systems/BsodAerodynamics.js';

describe('BSOD aerodynamics (pure)', () => {
  test('fuel only drains while held in flight; successive taps share one tank', () => {
    let f = canopyFuelStep(880, true, true, 100);
    expect(f).toEqual({ fuelMs: 780, deployed: true });
    f = canopyFuelStep(f.fuelMs, false, true, 300);
    expect(f).toEqual({ fuelMs: 780, deployed: false });
    f = canopyFuelStep(f.fuelMs, true, true, 200);
    expect(f).toEqual({ fuelMs: 580, deployed: true });
    f = canopyFuelStep(f.fuelMs, true, false, 1);
    expect(f).toEqual({ fuelMs: 880, deployed: false });
  });
  test('no micro negative fuel even on long substep', () => {
    const r=canopyFuelStep(2,true,true,8);
    expect(r.fuelMs).toBe(0);
    expect(r.deployed).toBe(true);
    expect(canopyFuelStep(0,true,true,8).deployed).toBe(false);
  });
  test('low-speed sail catches more tailwind than racing rider', () => {
    expect(canopySailFactor(0)).toBeGreaterThan(canopySailFactor(600));
    const slow=aerodynamicStep({vx:0,relativeAirX:400,parachute:true});
    const fast=aerodynamicStep({vx:600,relativeAirX:400,parachute:true});
    expect(slow.dvx).toBeGreaterThan(fast.dvx);
    expect(slow.dvy).toBeLessThan(0);
  });
  test('signed headwind pulls backwards and wind matching causes no forward acceleration', () => {
    expect(aerodynamicStep({vx:900,relativeAirX:-380,parachute:true}).dvx).toBeLessThan(0);
    expect(aerodynamicStep({vx:50,relativeAirX:0,parachute:true}).dvx).toBe(0);
  });
  test('airbrake pulls rider upward and never adds forward speed', () => {
    const slow=aerodynamicStep({vx:0,airBrake:true});
    const spent=airBrakeSpeedStep(700,8,1,PHYSICS.airBrakeDecel,TUNING.airBrakeSpanMs);
    const fast=aerodynamicStep({vx:spent.vx,airBrake:true,airBrakeSpentSpeedPxS:spent.spentSpeedPxS});
    expect(slow.dvy).toBe(0);
    expect(fast.dvy).toBeLessThan(0);
    expect(fast.dvx).toBe(0);
  });
  test('a near-wall tailwind pays for an actual emergency sail catch, not distant free thrust', () => {
    const args={vx:700,relativeAirX:600,parachute:true,stepMs:8};
    const far=aerodynamicStep({...args,proximity01:0});
    const close=aerodynamicStep({...args,proximity01:.95});
    expect(close.dvx).toBeGreaterThan(far.dvx*5);
    expect(aerodynamicStep({...args,relativeAirX:0,proximity01:1}).dvx).toBe(0);
  });
  test('high-speed airbrake can briefly overpower gravity, but stationary lift is zero', () => {
    const spent=airBrakeSpeedStep(900,8,1,PHYSICS.airBrakeDecel,TUNING.airBrakeSpanMs);
    const fast=aerodynamicStep({vx:spent.vx,airBrake:true,airBrakeSpentSpeedPxS:spent.spentSpeedPxS,stepMs:8});
    const stationary=aerodynamicStep({vx:0,airBrake:true,stepMs:8});
    expect(-fast.dvy).toBeGreaterThan(900*TUNING.airBrakeGravityMul*.008); // real initial upward burst pays for speed
    expect(stationary.dvy).toBe(0);
    const boost=aerodynamicStep({vx:spent.vx,airBrake:true,airBrakeSpentSpeedPxS:spent.spentSpeedPxS,airbrakeLiftMul:1.3,stepMs:8});
    expect(boost.dvy).toBeLessThan(fast.dvy);
  });
  test('release/repress cannot mint lift: every upward impulse requires actual speed removed that step', () => {
    const held=airBrakeSpeedStep(650,8,1,PHYSICS.airBrakeDecel,TUNING.airBrakeSpanMs);
    expect(held.vx).toBeLessThan(650);
    expect(held.spentSpeedPxS).toBeGreaterThan(0);
    const paid=aerodynamicStep({vx:held.vx,airBrake:true,airBrakeSpentSpeedPxS:held.spentSpeedPxS});
    expect(paid.dvy).toBeCloseTo(-held.spentSpeedPxS*TUNING.airBrakePaidLiftRatio,10);
    expect(aerodynamicStep({vx:650,airBrake:true}).dvy).toBe(0);
    expect(aerodynamicStep({vx:650,airBrake:false,airBrakeSpentSpeedPxS:held.spentSpeedPxS}).dvy).toBe(0);
    expect(aerodynamicStep({vx:0,airBrake:true,airBrakeSpentSpeedPxS:0}).dvy).toBe(0);
  });
  test('faster, larger brake bite and front-loaded lift fall off with horizontal speed', () => {
    expect(PHYSICS.airBrakeDecel).toBeGreaterThan(.25);
    expect(TUNING.airBrakeSpanMs).toBeLessThan(800);
    expect(TUNING.airBrakeGravityMul).toBeGreaterThan(.8);
    expect(TUNING.airBrakeDescentDamp).toBeLessThan(2.4);
    let vx=700;
    const dvy=[];
    for(let i=0;i<100;i++){
      const r=airBrakeSpeedStep(vx,8,1,PHYSICS.airBrakeDecel,TUNING.airBrakeSpanMs);
      vx=r.vx;
      dvy.push(aerodynamicStep({vx,airBrake:true,airBrakeSpentSpeedPxS:r.spentSpeedPxS}).dvy);
    }
    expect(dvy[0]).toBeLessThan(0);
    expect(-dvy[0]).toBeGreaterThan(900*TUNING.airBrakeGravityMul*.008);
    expect(-dvy[45]).toBeLessThan(900*TUNING.airBrakeGravityMul*.008);
    expect(Math.abs(dvy[75])).toBeLessThan(Math.abs(dvy[0])*.6);
    expect(vx).toBeLessThan(700*.5);
  });
  test('braking and paid lift preserve the same budget at 30, 60, 120 and 144Hz display intervals', () => {
    const integrate=(dtMs,n) => {
      let vx=700,lift=0;
      for(let i=0;i<n;i++){
        const r=airBrakeSpeedStep(vx,dtMs,1,PHYSICS.airBrakeDecel,TUNING.airBrakeSpanMs);
        vx=r.vx;
        lift+=-aerodynamicStep({vx,airBrake:true,airBrakeSpentSpeedPxS:r.spentSpeedPxS,stepMs:dtMs}).dvy;
      }
      return {vx,lift};
    };
    const standard=integrate(8,60);
    for(const [ms,steps] of [[16,30],[4,120],[10,48],[5,96]]){
      const x=integrate(ms,steps);
      expect(x.vx).toBeCloseTo(standard.vx,7);
      expect(x.lift).toBeCloseTo(standard.lift,7);
    }
    // Two separate taps must not restore a spent energy source.
    expect(standard.lift).toBeCloseTo((700-standard.vx)*TUNING.airBrakePaidLiftRatio,8);
  });
  test('airless and very thin atmospheres cannot create an AirBrake lift source', () => {
    expect(airBrakeSpeedStep(700,8,0,PHYSICS.airBrakeDecel,TUNING.airBrakeSpanMs))
      .toEqual({vx:700,spentSpeedPxS:0});
    const thin=airBrakeSpeedStep(700,8,.1,PHYSICS.airBrakeDecel,TUNING.airBrakeSpanMs);
    const dense=airBrakeSpeedStep(700,8,1,PHYSICS.airBrakeDecel,TUNING.airBrakeSpanMs);
    expect(thin.spentSpeedPxS).toBeLessThan(dense.spentSpeedPxS);
    expect(aerodynamicStep({vx:700,airBrake:true,airBrakeSpentSpeedPxS:100,atmosphereDensity:0}))
      .toEqual({dvx:0,dvy:0});
  });
  test('vacuum kills all aerodynamic force even during contact-danger', () => {
    expect(aerodynamicStep({vx:900,relativeAirX:1200,atmosphereDensity:0,parachute:true,airBrake:true})).toEqual({dvx:0,dvy:0});
  });
});


describe('Space Mountain keeps genuine vacuum but has a small powered divebomb', () => {
  test('only a held airborne divebomb with zero atmosphere produces forward purchase', () => {
    expect(vacuumDivebombStep({airborne:true,divebomb:true,atmosphereDensity:0,stepMs:100}))
      .toEqual({dvx:3.5,dvy:14}); // capped 50ms per physics call
    expect(vacuumDivebombStep({airborne:true,divebomb:true,atmosphereDensity:1}))
      .toEqual({dvx:0,dvy:0});
    expect(vacuumDivebombStep({airborne:true,divebomb:false,atmosphereDensity:0}))
      .toEqual({dvx:0,dvy:0});
    expect(vacuumDivebombStep({airborne:false,divebomb:true,atmosphereDensity:0}))
      .toEqual({dvx:0,dvy:0});
  });
  test('thrust costs altitude but does not create any wind in space', () => {
    const r=vacuumDivebombStep({airborne:true,divebomb:true,atmosphereDensity:0,stepMs:8});
    expect(r.dvx).toBeGreaterThan(0);
    expect(r.dvy).toBeGreaterThan(r.dvx);
    expect(aerodynamicStep({atmosphereDensity:0,relativeAirX:10000,parachute:true}))
      .toEqual({dvx:0,dvy:0});
    expect(vacuumDivebombStep({airborne:true,divebomb:true,atmosphereDensity:0,power:1.4}).dvx)
      .toBeGreaterThan(r.dvx);
  });
});
