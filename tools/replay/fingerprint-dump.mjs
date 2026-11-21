/** Replay Contract v1 (#118): drive the REAL game (Phaser + Matter, the production build) with a scripted input tape on an exact
 * display-frame schedule, and dump the per-checkpoint subsystem fingerprints that GhostRecorder.afterTick records.
 *
 *   GAME_URL=http://localhost:8293/ node tools/replay/fingerprint-dump.mjs            # run twice, assert identical
 *   DUMP=fp.json DUMP_HZ=30,60,120 node tools/replay/fingerprint-dump.mjs             # just record (cross-rate / cross-engine files)
 *   BROWSER=firefox|webkit ...                                                          # other Playwright engines (default chromium)
 *   COMPARE=a.json,b.json node tools/replay/fingerprint-dump.mjs                       # diff two dumps: first differing checkpoint + subsystems
 *
 * STATUS: written for execution in a FULL worktree (needs the built game and Playwright browsers). It was NOT run when it was
 * committed (the code-only worktree has no media and no browser). The same simulation + recorder hook is exercised headlessly
 * by tests/replay/fingerprintIntegration.test.js (real RunScene and Matter under jsdom, rendering stubbed).
 *
 * It reads `scene.ghostRecorder.fingerprints` (subsystem digests per 120-tick checkpoint), so it needs no module access to the
 * minified bundle. To localize a divergence to a tick and field (compareRuns) use the injected re-simulation: run this tool with
 * FROM_TICK/TO_TICK to also capture per-tick fingerprints for that window via an in-page dynamic import of the dev server's
 * src/systems/replay/fingerprintCapture.js (GAME_URL must then be the Vite dev server).
 * Same input conventions as tools/replay-determinism-browser-probe.mjs (run clock in ms; RunScene.update held while booting).
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, firefox, webkit } from 'playwright';

const url = process.env.GAME_URL || 'http://localhost:8293/';
const SEED = process.env.SEED || 'RPLAY118';
const SIM_MS = Number(process.env.SIM_MS || 9000);
const DUMP = process.env.DUMP || null;
const FROM = process.env.FROM_TICK ? Number(process.env.FROM_TICK) : null;
const TO = process.env.TO_TICK ? Number(process.env.TO_TICK) : null;
const engine = { chromium, firefox, webkit }[process.env.BROWSER || 'chromium'];

const TAPE = {
  held: [{ key: 'push', from: 0, to: 1800 }, { key: 'tilt', value: -1, from: 3000, to: 3700 }, { key: 'tuck', from: 7000, to: 8200 }],
  edges: [{ key: 'hop', at: 2600 }, { key: 'hop', at: 5900 }],
};

async function runOnce(hz, label) {
  const browser = await engine.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(), null, { timeout: 30000 });
    const out = await page.evaluate(async ({ hz, seed, simMs, tape, from, to }) => {
      const g = window.__bbGame;
      const run = g.scene.getScene('RunScene');
      const realUpdate = run.update;
      let hold = true;
      run.update = function (t, d) { if (!hold) return realUpdate.call(this, t, d); };
      g.scene.getScene('TitleScene').startRun(seed);
      await new Promise((res) => { const w = () => (run.sys.isActive() && run.sled ? res() : requestAnimationFrame(w)); w(); });
      g.loop.sleep();
      let capture = null;
      let fingerprintState = null;
      if (from != null) {
        const base = new URL('./src/systems/replay/', location.href).href;
        capture = (await import(`${base}fingerprintCapture.js`)).captureCausalState;
        fingerprintState = (await import(`${base}fingerprint.js`)).fingerprintState;
      }
      let clock = 0;
      const pending = tape.edges.map((e) => ({ ...e, fired: false }));
      run.inputRouter.poll = () => {
        const pad = { push: false, tilt: 0, heli: 0, tuck: false, hop: false, pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false } };
        for (const h of tape.held) if (clock >= h.from && clock < h.to) pad[h.key] = h.value ?? true;
        for (const e of pending) if (!e.fired && clock >= e.at) { e.fired = true; pad.pressed[e.key] = true; pad[e.key] = true; }
        return pad;
      };
      hold = false;
      const dt = 1000 / hz;
      const perTick = [];
      let t = 0, frames = 0, lastTick = 0;
      const now = () => Math.round(run.simClock.tick * run.simClock.tickMs * 1000) / 1000;
      while (now() < simMs && frames < simMs / dt + 50 && !run.crashed) {
        clock = now();
        t += dt;
        g.step(t, dt);
        frames++;
        if (capture && run.simClock.tick !== lastTick) {
          // at 120 Hz there is one tick per frame; at 30/60 Hz several ticks pass per frame, so per-tick windows need 120 Hz
          lastTick = run.simClock.tick;
          if (lastTick > from && lastTick <= to) perTick.push(fingerprintState(capture(run)));
        }
      }
      const rec = run.ghostRecorder;
      return { frames, endTick: run.simClock.tick, crashed: !!run.crashed, fingerprints: rec.fingerprints, errors: rec.fingerprintErrors, perTick };
    }, { hz, seed: SEED, simMs: SIM_MS, tape: TAPE, from: FROM, to: TO });
    assert.deepEqual(errors, [], `${label}: page errors`);
    assert.deepEqual(out.errors, [], `${label}: fingerprint capture errors`);
    return out;
  } finally { await browser.close(); }
}

function firstDiff(a, b) {
  const n = Math.min(a.fingerprints.length, b.fingerprints.length);
  for (let i = 0; i < n; i++) {
    const p = a.fingerprints[i], q = b.fingerprints[i];
    if (p.tick !== q.tick || p.combined !== q.combined) {
      const subsystems = Object.keys(p.subsystems).filter((k) => p.subsystems[k] !== q.subsystems[k]);
      return { checkpoint: p.tick, subsystems };
    }
  }
  return a.fingerprints.length === b.fingerprints.length ? null : { checkpoint: 'count', counts: [a.fingerprints.length, b.fingerprints.length] };
}

if (process.env.COMPARE) {
  const [fa, fb] = process.env.COMPARE.split(',');
  const da = JSON.parse(await readFile(fa, 'utf8'));
  const db = JSON.parse(await readFile(fb, 'utf8'));
  for (const hz of Object.keys(da.runs)) {
    if (db.runs[hz]) console.log(`hz=${hz}`, JSON.stringify(firstDiff(da.runs[hz], db.runs[hz])));
  }
  process.exit(0);
}
if (DUMP) {
  const runs = {};
  for (const hz of (process.env.DUMP_HZ || '60').split(',').map(Number)) runs[hz] = await runOnce(hz, `dump${hz}`);
  await writeFile(DUMP, JSON.stringify({ seed: SEED, simMs: SIM_MS, browser: process.env.BROWSER || 'chromium', runs }));
  console.log('DUMPED', DUMP, Object.keys(runs).join(','));
  process.exit(0);
}
const a = await runOnce(60, '60a');
const b = await runOnce(60, '60b');
assert.ok(a.fingerprints.length >= 5, 'too few checkpoints recorded');
const d = firstDiff(a, b);
console.log('SAME_RATE_REPEAT', JSON.stringify({ checkpoints: a.fingerprints.length, firstDiff: d }));
assert.equal(d, null, 'same seed + tape + frame schedule must give identical subsystem fingerprints');
