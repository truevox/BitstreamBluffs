import { PHYSICS } from '../../src/constants.js';
import { TUNING } from '../../src/systems/PhysicsTuner.js';
import { aerodynamicStep, airBrakeKickStep, canopyFuelStep, canopySailFactor, vacuumDivebombStep } from '../../src/systems/BsodAerodynamics.js';

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
  test('one AirBrake activation is a pair of IMMEDIATE kicks, not a sustained wing', () => {
    const r=airBrakeKickStep({vx:530,vy:150,decelFraction:PHYSICS.airBrakeDecel,
      liftBudgetFraction:TUNING.airBrakeLiftBudgetFraction,
      upwardRatio:TUNING.airBrakeKickUpRatio,maxUpPxS:TUNING.airBrakeKickUpCapPxS});
    expect(r.vx).toBeCloseTo(212,10);
    expect(r.spentSpeedPxS).toBeCloseTo(318,10);
    expect(r.vy).toBeCloseTo(-318,10); // already descending before pressing: visible upward launch
    expect(aerodynamicStep({vx:r.vx,vy:r.vy,airBrake:true,stepMs:8})).toEqual({dvx:0,dvy:0});
  });
  test('a near-wall tailwind pays for an actual emergency sail catch, not distant free thrust', () => {
    const args={vx:700,relativeAirX:600,parachute:true,stepMs:8};
    const far=aerodynamicStep({...args,proximity01:0});
    const close=aerodynamicStep({...args,proximity01:.95});
    expect(close.dvx).toBeGreaterThan(far.dvx*5);
    expect(aerodynamicStep({...args,relativeAirX:0,proximity01:1}).dvx).toBe(0);
  });
  test('kick is one-time and has NO sustained force, gravity reduction, or descent damping', () => {
    expect(TUNING).not.toHaveProperty('airBrakeGravityMul');
    expect(TUNING).not.toHaveProperty('airBrakeDescentDamp');
    expect(TUNING).not.toHaveProperty('airBrakeSpanMs');
    expect(TUNING).not.toHaveProperty('airBrakePaidLiftRatio');
    const r=airBrakeKickStep({vx:650,vy:-80,decelFraction:PHYSICS.airBrakeDecel,
      liftBudgetFraction:TUNING.airBrakeLiftBudgetFraction,
      upwardRatio:TUNING.airBrakeKickUpRatio,maxUpPxS:TUNING.airBrakeKickUpCapPxS});
    expect(r.vx).toBeCloseTo(260,10);
    expect(r.vy).toBeCloseTo(-420,10); // capped snap, then NORMAL GRAVITY
    expect(aerodynamicStep({vx:r.vx,vy:r.vy,airBrake:true,stepMs:1000})).toEqual({dvx:0,dvy:0});
  });
  test('one-shot kick independent of framerate and display step size', () => {
    const args={vx:530,vy:150,decelFraction:PHYSICS.airBrakeDecel,
      liftBudgetFraction:TUNING.airBrakeLiftBudgetFraction,
      upwardRatio:TUNING.airBrakeKickUpRatio,maxUpPxS:TUNING.airBrakeKickUpCapPxS};
    const out=airBrakeKickStep(args);
    for(const hz of [30,60,120,144]){
      expect(airBrakeKickStep({...args,stepMs:1000/hz})).toEqual(out);
    }
  });
  test('upgraded AirBrake Lift strengthens the same single kick without free forward momentum', () => {
    const args={vx:600,vy:240,decelFraction:PHYSICS.airBrakeDecel,
      liftBudgetFraction:TUNING.airBrakeLiftBudgetFraction,
      upwardRatio:TUNING.airBrakeKickUpRatio,maxUpPxS:TUNING.airBrakeKickUpCapPxS};
    const normal=airBrakeKickStep(args);
    const upgraded=airBrakeKickStep({...args,liftMul:1.3});
    expect(upgraded.vx).toBe(normal.vx);
    expect(upgraded.vy).toBeLessThan(normal.vy);
    expect(upgraded.vy).toBeGreaterThanOrEqual(-420);
  });
  test('vacuum and nearly stopped riders get no free vertical kick', () => {
    const v={vx:530,vy:350,decelFraction:PHYSICS.airBrakeDecel,
      liftBudgetFraction:TUNING.airBrakeLiftBudgetFraction,
      upwardRatio:TUNING.airBrakeKickUpRatio,maxUpPxS:TUNING.airBrakeKickUpCapPxS};
    expect(airBrakeKickStep({...v,atmosphereDensity:0})).toEqual({vx:530,vy:350,spentSpeedPxS:0});
    const stopped=airBrakeKickStep({...v,vx:20});
    expect(stopped.vy).toBe(350); // too little speed was paid to reset a high-speed fall
    expect(stopped.vx).toBeLessThan(20);
    expect(airBrakeKickStep({...v,atmosphereDensity:.1}).spentSpeedPxS)
      .toBeLessThan(airBrakeKickStep(v).spentSpeedPxS);
    expect(aerodynamicStep({atmosphereDensity:0,airBrake:true,relativeAirX:800}))
      .toEqual({dvx:0,dvy:0});
  });
  test('backward speed pays for the same two kicks without gaining absolute forward speed', () => {
    const r=airBrakeKickStep({vx:-600,vy:250,decelFraction:PHYSICS.airBrakeDecel});
    expect(r.vx).toBeCloseTo(-240,10);
    expect(r.vy).toBeLessThan(-300);
    expect(Math.abs(r.vx)).toBeLessThan(600);
  });
  test('already fast upward motion is not capped or slowed by AirBrake', () => {
    const r=airBrakeKickStep({vx:530,vy:-650,maxUpPxS:420});
    expect(r.vy).toBe(-650);
    expect(r.vx).toBeCloseTo(212,10);
  });
  test('stronger decel preserves exact vertical output from previous 40% braking for different speeds, atmospheres and upgrades', () => {
    expect(PHYSICS.airBrakeDecel).toBe(0.60);
    expect(TUNING.airBrakeLiftBudgetFraction).toBe(0.40);
    const oldFraction=0.40, newFraction=PHYSICS.airBrakeDecel;
    for(const vx of [0, 20, 63, 110, 530.6930808429843, 900, -110, -900]){
      for(const vy of [-700, -150, 0, 100, 350, 900]){
        for(const density of [0, .1, .5, 1]){
          for(const liftMul of [1, 1.15, 1.5]){
            const args={vx,vy,atmosphereDensity:density,liftMul,
              liftBudgetFraction:TUNING.airBrakeLiftBudgetFraction,
              upwardRatio:TUNING.airBrakeKickUpRatio,maxUpPxS:TUNING.airBrakeKickUpCapPxS};
            const before=airBrakeKickStep({...args,decelFraction:oldFraction});
            const after=airBrakeKickStep({...args,decelFraction:newFraction});
            expect(after.vy).toBe(before.vy);
            expect(Math.abs(after.vx)).toBeLessThanOrEqual(Math.abs(before.vx));
            expect(after.spentSpeedPxS).toBeGreaterThanOrEqual(before.spentSpeedPxS);
          }
        }
      }
    }
  });
  test('harder braking still does not create continuous lift when held', () => {
    const p=airBrakeKickStep({vx:600,vy:120,decelFraction:PHYSICS.airBrakeDecel,
      liftBudgetFraction:TUNING.airBrakeLiftBudgetFraction,
      upwardRatio:TUNING.airBrakeKickUpRatio});
    expect(p.vx).toBeCloseTo(240);
    expect(p.vy).toBeCloseTo(-360);
    expect(aerodynamicStep({vx:p.vx,vy:p.vy,airBrake:true,stepMs:100})).toEqual({dvx:0,dvy:0});
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
