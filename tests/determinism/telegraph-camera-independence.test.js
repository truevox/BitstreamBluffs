/**
 * Issue #140 (3D-readiness guardrail 1: "the camera is presentation, never game input").
 *
 * Before #155, RunScene.updateGroundTelegraph ran inside the fixed sim tick and passed `this._view.right` (the RENDERED
 * camera's right edge, one display frame stale) to planTelegraph as its horizon. This file detected that as an expected
 * failure; #155 has landed (the sim plans with planTelegraphMarks, which has no camera input, and only the renderer adds
 * `onScreen`), so these are now plain regression tests:
 *  - the RunScene call site passes nothing camera-derived (source check of the planner call's arguments);
 *  - the sim-side plan has no camera input and no `onScreen`;
 *  - in the presentation wrapper planTelegraph, only `onScreen` follows the camera; warn/hop cues never do.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planTelegraph, planTelegraphMarks, TelegraphTracker } from '../../src/systems/HazardTelegraph.js';

const crashDef = { id: 'firewall', onHit: { effect: 'crash' } };
const slowDef = { id: 'lagSpike', onHit: { effect: 'slow' } };
const hazards = [
  { hid: '0:0', def: crashDef, cx: 1500, w: 40 },
  { hid: '0:1', def: slowDef, cx: 1900, w: 30 },
  { hid: '0:2', def: crashDef, cx: 2200, w: 40 },
];
const sled = { x: 1000, vx: 420, speed: 430, grounded: true, landX: null };
// What a zoomed-out (0.6) and a zoomed-in (1.2) camera put at the right edge for the same sled, the same tick.
const VIEW_RIGHT_ZOOM_OUT = 1000 + 960 / 0.6 / 2 + 300;
const VIEW_RIGHT_ZOOM_IN = 1000 + 960 / 1.2 / 2;
const strip = (marks) => marks.map(({ ref, ...m }) => ({ id: ref.def.id, cx: ref.cx, ...m }));

/**
 * The arguments of the telegraph planner call inside RunScene.updateGroundTelegraph, read from the source text.
 * Balanced-paren scan, so a multi-line call works. Throws when the method or the call is gone, so a refactor cannot
 * silently retire the call-site check (the plain test below fails loudly instead).
 */
function telegraphCallSiteArgs() {
  const src = readFileSync(fileURLToPath(new URL('../../src/scenes/RunScene.js', import.meta.url)), 'utf8');
  const m = /\n  updateGroundTelegraph\([^)]*\) \{/.exec(src);
  if (!m) throw new Error('RunScene.updateGroundTelegraph not found');
  const body = src.slice(m.index, src.indexOf('\n  }\n', m.index));
  const at = body.search(/planTelegraph(Marks)?\(/);
  if (at < 0) throw new Error('planner call not found in updateGroundTelegraph');
  const open = body.indexOf('(', at);
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    if (body[i] === '(') depth++;
    else if (body[i] === ')' && --depth === 0) return body.slice(open + 1, i);
  }
  throw new Error('unbalanced planTelegraph( call');
}
const CAMERA_RE = /_view|cameras|\bcam\b|scrollX|zoom/;

describe('ground telegraph vs the rendered camera (#155 regression)', () => {
  test('the call-site check can find the planner call in RunScene.updateGroundTelegraph', () => {
    expect(() => telegraphCallSiteArgs()).not.toThrow();
  });

  test('RunScene passes nothing camera-derived to the telegraph planner', () => {
    expect(telegraphCallSiteArgs()).not.toMatch(CAMERA_RE);
  });

  test('the sim-side plan (planTelegraphMarks) has no camera input and no onScreen field', () => {
    expect(planTelegraphMarks.length).toBe(2); // (hazards, sled, opts?, t?): no viewRight parameter
    const marks = planTelegraphMarks(hazards, sled, { nowMs: 5000 });
    expect(marks.length).toBeGreaterThan(0);
    for (const m of marks) expect(m).not.toHaveProperty('onScreen');
  });

  test('in the presentation wrapper planTelegraph only `onScreen` follows the camera; every other field is camera-independent', () => {
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
