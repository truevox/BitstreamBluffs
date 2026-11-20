/** Issue #47: hostile Kodiaks in the REAL game (minified build).
 *
 *   GAME_URL=http://localhost:8293/ SHOT_DIR=/tmp/shots node tools/kodiak-browser-smoke.mjs
 *
 * For each of the three bear TYPES (seeds whose first encounter is that type), at Sync Level 6:
 *  - the bear spawns on the seeded schedule (the run starts 450 m in so the first encounter is
 *    immediate), warns, telegraphs, and either hits (named crash) or is passed (bonus);
 *  - a screenshot of the bear on screen for review.
 * Also: at Sync Level 1 no bear ever appears; a Kodiak run replays exactly from its ghost tape at
 * 30 and 120 Hz (bears live in the fixed tick).
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.env.GAME_URL || 'http://localhost:8293/';
const shotDir = process.env.SHOT_DIR || null;
const SEEDS = { kernelPanic: 'BEAR0', bruteForce: 'BEAR5', blackIce: 'BEAR4' };
const ARGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];

/** Start a run held at tick 0 with the sled already 450 m in, then step frames at `hz`. */
async function drive(page, { seed, level = 6, hz = 60, maxMs = 14000, shotWhen = null, hopOnTele = false, tape = null }) {
  return page.evaluate(async ({ seed, level, hz, maxMs, shotWhen, hopOnTele, tape }) => {
    const g = window.__bbGame;
    const prof = g.registry.get('profile');
    if (prof) prof.level = level;
    const run = g.scene.getScene('RunScene');
    if (!run.__real) run.__real = run.update;
    let hold = true;
    run.update = function (t, d) { if (!hold) return run.__real.call(this, t, d); };
    if (tape) g.registry.set('ghostReplay', tape);
    g.scene.getScene('TitleScene').startRun(seed);
    await new Promise((res) => { const w = () => (run.sys.isActive() && run.sled ? res() : requestAnimationFrame(w)); w(); });
    g.loop.sleep();
    // 450 m of credit before tick 1 (identically in every run): the first encounter is due at once.
    run.startX = run.sled.x - 450 * 30 - 1;
    const events = [];
    const onK = (p) => events.push({ ...p, tick: run.simClock.tick });
    g.events.on('bb:kodiak', onK);
    run.inputRouter.poll = () => {
      const k = run.kodiak;
      const hop = hopOnTele && k && (k.phase === 'tele' || k.phase === 'lunge') && run.sled.grounded;
      return { push: false, tilt: 0, hop, pressed: { hop, reset: false, pause: false, airBrake: false, parachute: false, confirm: false } };
    };
    hold = false;
    let t = 0, shot = null;
    const tickMs = run.simClock.tickMs;
    while (!run.crashed && run.simClock.tick * tickMs < maxMs) {
      t += 1000 / hz;
      g.step(t, 1000 / hz);
      const k = run.kodiak;
      if (shotWhen && !shot && k && run._view && k.x > run._view.left + 40 && k.x < run._view.right - 40 &&
          (shotWhen === 'visible' || k.phase === shotWhen)) { shot = { tick: run.simClock.tick, phase: k.phase }; break; }
    }
    if (run.crashed) await new Promise((r) => setTimeout(r, 400));
    g.events.off('bb:kodiak', onK);
    const crash = g.registry.get('lastCrash');
    return { events, crashed: !!run.crashed, killer: crash?.name || null, crashLine: crash?.line || null, crashCause: crash?.cause || null,
      tape: g.registry.get('lastGhostTape') || null, shot, kodiaksOn: run.kodiaksOn,
      replay: run.tapePlayer ? { desync: run.tapePlayer.desync, checked: run.tapePlayer.checked } : null, tick: run.simClock.tick };
  }, { seed, level, hz, maxMs, shotWhen, hopOnTele, tape });
}

async function page(browser) {
  const p = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await p.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(), null, { timeout: 30000 });
  return { p, errors };
}

const browser = await chromium.launch({ headless: true, args: ARGS });
try {
  for (const [kind, seed] of Object.entries(SEEDS)) {
    // Outcome run: no input. Every type must warn and then either hit the sled (named crash) or be passed.
    const a = await page(browser);
    const r = await drive(a.p, { seed });
    const types = r.events.map((e) => e.type);
    assert.equal(r.events[0]?.type, 'incoming', `${kind}: no incoming warning`);
    assert.ok(r.events[0].id.startsWith(kind), `${kind}: wrong bear ${r.events[0].id}`);
    const hit = r.crashed && /KODIAK/.test(String(r.killer || ''));
    console.log('KODIAK_OUTCOME', kind, JSON.stringify({ events: types, crashed: r.crashed, killer: r.killer, tick: r.tick }));
    assert.ok(hit || types.includes('passed') || types.includes('gone'), `${kind}: bear neither hit, was passed, nor left`);
    assert.deepEqual(a.errors, []);
    await a.p.close();
    // Screenshot run: the bear on screen, ideally mid-telegraph.
    if (shotDir) {
      const s = await page(browser);
      const shot = await drive(s.p, { seed, shotWhen: kind === 'blackIce' ? 'visible' : 'tele' });
      await s.p.evaluate(() => window.__bbGame.step(performance.now(), 16.7));
      await s.p.screenshot({ path: `${shotDir}/kodiak-${kind}.png` });
      console.log('KODIAK_SHOT', kind, JSON.stringify(shot.shot));
      await s.p.close();
    }
  }
  // Level gate
  const low = await page(browser);
  const lr = await drive(low.p, { seed: SEEDS.bruteForce, level: 1, maxMs: 6000 });
  assert.equal(lr.kodiaksOn, false);
  assert.deepEqual(lr.events, [], 'a bear appeared below the Sync Level gate');
  console.log('KODIAK_LEVEL_GATE_PASS');
  await low.p.close();
  // Determinism: a run that ends on a bear replays exactly from its tape at 30 and 120 Hz.
  const rec = await page(browser);
  const recorded = await drive(rec.p, { seed: SEEDS.bruteForce });
  await rec.p.close();
  if (recorded.tape) {
    for (const hz of [30, 120]) {
      const rp = await page(browser);
      const r = await drive(rp.p, { seed: SEEDS.bruteForce, hz, tape: recorded.tape });
      assert.equal(r.replay.desync, null, `${hz} Hz Kodiak replay desynced`);
      assert.equal(r.tick, recorded.tick, `${hz} Hz replay ended on tick ${r.tick}, recording on ${recorded.tick}`);
      console.log('KODIAK_REPLAY_PASS', hz, JSON.stringify({ checked: r.replay.checked, tick: r.tick }));
      await rp.p.close();
    }
  } else console.log('KODIAK_REPLAY_SKIPPED (recording did not end in a crash, so no tape)');
} finally { await browser.close(); }
