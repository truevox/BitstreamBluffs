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
  test('vacuum kills all aerodynamic force even during contact-danger', () => {
    expect(aerodynamicStep({vx:900,relativeAirX:1200,atmosphereDensity:0,parachute:true,airBrake:true})).toEqual({dvx:0,dvy:0});
  });
});
