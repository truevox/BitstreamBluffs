/**
 * Issue #140 (3D-readiness guardrail 1: "the camera is presentation, never game input").
 *
 * RunScene.updateGroundTelegraph runs inside the fixed sim tick and passes `this._view.right` (the RENDERED
 * camera's right edge, rebuilt in renderFrame, one display frame stale) to planTelegraph as its horizon.
 * The owner assigned the fix to issue #155. This file DETECTS it without fixing it:
 *  - an expected failure (test.failing) that turns into an unexpected pass, and so fails the suite, once #155
 *    makes the plan camera-independent (then flip it to a plain test);
 *  - plain tests that pin today's blast radius: only the `onScreen` flag of a mark follows the camera; the
 *    sounds/cues (TelegraphTracker) and every other mark field are camera-independent.
 */
import { planTelegraph, TelegraphTracker } from '../../src/systems/HazardTelegraph.js';

const crashDef = { id: 'firewall', onHit: { effect: 'crash' } };
const slowDef = { id: 'lagSpike', onHit: { effect: 'slow' } };
const hazards = [
  { def: crashDef, cx: 1500, w: 40 },
  { def: slowDef, cx: 1900, w: 30 },
  { def: crashDef, cx: 2200, w: 40 },
];
const sled = { x: 1000, vx: 420, speed: 430, grounded: true, landX: null };
// What a zoomed-out (0.6) and a zoomed-in (1.2) camera put at the right edge for the same sled, the same tick.
const VIEW_RIGHT_ZOOM_OUT = 1000 + 960 / 0.6 / 2 + 300;
const VIEW_RIGHT_ZOOM_IN = 1000 + 960 / 1.2 / 2;
const strip = (marks) => marks.map(({ ref, ...m }) => ({ id: ref.def.id, cx: ref.cx, ...m }));

describe('ground telegraph vs the rendered camera (#155 detector)', () => {
  // Expected to FAIL until issue #155 lands: the plan still depends on the camera. When this starts to pass,
  // Jest reports it as an error; change test.failing to test.
  test.failing('the planned marks do not depend on the rendered camera (fixed by #155)', () => {
    const a = planTelegraph(hazards, sled, VIEW_RIGHT_ZOOM_OUT, { nowMs: 5000 });
    const b = planTelegraph(hazards, sled, VIEW_RIGHT_ZOOM_IN, { nowMs: 5000 });
    expect(strip(b)).toEqual(strip(a));
  });

  test('today only `onScreen` follows the camera: every other mark field is camera-independent', () => {
    const a = strip(planTelegraph(hazards, sled, VIEW_RIGHT_ZOOM_OUT, { nowMs: 5000 }));
    const b = strip(planTelegraph(hazards, sled, VIEW_RIGHT_ZOOM_IN, { nowMs: 5000 }));
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((m) => m.onScreen)).not.toEqual(b.map((m) => m.onScreen)); // the leak is real
    const noScreen = (ms) => ms.map(({ onScreen, ...m }) => m);
    expect(noScreen(b)).toEqual(noScreen(a));
  });

  test('warn / hop-cue events (SFX, teleAtMs, crash-report arrival) are camera-independent', () => {
    const run = (viewRight) => {
      const tr = new TelegraphTracker();
      const log = [];
      const s = { ...sled };
      for (let tick = 0; tick < 240; tick++) {
        s.x += s.vx / 120;
        const now = tick * (1000 / 120);
        const marks = planTelegraph(hazards, s, viewRight + s.x - sled.x, { nowMs: now });
        for (const e of tr.update(now, marks)) log.push([tick, e.type, e.kind, e.ref.def.id, e.sound]);
      }
      return { log, arrival: hazards.map((h) => tr.lastArrivalMs(h)) };
    };
    const out = run(VIEW_RIGHT_ZOOM_OUT);
    expect(out.log.length).toBeGreaterThan(0);
    expect(run(VIEW_RIGHT_ZOOM_IN)).toEqual(out);
  });
});
