/** Issue #115: fair input timestamps in the REAL game (Phaser + Matter, built bundle). DIAGNOSTIC.
 *
 *   GAME_URL=http://localhost:8413/ node tools/fair-input-browser-probe.mjs
 *
 * Unlike tools/replay-determinism-browser-probe.mjs (which stubs inputRouter.poll), this probe sends
 * REAL KeyboardEvents through window -> InputRouter -> VirtualPad -> SimClock.padsFor -> RunScene, with
 * each event's timeStamp pinned to a synthetic clock that is also the rAF time handed to game.step().
 * Touch overlay buttons get real PointerEvents (pointerType 'touch', multi-finger, pointercancel) the same way.
 * The loop is asleep; frames are stepped at exact 30 / 60 / 120 / 144 Hz schedules. For each rate it
 * records the run's own ghost-tape input rows (RunScene.ghostRecorder) and the sled state at the end.
 *
 * REAL_RAF=1: instead, let Phaser's own requestAnimationFrame loop run (real vsync times, real
 * TimeStep delta smoothing) and type with Playwright's page.keyboard (browser-stamped timeStamps).
 * SimClock.padsFor is wrapped to log each frame's tick windows, so every W press (pad.parachute in the
 * default tricksRight layout) reports how many
 * ticks before (+) or after (-) its own tick window it was first applied. Works against main too.
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
  // touch overlay (real PointerEvents at the button's centre, pointerType touch): [type, button|null, t, pointerId]
  ['pointerdown', 'brake', 1000.3, 11], ['pointerup', null, 1002.7, 11], // 2.4 ms brake tap
  ['pointerdown', 'hop', 3300.7, 12], ['pointerdown', 'hop', 3310.4, 13], ['pointerup', null, 3320.9, 12], ['pointerup', null, 3360.6, 13],
  ['pointerdown', 'tuck', 3700.2, 14], ['pointercancel', null, 3741.5, 14],
].sort((a, b) => a[2] - b[2]);

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
      router.applySettings({ ...router.settings, touchOverlay: 'on' });
      router.pad.setOverlayContext(true);
      const overlay = router.pad.overlay;
      overlay.now = () => clock;
      router.poll(); // drop anything from boot
      const dt = 1000 / hz;
      let k = 0, ki = 0, frames = 0;
      hold = false;
      while ((run.simClock?.tick ?? 0) < endTick && frames < endTick * 2 + 50 && !run.crashed) {
        k++;
        const T = base + k * dt;
        while (ki < keys.length && base + keys[ki][2] <= T + 1e-9) {
          const [type, code, at, pointerId] = keys[ki++];
          clock = base + at;
          if (type.startsWith('pointer')) {
            const el = code ? overlay.root.querySelector(`[data-btn="${code}"]`) : null;
            const r = el ? el.getBoundingClientRect() : { left: -50, top: -50, width: 0, height: 0 };
            const e = new PointerEvent(type, { pointerId, pointerType: 'touch', isPrimary: false, bubbles: true, cancelable: true,
              clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
            Object.defineProperty(e, 'timeStamp', { value: base + at });
            (el || overlay.root).dispatchEvent(e);
            continue;
          }
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

async function realRaf() {
  const PRESSES = Number(process.env.PRESSES || 60);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: Number(process.env.RAF_W || 480), height: Number(process.env.RAF_H || 270) } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(), null, { timeout: 30000 });
    await page.evaluate(async (seed) => {
      const g = window.__bbGame;
      const run = g.scene.getScene('RunScene');
      g.scene.getScene('TitleScene').startRun(seed);
      await new Promise((res) => { const w = () => (run.sys.isActive() && run.sled && run.simClock ? res() : requestAnimationFrame(w)); w(); });
      const log = { keys: [], frames: [] };
      window.__fairLog = log;
      window.addEventListener('keydown', (e) => { if (!e.repeat) log.keys.push({ code: e.code, t: e.timeStamp }); }, { capture: true });
      const clock = run.simClock;
      const real = clock.padsFor.bind(clock);
      // main's RunScene does not pass frameTime: take it from update(time) so the probe measures both builds
      // (Phaser calls sys.sceneUpdate, bound when the scene started, so wrap that, not run.update)
      const realUpdate = run.sys.sceneUpdate;
      let frameTime = null;
      run.sys.sceneUpdate = function (t, d) { frameTime = t; return realUpdate.call(this, t, d); };
      clock.padsFor = (pad, ticks, opts) => {
        const out = real(pad, ticks, opts);
        log.frames.push({ T: opts?.frameTime ?? frameTime, acc: clock.accMs, ticks, first: clock.tick + 1, push: out.map((p) => !!p.parachute), crashed: !!run.crashed });
        return out;
      };
      run.sled.invulnerableMs = 1e9; // keep the run alive; timing only
    }, SEED);
    for (let i = 0; i < PRESSES; i++) {
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(35 + (i % 7) * 3);
      await page.keyboard.up('KeyW');
      await page.waitForTimeout(80 + ((i * 13) % 37));
    }
    const log = await page.evaluate(() => window.__fairLog);
    assert.deepEqual(errors, [], 'real-rAF: page errors');
    return log;
  } finally { await browser.close(); }
}

function analyseRaf(log) {
  const tickMs = 1000 / 120;
  const ticks = []; // per applied tick: { tick, end, push }
  const intervals = [];
  let prevT = null;
  for (const f of log.frames) {
    if (f.T != null && prevT != null) intervals.push(f.T - prevT);
    prevT = f.T;
    const lastEnd = f.T - f.acc;
    for (let i = 0; i < f.ticks; i++) ticks.push({ tick: f.first + i, end: lastEnd - (f.ticks - 1 - i) * tickMs, push: f.push[i] });
  }
  const lags = [];
  let missed = 0;
  for (const k of log.keys.filter((x) => x.code === 'KeyW')) {
    // first tick holding push whose frame came after the keydown (skip a hold still running from before)
    const idx = ticks.findIndex((x, j) => x.push && x.end > k.t - 6 * tickMs && (j === 0 || !ticks[j - 1].push || ticks[j - 1].end < k.t - 6 * tickMs));
    if (idx < 0) { missed++; continue; }
    const end = ticks[idx].end;
    // + = applied this many ticks BEFORE its own window (early); - = after it (late); 0 = its own tick
    lags.push(t2(k.t, end, tickMs));
  }
  const hist = {};
  for (const l of lags) hist[l] = (hist[l] || 0) + 1;
  intervals.sort((a, b) => a - b);
  return { presses: lags.length, missed, earlyTicksHistogram: hist, frameMsMedian: +(intervals[intervals.length >> 1] || 0).toFixed(3),
    frameMsMin: +(intervals[0] || 0).toFixed(3), frameMsMax: +(intervals.at(-1) || 0).toFixed(3) };
}
function t2(t, end, tickMs) {
  if (t > end) return Math.ceil((t - end) / tickMs - 1e-9);
  if (t <= end - tickMs) return -Math.floor((end - t) / tickMs + 1e-9);
  return 0;
}

if (process.env.REAL_RAF === '1') {
  const raw = await realRaf();
  if (process.env.RAF_DUMP) (await import('node:fs')).writeFileSync(process.env.RAF_DUMP, JSON.stringify(raw));
  const r = analyseRaf(raw);
  console.log('FAIR_INPUT_REAL_RAF', JSON.stringify(r));
  process.exit(0);
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
