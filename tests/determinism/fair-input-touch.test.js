/**
 * Issue #115 (touch scope): TouchOverlay pointer events carry event.timeStamp into VirtualPad, so touch
 * presses land on the tick whose window contains them, like keyboard. Diagnostic harness tests
 * (non-authoritative; see input-timing-harness.js). Real TouchOverlay listeners, real InputRouter.
 */
import { SIM_TICK_MS } from '../../src/systems/SimClock.js';
import { runCadence, oracleTape, idealTick } from './input-timing-harness.js';

afterEach(() => {
  window.dispatchEvent(new Event('blur'));
  delete navigator.getGamepads;
  document.body.innerHTML = '';
});

const ticksWhere = (pads, pred) => pads.map((p, i) => (pred(p) ? i + 1 : 0)).filter(Boolean);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const down = (t, button, pointerId = 1) => ({ t, type: 'touchdown', button, pointerId });
const up = (t, pointerId = 1, type = 'touchup') => ({ t, type, pointerId });

describe('#115 touch timestamps', () => {
  test('a 2 ms PUSH tap inside one 30 Hz frame is not lost (main: lost)', () => {
    const ev = [down(210.7, 'push'), up(212.7)];
    expect(ticksWhere(runCadence({ hz: 30, events: ev, durationMs: 300, mode: 'legacy' }).pads, (p) => p.push)).toEqual([]);
    expect(ticksWhere(runCadence({ hz: 30, events: ev, durationMs: 300, mode: 'timed' }).pads, (p) => p.push)).toEqual([idealTick(210.7)]);
  });

  const SEQ = [
    down(101.3, 'hop'), up(140.2), // hop held 39 ms
    down(210.7, 'push'), up(213.1), // sub-frame push tap
    down(300.5, 'tiltBack', 1), down(350.2, 'tiltForward', 2), up(352.0, 2), up(420.9, 1), // tuck tap from a 2nd finger
    down(500.4, 'brake'), up(505.0, 1, 'touchcancel'), // brake tap ended by pointercancel
    down(600.9, 'airBrake'), up(640.3, 1, 'lostcapture'), // released by lostpointercapture (no pointerup)
    down(700.2, 'hop', 1), down(712.0, 'hop', 2), up(730.5, 1), up(760.6, 2), // two fingers on one button
    down(800.2, 'tiltBack'), { t: 815.4, type: 'touchmove', button: 'tiltForward', pointerId: 1 }, up(850.1), // slide
  ];

  test.each([30, 60, 120])('a fixed timestamped touch sequence yields the reference tape exactly at %i Hz', (hz) => {
    expect(runCadence({ hz, events: SEQ, durationMs: 1000, mode: 'timed' }).tape).toEqual(oracleTape(SEQ, 120));
  });

  test('multi-touch: two fingers on HOP hold it from the first press to the last release, one edge', () => {
    const r = runCadence({ hz: 30, events: SEQ, durationMs: 1000, mode: 'timed' });
    const hop = ticksWhere(r.pads, (p) => p.hop).filter((g) => g * SIM_TICK_MS > 690);
    expect(hop).toEqual(range(idealTick(700.2), idealTick(760.6) - 1));
    expect(ticksWhere(r.pads, (p) => p.pressed.hop).filter((g) => g * SIM_TICK_MS > 690)).toEqual([idealTick(700.2)]);
  });

  test('pointercancel and lostpointercapture release on the tick that contains them', () => {
    const r = runCadence({ hz: 30, events: SEQ, durationMs: 1000, mode: 'timed' });
    expect(ticksWhere(r.pads, (p) => p.brakeHeld)).toEqual([idealTick(500.4)]);
    expect(ticksWhere(r.pads, (p) => p.airBrake)).toEqual(range(idealTick(600.9), idealTick(640.3) - 1));
  });

  test('touch and keyboard holding the same button: held from the first press to the last release', () => {
    const ev = [down(100.4, 'push'), { t: 120.3, type: 'keydown', code: 'KeyW' }, up(150.2), { t: 180.6, type: 'keyup', code: 'KeyW' }];
    for (const hz of [30, 60, 120]) {
      const r = runCadence({ hz, events: ev, durationMs: 300, mode: 'timed' });
      expect(ticksWhere(r.pads, (p) => p.push)).toEqual(range(idealTick(100.4), idealTick(180.6) - 1));
      expect(r.tape).toEqual(oracleTape(ev, r.tape.length));
    }
  });

  test('mixed touch + keyboard + gamepad in one 30 Hz frame: each on its own tick, gamepad on the first', () => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    navigator.getGamepads = () => [{ connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons }];
    // frame 1 = (0, 33.3]: touch HOP at 20 ms (tick 3), key W at 30 ms (tick 4), gamepad B (brake) seen at poll
    const ev = [down(20, 'hop'), { t: 30, type: 'keydown', code: 'KeyW' }];
    const beforeFrame = (router, k) => { buttons[1] = k === 1 ? { pressed: true, value: 1 } : { pressed: false, value: 0 }; };
    const r = runCadence({ hz: 30, events: ev, durationMs: 1000 / 30, mode: 'timed', beforeFrame });
    expect(r.pads.map((p) => p.brakeHeld)).toEqual([true, true, true, true]);
    expect(r.pads.map((p) => p.pressed.hop)).toEqual([false, false, true, false]);
    expect(r.pads.map((p) => p.push)).toEqual([false, false, false, true]);
    const l = runCadence({ hz: 30, events: ev, durationMs: 1000 / 30, mode: 'legacy', beforeFrame });
    expect(l.pads.map((p) => p.pressed.hop)).toEqual([true, false, false, false]); // main: all on tick 1
  });

  test('touch events stamped off the rAF clock (epoch / synthetic) stay untimed: first tick, tap still kept', () => {
    const epoch = Date.now();
    const ev = [{ t: 20, stamp: epoch, type: 'touchdown', button: 'push', pointerId: 1 }, { t: 22, stamp: epoch + 2, type: 'touchup', pointerId: 1 }];
    const r = runCadence({ hz: 30, events: ev, durationMs: 1000 / 30, mode: 'timed' });
    expect(r.pads.map((p) => p.push)).toEqual([true, false, false, false]);
  });
});
