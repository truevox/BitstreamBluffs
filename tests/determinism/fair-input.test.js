/**
 * Issue #115: fair input timestamps. Diagnostic harness tests (non-authoritative; see
 * input-timing-harness.js). A fixed timestamped keyboard sequence is replayed at 30/60/120/144 Hz
 * display cadences through the real InputRouter -> VirtualPad -> SimClock path.
 *
 * "legacy" = SimClock.padsFor(pad, ticks) exactly as main@b51ab36 used it (one poll per frame fanned
 * to N ticks). "timed" = the #115 scheduler (event.timeStamp -> tick whose window contains it).
 */
import { SIM_TICK_MS, SIM_MAX_TICKS_PER_FRAME } from '../../src/systems/SimClock.js';
import { decodePad } from '../../src/systems/ghost/GhostTape.js';
import { runCadence, oracleTape, idealTick, firstTick } from './input-timing-harness.js';

const RATES = [30, 60, 120, 144];
const DURATION = 1000;

// Fixed sequence. Times avoid exact tick/frame boundaries (+-1e-9 ambiguity) on purpose.
const SEQ = [
  { t: 101.3, type: 'keydown', code: 'Space' }, { t: 140.2, type: 'keyup', code: 'Space' }, // ~39 ms hop
  { t: 210.7, type: 'keydown', code: 'KeyW' }, { t: 213.1, type: 'keyup', code: 'KeyW' }, // 2.4 ms push tap
  { t: 300.5, type: 'keydown', code: 'KeyA' },
  { t: 350.2, type: 'keydown', code: 'KeyD' }, { t: 352.0, type: 'keyup', code: 'KeyD' }, // tuck tap under A
  { t: 420.9, type: 'keyup', code: 'KeyA' },
  { t: 500.4, type: 'keydown', code: 'KeyS' }, { t: 505.0, type: 'keyup', code: 'KeyS' }, // brake tap
  { t: 600.9, type: 'keydown', code: 'Space' }, { t: 603.0, type: 'keyup', code: 'Space' }, // hop tap
  { t: 700.1, type: 'keydown', code: 'ArrowUp' }, { t: 760.6, type: 'keyup', code: 'ArrowUp' },
  { t: 800.2, type: 'keydown', code: 'Space' }, { t: 805.0, type: 'keyup', code: 'Space' }, // double tap
  { t: 812.0, type: 'keydown', code: 'Space' }, { t: 815.0, type: 'keyup', code: 'Space' }, // in one 30 Hz frame
  { t: 902.5, type: 'keydown', code: 'KeyW' }, { t: 951.0, type: 'keyup', code: 'KeyW' },
];
const TICKS = 120;
const ORACLE = oracleTape(SEQ, TICKS);
const pad = (enc) => { const [b, t] = enc.split(':').map(Number); return decodePad(b, t); };
const ticksWhere = (tape, pred) => tape.map((e, i) => (pred(pad(e)) ? i + 1 : 0)).filter(Boolean);
const diffTicks = (a, b) => a.map((e, i) => (e !== b[i] ? i + 1 : 0)).filter(Boolean);

afterEach(() => { window.dispatchEvent(new Event('blur')); });

describe('#115 proof: legacy per-frame poll is refresh-rate dependent (main@b51ab36 behaviour)', () => {
  const legacy = Object.fromEntries(RATES.map((hz) => [hz, runCadence({ hz, events: SEQ, durationMs: DURATION, mode: 'legacy' })]));

  test('every cadence simulates the same 120 ticks', () => {
    for (const hz of RATES) expect(legacy[hz].tape.length).toBe(TICKS);
  });

  test('(a) the same input sequence yields different tapes at 30, 60 and 120 Hz', () => {
    expect(legacy[30].tape).not.toEqual(legacy[60].tape);
    expect(legacy[60].tape).not.toEqual(legacy[120].tape);
    expect(legacy[30].tape).not.toEqual(ORACLE);
  });

  test('(a) a press is applied on the first tick of its frame: up to 3 ticks before the tick that contains it at 30 Hz', () => {
    // ArrowUp held 700.1-760.6 ms = ticks 85..91 (the release at 760.6 falls in tick 92's window). At 30 Hz the
    // release is only polled by the frame at 733.3 -> no, by the frame at 766.7, but the PRESS frame (700, 733.3]
    // and the release frame (733.3, 766.7] each fan one poll over 4 ticks, so the held run is frame-quantized.
    const up = (h) => ticksWhere(legacy[h].tape, (p) => p.airBrake);
    expect(up(120)).toEqual([85, 86, 87, 88, 89, 90, 91]);
    expect(ticksWhere(ORACLE, (p) => p.airBrake)).toEqual([85, 86, 87, 88, 89, 90, 91]);
    expect(up(30)).toEqual([85, 86, 87, 88]);
    expect(up(30)).not.toEqual(up(120));
    // A press late in a 30 Hz frame is applied retroactively to the frame's FIRST tick.
    const late = [{ t: 932.0, type: 'keydown', code: 'KeyW' }, { t: 990, type: 'keyup', code: 'KeyW' }];
    const r30 = runCadence({ hz: 30, events: late, durationMs: DURATION, mode: 'legacy' });
    const firstPush = ticksWhere(r30.tape, (p) => p.push)[0];
    expect(idealTick(932.0)).toBe(112);
    expect(firstPush).toBe(109); // 3 ticks (25 ms of simulated time) before the key was pressed
  });

  test('(b) held-only buttons tapped and released inside one frame are lost', () => {
    // push tap 210.7-213.1, tuck tap 350.2-352.0, brake tap 500.4-505.0: all inside a 30 Hz and a 60 Hz frame.
    for (const hz of [30, 60]) {
      expect(ticksWhere(legacy[hz].tape, (p) => p.push && p.pressed && true).filter((g) => g < 300 / SIM_TICK_MS)).toEqual([]);
      expect(ticksWhere(legacy[hz].tape, (p) => p.tuck)).toEqual([]);
      expect(ticksWhere(legacy[hz].tape, (p) => p.brakeHeld)).toEqual([]);
    }
    // the oracle keeps each as exactly one tick
    expect(ticksWhere(ORACLE, (p) => p.tuck)).toEqual([idealTick(350.2)]);
    expect(ticksWhere(ORACLE, (p) => p.brakeHeld)).toEqual([idealTick(500.4)]);
  });

  test('(c) 144 Hz runs 0-tick frames: edges carry forward but a held tap inside such a frame is dropped', () => {
    const r = runCadence({ hz: 144, events: [], durationMs: DURATION, mode: 'legacy' });
    // Find a 0-tick frame: frames whose index never appears in frameOfTick.
    const withTicks = new Set(r.frameOfTick);
    const zero = [];
    for (let k = 1; k <= r.frames; k++) if (!withTicks.has(k)) zero.push(k);
    expect(zero.length).toBe(24); // 144 frames, 120 ticks: 24 frames run no tick at all
    const k = zero[10];
    const Tprev = (k - 1) * (1000 / 144), Tk = k * (1000 / 144);
    const tap = [{ t: Tprev + 1, type: 'keydown', code: 'KeyS' }, { t: Tprev + 2, type: 'keydown', code: 'Space' },
      { t: Tk + 0.5, type: 'keyup', code: 'KeyS' }, { t: Tk + 0.6, type: 'keyup', code: 'Space' }];
    const l = runCadence({ hz: 144, events: tap, durationMs: DURATION, mode: 'legacy' });
    expect(ticksWhere(l.tape, (p) => p.brakeHeld)).toEqual([]); // brake held across a whole frame: lost
    expect(ticksWhere(l.tape, (p) => p.pressed.hop)).toHaveLength(1); // the edge survives (carried)
  });

  test('(d) a sub-frame Space tap delivers pressed.hop with hop held = false (variableHop sees an instant release)', () => {
    const t = idealTick(600.9);
    const p = pad(legacy[30].tape[legacy[30].frameOfTick.indexOf(legacy[30].frameOfTick[t - 1])]);
    expect(p.pressed.hop).toBe(true);
    expect(p.hop).toBe(false);
  });

  test('(a) a double tap inside one 30 Hz frame merges into a single hop edge', () => {
    const inWindow = (g) => g * SIM_TICK_MS > 800 && g * SIM_TICK_MS <= 833.4;
    expect(ticksWhere(legacy[30].tape, (p) => p.pressed.hop).filter(inWindow)).toHaveLength(1);
    expect(ticksWhere(ORACLE, (p) => p.pressed.hop).filter(inWindow)).toHaveLength(2);
  });
});

describe('#115 fix: timestamped key events map to the tick whose window contains them', () => {
  const timed = Object.fromEntries(RATES.map((hz) => [hz, runCadence({ hz, events: SEQ, durationMs: DURATION, mode: 'timed' })]));

  test('a key pressed in the second tick window of a 60 Hz frame starts on that tick, not the first', () => {
    const r = runCadence({ hz: 60, events: [{ t: 12, type: 'keydown', code: 'KeyW' }], durationMs: 1000 / 60, mode: 'timed' });
    expect(r.pads.map((p) => p.push)).toEqual([false, true]);
    const l = runCadence({ hz: 60, events: [{ t: 12, type: 'keydown', code: 'KeyW' }], durationMs: 1000 / 60, mode: 'legacy' });
    expect(l.pads.map((p) => p.push)).toEqual([true, true]);
  });

  test.each([30, 60, 120])('a fixed timestamped sequence yields the reference tape exactly at %i Hz', (hz) => {
    expect(timed[hz].tape).toEqual(ORACLE);
  });

  test('30, 60 and 120 Hz tapes are identical', () => {
    expect(timed[30].tape).toEqual(timed[120].tape);
    expect(timed[60].tape).toEqual(timed[120].tape);
  });

  test('144 Hz: identical except events in a frame\'s sub-tick remainder, applied at most 1 tick early (never late)', () => {
    const d = diffTicks(timed[144].tape, ORACLE);
    // every difference is explained by one event shifted one tick earlier; the edges/held runs are otherwise equal
    for (const g of d) {
      const a = pad(timed[144].tape[g - 1]);
      const b = pad(ORACLE[g - 1]);
      const bNext = pad(ORACLE[g] || ORACLE[g - 1]);
      const aPrev = pad(timed[144].tape[g - 2] || timed[144].tape[g - 1]);
      // either the 144 Hz tape has the NEXT oracle tick's state early, or it is the oracle's previous state lingering
      const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
      expect(same(a, bNext) || same(aPrev, b) || same({ ...a, pressed: {} }, { ...bNext, pressed: {} })).toBe(true);
    }
    expect(d.length).toBeLessThanOrEqual(SEQ.length * 2);
  });

  test('(b) held-only taps inside one frame are preserved as one tick at every rate', () => {
    for (const hz of RATES) {
      expect(ticksWhere(timed[hz].tape, (p) => p.tuck)).toHaveLength(1);
      expect(ticksWhere(timed[hz].tape, (p) => p.brakeHeld)).toHaveLength(1);
      expect(ticksWhere(timed[hz].tape, (p) => p.push).filter((g) => g * SIM_TICK_MS < 300)).toHaveLength(1);
    }
  });

  test('(c) a held tap that spans a 144 Hz 0-tick frame is carried to the next tick, not dropped', () => {
    const r = runCadence({ hz: 144, events: [], durationMs: DURATION, mode: 'timed' });
    const withTicks = new Set(r.frameOfTick);
    let k = 0;
    for (let i = 40; i <= r.frames; i++) if (!withTicks.has(i)) { k = i; break; }
    const Tprev = (k - 1) * (1000 / 144), Tk = k * (1000 / 144);
    const tap = [{ t: Tprev + 1, type: 'keydown', code: 'KeyS' }, { t: Tk + 0.5, type: 'keyup', code: 'KeyS' }];
    const t = runCadence({ hz: 144, events: tap, durationMs: DURATION, mode: 'timed' });
    expect(ticksWhere(t.tape, (p) => p.brakeHeld).length).toBeGreaterThanOrEqual(1);
  });

  test('(d) the hop edge tick always carries hop held = true', () => {
    for (const hz of RATES) {
      for (const g of ticksWhere(timed[hz].tape, (p) => p.pressed.hop)) expect(pad(timed[hz].tape[g - 1]).hop).toBe(true);
    }
  });

  test('a double tap inside one 30 Hz frame is two hop edges, as at 120 Hz', () => {
    const inWindow = (g) => g * SIM_TICK_MS > 800 && g * SIM_TICK_MS <= 833.4;
    expect(ticksWhere(timed[30].tape, (p) => p.pressed.hop).filter(inWindow)).toHaveLength(2);
  });

  test('no added display latency: an input first shows up in the same render frame as before, never later', () => {
    for (const hz of RATES) {
      const legacy = runCadence({ hz, events: SEQ, durationMs: DURATION, mode: 'legacy' });
      for (const ev of SEQ.filter((e) => e.type === 'keydown')) {
        const from = Math.max(1, idealTick(ev.t) - SIM_MAX_TICKS_PER_FRAME);
        const field = { KeyW: 'push', KeyA: 'tilt', KeyD: 'tilt', KeyS: 'brakeHeld', Space: 'hop', ArrowUp: 'airBrake' }[ev.code];
        const pred = (p) => (field === 'tilt' ? p.tilt !== 0 || p.tuck : p[field]);
        const gl = firstTick(legacy.pads, from, pred);
        const gt = firstTick(timed[hz].pads, from, pred);
        expect(gt).toBeGreaterThan(0);
        if (gl > 0) expect(timed[hz].frameOfTick[gt - 1]).toBeLessThanOrEqual(legacy.frameOfTick[gl - 1]);
      }
    }
  });

  test('never retroactive: every input lands on a tick of the frame that polled it or later', () => {
    for (const hz of RATES) {
      for (const ev of SEQ.filter((e) => e.type === 'keydown')) {
        const frame = Math.ceil(ev.t / (1000 / hz) - 1e-9);
        const field = { KeyW: 'push', KeyA: 'tilt', KeyD: 'tuck', KeyS: 'brakeHeld', Space: 'hop', ArrowUp: 'airBrake' }[ev.code];
        const g = firstTick(timed[hz].pads, Math.max(1, idealTick(ev.t) - SIM_MAX_TICKS_PER_FRAME),
          (p) => (field === 'tilt' ? p.tilt !== 0 || p.tuck : p[field]));
        expect(timed[hz].frameOfTick[g - 1]).toBeGreaterThanOrEqual(frame);
      }
    }
  });
});
