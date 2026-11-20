/** Issue #56: ghost tapes end to end in the REAL game (minified build, Phaser + Matter).
 *
 *   GAME_URL=http://localhost:8293/ SHOT_DIR=/tmp/shots node tools/ghost-tape-browser-smoke.mjs
 *
 *  1. RECORD: a 60 Hz run with a scripted input tape until it crashes. The game saves a
 *     ghost tape; the course gets Latest = Best = that run.
 *  2. REPLAY: fresh pages feed only the tape back at 30 Hz and at 120 Hz. Every checkpoint
 *     must match exactly, and the replay must crash on the same tick.
 *  3. GHOST: a new run on the same course (same browser profile, so IndexedDB persists)
 *     draws one BEST+LAST ghost on the recorded trace. Screenshot for review.
 *  4. ISOLATION: the same live inputs with the ghost on screen produce exactly the original
 *     checkpoints, so a ghost cannot touch physics.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.GAME_URL || 'http://localhost:8293/';
const shotDir = process.env.SHOT_DIR || null;
const SEED = process.env.SEED || 'GHOST56';
const MAX_MS = 20000;
// Scripted live input (run-clock ms, multiples of 100 so every rate sees it on the same tick).
const SCRIPT = {
  held: [{ key: 'push', from: 0, to: 1800 }, { key: 'push', from: 4200, to: 5200 }, { key: 'tuck', from: 7000, to: 8200 },
    { key: 'tilt', value: -1, from: 10000, to: 11500 }],
  edges: [{ key: 'hop', at: 2600 }, { key: 'hop', at: 5900 }, { key: 'hop', at: 9800 }],
};

/** In-page: start a run held at tick 0, then drive frames at `hz`. */
async function drive(page, { hz, seed, maxMs, script, tape, untilMs, shot }) {
  return page.evaluate(async ({ hz, seed, maxMs, script, tape, untilMs }) => {
    const g = window.__bbGame;
    const run = g.scene.getScene('RunScene');
    if (!run.__realUpdate) run.__realUpdate = run.update;
    let hold = true;
    run.update = function (t, d) { if (!hold) return run.__realUpdate.call(this, t, d); };
    if (tape) g.registry.set('ghostReplay', tape);
    g.scene.getScene('TitleScene').startRun(seed);
    await new Promise((res) => { const w = () => (run.sys.isActive() && run.sled ? res() : requestAnimationFrame(w)); w(); });
    // Ghosts load from IndexedDB asynchronously; give them a moment before the first tick.
    await new Promise((r) => setTimeout(r, 300));
    g.loop.sleep();
    let clock = 0;
    const pending = (script?.edges || []).map((e) => ({ ...e, fired: false }));
    run.inputRouter.poll = () => {
      const pad = { push: false, tilt: 0, tuck: false, hop: false, pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false } };
      if (script) {
        for (const h of script.held) if (clock >= h.from && clock < h.to) pad[h.key] = h.value ?? true;
        for (const e of pending) if (!e.fired && clock >= e.at) { e.fired = true; pad.pressed[e.key] = true; pad[e.key] = true; }
      }
      return pad;
    };
    hold = false;
    const dt = 1000 / hz;
    let t = 0;
    const tickMs = run.simClock.tickMs;
    const stop = untilMs ?? maxMs;
    while (!run.crashed && run.simClock.tick * tickMs < stop) {
      clock = Math.round(run.simClock.tick * tickMs * 1000) / 1000;
      t += dt;
      g.step(t, dt);
    }
    // The library writes the tape asynchronously (IndexedDB) after the crash.
    if (run.crashed) await new Promise((r) => setTimeout(r, 600));
    const cam = run.cameras.main;
    const ghosts = (run.ghostRiders || []).map((r) => {
      const p = r.trace.length ? { x: r.gfx ? 0 : 0 } : null;
      return { runId: r.runId, roles: r.roles, visible: r.visible, onScreen: cam.worldView.contains(r.label.x, r.label.y) };
    });
    return {
      crashed: !!run.crashed, tick: run.simClock.tick, x: run.sled.x,
      tape: g.registry.get('lastGhostTape') || null,
      replay: run.tapePlayer ? { desync: run.tapePlayer.desync, checked: run.tapePlayer.checked } : null,
      ghosts,
      course: g.registry.get('ghostLibrary')?.course(seed, 0) || null,
      recorderCheckpoints: run.ghostRecorder?.checkpoints || null,
    };
  }, { hz, seed, maxMs, script, tape, untilMs });
}

async function freshPage(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive() && window.__bbGame.registry.get('ghostLibrary'), null, { timeout: 30000 });
  return { page, errors };
}

const profile = await mkdtemp(join(tmpdir(), 'bb-ghost-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: true, viewport: { width: 960, height: 540 },
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
try {
  if (process.env.ONLY_FAVORITES !== '1') {
  // 1. RECORD
  const rec = await freshPage(ctx);
  const recorded = await drive(rec.page, { hz: 60, seed: SEED, maxMs: MAX_MS, script: SCRIPT });
  assert.equal(recorded.crashed, true, `run did not crash within ${MAX_MS} ms; pick another SEED`);
  const tape = recorded.tape;
  assert.ok(tape && tape.runId, 'no ghost tape saved at the crash');
  assert.ok(tape.checkpoints.length >= 5, 'too few checkpoints');
  assert.equal(recorded.course?.latest, tape.runId);
  assert.equal(recorded.course?.best, tape.runId);
  const size = JSON.stringify(tape).length;
  console.log('GHOST_RECORD_PASS', JSON.stringify({ runId: tape.runId, endTick: tape.endTick, crashTick: recorded.tick, distanceM: tape.distanceM,
    inputs: tape.inputs.length, checkpoints: tape.checkpoints.length, bytes: size }));
  assert.deepEqual(rec.errors, []);
  await rec.page.close();

  // 2. REPLAY at other display rates, from the tape alone
  for (const hz of [30, 120]) {
    const p = await freshPage(ctx);
    const r = await drive(p.page, { hz, seed: SEED, maxMs: MAX_MS, tape });
    assert.equal(r.replay.desync, null, `${hz} Hz replay desynced: ${JSON.stringify(r.replay.desync)}`);
    assert.equal(r.replay.checked, tape.checkpoints.length, `${hz} Hz checked ${r.replay.checked}/${tape.checkpoints.length} checkpoints`);
    assert.equal(r.crashed, true, `${hz} Hz replay did not crash`);
    assert.equal(r.tick, recorded.tick, `${hz} Hz replay crashed on tick ${r.tick}, recording on ${recorded.tick}`);
    assert.deepEqual(p.errors, []);
    console.log('GHOST_REPLAY_PASS', hz, JSON.stringify({ checked: r.replay.checked, crashTick: r.tick, x: +r.x.toFixed(2) }));
    await p.page.close();
  }

  // 3. GHOST on the next run of the course
  const gp = await freshPage(ctx);
  // The live rider brakes, so the recorded ghost pulls visibly ahead for the screenshot.
  const ghostRun = await drive(gp.page, { hz: 60, seed: SEED, maxMs: MAX_MS, untilMs: 2000, script: { held: [{ key: 'brake', from: 0, to: 700 }], edges: [] } });
  assert.equal(ghostRun.ghosts.length, 1, `expected one deduped ghost, got ${JSON.stringify(ghostRun.ghosts)}`);
  assert.deepEqual([...ghostRun.ghosts[0].roles].sort(), ['best', 'latest']);
  assert.equal(ghostRun.ghosts[0].visible, true);
  if (shotDir) {
    await gp.page.evaluate(() => { const g = window.__bbGame; g.step(performance.now(), 16.7); });
    await gp.page.screenshot({ path: `${shotDir}/ghost-best-latest.png` });
  }
  assert.deepEqual(gp.errors, []);
  console.log('GHOST_DRAW_PASS', JSON.stringify(ghostRun.ghosts));
  await gp.page.close();

  // 4. ISOLATION: same live inputs with the ghost visible -> identical checkpoints
  const ip = await freshPage(ctx);
  const iso = await drive(ip.page, { hz: 60, seed: SEED, maxMs: MAX_MS, script: SCRIPT });
  assert.equal(iso.ghosts.length >= 1, true, 'ghost not present during the isolation run');
  assert.equal(iso.crashed, true);
  assert.equal(iso.tick, recorded.tick, 'ghost changed when the run crashed');
  assert.deepEqual(iso.tape.checkpoints, tape.checkpoints, 'ghost on screen changed the physics');
  assert.deepEqual(iso.tape.inputs, tape.inputs);
  assert.deepEqual(ip.errors, []);
  console.log('GHOST_ISOLATION_PASS', JSON.stringify({ checkpoints: iso.tape.checkpoints.length, crashTick: iso.tick, ghosts: iso.ghosts.length }));
  await ip.page.close();

  }

  // 5. FAVORITES from Game Over: G opens the menu, Enter pins this run as FAV A, Right turns it off.
  const fp = await freshPage(ctx);
  await fp.page.evaluate(() => window.__bbGame.scene.getScene('TitleScene').startRun('GHOSTFAV'));
  await fp.page.waitForFunction(() => window.__bbGame.scene.getScene('RunScene')?.sled, null, { timeout: 30000 });
  await fp.page.waitForTimeout(2500);
  await fp.page.evaluate(() => { window.__bbGame.scene.getScene('RunScene').pendingCrash = { cause: 'chasm' }; });
  await fp.page.waitForFunction(() => window.__bbGame.scene.getScene('GameOverScene')?.sys?.isActive() && window.__bbGame.scene.getScene('GameOverScene').ghostBtn, null, { timeout: 30000 }).catch(async () => { throw new Error('no GHOST FAV button: ' + await fp.page.evaluate(() => { const g = window.__bbGame; return JSON.stringify({ go: g.scene.getScene('GameOverScene')?.sys?.isActive(), tape: g.registry.get('lastGhostTape')?.runId, rec: g.registry.get('lastRecord')?.id }); })); });
  await fp.page.waitForTimeout(1500);
  await fp.page.keyboard.press('g');
  await fp.page.waitForFunction(() => window.__bbGame.scene.getScene('GameOverScene').ghostView, null, { timeout: 5000 }).catch((e) => { throw new Error(`favorites step failed: ${e.message.split('\n')[0]}`); });
  await fp.page.keyboard.press('Enter');
  await fp.page.waitForFunction(() => { const g = window.__bbGame; const t = g.registry.get('lastGhostTape');
    return g.registry.get('ghostLibrary').course('GHOSTFAV', 0)?.favorites?.[0] === t.runId; }, null, { timeout: 5000 }).catch((e) => { throw new Error(`favorites step failed: ${e.message.split('\n')[0]}`); });
  await fp.page.waitForTimeout(300);
  if (shotDir) await fp.page.screenshot({ path: `${shotDir}/ghost-favorites.png` });
  await fp.page.keyboard.press('ArrowRight');
  await fp.page.waitForFunction(() => window.__bbGame.registry.get('ghostLibrary').course('GHOSTFAV', 0)?.show?.fav0 === false, null, { timeout: 5000 }).catch((e) => { throw new Error(`favorites step failed: ${e.message.split('\n')[0]}`); });
  await fp.page.waitForTimeout(400); // menu input debounces repeated directions
  await fp.page.keyboard.press('ArrowRight');
  await fp.page.waitForFunction(() => window.__bbGame.registry.get('ghostLibrary').course('GHOSTFAV', 0)?.show?.fav0 === true, null, { timeout: 5000 }).catch((e) => { throw new Error(`favorites step failed: ${e.message.split('\n')[0]}`); });
  await fp.page.keyboard.press('Escape');
  await fp.page.waitForFunction(() => !window.__bbGame.scene.getScene('GameOverScene').ghostView, null, { timeout: 5000 }).catch((e) => { throw new Error(`favorites step failed: ${e.message.split('\n')[0]}`); });
  const stillOver = await fp.page.evaluate(() => window.__bbGame.scene.getScene('GameOverScene').sys.isActive());
  assert.equal(stillOver, true, 'closing the favorites menu must stay on Game Over');
  assert.deepEqual(fp.errors, []);
  await fp.page.close();
  const np = await freshPage(ctx);
  const favRun = await drive(np.page, { hz: 60, seed: 'GHOSTFAV', maxMs: MAX_MS, untilMs: 500 });
  assert.equal(favRun.ghosts.length, 1);
  assert.deepEqual([...favRun.ghosts[0].roles].sort(), ['best', 'fav0', 'latest']);
  assert.deepEqual(np.errors, []);
  console.log('GHOST_FAVORITES_PASS', JSON.stringify(favRun.ghosts));
  await np.page.close();
} finally {
  await ctx.close();
  await rm(profile, { recursive: true, force: true });
}
