import { describe, expect, it } from '@jest/globals';
import { explainCrash } from '../../src/systems/coach/CrashCause.js';
import { lastInputEdges } from '../../src/systems/coach/Perturb.js';
import { BANNED, standardTape } from './coachFixtures.js';

const crash = (over = {}) => ({
  runId: 'r1', seed: 'coach-seed', biomeMask: 0, x: 4200, distM: 301, cause: 'hazard', hazardId: 'packetSpike',
  name: 'PACKET SPIKE', verdict: 'HOP WAS 0.21 S LATE', line: 'PACKET SPIKE AT 301 M - HOP WAS 0.21 S LATE', ...over,
});
const dig = (o, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);

describe('explainCrash', () => {
  const tape = standardTape();
  const input = { lastCrash: crash(), crashTick: 1000, tape, sledAtCrash: { angle: 0.5, vx: 600, vy: 80, angularVelocity: 0.1 } };

  it('names the cause and hazard and cites the field behind every claim', () => {
    const out = explainCrash(input);
    expect(out.cause).toBe('hazard');
    expect(out.hazardId).toBe('packetSpike');
    expect(out.claims.length).toBeGreaterThanOrEqual(4);
    for (const c of out.claims) {
      expect(typeof c.text).toBe('string');
      expect(c.text.length).toBeGreaterThan(5);
      expect(c.evidence).toBeTruthy();
      expect(typeof c.evidence.field).toBe('string');
      expect(c.evidence.value).not.toBeUndefined();
      expect(c.evidence.value).not.toBeNull();
    }
  });
  it('every non-tape evidence value is EXACTLY the value found at the cited field of the input', () => {
    const out = explainCrash(input);
    const cited = out.claims.filter((c) => !c.evidence.field.startsWith('tape.'));
    expect(cited.length).toBeGreaterThanOrEqual(4);
    for (const c of cited) expect(dig(input, c.evidence.field)).toEqual(c.evidence.value);
  });
  it('tape claims cite a real input edge (tick) of the tape', () => {
    const out = explainCrash(input);
    const tapeClaims = out.claims.filter((c) => c.evidence.field === 'tape.inputs');
    expect(tapeClaims.length).toBeGreaterThanOrEqual(2);
    const edges = lastInputEdges(tape, 1000, 240);
    for (const c of tapeClaims.filter((x) => x.evidence.value.tick !== undefined)) {
      expect(edges.some((e) => e.tick === c.evidence.value.tick)).toBe(true);
      expect(c.evidence.value.ticksBeforeCrash).toBe(1000 - c.evidence.value.tick);
    }
  });
  it('words the hop verdict from hopTiming: late = after the window closed, early = before it opened', () => {
    const late = explainCrash(input).claims.find((c) => c.evidence.field === 'lastCrash.verdict');
    expect(late.text).toMatch(/0\.21 s after the ideal hop window (had )?closed/i);
    const early = explainCrash({ ...input, lastCrash: crash({ verdict: 'HOP WAS 0.40 S EARLY' }) }).claims.find((c) => c.evidence.field === 'lastCrash.verdict');
    expect(early.text).toMatch(/0\.40 s before the ideal hop window opened/i);
    const none = explainCrash({ ...input, lastCrash: crash({ verdict: 'NO HOP' }) }).claims.find((c) => c.evidence.field === 'lastCrash.verdict');
    expect(none.text).toMatch(/no hop/i);
    const on = explainCrash({ ...input, lastCrash: crash({ verdict: 'HOP WAS ON TIME' }) }).claims.find((c) => c.evidence.field === 'lastCrash.verdict');
    expect(on.text).toMatch(/inside the ideal hop window/i);
  });
  it('reports the last hop and lean relative to the crash, from the tape', () => {
    const texts = explainCrash(input).claims.map((c) => c.text).join('\n');
    expect(texts).toMatch(/last hop press was 1\.25 s/); // 150 ticks at 120 Hz
    expect(texts).toMatch(/last lean change/i);
  });
  it('missing data yields fewer claims, never invented ones', () => {
    const bare = explainCrash({ lastCrash: { cause: 'terrain' }, crashTick: 1000 });
    expect(bare.cause).toBe('terrain');
    expect(bare.hazardId).toBeNull();
    expect(bare.claims).toHaveLength(1);
    expect(bare.claims[0].evidence).toEqual({ field: 'lastCrash.cause', value: 'terrain' });

    const nothing = explainCrash({});
    expect(nothing).toEqual({ cause: null, hazardId: null, claims: [] });
    expect(explainCrash({ lastCrash: null, crashTick: 5, tape: null })).toEqual({ cause: null, hazardId: null, claims: [] });

    const noVerdict = explainCrash({ lastCrash: crash({ verdict: '', distM: undefined, hazardId: null }), crashTick: 1000 });
    expect(noVerdict.claims.some((c) => c.evidence.field === 'lastCrash.verdict')).toBe(false);
    expect(noVerdict.claims.some((c) => c.evidence.field === 'lastCrash.distM')).toBe(false);
    expect(noVerdict.claims.some((c) => c.evidence.field === 'lastCrash.hazardId')).toBe(false);

    const badAngle = explainCrash({ lastCrash: crash({ cause: 'terrain', verdict: '' }), crashTick: 1000, sledAtCrash: { angle: NaN } });
    expect(badAngle.claims.some((c) => c.evidence.field.startsWith('sledAtCrash'))).toBe(false);
  });
  it('only terrain and bad landings get an impact-angle claim; it accepts the sledState array too', () => {
    expect(explainCrash(input).claims.some((c) => c.evidence.field === 'sledAtCrash.angle')).toBe(false); // hazard crash
    const t = explainCrash({ ...input, lastCrash: crash({ cause: 'terrain', hazardId: null, verdict: '' }) });
    const a = t.claims.find((c) => c.evidence.field === 'sledAtCrash.angle');
    expect(a.text).toMatch(/29 degrees/);
    const arr = explainCrash({ lastCrash: crash({ cause: 'badLanding', hazardId: null, verdict: '' }), crashTick: 1000, sledAtCrash: [10, 20, 1.0, 5, 6, 0, 99] });
    expect(arr.claims.find((c) => c.evidence.field === 'sledAtCrash.angle').text).toMatch(/57 degrees/);
  });
  it('without a tape or with an unperturbable one it makes no tape claims', () => {
    const out = explainCrash({ ...input, tape: { ...tape, edgeRows: undefined } });
    expect(out.claims.some((c) => c.evidence.field === 'tape.inputs')).toBe(false);
  });
  it('is pure: no mutation, identical output twice, no banned wording', () => {
    const snap = JSON.stringify(input);
    const a = explainCrash(input);
    expect(JSON.stringify(input)).toBe(snap);
    expect(JSON.stringify(explainCrash(input))).toBe(JSON.stringify(a));
    expect(JSON.stringify(a)).not.toMatch(BANNED);
  });
});
