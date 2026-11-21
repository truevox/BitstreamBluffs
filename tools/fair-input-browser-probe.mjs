/** Issue #115: fair input timestamps in the REAL game (Phaser + Matter, built bundle). DIAGNOSTIC.
 *
 *   GAME_URL=http://localhost:8413/ node tools/fair-input-browser-probe.mjs
 *
 * Unlike tools/replay-determinism-browser-probe.mjs (which stubs inputRouter.poll), this probe sends
 * REAL KeyboardEvents through window -> InputRouter -> VirtualPad -> SimClock.padsFor -> RunScene, with
 * each event's timeStamp pinned to a synthetic clock that is also the rAF time handed to game.step().
 * The loop is asleep; frames are stepped at exact 30 / 60 / 120 / 144 Hz schedules. For each rate it
 * records the run's own ghost-tape input rows (RunScene.ghostRecorder) and the sled state at the end.
 *
 * Output: FAIR_INPUT_<hz> lines with the tape digest and end state, then a parity verdict.
 * EXPECT_FAIR=1 asserts identical tapes and sled state at 30/60/120 Hz (a #115 build); without it the
 * probe only reports (so it also measures main). Digests here are diagnostic, non-authoritative.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const url = process.env.GAME_URL || 'http://localhost:8413/';
const SEED = process.env.SEED || 'FAIR115';
const END_TICK = Number(process.env.END_TICK || 720); // multiple of 12: a frame boundary at 30/60/120 Hz
const RATES = (process.env.RATES || '30,60,120,144').split(',').map(Number);
const expectFair = process.env.EXPECT_FAIR === '1';

// Run-clock ms (0 = first simulated frame). Off frame/tick boundaries on purpose; includes sub-frame taps.
const KEYS = [
  ['keydown', 'KeyW', 0.5], ['keyup', 'KeyW', 1500.3],
  ['keydown', 'Space', 2001.7], ['keyup', 'Space', 2004.1], // 2.4 ms hop tap
  ['keydown', 'KeyA', 2600.2], ['keydown', 'KeyD', 2800.4], ['keyup', 'KeyD', 2803.0], ['keyup', 'KeyA', 3100.9],
  ['keydown', 'KeyS', 3500.5], ['keyup', 'KeyS', 3504.9], // brake tap
  ['keydown', 'Space', 4000.3], ['keyup', 'Space', 4080.6],
  ['keydown', 'KeyW', 4500.2], ['keyup', 'KeyW', 5200.7],
  ['keydown', 'Space', 5600.2], ['keyup', 'Space', 5605.0], ['keydown', 'Space', 5611.0], ['keyup', 'Space', 5614.0],
];

async function runOnce(hz) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(), null, { timeout: 30000 });
    const out = await page.evaluate(async ({ hz, seed, keys, endTick }) => {
      const g = window.__bbGame;
      const run = g.scene.getScene('RunScene');
      const realUpdate = run.update;
      let hold = true;
      run.update = function (t, d) { if (!hold) return realUpdate.call(this, t, d); };
      g.scene.getScene('TitleScene').startRun(seed);
      await new Promise((res) => { const w = () => (run.sys.isActive() && run.sled ? res() : requestAnimationFrame(w)); w(); });
      g.loop.sleep();
      const router = run.inputRouter;
      const base = 100000; // synthetic clock origin (ms); shared by event.timeStamp and game.step(time)
      let clock = base;
      router.now = () => clock;
      router.setEnabled(true);
      router.poll(); // drop anything from boot
      const dt = 1000 / hz;
      let k = 0, ki = 0, frames = 0;
      hold = false;
      while ((run.simClock?.tick ?? 0) < endTick && frames < endTick * 2 + 50 && !run.crashed) {
        k++;
        const T = base + k * dt;
        while (ki < keys.length && base + keys[ki][2] <= T + 1e-9) {
          const [type, code, at] = keys[ki++];
          clock = base + at;
          const e = new KeyboardEvent(type, { code, bubbles: true, cancelable: true });
          Object.defineProperty(e, 'timeStamp', { value: base + at });
          window.dispatchEvent(e);
        }
        clock = T;
        g.step(T, dt);
        frames++;
      }
      const rec = run.ghostRecorder;
      let abs = 0;
      const inputs = (rec?.inputs || []).map(([d, bits, tilt]) => { abs += d; return [abs, bits, tilt]; }).filter((r) => r[0] <= endTick);
      const b = run.sled.body;
      return { frames, tick: run.simClock?.tick, crashed: !!run.crashed, inputs,
        sled: [b.position.x, b.position.y, b.angle, b.velocity.x, b.velocity.y, b.angularVelocity], score: run.score?.getTotal?.() ?? null };
    }, { hz, seed: SEED, keys: KEYS, endTick: END_TICK });
    assert.deepEqual(errors, [], `${hz} Hz: page errors`);
    return out;
  } finally { await browser.close(); }
}

const digest = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 12);
const runs = {};
for (const hz of RATES) {
  const r = await runOnce(hz);
  runs[hz] = r;
  console.log(`FAIR_INPUT_${hz}`, JSON.stringify({ frames: r.frames, tick: r.tick, crashed: r.crashed, inputRows: r.inputs.length,
    tape: digest(r.inputs), state: digest([r.sled, r.score]), x: +r.sled[0].toFixed(3), score: r.score }));
}
const ref = runs[RATES.includes(120) ? 120 : RATES[0]];
const verdict = {};
for (const hz of RATES) {
  const r = runs[hz];
  const rowsDiff = [];
  const n = Math.max(r.inputs.length, ref.inputs.length);
  for (let i = 0; i < n; i++) if (JSON.stringify(r.inputs[i]) !== JSON.stringify(ref.inputs[i])) rowsDiff.push([r.inputs[i], ref.inputs[i]]);
  verdict[hz] = { sameTape: rowsDiff.length === 0, sameState: digest([r.sled, r.score]) === digest([ref.sled, ref.score]), firstRowDiffs: rowsDiff.slice(0, 3) };
}
console.log('FAIR_INPUT_VERDICT', JSON.stringify(verdict));
if (expectFair) {
  for (const hz of [30, 60, 120].filter((h) => RATES.includes(h))) {
    assert.ok(verdict[hz].sameTape, `${hz} Hz tape differs from 120 Hz`);
    assert.ok(verdict[hz].sameState, `${hz} Hz sled state differs from 120 Hz`);
  }
  console.log('FAIR_INPUT_PASS');
} else console.log('FAIR_INPUT_REPORT_ONLY (set EXPECT_FAIR=1 to assert 30/60/120 Hz parity)');
