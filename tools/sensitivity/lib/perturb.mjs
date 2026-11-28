/**
 * Issue #130 (narrow slice) — developer-only input-timing perturbation, kept pure.
 *
 * WHAT THIS IS
 * A tape is the shipped, authoritative record of one run's input: a delta-encoded list of pad changes
 * (`inputs: [[tickDelta, bits, tilt127], ...]`), decoded by the game's own `decodePad` and fed back by the
 * game's own `TapePlayer`. This module reconstructs that exact per-tick pad sequence, moves the activation
 * spans of ONE named control by a whole number of fixed simulation ticks, and re-encodes a tape the shipped
 * `TapePlayer` accepts. Nothing here runs a simulation, and nothing here decides what an outcome means.
 *
 * WHY IT RECONSTRUCTS PADS INSTEAD OF SHIFTING ROWS
 * The obvious implementation — add the offset to the tick of every row inside a span — is wrong, and the
 * probe that preceded this file showed why: a row carries several fields at once (`variableHop`,
 * `noAutoNudge`, a held `hop` and a `tilt` edge can share one row), so shifting "the hop rows" also drags
 * unrelated tilt edges with them. It also fails for negative offsets, because two adjacent rows can then
 * collide in tick order even when the field's own spans are far apart. Working in pad space touches only the
 * named field, and span arithmetic is then checkable directly.
 *
 * WHAT IT REFUSES TO DO
 * A perturbation that would merge two activations, split one, or push a span outside the recorded run is
 * returned as an explicit exclusion, never silently dropped or clipped. A clipped span is a different
 * experiment (it changes the action's duration, not only its timing), so it must not be counted as this one.
 */
import { decodePad, encodePad } from '../../../src/systems/ghost/GhostTape.js';

/**
 * The controls this tool can perturb, and how "active" is read for each.
 *
 * `held` fields are read from the decoded pad's own boolean fields; `edge` fields are the one-shot press bits
 * the shipped recorder writes on the tick the press lands. `tests/sensitivity/perturb.test.js` pins this table
 * against the shipped `encodePad`/`decodePad` round trip, so a change to `GhostTape.BOOL_FIELDS` or
 * `EDGE_FIELDS` fails here instead of silently perturbing a different control.
 */
export const FIELDS = Object.freeze({
  tilt: { kind: 'analog', key: 'tilt' },
  push: { kind: 'held', key: 'push' },
  tuck: { kind: 'held', key: 'tuck' },
  brakeHeld: { kind: 'held', key: 'brakeHeld' },
  hop: { kind: 'held', key: 'hop' },
  airBrake: { kind: 'held', key: 'airBrake' },
  parachute: { kind: 'held', key: 'parachute' },
  hopPress: { kind: 'edge', key: 'hop' },
  airBrakePress: { kind: 'edge', key: 'airBrake' },
  parachutePress: { kind: 'edge', key: 'parachute' },
});

/** One-shot press bits the shipped recorder stores (GhostTape.EDGE_FIELDS). Used only to spot a row that
 *  carries an edge, which is the shipped recorder's own reason to write a row for otherwise-equal bits. */
const EDGE_NAMES = Object.freeze(['hop', 'reset', 'pause', 'airBrake', 'parachute', 'confirm']);

const isField = (name) => Object.hasOwn(FIELDS, name);

function assertTape(tape) {
  if (!tape || typeof tape !== 'object') throw new TypeError('expected a tape object');
  if (!Array.isArray(tape.inputs) || tape.inputs.length === 0) throw new TypeError('tape.inputs must be a non-empty array');
  for (const row of tape.inputs) {
    if (!Array.isArray(row) || row.length !== 3) throw new TypeError('every tape input row is [tickDelta, bits, tilt127]');
    if (!Number.isSafeInteger(row[0]) || row[0] < 1) throw new TypeError('every tick delta is a positive integer');
    if (!Number.isSafeInteger(row[1]) || row[1] < 0) throw new TypeError('every bits field is a non-negative integer');
    if (!Number.isSafeInteger(row[2])) throw new TypeError('every tilt field is an integer');
  }
}

/** Cumulative absolute tick of each row (the tape stores deltas, starting from tick 0). */
export function rowTicks(tape) {
  const ticks = [];
  let acc = 0;
  for (const row of tape.inputs) { acc += row[0]; ticks.push(acc); }
  return ticks;
}

/**
 * The last tick this tape can speak about. `endTick` is the recorder's last *completed* tick; a row may also
 * have been written on the crashing tick (RunScene calls `input()` before `simTick`, and `afterTick` only
 * after a non-crash tick), so the horizon is the later of the two. Bounding by `endTick` alone would silently
 * discard that last row.
 */
export function tapeHorizon(tape) {
  assertTape(tape);
  const ticks = rowTicks(tape);
  const end = Number.isSafeInteger(tape.endTick) && tape.endTick > 0 ? tape.endTick : 0;
  return Math.max(end, ticks[ticks.length - 1]);
}

/**
 * The exact per-tick pad for ticks 1..horizon, reconstructed with the shipped decoder and the shipped
 * `TapePlayer` delta rule: a row takes effect at its tick, a one-shot edge belongs only to the tick it was
 * recorded on, and everything else persists. `tests/sensitivity/perturb.test.js` asserts this equals
 * `new TapePlayer(tape).padAt(t)` for every tick, so this can never drift from the shipped replay path.
 *
 * @returns {Array<object>} index 0 is unused (tick 0); `pads[t]` is the pad for tick `t`.
 */
export function readPads(tape) {
  const horizon = tapeHorizon(tape);
  const rows = tape.inputs;
  const pads = new Array(horizon + 1);
  let i = 0;
  let nextAt = rows[0][0];
  let pad = decodePad(0, 0);
  let changeTick = -1;
  for (let t = 1; t <= horizon; t++) {
    while (i < rows.length && t >= nextAt) {
      pad = decodePad(rows[i][1], rows[i][2]);
      changeTick = nextAt;
      i++;
      nextAt = i < rows.length ? nextAt + rows[i][0] : Infinity;
    }
    pads[t] = changeTick === t ? clonePad(pad) : { ...clonePad(pad), pressed: {} };
  }
  return pads;
}

/**
 * Re-encode per-tick pads into tape input rows, using the shipped recorder's own write rule: a row is written
 * when the encoded bits or tilt differ from the last written row, or when the tick carries a one-shot edge.
 * `writePads(readPads(tape))` reproduces `tape.inputs` byte-for-byte at offset 0 — the identity property the
 * whole tool rests on.
 */
export function writePads(pads, horizon) {
  const inputs = [];
  let last = null;
  let lastTick = 0;
  for (let t = 1; t <= horizon; t++) {
    const pad = pads[t];
    if (!pad) throw new TypeError(`missing pad for tick ${t}`);
    const [bits, tilt] = encodePad(pad);
    const carriesEdge = EDGE_NAMES.some((name) => pad.pressed?.[name]);
    if (last && last[0] === bits && last[1] === tilt && !carriesEdge) continue;
    inputs.push([t - lastTick, bits, tilt]);
    lastTick = t;
    last = [bits, tilt];
  }
  return inputs;
}

function clonePad(pad) {
  return { ...pad, pressed: { ...(pad.pressed || {}) } };
}

/** Whether the named field is active on this pad. */
export function isActive(pad, field) {
  const spec = FIELDS[field];
  if (!spec) throw new TypeError(`unknown field "${field}"`);
  if (spec.kind === 'analog') return pad.tilt !== 0;
  if (spec.kind === 'edge') return pad.pressed?.[spec.key] === true;
  return pad[spec.key] === true;
}

/** Value carried by the named field on this pad (what a shifted span must reproduce). */
function fieldValue(pad, field) {
  const spec = FIELDS[field];
  return spec.kind === 'analog' ? pad.tilt : spec.kind === 'edge' ? true : pad[spec.key] === true;
}

function clearField(pad, field) {
  const spec = FIELDS[field];
  if (spec.kind === 'analog') pad.tilt = 0;
  else if (spec.kind === 'edge') pad.pressed[spec.key] = false;
  else pad[spec.key] = false;
}

function setField(pad, field, value) {
  const spec = FIELDS[field];
  if (spec.kind === 'analog') pad.tilt = value;
  else if (spec.kind === 'edge') pad.pressed[spec.key] = value === true;
  else pad[spec.key] = value === true;
}

/** Maximal runs of consecutive ticks on which the field is active, as inclusive `[start, end]` pairs. */
export function spansOf(active) {
  const spans = [];
  let start = -1;
  for (let t = 1; t < active.length; t++) {
    if (active[t] && start === -1) start = t;
    else if (!active[t] && start !== -1) { spans.push([start, t - 1]); start = -1; }
  }
  if (start !== -1) spans.push([start, active.length - 1]);
  return spans;
}

/** Activation spans of the named field over ticks 1..horizon. */
export function actionSpans(pads, horizon, field) {
  const active = new Array(horizon + 1).fill(false);
  for (let t = 1; t <= horizon; t++) active[t] = isActive(pads[t], field);
  return spansOf(active);
}

/**
 * Move every activation span of `field` by `offset` fixed ticks, preserving each span's duration.
 *
 * Returns `{ ok: true, tape, spans, shiftedSpans, changed, horizon }` or
 * `{ ok: false, reason, spans, horizon }` with a machine-readable reason:
 *   `out-of-range`   a shifted span would start before tick 1 or run past the recorded horizon
 *   `no-activations` the field is never active, so there is nothing to time
 *
 * WHY THERE IS NO "SPAN COLLISION" REFUSAL
 * Every span of one field moves by the same offset, so every gap between two spans is preserved by
 * construction: a uniform translation cannot merge two activations or split one. The only way a span can be
 * damaged is at the recorded boundary, and that is exactly what `out-of-range` refuses. A "collision" branch
 * here would be unreachable code pretending to be a guard, so instead the span structure is re-derived and
 * asserted to be the exact translation of the original — a violated invariant is a bug in this file, and it
 * throws rather than being reported as an experiment that simply could not run.
 *
 * `offset === 0` is the control: it returns the input tape untouched (`changed: false`) so a caller can assert
 * the identity property on every single run.
 */
export function perturbTape(tape, { field, offset }) {
  if (!isField(field)) throw new TypeError(`unknown field "${field}"`);
  if (!Number.isSafeInteger(offset)) throw new TypeError('offset must be an integer number of fixed ticks');
  const horizon = tapeHorizon(tape);
  const pads = readPads(tape);
  const spans = actionSpans(pads, horizon, field);

  if (spans.length === 0) return { ok: false, reason: 'no-activations', spans, horizon };
  if (offset === 0) {
    return { ok: true, tape, spans, shiftedSpans: 0, changed: false, horizon };
  }

  const writes = [];
  for (const [a, b] of spans) {
    for (let t = a; t <= b; t++) writes.push([t + offset, fieldValue(pads[t], field)]);
  }
  for (const [t] of writes) {
    if (t < 1 || t > horizon) return { ok: false, reason: 'out-of-range', spans, horizon };
  }

  const next = pads.map((pad, t) => (t === 0 ? pad : clonePad(pad)));
  for (const [a, b] of spans) for (let t = a; t <= b; t++) clearField(next[t], field);
  for (const [t, value] of writes) setField(next[t], field, value);

  // Invariant, not a user-facing refusal: the result must be the exact translation of the original spans.
  const moved = actionSpans(next, horizon, field);
  const translated = moved.length === spans.length &&
    moved.every(([a, b], i) => a === spans[i][0] + offset && b === spans[i][1] + offset);
  if (!translated) {
    throw new Error(`internal invariant violated: shifting "${field}" by ${offset} produced ${JSON.stringify(moved)} from ${JSON.stringify(spans)}`);
  }

  const inputs = writePads(next, horizon);
  const changed = JSON.stringify(inputs) !== JSON.stringify(tape.inputs);
  return { ok: true, tape: { ...tape, inputs }, spans, shiftedSpans: spans.length, changed, horizon };
}
