/**
 * B0 effect plumbing: the pure math of every new hazard effect and power-up kind (spec §5 / §6 B0.4).
 * RunScene and PhysicsTuner only call these; tests/src/biome-effects-runscene.test.js covers the dispatch.
 */
import {
  emptyWards, addWard, tickWards, isWarded, wardMsLeft, WARD_MIN_MS, WARD_MAX_MS,
} from '../../src/systems/Wards.js';
import {
  GUST_MAX_PX_S, gustImpulse, BLIND_MIN_VISIBILITY, BLIND_DEFAULT_MS, blindVisibility, blindOverlayAlpha,
  glideFrictionMul, GLIDE_MIN_FRICTION_MUL, stabilizeToleranceDeg, STABILIZE_MAX_DEG, resolveLanding,
  hazardEffectDurationMs, hazardColorKey, hazardDrawKind, powerupDrawKind, timedPowerupMs,
} from '../../src/systems/BiomeEffects.js';
import { PhysicsTuner, TUNING } from '../../src/systems/PhysicsTuner.js';
import { PHYSICS } from '../../src/constants.js';
import { classifyLanding } from '../../src/systems/TrickTracker.js';
import { loadContent } from './_helpers.js';

const MODS = loadContent().terrainMods;

describe('Wards.js: isWarded(state, query)', () => {
  const ward = { kind: 'ward', durationMs: 4000, mods: ['stickyPatch'], hazards: ['fxGroundHazard'], effects: ['blind', 'scramble'] };

  test('an empty or missing state wards nothing', () => {
    expect(isWarded(emptyWards(), { modId: 'stickyPatch' })).toBe(false);
    expect(isWarded(null, { modId: 'stickyPatch' })).toBe(false);
    expect(isWarded(undefined, { effect: 'blind' })).toBe(false);
  });

  test('a ward answers for the mods, hazards and effects it lists, and nothing else', () => {
    const s = addWard(emptyWards(), 'slickWax', ward);
    expect(isWarded(s, { modId: 'stickyPatch' })).toBe(true);
    expect(isWarded(s, { modId: 'highBandwidth' })).toBe(false);
    expect(isWarded(s, { hazardId: 'fxGroundHazard' })).toBe(true);
    expect(isWarded(s, { hazardId: 'packetSpike' })).toBe(false);
    expect(isWarded(s, { effect: 'blind' })).toBe(true);
    expect(isWarded(s, { effect: 'scramble' })).toBe(true);
    expect(isWarded(s, { effect: 'slow' })).toBe(false);
    expect(isWarded(s, {})).toBe(false);
    expect(isWarded(s, null)).toBe(false);
  });

  test('addWard does not mutate its input, and re-collecting the same ward refreshes it instead of stacking', () => {
    const a = emptyWards();
    const b = addWard(a, 'slickWax', ward);
    expect(a.wards).toHaveLength(0);
    const c = tickWards(b, 1500).state;
    expect(wardMsLeft(c, 'slickWax')).toBe(2500);
    const d = addWard(c, 'slickWax', ward);
    expect(d.wards).toHaveLength(1);
    expect(wardMsLeft(d, 'slickWax')).toBe(4000);
  });

  test('ward durations are clamped to 4-6 s (spec §4)', () => {
    expect([WARD_MIN_MS, WARD_MAX_MS]).toEqual([4000, 6000]);
    expect(wardMsLeft(addWard(emptyWards(), 'a', { ...ward, durationMs: 100 }), 'a')).toBe(4000);
    expect(wardMsLeft(addWard(emptyWards(), 'a', { ...ward, durationMs: 60000 }), 'a')).toBe(6000);
    expect(wardMsLeft(addWard(emptyWards(), 'a', { ...ward, durationMs: 5000 }), 'a')).toBe(5000);
    expect(wardMsLeft(addWard(emptyWards(), 'a', { ...ward, durationMs: undefined }), 'a')).toBe(4000);
  });

  test('tickWards counts down and reports each expired id once', () => {
    let s = addWard(addWard(emptyWards(), 'a', ward), 'b', { ...ward, durationMs: 6000 });
    let r = tickWards(s, 3999);
    expect(r.expired).toEqual([]);
    s = r.state;
    r = tickWards(s, 1);
    expect(r.expired).toEqual(['a']);
    expect(isWarded(r.state, { modId: 'stickyPatch' })).toBe(true); // b still holds
    r = tickWards(r.state, 2000);
    expect(r.expired).toEqual(['b']);
    expect(isWarded(r.state, { modId: 'stickyPatch' })).toBe(false);
    expect(tickWards(r.state, 1000).expired).toEqual([]);
  });

  test('malformed ward lists are ignored, not thrown on', () => {
    const s = addWard(emptyWards(), 'x', { kind: 'ward', durationMs: 4000, mods: 'stickyPatch', hazards: null });
    expect(isWarded(s, { modId: 'stickyPatch' })).toBe(false);
  });
});

describe('PhysicsTuner skips warded mod ids; glide and stabilize reach the effective physics', () => {
  const t = new PhysicsTuner();
  const sticky = MODS.stickyPatch;
  const base = t.getEffective({});

  test('a ward vs stickyPatch makes the sticky zone feel like no zone at all', () => {
    const inSticky = t.getEffective({ zones: [sticky] });
    expect(inSticky.groundResist).toBeGreaterThan(base.groundResist);
    const wards = addWard(emptyWards(), 'slickWax', { durationMs: 4000, mods: ['stickyPatch'] });
    const warded = t.getEffective({ zones: [sticky], wards });
    expect(warded.groundResist).toBeCloseTo(base.groundResist, 12);
    // only the listed mod: a highBandwidth zone still applies under the same ward
    const hb = t.getEffective({ zones: [sticky, MODS.highBandwidth], wards });
    expect(hb.groundResist).toBeCloseTo(t.getEffective({ zones: [MODS.highBandwidth] }).groundResist, 12);
  });

  test('a ward vs slowMotion / conveyorBelt removes those mods too (B1 targets)', () => {
    const wards = addWard(emptyWards(), 'w', { durationMs: 4000, mods: ['slowMotion', 'conveyorBelt'] });
    const slow = t.getEffective({ zones: [MODS.slowMotion], wards });
    expect(slow.gravityPxS2).toBe(base.gravityPxS2);
    const belt = t.getEffective({ zones: [MODS.conveyorBelt], wards });
    expect(belt.beltDrivePxS2).toBe(0);
  });

  test('glide multiplies the ground friction (groundResist) by its frictionMul', () => {
    const g = t.getEffective({ glideFrictionMul: 0.7 });
    expect(g.groundResist).toBeCloseTo(base.groundResist * 0.7, 12);
    expect(t.getEffective({ glideFrictionMul: 1 }).groundResist).toBeCloseTo(base.groundResist, 12);
  });

  test('stabilize bounceMul scales bounce (and so restitution)', () => {
    const s = t.getEffective({ zones: [MODS.bouncySpring], stabilizeBounceMul: 0.5 });
    const n = t.getEffective({ zones: [MODS.bouncySpring] });
    expect(s.bounceMul).toBeCloseTo(n.bounceMul * 0.5, 12);
  });
});

describe('BiomeEffects.js: gust', () => {
  test('the impulse is the def vector when inside the 180 px/s bound', () => {
    expect(GUST_MAX_PX_S).toBe(180);
    expect(gustImpulse([120, -60])).toEqual({ dvx: 120, dvy: -60 });
  });

  test('a larger impulse is scaled down to 180 px/s, keeping its direction', () => {
    const g = gustImpulse([400, -300]);
    expect(Math.hypot(g.dvx, g.dvy)).toBeCloseTo(180, 9);
    expect(g.dvx / g.dvy).toBeCloseTo(400 / -300, 9);
  });

  test('malformed input is a zero impulse', () => {
    expect(gustImpulse(null)).toEqual({ dvx: 0, dvy: 0 });
    expect(gustImpulse([NaN, 5])).toEqual({ dvx: 0, dvy: 5 });
    expect(gustImpulse('x')).toEqual({ dvx: 0, dvy: 0 });
  });
});

describe('BiomeEffects.js: blind', () => {
  test('visibility never drops below 35 % (spec §4) and defaults sensibly', () => {
    expect(BLIND_MIN_VISIBILITY).toBe(0.35);
    expect(blindVisibility(0)).toBe(0.35);
    expect(blindVisibility(-3)).toBe(0.35);
    expect(blindVisibility(0.6)).toBe(0.6);
    expect(blindVisibility(2)).toBe(1);
    expect(blindVisibility(undefined)).toBeGreaterThanOrEqual(0.35);
    expect(blindVisibility(NaN)).toBeGreaterThanOrEqual(0.35);
  });

  test('the overlay alpha is at most 1 - 0.35 at every moment and 0 when the effect is over', () => {
    for (const vis of [0, 0.35, 0.4, 0.8]) {
      for (let left = -100; left <= 1300; left += 10) {
        const a = blindOverlayAlpha(left, 1200, vis);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1 - BLIND_MIN_VISIBILITY + 1e-12);
        if (left <= 0) expect(a).toBe(0);
      }
    }
    expect(blindOverlayAlpha(600, 1200, 0.4)).toBeCloseTo(0.6, 9); // mid-effect: full dim
  });

  test('the overlay is a pure function of time left (not seed-dependent, no randomness)', () => {
    expect(blindOverlayAlpha(500, 1200, 0.4)).toBe(blindOverlayAlpha(500, 1200, 0.4));
    expect(blindOverlayAlpha(500, 0, 0.4)).toBeGreaterThanOrEqual(0); // zero total never divides by zero
    expect(Number.isFinite(blindOverlayAlpha(500, 0, 0.4))).toBe(true);
  });
});

describe('BiomeEffects.js: glide, stabilize and landing', () => {
  test('glide frictionMul lowers friction, never raises it, never below the floor', () => {
    expect(glideFrictionMul(0.7)).toBe(0.7);
    expect(glideFrictionMul(1.4)).toBe(1);
    expect(glideFrictionMul(0)).toBe(GLIDE_MIN_FRICTION_MUL);
    expect(glideFrictionMul(undefined)).toBe(0.7);
  });

  test('stabilize tolerance is clamped to [0, STABILIZE_MAX_DEG]', () => {
    expect(stabilizeToleranceDeg(12)).toBe(12);
    expect(stabilizeToleranceDeg(-5)).toBe(0);
    expect(stabilizeToleranceDeg(90)).toBe(STABILIZE_MAX_DEG);
    expect(stabilizeToleranceDeg(undefined)).toBe(0);
  });

  test('without stabilize resolveLanding is exactly the old forgiveness rule', () => {
    const cases = [
      { quality: 'crash', angleDeg: 70, impactSpeedPxS: 400 },
      { quality: 'crash', angleDeg: 80, impactSpeedPxS: 400 },
      { quality: 'crash', angleDeg: 60, impactSpeedPxS: 1800 },
      { quality: 'good', angleDeg: 20, impactSpeedPxS: 300 },
      { quality: 'sloppy', angleDeg: 40, impactSpeedPxS: 300 },
    ];
    for (const l of cases) {
      const old = l.quality === 'crash' && Math.abs(l.angleDeg) <= TUNING.forgiveAngleDeg && l.impactSpeedPxS < TUNING.forgiveImpactPxS
        ? { ...l, quality: 'sloppy' } : l;
      expect(resolveLanding(l, 0)).toEqual(old);
    }
  });

  test('stabilize widens landing tolerance: a crash just past the forgiveness angle becomes a wobble, grades lift by the tolerance', () => {
    const crash = { quality: 'crash', angleDeg: TUNING.forgiveAngleDeg + 8, impactSpeedPxS: 400 };
    expect(resolveLanding(crash, 0).quality).toBe('crash');
    expect(resolveLanding(crash, 12).quality).not.toBe('crash');
    const sloppy = { quality: classifyLanding(36, 300).quality, angleDeg: 36, impactSpeedPxS: 300 };
    expect(sloppy.quality).toBe('sloppy');
    expect(resolveLanding(sloppy, 12).quality).toBe('good');
    // never worsens a landing, and never rescues a too-hard impact
    const perfect = { quality: 'perfect', angleDeg: 2, impactSpeedPxS: 300 };
    expect(resolveLanding(perfect, 12).quality).toBe('perfect');
    const slam = { quality: 'crash', angleDeg: 10, impactSpeedPxS: 1800 };
    expect(resolveLanding(slam, 12).quality).toBe('crash');
  });
});

describe('BiomeEffects.js: effect durations, colours and draw kinds', () => {
  test('base hazard durations are unchanged; gust is instantaneous; blind has a default', () => {
    expect(hazardEffectDurationMs({ effect: 'crash' })).toBe(0);
    expect(hazardEffectDurationMs({ effect: 'slow', durationMs: 1500 })).toBe(1500);
    expect(hazardEffectDurationMs({ effect: 'slow' })).toBe(1500);
    expect(hazardEffectDurationMs({ effect: 'scramble' })).toBe(PHYSICS.scrambleDurationMs);
    expect(hazardEffectDurationMs({ effect: 'scramble', durationMs: 2000 })).toBe(2000);
    expect(hazardEffectDurationMs({ effect: 'gust', durationMs: 999 })).toBe(0);
    expect(hazardEffectDurationMs({ effect: 'blind' })).toBe(BLIND_DEFAULT_MS);
    expect(hazardEffectDurationMs({ effect: 'blind', durationMs: 900 })).toBe(900);
  });

  test('timed power-up durations default per kind', () => {
    expect(timedPowerupMs({ kind: 'glide', durationMs: 3000 })).toBe(3000);
    expect(timedPowerupMs({ kind: 'glide' })).toBe(4000);
    expect(timedPowerupMs({ kind: 'stabilize' })).toBe(5000);
  });

  test('a biome crash hazard is always drawn in `danger`; base defs keep their own colorKey', () => {
    expect(hazardColorKey({ biome: 'space-mountain', onHit: { effect: 'crash' }, colorKey: 'magenta' })).toBe('danger');
    expect(hazardColorKey({ biome: 'space-mountain', colorKey: 'magenta' })).toBe('danger'); // no onHit = crash
    expect(hazardColorKey({ biome: 'crystal-cavern', onHit: { effect: 'blind' }, colorKey: 'cyan' })).toBe('cyan');
    expect(hazardColorKey({ id: 'glitchChasm', onHit: { effect: 'crash' }, colorKey: 'magenta' })).toBe('magenta');
    expect(hazardColorKey({ id: 'x' })).toBe('danger');
  });

  test('an unknown shapeKey draws the generic shape (never nothing)', () => {
    for (const k of ['chasm', 'firewall', 'spike', 'vent', 'drone']) expect(hazardDrawKind({ shapeKey: k })).toBe(k);
    expect(hazardDrawKind({ shapeKey: 'groomerCat' })).toBe('generic');
    expect(hazardDrawKind({})).toBe('generic');
    for (const k of ['clock', 'burst', 'shield']) expect(powerupDrawKind({ shapeKey: k })).toBe(k);
    expect(powerupDrawKind({ shapeKey: 'mapleWax' })).toBe('generic');
  });
});
