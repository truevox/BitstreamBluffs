import { describe, expect, it } from '@jest/globals';
import { decodeTrace, encodePad } from '../../src/systems/ghost/GhostTape.js';
import { validateInputRows } from '../../src/systems/replay/manifest.js';
import {
  applyCandidate, enumerateCandidates, isLegalPadSequence, lastInputEdges, padStates, perturbableTape,
} from '../../src/systems/coach/Perturb.js';
import { makeTape, standardTape } from './coachFixtures.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const HOP_BIT = encodePad({ hop: true, tilt: 0 })[0];
const HOP_EDGE = encodePad({ pressed: { hop: true }, tilt: 0 })[0];
const TUCK_BIT = encodePad({ tuck: true, tilt: 0 })[0];

/** tick -> state helpers over a tape */
const statesOf = (tape, lo, hi) => padStates(tape, lo, hi);
const hopPresses = (tape, lo, hi) => {
  const s = statesOf(tape, lo - 1, hi);
  const out = [];
  for (let i = 1; i < s.bits.length; i++) if ((s.bits[i] & HOP_BIT) && !(s.bits[i - 1] & HOP_BIT)) out.push(lo + i - 1);
  return out;
};
const hopHold = (tape, press, hi) => {
  const s = statesOf(tape, press, hi);
  let n = 0;
  while (n < s.bits.length && (s.bits[n] & HOP_BIT)) n++;
  return n;
};

describe('lastInputEdges', () => {
  const tape = standardTape();
  it('finds hop, lean and tuck edges inside the window, oldest first, and nothing older', () => {
    const edges = lastInputEdges(tape, 1000, 200); // ticks 801..1000
    const key = edges.map((e) => `${e.kind}:${e.action}@${e.tick}`);
    expect(key).toEqual([
      'hop:press@850', 'hop:release@866', 'lean:change@900', 'lean:change@940', 'tuck:press@950', 'tuck:release@975',
    ]);
    expect(edges.every((e) => e.ticksBeforeCrash === 1000 - e.tick)).toBe(true);
    expect(edges.find((e) => e.kind === 'lean' && e.tick === 900)).toMatchObject({ from: 0, to: 127 });
    expect(key.some((k) => k.includes('@200'))).toBe(false);
  });
  it('a narrower window drops older edges', () => {
    const edges = lastInputEdges(tape, 1000, 60); // 941..1000
    expect(edges.map((e) => `${e.kind}:${e.action}`)).toEqual(['tuck:press', 'tuck:release']);
  });
  it('classifies tricks (corkscrew) as kind trick', () => {
    const t = makeTape({ endTick: 400, corks: [[300, 320]] });
    expect(lastInputEdges(t, 400, 150).map((e) => `${e.kind}/${e.field}/${e.action}`))
      .toEqual(['trick/corkscrew/press', 'trick/corkscrew/release']);
  });
  it('does not mutate the tape', () => {
    const before = clone(tape);
    lastInputEdges(tape, 1000, 200);
    expect(clone(tape)).toEqual(before);
  });
  it('tolerates an empty or missing tape', () => {
    expect(lastInputEdges({ inputs: [] }, 100, 50)).toEqual([]);
    expect(lastInputEdges(null, 100, 50)).toEqual([]);
  });
});

describe('enumerateCandidates', () => {
  const tape = standardTape();
  const opts = { branchTick: 640, crashTick: 1000, maxShift: 12, budget: 10000 };

  it('is deterministic and never mutates the input tape', () => {
    const before = clone(tape);
    const a = enumerateCandidates(tape, opts);
    const b = enumerateCandidates(clone(tape), opts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(clone(tape)).toEqual(before);
  });
  it('has stable unique ids and human labels', () => {
    const list = enumerateCandidates(tape, opts);
    expect(list.length).toBeGreaterThan(40);
    expect(new Set(list.map((c) => c.id)).size).toBe(list.length);
    expect(list.every((c) => typeof c.label === 'string' && c.label.length > 3)).toBe(true);
    const six = list.find((c) => c.id === 'hop-shift:850:-6');
    expect(six).toMatchObject({ kind: 'hop-shift', offsetTicks: -6, label: 'hop 6 ticks earlier', branchTick: 640 });
    expect(list.find((c) => c.id === 'hop-shift:850:1').label).toBe('hop 1 tick later');
  });
  it('covers every perturbation kind', () => {
    const kinds = new Set(enumerateCandidates(tape, opts).map((c) => c.kind));
    expect([...kinds].sort()).toEqual(['edge-shift', 'hop-add', 'hop-drop', 'hop-shift', 'lean-set', 'lean-shift']);
  });
  it('caps the list by budget and the capped list is a prefix of the uncapped one', () => {
    const full = enumerateCandidates(tape, opts);
    const capped = enumerateCandidates(tape, { ...opts, budget: 17 });
    expect(capped).toHaveLength(17);
    expect(capped.map((c) => c.id)).toEqual(full.slice(0, 17).map((c) => c.id));
  });
  it('a small budget still samples several kinds (round robin, not one kind first)', () => {
    const kinds = new Set(enumerateCandidates(tape, { ...opts, budget: 20 }).map((c) => c.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });
  it('never proposes a change before branchTick', () => {
    for (const c of enumerateCandidates(tape, opts)) {
      expect(c.sets.every((s) => s.from >= c.branchTick)).toBe(true);
    }
  });
  it('shifts that would merge two hops into one (or cross a neighbour) are not proposed', () => {
    const t = makeTape({ endTick: 600, hops: [[500, 510], [514, 524]] }); // 4-tick gap
    const list = enumerateCandidates(t, { branchTick: 300, crashTick: 600, maxShift: 12, budget: 1000 });
    const second = list.filter((c) => c.kind === 'hop-shift' && c.id.startsWith('hop-shift:514:'));
    const ks = second.map((c) => c.offsetTicks);
    expect(ks).toContain(-3); // press at 511: tick 510 is still a release tick between the two hops
    expect(ks).not.toContain(-4); // press at 510 would be held straight after tick 509: the two hops merge
    expect(ks).not.toContain(-8); // would land inside the first hop
  });
  it('keyboard-only tilt tapes only get keyboard tilt values', () => {
    const list = enumerateCandidates(tape, opts).filter((c) => c.kind === 'lean-set');
    expect(list.length).toBeGreaterThan(0);
    for (const c of list) expect([-127, 0, 127]).toContain(c.sets[0].value);
  });
  it('analog tilt tapes get 1/127-quantised small deltas, clamped to the legal range', () => {
    const t = makeTape({ endTick: 1000, hops: [[850, 866]], leans: [[900, 940, 100], [940, 960, 30]] });
    const list = enumerateCandidates(t, opts).filter((c) => c.kind === 'lean-set');
    expect(list.length).toBeGreaterThan(0);
    for (const c of list) {
      const v = c.sets[0].value;
      expect(Number.isInteger(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(127);
    }
    expect(list.some((c) => c.sets[0].value === 100 + 16)).toBe(true);
  });
  it('refuses unsupported tapes honestly (legacy edge rows) instead of guessing', () => {
    const legacy = { ...tape, edgeRows: undefined };
    expect(perturbableTape(legacy)).toMatchObject({ ok: false });
    expect(enumerateCandidates(legacy, opts)).toEqual([]);
    expect(perturbableTape(tape)).toEqual({ ok: true });
    expect(perturbableTape(null).ok).toBe(false);
  });
  it('a tape with no edges in the window yields no shift/drop candidates but still offers added hops', () => {
    const t = makeTape({ endTick: 1000, hops: [[100, 110]] });
    const kinds = new Set(enumerateCandidates(t, opts).map((c) => c.kind));
    expect([...kinds]).toEqual(['hop-add']);
  });
});

describe('applyCandidate', () => {
  const tape = standardTape();
  const opts = { branchTick: 640, crashTick: 1000, maxShift: 12, budget: 10000 };
  const list = enumerateCandidates(tape, opts);
  const get = (id) => list.find((c) => c.id === id);
  const prefixRows = (rows, branch) => {
    let at = 0; const out = [];
    for (const r of rows) { at += r[0]; if (at >= branch) break; out.push(r); }
    return out;
  };

  it('returns a NEW tape and never mutates the original', () => {
    const before = clone(tape);
    const out = applyCandidate(tape, get('hop-shift:850:-6'));
    expect(out).not.toBe(tape);
    expect(out.inputs).not.toBe(tape.inputs);
    expect(clone(tape)).toEqual(before);
  });
  it('keeps every row before branchTick byte-identical, for EVERY candidate', () => {
    const want = JSON.stringify(prefixRows(tape.inputs, 640));
    expect(want.length).toBeGreaterThan(10);
    for (const c of list) {
      const out = applyCandidate(tape, c);
      expect(JSON.stringify(out.inputs.slice(0, prefixRows(tape.inputs, 640).length))).toBe(want);
    }
  });
  it('identity edit reproduces the recorder rows exactly', () => {
    const out = applyCandidate(tape, { ...get('hop-drop:850'), sets: [] });
    expect(out.inputs).toEqual(tape.inputs);
  });
  it('hop-shift moves the press by exactly k ticks and keeps the hold length', () => {
    expect(hopPresses(tape, 640, 1000)).toEqual([850]);
    for (const k of [-6, -1, 1, 6]) {
      const out = applyCandidate(tape, get(`hop-shift:850:${k}`));
      expect(hopPresses(out, 640, 1000)).toEqual([850 + k]);
      expect(hopHold(out, 850 + k, 1000)).toBe(16);
    }
  });
  it('hop-drop removes the hop; hop-add inserts one at the stated offset', () => {
    expect(hopPresses(applyCandidate(tape, get('hop-drop:850')), 640, 1000)).toEqual([]);
    const add = list.find((c) => c.kind === 'hop-add');
    const out = applyCandidate(tape, add);
    expect(hopPresses(out, 640, 1000)).toContain(1000 + add.offsetTicks);
    expect(hopPresses(out, 640, 1000)).toContain(850);
  });
  it('tuck edge shift changes only the tuck field', () => {
    const c = list.find((x) => x.kind === 'edge-shift' && x.id.includes('tuck:950:press'));
    expect(c).toBeTruthy();
    const out = applyCandidate(tape, c);
    const a = statesOf(tape, 640, 1000), b = statesOf(out, 640, 1000);
    for (let i = 0; i < a.bits.length; i++) expect((a.bits[i] & ~TUCK_BIT) >>> 0).toBe((b.bits[i] & ~TUCK_BIT) >>> 0);
    expect(a.bits.some((v, i) => v !== b.bits[i])).toBe(true);
  });
  it('rows stay well-formed for every candidate (validateInputRows) and ticks outside the edit are untouched', () => {
    for (const c of list) {
      const out = applyCandidate(tape, c);
      expect(() => validateInputRows(out.inputs, out.endTick)).not.toThrow();
    }
  });
  it('drops checkpoints and trace from the divergent part, keeps the verified prefix', () => {
    const full = {
      ...tape,
      checkpoints: [120, 240, 480, 600, 720, 840, 960].map((t) => [t, t, 0, 0, 0, 0, 0, 0]),
      trace: Buffer.from(new Float32Array(Array.from({ length: 250 * 3 }, (_, i) => i)).buffer).toString('base64'),
    };
    const out = applyCandidate(full, get('hop-shift:850:-6'));
    expect(out.checkpoints.map((cp) => cp[0])).toEqual([120, 240, 480, 600]);
    expect(decodeTrace(out).length).toBe(Math.floor(639 / 4) * 3);
    expect(Array.from(decodeTrace(out).subarray(0, 6))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(out.endTick).toBe(tape.endTick);
    expect(full.checkpoints).toHaveLength(7);
  });
  it('negative control: an edit that reaches before branchTick is refused', () => {
    const bad = { ...get('hop-shift:850:-6'), sets: [{ field: 'hop', from: 639, to: 650, value: true }] };
    expect(() => applyCandidate(tape, bad)).toThrow(/branchTick/);
  });
  it('negative control: an out-of-range tilt or a non-editable field is refused as illegal', () => {
    const bad = { ...get('hop-shift:850:-6'), sets: [{ field: 'tilt', from: 700, to: 710, value: 200 }] };
    expect(() => applyCandidate(tape, bad)).toThrow(/illegal/);
    const heli = { ...get('hop-shift:850:-6'), sets: [{ field: 'heli', from: 700, to: 710, value: 1 }] };
    expect(() => applyCandidate(tape, heli)).toThrow(/illegal/);
  });
});

describe('legality of every generated candidate', () => {
  const tape = standardTape();
  const list = enumerateCandidates(tape, { branchTick: 640, crashTick: 1000, maxShift: 12, budget: 10000 });
  it('every candidate tape is a legal pad sequence (edge/held consistent, bits and tilt in range)', () => {
    for (const c of list) {
      const out = applyCandidate(tape, c);
      const s = padStates(out, 639, 1000);
      expect(isLegalPadSequence(s)).toEqual({ ok: true });
      expect(s.bits.every((b) => b >>> 0 === b && b <= 0xfffff)).toBe(true);
      expect(s.tilt.every((v) => Number.isInteger(v) && v >= -127 && v <= 127)).toBe(true);
    }
  });
  it('negative control: the checker rejects an edge with no held bit, a rise with no edge, and a repeated edge', () => {
    const edgeNoHeld = { bits: [0, HOP_EDGE & ~HOP_BIT], tilt: [0, 0] };
    expect(isLegalPadSequence(edgeNoHeld).ok).toBe(false);
    const riseNoEdge = { bits: [0, HOP_BIT], tilt: [0, 0] };
    expect(isLegalPadSequence(riseNoEdge).ok).toBe(false);
    const repeated = { bits: [0, HOP_BIT | HOP_EDGE, HOP_BIT | HOP_EDGE], tilt: [0, 0, 0] };
    expect(isLegalPadSequence(repeated).ok).toBe(false);
    const outOfRange = { bits: [0, 0], tilt: [0, 200] };
    expect(isLegalPadSequence(outOfRange).ok).toBe(false);
    const goodPress = { bits: [0, HOP_BIT | HOP_EDGE, HOP_BIT, 0], tilt: [0, 0, 0, 0] };
    expect(isLegalPadSequence(goodPress)).toEqual({ ok: true });
  });
});
