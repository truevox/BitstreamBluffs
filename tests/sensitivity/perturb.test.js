/**
 * Issue #130 (narrow slice) — input-timing perturbation, pinned against the SHIPPED replay path.
 *
 * The tool is only honest if it drives the game's real tape machinery. These tests therefore assert against
 * `GhostTape`'s own `TapePlayer` and `encodePad`/`decodePad` rather than against a private model of the format:
 *
 *  1. `readPads` must equal `TapePlayer.padAt(t)` for every tick of a real captured tape.
 *  2. `writePads(readPads(tape))` must reproduce the captured `inputs` byte-for-byte (the identity property).
 *  3. A perturbation must move ONLY the named field, by exactly the requested number of ticks.
 *  4. Every refusal must be a named reason, never a silent clip or drop.
 *
 * The fixtures are real tapes captured from the shipped sim by this tool (see README "How the fixtures were
 * made"), so a format change that breaks these tests is a format change the tool would otherwise get wrong.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TapePlayer, decodePad, encodePad } from '../../src/systems/ghost/GhostTape.js';
import {
  FIELDS, actionSpans, isActive, perturbTape, readPads, rowTicks, spansOf, tapeHorizon, writePads,
} from '../../tools/sensitivity/lib/perturb.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(HERE, 'fixtures');
const TAPES = ['capture-sim-01.tape.json', 'capture-sim-02.tape.json'];

const loadTape = (name) => JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));

/** A blank pad with every declared field off, so the codec test does not depend on the fixture's contents. */
function blankPad() {
  return {
    push: false, variableHop: false, noAutoNudge: false, divebomb: false, corkscrew: false, tuck: false,
    brakeHeld: false, hop: false, reset: false, airBrake: false, parachute: false, pause: false,
    heli: 0, tilt: 0, pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false },
  };
}

describe('tape reconstruction matches the shipped TapePlayer', () => {
  for (const name of TAPES) {
    test(`${name}: readPads equals TapePlayer.padAt on every tick`, () => {
      const tape = loadTape(name);
      const horizon = tapeHorizon(tape);
      const pads = readPads(tape);
      const player = new TapePlayer(tape);
      for (let t = 1; t <= horizon; t++) expect({ tick: t, pad: pads[t] }).toEqual({ tick: t, pad: player.padAt(t) });
    });

    test(`${name}: writePads(readPads(tape)) reproduces the captured inputs exactly`, () => {
      const tape = loadTape(name);
      expect(writePads(readPads(tape), tapeHorizon(tape))).toEqual(tape.inputs);
    });

    test(`${name}: the horizon covers the last recorded row`, () => {
      const tape = loadTape(name);
      const ticks = rowTicks(tape);
      expect(tapeHorizon(tape)).toBeGreaterThanOrEqual(ticks[ticks.length - 1]);
      expect(tapeHorizon(tape)).toBeGreaterThanOrEqual(tape.endTick);
    });
  }
});

describe('offset 0 is the identity, on every field of every fixture', () => {
  for (const name of TAPES) {
    for (const field of Object.keys(FIELDS)) {
      test(`${name} ${field}: offset 0 returns the input tape untouched`, () => {
        const tape = loadTape(name);
        const result = perturbTape(tape, { field, offset: 0 });
        if (!result.ok) {
          // A control this run never used is a legitimate 'no-activations', never a silent pass.
          expect(result.reason).toBe('no-activations');
          return;
        }
        expect(result.changed).toBe(false);
        expect(result.tape.inputs).toEqual(tape.inputs);
        expect(result.tape.inputs).toBe(tape.inputs); // the same array, not a copy that happens to match
      });
    }
  }
});

describe('a perturbation moves only the named field', () => {
  const tape = loadTape('capture-sim-01.tape.json');
  const horizon = tapeHorizon(tape);

  test('every other field and the tilt value are identical on every tick', () => {
    const before = readPads(tape);
    const result = perturbTape(tape, { field: 'hopPress', offset: 2 });
    expect(result.ok).toBe(true);
    const after = readPads(result.tape);
    for (let t = 1; t <= horizon; t++) {
      for (const field of Object.keys(FIELDS)) {
        if (field === 'hopPress') continue;
        expect({ t, field, active: isActive(after[t], field) }).toEqual({ t, field, active: isActive(before[t], field) });
      }
      expect({ t, tilt: after[t].tilt }).toEqual({ t, tilt: before[t].tilt });
    }
  });

  test('each activation span is exactly `offset` ticks later, with its duration intact', () => {
    const result = perturbTape(tape, { field: 'hopPress', offset: 2 });
    const before = actionSpans(readPads(tape), horizon, 'hopPress');
    const after = actionSpans(readPads(result.tape), horizon, 'hopPress');
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      expect(after[i][0] - before[i][0]).toBe(2);
      expect(after[i][1] - after[i][0]).toBe(before[i][1] - before[i][0]);
    }
  });

  test('a negative offset moves the spans earlier by the same rule', () => {
    const spans = actionSpans(readPads(tape), horizon, 'hopPress');
    const room = spans[0][0] - 1;
    expect(room).toBeGreaterThan(0); // otherwise this assertion would be vacuous
    const result = perturbTape(tape, { field: 'hopPress', offset: -room });
    expect(result.ok).toBe(true);
    const after = actionSpans(readPads(result.tape), horizon, 'hopPress');
    expect(after.length).toBe(spans.length);
    for (let i = 0; i < spans.length; i++) {
      expect(after[i][0] - spans[i][0]).toBe(-room);
      expect(after[i][1] - after[i][0]).toBe(spans[i][1] - spans[i][0]);
    }
  });
});

describe('refusals are named, never silent', () => {
  const tape = loadTape('capture-sim-01.tape.json');
  const horizon = tapeHorizon(tape);

  test('an unknown field is a type error, not a no-op', () => {
    expect(() => perturbTape(tape, { field: 'warp', offset: 1 })).toThrow(/unknown field/);
  });

  test('a fractional offset is refused', () => {
    expect(() => perturbTape(tape, { field: 'hopPress', offset: 1.5 })).toThrow(/integer/);
  });

  test('a control this run never used reports no-activations and builds no tape', () => {
    const result = perturbTape(tape, { field: 'parachute', offset: 1 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-activations');
    expect(result.tape).toBeUndefined();
  });

  test('an offset that pushes a span past the recorded horizon is refused', () => {
    const spans = actionSpans(readPads(tape), horizon, 'hopPress');
    const last = spans[spans.length - 1];
    const result = perturbTape(tape, { field: 'hopPress', offset: horizon - last[0] + 1 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('out-of-range');
  });

  test('a span that starts at tick 1 cannot be moved earlier', () => {
    const spans = actionSpans(readPads(tape), horizon, 'hopPress');
    const result = perturbTape(tape, { field: 'hopPress', offset: -spans[0][0] });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('out-of-range');
  });

  test('a shift that would run past the recorded horizon is refused at the boundary, not clipped', () => {
    // Two separate one-tick hop activations (turned off again by the next row): shifting moves both, so the
    // LAST one reaches the recorded boundary first.
    const HOP_HELD = 1 << 7;
    const apart = { endTick: 10, inputs: [[1, HOP_HELD, 0], [1, 0, 0], [1, HOP_HELD, 0], [1, 0, 0], [6, 0, 0]] };
    expect(actionSpans(readPads(apart), tapeHorizon(apart), 'hop')).toEqual([[1, 1], [3, 3]]);
    const ok = perturbTape(apart, { field: 'hop', offset: 1 });
    expect(ok.ok).toBe(true);
    expect(actionSpans(readPads(ok.tape), tapeHorizon(ok.tape), 'hop')).toEqual([[2, 2], [4, 4]]);
    // +8 would put the second span at tick 11, past the horizon of 10.
    const refused = perturbTape(apart, { field: 'hop', offset: 8 });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('out-of-range');
  });

  test('a uniform shift cannot merge spans, so the span structure is preserved exactly', () => {
    // Every span moves by the same offset, so every gap is preserved. This is why there is no collision refusal.
    const HOP_HELD = 1 << 7;
    const apart = { endTick: 20, inputs: [[1, HOP_HELD, 0], [1, 0, 0], [1, HOP_HELD, 0], [1, 0, 0], [16, 0, 0]] };
    const before = actionSpans(readPads(apart), tapeHorizon(apart), 'hop');
    expect(before).toEqual([[1, 1], [3, 3]]);
    for (const offset of [1, 2, 3]) {
      const result = perturbTape(apart, { field: 'hop', offset });
      expect(result.ok).toBe(true);
      const after = actionSpans(readPads(result.tape), tapeHorizon(result.tape), 'hop');
      expect(after.length).toBe(before.length);
      expect(after.map(([a, b], i) => [a - before[i][0], b - before[i][1]])).toEqual(before.map(() => [offset, offset]));
    }
  });
});

describe('spansOf is the plain maximal-run rule', () => {
  test('finds maximal runs and ignores index 0', () => {
    expect(spansOf([true, false, true, true, false, true])).toEqual([[2, 3], [5, 5]]);
  });
  test('an all-inactive array has no spans', () => {
    expect(spansOf([false, false, false])).toEqual([]);
  });
  test('a run reaching the end is closed at the last index', () => {
    expect(spansOf([false, true, true])).toEqual([[1, 2]]);
  });
});

describe('the field table matches the shipped pad codec', () => {
  for (const [name, spec] of Object.entries(FIELDS)) {
    test(`${name} is readable through encodePad/decodePad`, () => {
      const pad = blankPad();
      if (spec.kind === 'analog') pad.tilt = -1;
      else if (spec.kind === 'edge') pad.pressed[spec.key] = true;
      else pad[spec.key] = true;
      const [bits, tilt] = encodePad(pad);
      expect({ name, active: isActive(decodePad(bits, tilt), name) }).toEqual({ name, active: true });
    });

    test(`${name} is false on a blank pad`, () => {
      const [bits, tilt] = encodePad(blankPad());
      expect({ name, active: isActive(decodePad(bits, tilt), name) }).toEqual({ name, active: false });
    });
  }
});
