/**
 * Micro Mountain glow-up: the real Sled draw path draws the Neon Sled Drone when the look says so.
 *
 * Sled.js is a Phaser entity; like cosmetics-complete, this drives its `_draw` on a bare prototype with a
 * recording Graphics, so the drone is checked on the code that paints the screen, not on the resolver alone.
 */
import fs from 'fs';
import { jest } from '@jest/globals';

jest.unstable_mockModule('phaser', () => ({
  default: { Physics: { Matter: { Matter: { Bodies: {}, Body: { getVelocity: () => ({ x: 0, y: 0 }) } } } } },
}));

const { resolveCosmetics, COSMETIC_HUES } = await import('../../src/systems/Cosmetics.js');
const { Sled } = await import('../../src/entities/Sled.js');

const PALETTES = JSON.parse(fs.readFileSync('src/data/palettes.json', 'utf8'));
const ints = (hex) => Object.fromEntries(Object.entries(hex).map(([k, v]) => [k, parseInt(v.slice(1), 16)]));
const HEX = PALETTES.default;
const INTS = ints(HEX);
const CB = PALETTES.colorblind;
const CB_INTS = ints(CB);
const int = (h) => parseInt(h.slice(1), 16);
const DRONE_LOOK = resolveCosmetics({ equipped: { rider: 'drone' } }, INTS, HEX);

/** A Graphics stand-in that records every call with its arguments. */
function recordingGfx() {
  const calls = [];
  const g = new Proxy({}, { get: (_, k) => (k === 'calls' ? calls : (...a) => { calls.push([k, ...a]); return g; }) });
  return g;
}

function drawSled(look, { palette = INTS, time = 0, pose = {}, scrambled = false } = {}) {
  const s = Object.create(Sled.prototype);
  Object.assign(s, {
    gfx: recordingGfx(), palette, look,
    body: { angle: 0, position: { x: 100, y: 100 } }, off: { x: 0, y: 0 },
    heliPhase: 0, heliVel: 0, squash: 0, pose: { chute: 0, phi: 10, tuck: 0, brake: 0, ...pose },
    invulnerableMs: 0, _time: time, scrambled, shield: false, msSinceContact: 0, heliInput: 0,
  });
  s._draw();
  return s;
}
const colours = (s) => s.gfx.calls.filter((c) => c[0] === 'fillStyle' || c[0] === 'lineStyle').map((c) => (c[0] === 'fillStyle' ? c[1] : c[2]));
// The neon rider's helmet: an amber disc of radius 4.6 (Sled._draw). The drone has no helmet.
const helmets = (s) => s.gfx.calls.filter((c) => c[0] === 'fillCircle' && c[3] === 4.6).length;

describe('Neon Sled Drone: Sled draws it', () => {
  test('the default look draws the neon rider (helmet) and records shape default', () => {
    const s = drawSled(null);
    expect(s.lastRiderShape).toBe('default');
    expect(helmets(s)).toBe(1);
  });

  test('the drone look draws the drone instead of the rider, in its own frame colour', () => {
    const s = drawSled(DRONE_LOOK);
    expect(s.lastRiderShape).toBe('drone');
    expect(helmets(s)).toBe(0);
    expect(colours(s)).toContain(int(COSMETIC_HUES.rider.drone.color));
    // Two rotor discs, each a closed ring of points, and a blinking light on each rotor arm.
    expect(s.drone.rotors).toHaveLength(2);
    expect(s.drone.lights).toHaveLength(2);
  });

  test('the rotor lights blink from sled time, alternating between the two arms', () => {
    const a = drawSled(DRONE_LOOK, { time: 0 }).drone.lights.map((l) => l.on);
    const b = drawSled(DRONE_LOOK, { time: 260 }).drone.lights.map((l) => l.on);
    expect(a[0]).not.toBe(a[1]);
    expect(b).toEqual([!a[0], !a[1]]);
  });

  test('the rotor blades turn from sled time', () => {
    const a = drawSled(DRONE_LOOK, { time: 0 }).drone.rotors[0].blade;
    const b = drawSled(DRONE_LOOK, { time: 40 }).drone.rotors[0].blade;
    expect(a).not.toEqual(b);
  });

  test('colourblind: the drone is drawn in palette colours only (no cosmetic hue)', () => {
    const look = resolveCosmetics({ equipped: { rider: 'drone' } }, CB_INTS, CB, { colorblind: true });
    const s = drawSled(look, { palette: CB_INTS });
    expect(s.lastRiderShape).toBe('drone');
    const allowed = new Set(Object.values(CB_INTS));
    for (const c of colours(s)) expect(allowed.has(c)).toBe(true);
    expect(colours(s)).not.toContain(CB_INTS.danger);
  });

  test('never drawn in the hazard colour', () => {
    expect(colours(drawSled(DRONE_LOOK))).not.toContain(INTS.danger);
  });

  test('a scramble still overrides the frame colour, as it does for the rider', () => {
    const s = drawSled(DRONE_LOOK, { scrambled: true });
    expect(colours(s)).not.toContain(int(COSMETIC_HUES.rider.drone.color));
  });
});
