#!/usr/bin/env node
/**
 * Issue #119 (canonical colliders): before/after measurement in the REAL built game. Diagnostic only.
 *
 *   npm run build && npx vite preview --port 8414 --strictPort &
 *   GAME_URL=http://localhost:8414/ node tools/determinism/collider-pool-measure.mjs [--label before]
 *
 * Two fixtures, stepped one 120 Hz tick per frame with a scripted tape (no wall clock reaches the sim):
 *   long    seed SAVE119, 6000 ticks (50 s) of normal riding from the start
 *   jump    seed SAVE119H@2047, sled placed at x=107000 before tick 1 (the savestate study's hazard fixture), 1000 ticks
 * Reports: ms per tick (median of 5 reps of 500-tick blocks), Matter bodies created, pooled bodies held, world bodies,
 * JS heap, the size of a JSON dump of every collider's geometry (the part a savestate must carry), and the sled pose
 * at the end (to show the physics change is sub-pixel and the run plays the same).
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const URL_ = process.env.GAME_URL || 'http://localhost:8414/';
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium_headless_shell';
const label = process.argv.includes('--label') ? process.argv[process.argv.indexOf('--label') + 1] : 'run';

const FIX = {
  long: { seed: 'SAVE119', startX: null, ticks: 6000 },
  jump: { seed: 'SAVE119H@2047', startX: 107000, ticks: 1000, shields: 99 },
};

const browser = await chromium.launch({ headless: true, executablePath: EXE, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const out = { label };
try {
  for (const [name, fx] of Object.entries(FIX)) {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await ctx.newPage();
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(), null, { timeout: 30000 });
    out[name] = await page.evaluate(async (fx) => {
      const g = window.__bbGame; const run = g.scene.getScene('RunScene');
      const real = run.update; let hold = true;
      run.update = function (t, d) { if (!hold) return real.call(this, t, d); };
      g.scene.getScene('TitleScene').startRun(fx.seed);
      await new Promise((res) => { const w = () => (run.sys.isActive() && run.sled ? res() : requestAnimationFrame(w)); w(); });
      g.loop.sleep();
      if (fx.shields) run.shieldCharges = fx.shields;
      const M = Phaser.Physics.Matter.Matter;
      const id0 = M.Common._nextId;
      if (fx.startX != null) { run.streamTerrain(fx.startX); run.sled.setPose(fx.startX, run.terrain.heightAt(fx.startX) - 15, run.slopeAt(fx.startX), 420, 0); }
      run.inputRouter.poll = () => { const tick = run.simClock.tick + 1; const pad = { push: tick % 400 < 220, tilt: 0, heli: 0, tuck: tick % 900 > 700, hop: false, pressed: { hop: tick % 333 === 0, reset: false, pause: false, airBrake: false, parachute: false, confirm: false } }; pad.hop = pad.pressed.hop; return pad; };
      hold = false;
      let t = 0; const blocks = [];
      const step = (n) => { const s = performance.now(); for (let i = 0; i < n && !run.crashed; i++) { t += 1000 / 120; g.step(t, 1000 / 120); } return performance.now() - s; };
      for (let done = 0; done < fx.ticks && !run.crashed; done += 500) blocks.push(step(Math.min(500, fx.ticks - done)) / Math.min(500, fx.ticks - done));
      const sorted = [...blocks].sort((a, b) => a - b);
      const e = run.matter.world.engine;
      const all = M.Composite.allBodies(e.world);
      const pool = run.mesh._bodyPool || [];
      const geo = (b) => [b.position.x, b.position.y, ...b.vertices.flatMap((v) => [v.x, v.y])];
      const b = run.sled.body;
      return {
        ticks: run.simClock.tick, crashed: !!run.crashed, msPerTickMedian: +sorted[Math.floor(sorted.length / 2)].toFixed(3),
        msPerTickBlocks: blocks.map((x) => +x.toFixed(3)), matterIdsConsumed: M.Common._nextId - id0, bodiesCreatedByMesh: run.mesh.stats.bodiesCreated,
        pooledBodies: pool.length, worldBodies: all.length, chunks: run.mesh.chunks.size,
        colliderGeometryJsonBytes: JSON.stringify([...all, ...pool].filter((x) => x.label === 'terrain').map(geo)).length,
        heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
        sledEnd: { x: b.position.x, y: b.position.y, angle: b.angle }, score: run.score.getTotal(),
      };
    }, fx);
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify(out, null, 1));
