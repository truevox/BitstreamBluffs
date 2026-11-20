/** Issue #59: drive the REAL game (Phaser + Matter, minified build) frame by frame with a
 * scripted input tape and an exact display-frame schedule, then compare sled trajectories.
 *
 *   GAME_URL=http://localhost:8293/ node tools/replay-determinism-browser-probe.mjs
 *
 * Each run gets its own browser page. RunScene.update is held from the moment the scene
 * exists, the game loop is put to sleep, and frames are stepped with game.step(t, dt), so
 * no wall-clock frame ever reaches the simulation. Scramble is forced on for the whole run.
 *
 * Checks:
 *  - SAME_RATE_REPEAT: two runs, same seed, same tape, same 60 Hz schedule -> identical
 *    pose/velocity/score every sample (requires seeded scramble: Math.random would diverge).
 *  - RATE_PARITY (report, or assert with EXPECT_RATE_PARITY=1): 30 / 60 / 120 Hz schedules.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.env.GAME_URL || 'http://localhost:8293/';
const SEED = process.env.SEED || 'RPLAY59';
const SIM_MS = Number(process.env.SIM_MS || 9000);
const expectParity = process.env.EXPECT_RATE_PARITY === '1';
const SCRAMBLE = process.env.SCRAMBLE !== '0';
// DUMP=file.json DUMP_HZ=60,120: just record those runs (handling comparisons between builds) and exit.
const DUMP = process.env.DUMP || null;

// Input tape in run-clock ms: held ranges and one-shot edges. Every time is a multiple of
// 100 ms, i.e. a whole number of 30/60/120 Hz frames, so all rates see each change on the same tick.
// TAPE=cruise: the same tape without the two flips (handling comparisons without bail-outs).
const TAPE = process.env.TAPE === 'cruise' ? {
  held: [
    { key: 'push', from: 0, to: 1800 },
    { key: 'push', from: 4200, to: 5200 },
    { key: 'tuck', from: 7000, to: 8200 },
  ],
  edges: [{ key: 'hop', at: 2600 }, { key: 'hop', at: 5900 }],
} : {
  held: [
    { key: 'push', from: 0, to: 1800 },
    { key: 'tilt', value: -1, from: 3000, to: 3700 },
    { key: 'push', from: 4200, to: 5200 },
    { key: 'tilt', value: 1, from: 6100, to: 6500 },
    { key: 'tuck', from: 7000, to: 8200 },
  ],
  edges: [{ key: 'hop', at: 2600 }, { key: 'hop', at: 5900 }],
};

async function runOnce(hz, label) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(), null, { timeout: 30000 });
    const out = await page.evaluate(async ({ hz, seed, simMs, tape, scramble }) => {
      const g = window.__bbGame;
      const run = g.scene.getScene('RunScene');
      const realUpdate = run.update;
      let hold = true;
      run.update = function (t, d) { if (!hold) return realUpdate.call(this, t, d); };
      g.scene.getScene('TitleScene').startRun(seed);
      // Let Phaser boot the scene (update is held, so no simulation time passes).
      await new Promise((res) => { const w = () => (run.sys.isActive() && run.sled ? res() : requestAnimationFrame(w)); w(); });
      g.loop.sleep();
      if (scramble) run.scrambleMs = 1e9; // scramble the whole run: the RNG under test
      let clock = 0;
      const pending = tape.edges.map((e) => ({ ...e, fired: false }));
      run.inputRouter.poll = () => {
        const pad = { push: false, tilt: 0, tuck: false, hop: false, pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false } };
        for (const h of tape.held) if (clock >= h.from && clock < h.to) pad[h.key] = h.value ?? true;
        for (const e of pending) if (!e.fired && clock >= e.at) { e.fired = true; pad.pressed[e.key] = true; pad[e.key] = true; }
        return pad;
      };
      hold = false;
      const dt = 1000 / hz;
      const samples = [];
      let t = 0, nextSample = 0, frames = 0, lastTick = -1;
      // Tape time from the integer tick count when the fixed-tick clock exists (exact at
      // every rate); the variable-delta baseline only has runTimeMs.
      const now = () => (run.simClock ? Math.round(run.simClock.tick * run.simClock.tickMs * 1000) / 1000 : run.runTimeMs);
      while (now() < simMs && frames < simMs / dt + 50) {
        clock = now();
        t += dt;
        g.step(t, dt);
        frames++;
        // Fixed tick: sample every 60th tick (a frame boundary at 30, 60 and 120 Hz). Baseline: by run time.
        const due = run.simClock ? run.simClock.tick % 60 === 0 && run.simClock.tick !== lastTick : now() + 1e-6 >= nextSample;
        if (due || run.crashed) {
          lastTick = run.simClock?.tick;
          const b = run.sled.body;
          samples.push({ t: Math.round(now()), tick: run.simClock?.tick ?? null, x: run.sled.x, y: run.sled.y, a: b.angle, vx: b.velocity.x, vy: b.velocity.y, w: b.angularVelocity,
            score: run.score?.getTotal?.() ?? null, crashed: !!run.crashed, scramble: run.runRandom?.physicsScramble?.state ?? null });
          nextSample += 500; // 60 ticks: a whole number of 30, 60 and 120 Hz frames
          if (run.crashed) break;
        }
      }
      return { frames, samples };
    }, { hz, seed: SEED, simMs: SIM_MS, tape: TAPE, scramble: SCRAMBLE });
    assert.deepEqual(errors, [], `${label}: page errors`);
    return out;
  } finally { await browser.close(); }
}

function compare(a, b) {
  const n = Math.min(a.samples.length, b.samples.length);
  let maxPos = 0, maxAng = 0, firstDiverge = null;
  for (let i = 0; i < n; i++) {
    const p = a.samples[i], q = b.samples[i];
    const dp = Math.hypot(p.x - q.x, p.y - q.y), da = Math.abs(p.a - q.a);
    maxPos = Math.max(maxPos, dp); maxAng = Math.max(maxAng, da);
    if (firstDiverge === null && (dp > 0 || da > 0 || p.vx !== q.vx || p.w !== q.w)) firstDiverge = p.t;
  }
  return { samples: [a.samples.length, b.samples.length], maxPosPx: +maxPos.toFixed(3), maxAngRad: +maxAng.toFixed(4), firstDivergeMs: firstDiverge,
    end: [a.samples.at(-1), b.samples.at(-1)].map((s) => s && { t: s.t, x: +s.x.toFixed(2), y: +s.y.toFixed(2), crashed: s.crashed, score: s.score }) };
}

if (DUMP) {
  const { writeFile } = await import('node:fs/promises');
  const runs = {};
  for (const hz of (process.env.DUMP_HZ || '60').split(',').map(Number)) runs[hz] = (await runOnce(hz, `dump${hz}`)).samples;
  await writeFile(DUMP, JSON.stringify({ seed: SEED, scramble: SCRAMBLE, simMs: SIM_MS, runs }));
  console.log('DUMPED', DUMP, Object.keys(runs).join(','));
  process.exit(0);
}
const r60a = await runOnce(60, '60a');
const r60b = await runOnce(60, '60b');
const same = compare(r60a, r60b);
console.log('SAME_RATE_REPEAT', JSON.stringify(same));
assert.ok(r60a.samples.length >= 5, 'probe produced too few samples');
assert.ok(r60a.samples.at(-1).scramble !== r60a.samples[0].scramble, 'scramble stream never advanced: scramble not exercised');
assert.equal(same.firstDivergeMs, null, 'same seed + tape + frame schedule must replay identically');
console.log('REPLAY_SAME_RATE_PASS');

const r30 = await runOnce(30, '30');
const r120 = await runOnce(120, '120');
const p30 = compare(r60a, r30), p120 = compare(r60a, r120);
console.log('RATE_PARITY_60_vs_30', JSON.stringify(p30));
console.log('RATE_PARITY_60_vs_120', JSON.stringify(p120));
if (expectParity) {
  assert.equal(p30.firstDivergeMs, null, '30 Hz diverged from 60 Hz');
  assert.equal(p120.firstDivergeMs, null, '120 Hz diverged from 60 Hz');
  console.log('REPLAY_RATE_PARITY_PASS');
} else console.log('RATE_PARITY_REPORT_ONLY (variable-delta baseline; set EXPECT_RATE_PARITY=1 once fixed-tick lands)');
