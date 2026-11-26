/**
 * #66 Crash Coach: legal input perturbations of a ghost tape. NO Phaser, no clock, no randomness: every function here is
 * pure and deterministic, and none mutates the tape it is given.
 *
 * A tape stores pad rows `[tickDelta, bits, tilt127]` (GhostTape.js). This module reads them tick by tick, proposes small
 * edits near the end of the run (hop earlier/later, no hop, an extra hop, a different lean, an edge of tuck/trick moved)
 * and builds a NEW tape for each edit, re-encoded the way GhostRecorder writes rows (dedup, every-tick edge rows).
 *
 * "Legal" = a pad a real player could produce, in the encodePad bit semantics:
 *  - a one-shot edge bit (hop, reset, pause, airBrake, parachute) appears exactly on the tick its held bit rises, and
 *    nowhere else; a held bit that rises always carries its edge;
 *  - tilt is an integer in [-127, 127]; bits stay inside the 20 defined bits;
 *  - a tape recorded with keyboard tilt only (-1/0/1) only ever gets keyboard tilt values.
 * Limits (reported to the caller, never papered over): only tapes with `edgeRows: 'every-tick'` are perturbed (legacy
 * tapes lost repeated edges, so the pad of a tick is not recoverable), `heli` is never edited, and the held-pad tail after
 * `endTick` is whatever the last row says (the tape has no inputs after the crash).
 */
import { encodePad, decodeTrace, TRACE_EVERY } from '../ghost/GhostTape.js';

/** Fields that have a held bit and a one-shot edge bit. */
const EDGE_HELD_FIELDS = Object.freeze(['hop', 'reset', 'pause', 'airBrake', 'parachute']);
/** Held-only boolean fields a candidate may edit. */
const EDITABLE_FIELDS = Object.freeze(['hop', 'tuck', 'divebomb', 'corkscrew', 'airBrake', 'parachute']);
const TRICK_FIELDS = Object.freeze(['divebomb', 'corkscrew', 'airBrake', 'parachute']);

// Bit masks come from encodePad itself, so this file never duplicates the bit layout.
const HELD_BIT = {};
const EDGE_BIT = {};
for (const f of new Set([...EDGE_HELD_FIELDS, ...EDITABLE_FIELDS])) HELD_BIT[f] = encodePad({ [f]: true, tilt: 0 })[0];
for (const f of EDGE_HELD_FIELDS) EDGE_BIT[f] = encodePad({ pressed: { [f]: true }, tilt: 0 })[0];
const EDGE_MASK = encodePad({ pressed: { hop: 1, reset: 1, pause: 1, airBrake: 1, parachute: 1, confirm: 1 }, tilt: 0 })[0];
const BITS_MAX = 0xfffff;

/** Where an extra hop may be added, in ticks before the crash. */
export const ADD_HOP_OFFSETS = Object.freeze([-120, -90, -60, -45, -30, -20, -12]);
/** Analog tilt tweaks, in 1/127 units, smallest first. */
export const TILT_DELTAS_127 = Object.freeze([-16, 16, -48, 48]);
const KEYBOARD_TILTS = Object.freeze([-127, 0, 127]);
const DEFAULT_HOP_HOLD_TICKS = 12;
/** Candidates taken from each group per round-robin round (hop timing is the main lever, so it gets the most). */
const ROUND_WEIGHTS = Object.freeze({ 'hop-shift': 4, 'hop-drop': 1, 'hop-add': 1, 'edge-shift': 1, 'lean-shift': 1, 'lean-set': 1 });
const GROUP_ORDER = Object.freeze(['hop-shift', 'hop-drop', 'hop-add', 'edge-shift', 'lean-shift', 'lean-set']);

const isInt = (v) => typeof v === 'number' && Number.isSafeInteger(v);
const plural = (n) => `${n} tick${n === 1 ? '' : 's'}`;

/** Can this tape be perturbed faithfully? @returns {{ok:true}|{ok:false, reason:string}} */
export function perturbableTape(tape) {
  if (!tape || typeof tape !== 'object' || !Array.isArray(tape.inputs)) return { ok: false, reason: 'the tape has no input rows' };
  if (!isInt(tape.endTick) || tape.endTick < 1) return { ok: false, reason: 'the tape has no end tick' };
  if (tape.edgeRows !== 'every-tick') return { ok: false, reason: 'this tape predates exact edge rows, so its pad cannot be rebuilt tick by tick' };
  return { ok: true };
}

/** Last tick any row can apply to. */
function lastTickOf(tape) {
  let at = 0;
  for (const r of tape.inputs) at += r[0];
  return Math.max(tape.endTick | 0, at);
}

/**
 * Per-tick pad bits and tilt for ticks lo..hi (index i is tick lo + i). A one-shot edge bit lives only on the tick of its
 * row, exactly as TapePlayer.padAt serves it; ticks before the first row are the neutral pad.
 * @returns {{lo:number, bits:number[], tilt:number[]}}
 */
export function padStates(tape, lo, hi) {
  const rows = (tape && tape.inputs) || [];
  const bits = [];
  const tilt = [];
  let i = 0;
  let nextAt = rows.length ? rows[0][0] : Infinity;
  let cb = 0;
  let ct = 0;
  let rowTick = -1;
  for (let t = 0; t <= hi; t++) {
    while (i < rows.length && t >= nextAt) {
      cb = rows[i][1];
      ct = rows[i][2];
      rowTick = nextAt;
      i++;
      nextAt = i < rows.length ? nextAt + rows[i][0] : Infinity;
    }
    if (t >= lo) {
      bits.push(rowTick === t ? cb >>> 0 : (cb & ~EDGE_MASK) >>> 0);
      tilt.push(ct);
    }
  }
  return { lo, bits, tilt };
}

/**
 * Is this per-tick pad sequence something a real player could produce? Checks every adjacent pair in [from, to] (indices;
 * default all).
 * @param {{bits:number[], tilt:number[]}} s
 * @param {{from?:number, to?:number}} [range]
 * @returns {{ok:true}|{ok:false, reason:string, index:number}}
 */
export function isLegalPadSequence(s, range = {}) {
  const from = Math.max(0, range.from ?? 0);
  const to = Math.min(s.bits.length - 1, range.to ?? s.bits.length - 1);
  for (let i = from; i <= to; i++) {
    const b = s.bits[i];
    if (!(b >>> 0 === b) || b > BITS_MAX) return { ok: false, reason: 'bits outside the 20 defined pad bits', index: i };
    if (!isInt(s.tilt[i]) || s.tilt[i] < -127 || s.tilt[i] > 127) return { ok: false, reason: 'tilt outside [-127, 127]', index: i };
    if (i === 0) continue;
    const p = s.bits[i - 1];
    for (const f of EDGE_HELD_FIELDS) {
      const edge = (b & EDGE_BIT[f]) !== 0;
      const held = (b & HELD_BIT[f]) !== 0;
      const wasHeld = (p & HELD_BIT[f]) !== 0;
      if (edge && !(held && !wasHeld)) return { ok: false, reason: `${f} edge without a fresh press`, index: i };
      if (held && !wasHeld && !edge) return { ok: false, reason: `${f} pressed without its edge`, index: i };
    }
  }
  return { ok: true };
}

/** Edge kind of a held field. */
const kindOfField = (f) => (f === 'hop' ? 'hop' : f === 'tuck' ? 'tuck' : 'trick');
const FIELD_SCAN = Object.freeze(['hop', 'tuck', ...TRICK_FIELDS]);

/**
 * Input edges (held-field presses/releases and tilt changes) in the window before the crash: ticks
 * crashTick - windowTicks + 1 .. crashTick, oldest first.
 * @returns {Array<{id:string, kind:'hop'|'tuck'|'trick'|'lean', field:string, action:'press'|'release'|'change', tick:number,
 *   ticksBeforeCrash:number, from?:number, to?:number}>}
 */
export function lastInputEdges(tape, crashTick, windowTicks) {
  if (!tape || !Array.isArray(tape.inputs) || !isInt(crashTick) || !isInt(windowTicks) || windowTicks < 1) return [];
  const lo = Math.max(1, crashTick - windowTicks + 1);
  const s = padStates(tape, lo - 1, crashTick);
  const out = [];
  for (let i = 1; i < s.bits.length; i++) {
    const tick = lo - 1 + i;
    for (const f of FIELD_SCAN) {
      const now = (s.bits[i] & HELD_BIT[f]) !== 0;
      const was = (s.bits[i - 1] & HELD_BIT[f]) !== 0;
      if (now === was) continue;
      const action = now ? 'press' : 'release';
      out.push({ id: `${kindOfField(f)}:${f}:${action}@${tick}`, kind: kindOfField(f), field: f, action, tick, ticksBeforeCrash: crashTick - tick });
    }
    if (s.tilt[i] !== s.tilt[i - 1]) {
      out.push({ id: `lean:change@${tick}`, kind: 'lean', field: 'tilt', action: 'change', tick, ticksBeforeCrash: crashTick - tick,
        from: s.tilt[i - 1], to: s.tilt[i] });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Candidate generation

/**
 * @typedef {Object} Candidate
 * @property {string} id stable id, e.g. 'hop-shift:850:-6'
 * @property {'hop-shift'|'hop-drop'|'hop-add'|'edge-shift'|'lean-shift'|'lean-set'} kind
 * @property {string} label human text, e.g. 'hop 6 ticks earlier'
 * @property {number|null} offsetTicks signed shift (negative = earlier); for hop-add the tick offset from the crash; else null
 * @property {number} branchTick first tick that may differ from the tape
 * @property {Array<{field:string, from:number, to:number, value:boolean|number}>} sets edits: field = value on ticks [from, to)
 */

/** Interleave magnitudes: -1, +1, -2, +2 ... */
function* shiftOrder(maxShift) {
  for (let m = 1; m <= maxShift; m++) { yield -m; yield m; }
}

function* edgesNearestFirst(edges) {
  const sorted = [...edges].sort((a, b) => b.tick - a.tick || (a.id < b.id ? -1 : 1));
  yield* sorted;
}

/**
 * Deterministic, ordered list of legal perturbations. The list interleaves the groups (hop timing, no hop, extra hop,
 * tuck/trick edges, lean timing, lean value) so a small budget still samples every lever.
 * @param {object} tape
 * @param {{branchTick:number, crashTick:number, maxShift?:number, budget?:number}} o
 * @returns {Candidate[]}
 */
export function enumerateCandidates(tape, { branchTick, crashTick, maxShift = 12, budget = 64 } = {}) {
  if (!perturbableTape(tape).ok) return [];
  if (!isInt(branchTick) || branchTick < 1 || !isInt(crashTick) || crashTick <= branchTick) return [];
  const cap = budget === Infinity ? Infinity : Math.max(0, Math.floor(budget));
  const maxK = Math.max(0, Math.floor(maxShift));
  const hi = lastTickOf(tape);
  const END = hi + 1;
  const lo = branchTick - 1;
  const S = padStates(tape, lo, hi);
  const held = (f, t) => (S.bits[t - lo] & HELD_BIT[f]) !== 0;
  const tiltAt = (t) => S.tilt[t - lo];
  const edges = lastInputEdges(tape, crashTick, crashTick - branchTick + 1).filter((e) => e.tick >= branchTick);
  const mk = (c) => ({ offsetTicks: null, branchTick, ...c });

  // --- hop pulses -----------------------------------------------------------------------------------------------
  const pulses = [];
  for (const e of edgesNearestFirst(edges.filter((x) => x.kind === 'hop' && x.action === 'press'))) {
    let r = e.tick + 1;
    while (r < END && held('hop', r)) r++;
    pulses.push({ p: e.tick, r });
  }
  const inPulse = (t, p, r) => t >= p && t < r;
  const groups = Object.fromEntries(GROUP_ORDER.map((g) => [g, []]));

  // hop-shift: the whole pulse (press and release) moves, keeping its hold length
  for (const k of shiftOrder(maxK)) {
    for (const { p, r } of pulses) {
      const nP = p + k;
      const nR = r === END ? END : r + k;
      if (nP < branchTick || nP > crashTick || nR > END || nR <= nP) continue;
      let ok = true;
      for (let t = nP - 1; t <= Math.min(nR, END - 1) && ok; t++) if (held('hop', t) && !inPulse(t, p, r)) ok = false;
      if (!ok) continue;
      const sets = [{ field: 'hop', from: p, to: r, value: false }, { field: 'hop', from: nP, to: nR, value: true }];
      groups['hop-shift'].push(mk({ id: `hop-shift:${p}:${k}`, kind: 'hop-shift', label: `hop ${plural(Math.abs(k))} ${k < 0 ? 'earlier' : 'later'}`, offsetTicks: k, sets }));
    }
  }
  // hop-drop
  for (const { p, r } of pulses) {
    groups['hop-drop'].push(mk({ id: `hop-drop:${p}`, kind: 'hop-drop', label: `no hop ${plural(crashTick - p)} before the crash`,
      sets: [{ field: 'hop', from: p, to: r, value: false }] }));
  }
  // hop-add: hold length = median hold of the hops in the window (else a default)
  const holds = pulses.filter((x) => x.r < END).map((x) => x.r - x.p).sort((a, b) => a - b);
  const holdLen = holds.length ? holds[holds.length >> 1] : DEFAULT_HOP_HOLD_TICKS;
  for (const off of ADD_HOP_OFFSETS) {
    const a = crashTick + off;
    const b = a + holdLen;
    if (a < branchTick || b > END) continue;
    let ok = true;
    for (let t = a - 1; t <= Math.min(b, END - 1) && ok; t++) if (held('hop', t)) ok = false;
    if (!ok) continue;
    groups['hop-add'].push(mk({ id: `hop-add:${off}`, kind: 'hop-add', label: `add a hop ${plural(-off)} before the crash`, offsetTicks: off,
      sets: [{ field: 'hop', from: a, to: b, value: true }] }));
  }

  // --- tuck / trick edges: each transition moves on its own -------------------------------------------------------
  const boolEdges = [...edgesNearestFirst(edges.filter((e) => e.kind === 'tuck' || e.kind === 'trick'))];
  for (const k of shiftOrder(maxK)) {
    for (const e of boolEdges) {
      const t = e.tick;
      const a = held(e.field, t - 1);
      const b = held(e.field, t);
      let ok;
      let sets;
      if (k < 0) {
        ok = t + k >= branchTick;
        for (let x = t + k - 1; x <= t - 1 && ok; x++) if (held(e.field, x) !== a) ok = false;
        sets = [{ field: e.field, from: t + k, to: t, value: b }];
      } else {
        ok = t + k <= crashTick && t + k <= hi;
        for (let x = t; x <= t + k && ok; x++) if (held(e.field, x) !== b) ok = false;
        sets = [{ field: e.field, from: t, to: t + k, value: a }];
      }
      if (!ok) continue;
      groups['edge-shift'].push(mk({ id: `edge-shift:${e.field}:${t}:${e.action}:${k}`, kind: 'edge-shift',
        label: `${e.field} ${e.action} ${plural(Math.abs(k))} ${k < 0 ? 'earlier' : 'later'}`, offsetTicks: k, sets }));
    }
  }

  // --- lean: timing of each tilt change, and the tilt value of each segment ---------------------------------------
  const leanEdges = [...edgesNearestFirst(edges.filter((e) => e.kind === 'lean'))];
  for (const k of shiftOrder(maxK)) {
    for (const e of leanEdges) {
      const t = e.tick;
      const a = e.from;
      const b = e.to;
      let ok;
      let sets;
      if (k < 0) {
        ok = t + k >= branchTick;
        for (let x = t + k - 1; x <= t - 1 && ok; x++) if (tiltAt(x) !== a) ok = false;
        sets = [{ field: 'tilt', from: t + k, to: t, value: b }];
      } else {
        ok = t + k <= crashTick && t + k <= hi;
        for (let x = t; x <= t + k && ok; x++) if (tiltAt(x) !== b) ok = false;
        sets = [{ field: 'tilt', from: t, to: t + k, value: a }];
      }
      if (!ok) continue;
      groups['lean-shift'].push(mk({ id: `lean-shift:${t}:${k}`, kind: 'lean-shift', label: `lean change ${plural(Math.abs(k))} ${k < 0 ? 'earlier' : 'later'}`,
        offsetTicks: k, sets }));
    }
  }
  let keyboardOnly = true;
  for (const r of tape.inputs) if (!KEYBOARD_TILTS.includes(r[2])) { keyboardOnly = false; break; }
  const tiltText = (v) => (v / 127).toFixed(2);
  const tiltTweaks = keyboardOnly ? (v) => KEYBOARD_TILTS.filter((x) => x !== v) : (v) => {
    const out = [];
    for (const d of TILT_DELTAS_127) {
      const n = Math.max(-127, Math.min(127, v + d));
      if (n !== v && !out.includes(n)) out.push(n);
    }
    return out;
  };
  const leanSets = leanEdges.map((e) => {
    let end = e.tick + 1;
    while (end < END && tiltAt(end) === e.to) end++;
    return { e, end, values: tiltTweaks(e.to) };
  });
  for (let n = 0; n < 4; n++) {
    for (const { e, end, values } of leanSets) {
      if (n >= values.length) continue;
      const v = values[n];
      groups['lean-set'].push(mk({ id: `lean-set:${e.tick}:${v}`, kind: 'lean-set',
        label: `lean ${tiltText(v)} instead of ${tiltText(e.to)} from ${plural(e.ticksBeforeCrash)} before the crash`, sets: [{ field: 'tilt', from: e.tick, to: end, value: v }] }));
    }
  }

  // --- interleave, capped ------------------------------------------------------------------------------------------
  const out = [];
  const idx = Object.fromEntries(GROUP_ORDER.map((g) => [g, 0]));
  let more = true;
  while (more && out.length < cap) {
    more = false;
    for (const g of GROUP_ORDER) {
      for (let w = 0; w < ROUND_WEIGHTS[g] && idx[g] < groups[g].length && out.length < cap; w++) out.push(groups[g][idx[g]++]);
      if (idx[g] < groups[g].length) more = true;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Applying a candidate

function toBase64(floats) {
  const bytes = new Uint8Array(new Float32Array(floats).buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const illegal = (why) => new Error(`illegal candidate: ${why}`);

/**
 * A NEW tape with the candidate's edits applied. Rows before `candidate.branchTick` are copied byte-for-byte; the rest are
 * rebuilt from the edited per-tick pads with the recorder's own dedup rule. Checkpoints and trace from the branch on are
 * dropped (they describe the original run, not this one); the verified prefix keeps its checkpoints. Throws if an edit
 * reaches before branchTick or produces a pad a player could not produce. Never mutates `tape`.
 * @param {object} tape
 * @param {Candidate} candidate
 * @returns {object}
 */
export function applyCandidate(tape, candidate) {
  const ok = perturbableTape(tape);
  if (!ok.ok) throw illegal(ok.reason);
  const branchTick = candidate && candidate.branchTick;
  if (!isInt(branchTick) || branchTick < 1) throw illegal('missing branchTick');
  if (!Array.isArray(candidate.sets)) throw illegal('missing edits');
  const hi = lastTickOf(tape);
  const lo = branchTick - 1;
  const S = padStates(tape, lo, hi);
  const touched = {};
  for (const set of candidate.sets) {
    if (!isInt(set.from) || !isInt(set.to) || set.to < set.from) throw illegal('malformed edit range');
    if (set.from < branchTick) throw new Error(`illegal candidate: edit at tick ${set.from} is before branchTick ${branchTick}`);
    const to = Math.min(set.to, hi + 1);
    if (set.field === 'tilt') {
      if (!isInt(set.value) || set.value < -127 || set.value > 127) throw illegal('tilt outside [-127, 127]');
      for (let t = set.from; t < to; t++) S.tilt[t - lo] = set.value;
    } else if (EDITABLE_FIELDS.includes(set.field)) {
      for (let t = set.from; t < to; t++) S.bits[t - lo] = ((set.value ? S.bits[t - lo] | HELD_BIT[set.field] : S.bits[t - lo] & ~HELD_BIT[set.field]) >>> 0);
    } else throw illegal(`field ${set.field} is not editable`);
    const r = touched[set.field] || (touched[set.field] = { from: set.from, to });
    r.from = Math.min(r.from, set.from);
    r.to = Math.max(r.to, to);
  }
  // A press edge is derived from the held bit: it sits on exactly the ticks where the held bit rises.
  let minT = Infinity;
  let maxT = -Infinity;
  for (const [f, r] of Object.entries(touched)) {
    minT = Math.min(minT, r.from);
    maxT = Math.max(maxT, r.to);
    if (!EDGE_HELD_FIELDS.includes(f)) continue;
    for (let t = r.from; t <= Math.min(r.to, hi); t++) {
      const rise = (S.bits[t - lo] & HELD_BIT[f]) !== 0 && (S.bits[t - 1 - lo] & HELD_BIT[f]) === 0;
      S.bits[t - lo] = ((rise ? S.bits[t - lo] | EDGE_BIT[f] : S.bits[t - lo] & ~EDGE_BIT[f]) >>> 0);
    }
  }
  if (minT <= maxT) {
    const legal = isLegalPadSequence(S, { from: Math.max(0, minT - 1 - lo), to: Math.min(S.bits.length - 1, maxT + 1 - lo) });
    if (!legal.ok) throw illegal(`${legal.reason} (tick ${lo + legal.index})`);
  }

  // Re-encode: prefix rows verbatim, then the recorder's rule for every tick from branchTick.
  const rows = [];
  let at = 0;
  let last = null;
  let lastTick = 0;
  for (const r of tape.inputs) {
    if (at + r[0] >= branchTick) break;
    at += r[0];
    rows.push([r[0], r[1], r[2]]);
    last = [r[1], r[2]];
    lastTick = at;
  }
  for (let t = branchTick; t <= hi; t++) {
    const b = S.bits[t - lo];
    const tl = S.tilt[t - lo];
    if (last && last[0] === b && last[1] === tl && !(b & EDGE_MASK)) continue;
    rows.push([t - lastTick, b, tl]);
    lastTick = t;
    last = [b, tl];
  }
  const out = { ...tape, inputs: rows, checkpoints: (tape.checkpoints || []).filter((c) => c[0] < branchTick).map((c) => [...c]) };
  if (typeof tape.trace === 'string') out.trace = toBase64(Array.from(decodeTrace(tape).subarray(0, Math.floor((branchTick - 1) / TRACE_EVERY) * 3)));
  return out;
}
