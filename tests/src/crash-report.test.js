/**
 * Readable Chaos, phase 3: death legibility. Pure rules (systems/CrashReport.js): who killed the run, how the hop was
 * timed against the telegraph's own ideal-hop window, the Game Over header line, the crash beat schedule, and where the
 * DIED HERE marker stands on a same-seed retry.
 */
import {
  CRASH_BEAT, killerName, hopTiming, verdictText, crashReport, crashBeat, deathMarkerX,
} from '../../src/systems/CrashReport.js';
import { GROUND_WARN } from '../../src/systems/HazardTelegraph.js';
import { loadContent } from './_helpers.js';

const DEFS = loadContent().hazards;

describe('killerName: every crash names its killer', () => {
  test('crash hazards are named from their id (no def has a display name)', () => {
    expect(killerName('hazard', DEFS.packetSpike)).toBe('PACKET SPIKE');
    expect(killerName('hazard', DEFS.glitchChasm)).toBe('GLITCH CHASM');
    expect(killerName('hazard', DEFS.rollingBoulder)).toBe('ROLLING BOULDER');
    expect(killerName('hazard', DEFS.dewDrop)).toBe('DEW DROP');
    expect(killerName('hazard', DEFS.gearGate)).toBe('GEAR GATE');
    expect(killerName('hazard', DEFS.roguePacket)).toBe('ROGUE PACKET');
    expect(killerName('hazard', DEFS.seagullDive)).toBe('SEAGULL DIVE');
    expect(killerName('hazard', { id: 'x', name: 'Neon Thing', onHit: { effect: 'crash' } })).toBe('NEON THING');
  });
  test('every shipped crash hazard gets a name; a hazard that cannot kill is never named (blind, slow, scramble)', () => {
    for (const d of Object.values(DEFS)) {
      const crashes = !d.onHit || d.onHit.effect === 'crash';
      if (crashes) expect(killerName('hazard', d)).toMatch(/^[A-Z][A-Z ]+$/);
      else expect(killerName('hazard', d)).toBe('CRASH');
    }
    expect(killerName('hazard', DEFS.shatterWall)).toBe('CRASH');
    expect(killerName('hazard', DEFS.ashCloud)).toBe('CRASH');
  });
  test('non-hazard causes', () => {
    expect(killerName('terrain')).toBe('HEAD FIRST');
    expect(killerName('badLanding')).toBe('BAD LANDING');
    expect(killerName('chasm')).toBe('FELL INTO THE VOID');
    expect(killerName('hazard', null)).toBe('CRASH');
    expect(killerName(undefined)).toBe('CRASH');
  });
});

describe('hopTiming: against the telegraph ideal-hop window', () => {
  // arrival at 10 000 ms: window opens at 10 000 - 380 = 9620, closes at 9620 + 250 = 9870
  const A = 10000;
  const open = A - GROUND_WARN.hopLeadMs;
  const close = open + GROUND_WARN.hopWindowMs;
  test('no hop at all, or the last hop long before the window: none', () => {
    expect(hopTiming(null, A)).toEqual({ kind: 'none', s: 0 });
    expect(hopTiming(open - 1001, A)).toEqual({ kind: 'none', s: 0 });
  });
  test('late: seconds after the window closed', () => {
    expect(hopTiming(close + 210, A)).toEqual({ kind: 'late', s: 0.21 });
    expect(hopTiming(close + 1, A).kind).toBe('late');
  });
  test('early: seconds before the window opened (up to 1 s)', () => {
    expect(hopTiming(open - 100, A)).toEqual({ kind: 'early', s: 0.1 });
    expect(hopTiming(open - 1000, A).kind).toBe('early');
  });
  test('inside the window: on time', () => {
    expect(hopTiming(open, A).kind).toBe('onTime');
    expect(hopTiming(close, A).kind).toBe('onTime');
  });
  test('verdict text', () => {
    expect(verdictText({ kind: 'none', s: 0 })).toBe('NO HOP');
    expect(verdictText({ kind: 'late', s: 0.21 })).toBe('HOP WAS 0.21 S LATE');
    expect(verdictText({ kind: 'early', s: 0.1 })).toBe('HOP WAS 0.10 S EARLY');
    expect(verdictText({ kind: 'onTime', s: 0 })).toBe('HOP WAS ON TIME');
  });
});

describe('crashReport: the Game Over line and the registry payload', () => {
  const base = { seed: 's1', biomeMask: 4, startX: 100, pxPerMeter: 20, crashMs: 10000 };
  test('a hazard crash: name, distance, hop verdict from the telegraph arrival', () => {
    const r = crashReport({ ...base, cause: 'hazard', def: DEFS.packetSpike, x: 100 + 301.6 * 20, lastHopMs: 10000 - 130 + 210, arrivalMs: 10000 });
    expect(r).toMatchObject({ seed: 's1', biomeMask: 4, x: 100 + 301.6 * 20, distM: 301, cause: 'hazard', hazardId: 'packetSpike', name: 'PACKET SPIKE', verdict: 'HOP WAS 0.21 S LATE' });
    expect(r.line).toBe('PACKET SPIKE AT 301 M - HOP WAS 0.21 S LATE');
  });
  test('the arrival falls back to the crash time when the telegraph never planned one', () => {
    const r = crashReport({ ...base, cause: 'hazard', def: DEFS.glitchChasm, x: 2100, lastHopMs: null, arrivalMs: null });
    expect(r.line).toBe('GLITCH CHASM AT 100 M - NO HOP');
    const r2 = crashReport({ ...base, cause: 'hazard', def: DEFS.glitchChasm, x: 2100, lastHopMs: 10000 - 380 - 50, arrivalMs: undefined });
    expect(r2.verdict).toBe('HOP WAS 0.05 S EARLY');
  });
  test('a non-hazard crash has no hop verdict', () => {
    const r = crashReport({ ...base, cause: 'badLanding', x: 2100, lastHopMs: 9000, arrivalMs: null });
    expect(r).toMatchObject({ name: 'BAD LANDING', verdict: '', hazardId: null });
    expect(r.line).toBe('BAD LANDING AT 100 M');
  });
  test('a non-killing def is never named, even if a caller passes one', () => {
    const r = crashReport({ ...base, cause: 'hazard', def: DEFS.shatterWall, x: 2100, lastHopMs: null, arrivalMs: null });
    expect(r.name).toBe('CRASH');
    expect(r.verdict).toBe('');
  });
  test('distance never negative', () => {
    expect(crashReport({ ...base, cause: 'terrain', x: 50 }).distM).toBe(0);
  });
});

describe('crashBeat: 400 ms at 0.25x after the hit-stop, with an eased zoom-in that holds', () => {
  test('schedule', () => {
    expect(CRASH_BEAT).toMatchObject({ slowMs: 400, slowScale: 0.25 });
    expect(crashBeat(10, 70).fxScale).toBe(0.08); // the existing hit-stop
    expect(crashBeat(70, 70).fxScale).toBe(0.25);
    expect(crashBeat(469, 70).fxScale).toBe(0.25);
    expect(crashBeat(470, 70).fxScale).toBe(1);
    expect(crashBeat(0, 70).zoomMul).toBe(1);
    expect(crashBeat(270, 70).zoomMul).toBeGreaterThan(1);
    expect(crashBeat(470, 70).zoomMul).toBeCloseTo(1 + CRASH_BEAT.zoomIn, 9);
    expect(crashBeat(900, 70).zoomMul).toBeCloseTo(1 + CRASH_BEAT.zoomIn, 9);
    let prev = 1;
    for (let t = 0; t <= 900; t += 10) { const z = crashBeat(t, 70).zoomMul; expect(z).toBeGreaterThanOrEqual(prev); prev = z; }
  });
  test('the beat fits inside the crash-to-Game-Over time (the total is unchanged)', () => {
    expect(70 + CRASH_BEAT.slowMs).toBeLessThan(950);
  });
});

describe('deathMarkerX: DIED HERE only on a same-seed, same-mask retry', () => {
  const lc = { seed: 'abc', biomeMask: 4, x: 6100, distM: 300 };
  test('same seed and mask: the death x', () => {
    expect(deathMarkerX(lc, 'abc', 4)).toBe(6100);
  });
  test('other seed, other mask, nothing stored, or junk: none', () => {
    expect(deathMarkerX(lc, 'abd', 4)).toBe(null);
    expect(deathMarkerX(lc, 'abc', 0)).toBe(null);
    expect(deathMarkerX(null, 'abc', 4)).toBe(null);
    expect(deathMarkerX({ seed: 'abc', biomeMask: 4, x: NaN }, 'abc', 4)).toBe(null);
  });
  test('an absent mask reads as 0 on both sides', () => {
    expect(deathMarkerX({ seed: 'abc', x: 900 }, 'abc', 0)).toBe(900);
    expect(deathMarkerX({ seed: 'abc', biomeMask: 0, x: 900 }, 'abc', undefined)).toBe(900);
  });
});
