/** Shard Magnet in the REAL game (minified build, Phaser + Matter), driven tick-exactly.
 *
 *   GAME_URL=http://localhost:8293/ SHOT_DIR=/tmp/shots node tools/shard-magnet-browser-smoke.mjs
 *
 * Same seed, same input tape, same 60 Hz frame schedule:
 *  - NONE: no magnet. Baseline shard count.
 *  - BASE: the magnet active the whole run at rank 0. Must collect more shards.
 *  - UPGRADED: MAGNET PULL near its soft cap. Must collect at least as many as BASE.
 *  - BASE again: identical result (the pull is deterministic, so ghost tapes stay exact).
 * Also counts Shard Magnet pickups streamed on the course, and screenshots the black hole.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.env.GAME_URL || 'http://localhost:8293/';
const shotDir = process.env.SHOT_DIR || null;
const SEED = process.env.SEED || 'RPLAY59';
const SIM_MS = 12000;
const TAPE = { held: [{ key: 'push', from: 0, to: 1800 }, { key: 'push', from: 4200, to: 5200 }, { key: 'tuck', from: 7000, to: 8200 }],
  edges: [{ key: 'hop', at: 2600 }, { key: 'hop', at: 5900 }] };

async function run(label, { magnet, magnetMul, shotAtMs }) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(), null, { timeout: 30000 });
    const out = await page.evaluate(async ({ seed, simMs, tape, magnet, magnetMul, shotAtMs }) => {
      const g = window.__bbGame;
      const run = g.scene.getScene('RunScene');
      const real = run.update;
      let hold = true;
      run.update = function (t, d) { if (!hold) return real.call(this, t, d); };
      g.scene.getScene('TitleScene').startRun(seed);
      await new Promise((res) => { const w = () => (run.sys.isActive() && run.sled ? res() : requestAnimationFrame(w)); w(); });
      g.loop.sleep();
      if (magnet) {
        const def = run.content.powerups.shardMagnet;
        run.magnetMs = 1e9; run.magnetEff = def.effect; run.magnetId = def.id;
      }
      if (magnetMul) run.upgradeFx = { ...run.upgradeFx, magnetMul };
      let clock = 0;
      const pending = tape.edges.map((e) => ({ ...e, fired: false }));
      run.inputRouter.poll = () => {
        const pad = { push: false, tilt: 0, tuck: false, hop: false, pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false } };
        for (const h of tape.held) if (clock >= h.from && clock < h.to) pad[h.key] = h.value ?? true;
        for (const e of pending) if (!e.fired && clock >= e.at) { e.fired = true; pad.pressed[e.key] = true; pad[e.key] = true; }
        return pad;
      };
      hold = false;
      const magnets = new Set();
      let t = 0, shot = false;
      const tickMs = run.simClock.tickMs;
      while (!run.crashed && run.simClock.tick * tickMs < simMs) {
        clock = Math.round(run.simClock.tick * tickMs * 1000) / 1000;
        t += 1000 / 60;
        g.step(t, 1000 / 60);
        for (const list of run.powerups.values()) for (const p of list) if (String(p.key).endsWith(':magnet')) magnets.add(p.key);
        if (shotAtMs && !shot && clock >= shotAtMs) { shot = true; window.__shotReady = true; break; }
      }
      return { shards: run.shardCount || 0, x: run.sled.x, tick: run.simClock.tick, crashed: !!run.crashed, magnets: [...magnets] };
    }, { seed: SEED, simMs: SIM_MS, tape: TAPE, magnet, magnetMul, shotAtMs });
    if (shotAtMs && shotDir) {
      await page.evaluate(() => window.__bbGame.step(performance.now(), 16.7));
      await page.screenshot({ path: `${shotDir}/shard-magnet-black-hole.png` });
    }
    assert.deepEqual(errors, [], `${label}: page errors`);
    return out;
  } finally { await browser.close(); }
}

const none = await run('none', {});
const base = await run('base', { magnet: true });
const upgraded = await run('upgraded', { magnet: true, magnetMul: 2.4 });
const again = await run('base-again', { magnet: true });
console.log('MAGNET_COUNTS', JSON.stringify({ none: none.shards, base: base.shards, upgraded: upgraded.shards, crashed: [none.crashed, base.crashed, upgraded.crashed] }));
assert.ok(base.shards > none.shards, `magnet did not collect more shards (${base.shards} vs ${none.shards})`);
assert.ok(upgraded.shards >= base.shards, `upgraded magnet collected fewer shards (${upgraded.shards} vs ${base.shards})`);
assert.equal(again.shards, base.shards, 'magnet run not deterministic (shards)');
assert.equal(again.x, base.x, 'magnet run not deterministic (position)');
console.log('MAGNET_PULL_PASS');
console.log('MAGNET_SPAWNS_ON_COURSE', JSON.stringify(none.magnets));
assert.ok(none.magnets.length >= 1, 'no Shard Magnet pickup streamed in 12 s of course');
console.log('MAGNET_SPAWN_PASS');
if (shotDir) { await run('shot', { magnet: true, magnetMul: 1.8, shotAtMs: Number(process.env.SHOT_AT_MS || 3000) }); console.log('MAGNET_SHOT', `${shotDir}/shard-magnet-black-hole.png`); }
