import { aerodynamicStep, canopyFuelStep, canopySailFactor } from '../../src/systems/BsodAerodynamics.js';

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
    const fast=aerodynamicStep({vx:700,airBrake:true});
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
    const fast=aerodynamicStep({vx:900,airBrake:true,stepMs:8});
    const stationary=aerodynamicStep({vx:0,airBrake:true,stepMs:8});
    expect(-fast.dvy).toBeGreaterThan(900*.8*.008); // normal airbrake gravity
    expect(stationary.dvy).toBe(0);
    const boost=aerodynamicStep({vx:900,airBrake:true,airbrakeLiftMul:1.3,stepMs:8});
    expect(boost.dvy).toBeLessThan(fast.dvy);
  });
  test('vacuum kills all aerodynamic force even during contact-danger', () => {
    expect(aerodynamicStep({vx:900,relativeAirX:1200,atmosphereDensity:0,parachute:true,airBrake:true})).toEqual({dvx:0,dvy:0});
  });
});
