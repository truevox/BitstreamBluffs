#!/usr/bin/env node
/**
 * EXPERIMENTAL / NON-PRODUCTION (issue #119 Phase 1). Savestate equivalence in the REAL built game.
 *
 *   npm run build && npx vite preview --port 8414 --strictPort &
 *   GAME_URL=http://localhost:8414/ node tools/savestate-experiment/browser-experiment.mjs [--json out.json] [--quick]
 *
 * Every case uses two isolated browser contexts (fresh storage, fresh Phaser game, fresh Matter world):
 *   A  plays ticks 1..K uninterrupted, then a diagnostic snapshot is taken (JSON round-trip through Node).
 *   B  is a FRESH RunScene with the same seed/config held at tick 0; the snapshot is restored at a LEVEL, then
 *      A and B are stepped in lockstep K+1..N with the identical tick-indexed input tape.
 * Per tick both pages report diagnostic sub-system digests (non-authoritative; #152 owns real hashes); the
 * first divergent tick and the sub-systems that differ there are reported.
 *
 * Frames are stepped with game.step(t, 1000/120): exactly one sim tick per display frame, so a frame boundary is
 * a tick boundary and renderFrame still runs every tick (the #155 camera read stays in play).
 *
 * Fixtures:
 *   contact  seed SAVE119, scramble forced on (RNG stream exercised), push/hop/tilt/heli/tuck tape on terrain.
 *   hazard   seed SAVE119H@2047 (all biomes), sled placed at x=107000 before tick 1 (a Gear Gate cluster: timed
 *            moving hazards), Kodiaks forced on (two packs spawn), 99 shield charges so hits are absorbed, not fatal.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL_ = process.env.GAME_URL || 'http://localhost:8414/';
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium_headless_shell';
const argv = process.argv.slice(2);
const QUICK = argv.includes('--quick');
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

const matterKitSrc = readFileSync(path.join(here, 'matter-snapshot-kit.js'), 'utf8').replace(/^export /gm, '')
  + '\nwindow.__ssMatterKit = createMatterSnapshotKit(Phaser.Physics.Matter.Matter);\n';
const gameKitSrc = readFileSync(path.join(here, 'game-state-kit.js'), 'utf8');

// Tick-indexed tape (120 Hz ticks). Held ranges [from, to) and one-shot edges.
const TAPES = {
  contact: {
    held: [
      { key: 'push', from: 0, to: 216 }, { key: 'heli', value: 1, from: 324, to: 348 }, { key: 'tilt', value: -1, from: 360, to: 444 },
      { key: 'push', from: 504, to: 624 }, { key: 'tilt', value: 1, from: 732, to: 780 }, { key: 'tuck', from: 840, to: 984 },
      { key: 'push', from: 1000, to: 1100 }, { key: 'tilt', value: -1, from: 1150, to: 1190 },
    ],
    edges: [{ key: 'hop', at: 312 }, { key: 'hop', at: 708 }, { key: 'hop', at: 1120 }],
  },
  hazard: {
    held: [{ key: 'push', from: 0, to: 300 }, { key: 'tuck', from: 400, to: 700 }, { key: 'push', from: 760, to: 900 }],
    edges: [{ key: 'hop', at: 250 }, { key: 'hop', at: 520 }, { key: 'hop', at: 830 }, { key: 'hop', at: 1010 }],
  },
};
const FIXTURES = {
  contact: { seed: 'SAVE119', scramble: true, startX: null, kodiaks: false, K: 600, N: QUICK ? 900 : 1100 },
  hazard: { seed: 'SAVE119H@2047', scramble: false, startX: 107000, kodiaks: true, shields: 99, K: 480, N: QUICK ? 760 : 1000 },
};

async function bootPage(browser, fx, tape) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(), null, { timeout: 30000 });
  await page.addScriptTag({ content: matterKitSrc });
  await page.addScriptTag({ content: gameKitSrc });
  await page.evaluate(async ({ fx, tape }) => {
    const g = window.__bbGame;
    const run = g.scene.getScene('RunScene');
    const realUpdate = run.update;
    let hold = true;
    run.update = function (t, d) { if (!hold) return realUpdate.call(this, t, d); };
    g.scene.getScene('TitleScene').startRun(fx.seed);
    await new Promise((res) => { const w = () => (run.sys.isActive() && run.sled ? res() : requestAnimationFrame(w)); w(); });
    g.loop.sleep();
    if (fx.scramble) run.scrambleMs = 1e9;
    if (fx.kodiaks) run.kodiaksOn = true;
    if (fx.shields) run.shieldCharges = fx.shields; // hazard hits are absorbed (and scored as hits), so the run survives
    if (fx.startX != null) {
      run.streamTerrain(fx.startX);
      run.sled.setPose(fx.startX, run.terrain.heightAt(fx.startX) - 15, run.slopeAt(fx.startX), 420, 0);
    }
    run.inputRouter.poll = () => {
      const tick = run.simClock.tick + 1; // the tick this poll feeds (one tick per frame)
      const pad = { push: false, tilt: 0, heli: 0, tuck: false, hop: false, pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false } };
      for (const h of tape.held) if (tick >= h.from && tick < h.to) pad[h.key] = h.value ?? true;
      for (const e of tape.edges) if (tick === e.at) { pad.pressed[e.key] = true; pad[e.key] = true; }
      return pad;
    };
    window.__ss = { g, run, t: 0, step(n) { for (let i = 0; i < n; i++) { this.t += 1000 / 120; g.step(this.t, 1000 / 120); } return run.simClock.tick; } };
    hold = false;
  }, { fx, tape });
  return { ctx, page, errors };
}

/** Leaf paths where two capture trees differ (first `max`). */
function leafDiff(a, b, path = '', out = [], max = 25) {
  if (out.length >= max) return out;
  if (a === b || (typeof a === 'number' && typeof b === 'number' && Object.is(a, b))) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (k === '__id' || k === '__alias') continue;
      leafDiff(a[k], b[k], `${path}.${k}`, out, max);
    }
    return out;
  }
  out.push(`${path}: A=${JSON.stringify(a)?.slice(0, 60)} B=${JSON.stringify(b)?.slice(0, 60)}`);
  return out;
}

function compareDigests(a, b) {
  const diff = [];
  for (const k of Object.keys(a)) {
    if (k.startsWith('__')) continue;
    if (a[k] !== b[k]) diff.push(k);
  }
  for (const k of Object.keys(b)) if (!k.startsWith('__') && !(k in a)) diff.push(`${k}(only B)`);
  const sa = a.__sled, sb = b.__sled;
  const sledExact = sa.every((v, i) => Object.is(v, sb[i]));
  return { diff, sledExact, posErr: Math.hypot(sa[0] - sb[0], sa[1] - sb[1]), scoreErr: Math.abs(a.__score - b.__score) };
}

async function runCase(browser, fxName, level, skip = []) {
  const fx = FIXTURES[fxName];
  const tape = TAPES[fxName];
  const A = await bootPage(browser, fx, tape);
  const B = await bootPage(browser, fx, tape);
  try {
    let fixtureStats = null;
    let snapBytes = 0, restoreLog = [], classes = null, audit = [];
    if (level !== 'control') {
      await A.page.evaluate((K) => window.__ss.step(K), fx.K);
      fixtureStats = await A.page.evaluate(() => {
        const run = window.__ss.run; let hz = 0, moving = 0, hit = 0;
        for (const l of run.hazards.values()) for (const h of l) { hz++; if (h.motion) moving++; if (h.hit) hit++; }
        const e = run.matter.world.engine;
        return { tick: run.simClock.tick, sledX: run.sled.x, hazards: hz, movingHazards: moving, hazardsHit: hit, kodiaksOut: run.kodiaks.length, kodiakNext: run.kodiakNext,
          pairs: e.pairs.list.length, activePairs: e.pairs.list.filter((p) => p.isActive && !p.isSensor).length, worldBodies: e.world.bodies.length, pool: run.mesh._bodyPool.length,
          chunks: run.mesh.chunks.size, score: run.score.getTotal(), crashed: run.crashed, nextId: Phaser.Physics.Matter.Matter.Common._nextId };
      });
      const json = await A.page.evaluate(() => JSON.stringify(window.__ssGameKit.capture(window.__ss.run, { withConfig: true })));
      snapBytes = json.length;
      const parsed = JSON.parse(json);
      classes = parsed.classes; audit = parsed.audit;
      const r = await B.page.evaluate(({ json, level, skip }) => {
        try { return { ok: true, ...window.__ssGameKit.restore(window.__ss.run, JSON.parse(json), level, { skip }) }; } catch (e) { return { ok: false, error: String(e.message || e) }; }
      }, { json, level, skip });
      if (!r.ok) return { fixture: fxName, level, skip: skip.join('+') || '-', restoreError: r.error, snapBytes, audit };
      restoreLog = r.log || [];
    } else {
      // control: two uninterrupted runs, both played to K, then compared K+1..N (digest determinism baseline)
      await Promise.all([A, B].map((P) => P.page.evaluate((K) => window.__ss.step(K), fx.K)));
    }
    const K = fx.K;
    const firstBy = {};
    let firstLeaves = null;
    let first = null, firstDiff = null, firstSled = null, maxPos = 0, crashA = null, crashB = null, endPos = 0, ticks = 0;
    const BATCH = 60;
    outer: for (let t0 = K + 1; t0 <= fx.N; t0 += BATCH) {
      const n = Math.min(BATCH, fx.N - t0 + 1);
      const [ba, bb] = await Promise.all([A, B].map((P) => P.page.evaluate((n) => window.__ssGameKit.runBatch(window.__ss, n), n)));
      for (let i = 0; i < n; i++) {
        const da = ba[i], db = bb[i], t = t0 + i;
        if (!da || !db) break outer;
        ticks++;
        const c = compareDigests(da, db);
        for (const k of c.diff) if (!(k in firstBy)) firstBy[k] = t;
        if (c.diff.length && first === null) {
          first = t; firstDiff = c.diff;
          const cap = (tt) => JSON.stringify(window.__ss.ring.get(tt));
          const [ca, cb] = (await Promise.all([A.page.evaluate(cap, t), B.page.evaluate(cap, t)])).map((j) => JSON.parse(j));
          firstLeaves = [];
          for (const k of c.diff) {
            if (k === 'matter.worldOrder' || k === 'matter.detectorOrder') { const f = k.slice(7); const i = ca.matter[f].findIndex((x, j) => x !== cb.matter[f][j]); firstLeaves.push(`${k}[${i}]: A=${ca.matter[f][i]} B=${cb.matter[f][i]} (len ${ca.matter[f].length}/${cb.matter[f].length})`); }
            else if (k.startsWith('matter.')) leafDiff(ca.matter[k.slice(7)], cb.matter[k.slice(7)], k, firstLeaves, firstLeaves.length + 6);
            else if (k === 'pool') leafDiff(ca.pool, cb.pool, 'pool', firstLeaves, firstLeaves.length + 6);
            else if (k.startsWith('camera')) leafDiff(ca.camera, cb.camera, 'camera', firstLeaves, firstLeaves.length + 6);
            else leafDiff(ca.game[k], cb.game[k], k, firstLeaves, firstLeaves.length + 4);
          }
        }
        if (!c.sledExact && firstSled === null) firstSled = t;
        maxPos = Math.max(maxPos, c.posErr); endPos = c.posErr;
        if (da.__crashed && crashA === null) crashA = t;
        if (db.__crashed && crashB === null) crashB = t;
        if (crashA !== null && crashB !== null && t > Math.max(crashA, crashB) + 30) break outer;
      }
    }
    const errors = [...A.errors, ...B.errors];
    return {
      fixture: fxName, level, skip: skip.join('+') || '-', K, N: fx.N, ticksCompared: ticks, snapBytes, fixtureStats,
      firstDivergentTick: first, ticksAfterRestore: first === null ? null : first - K, subsystemsAtFirst: firstDiff,
      firstSledDivergentTick: firstSled, firstLeaves, firstDivergenceBySubsystem: firstBy, maxSledPosErrPx: +maxPos.toFixed(4), endSledPosErrPx: +endPos.toFixed(4),
      crashTickA: crashA, crashTickB: crashB, restoreLog: restoreLog.slice(0, 12), restoreLogCount: restoreLog.length,
      audit, classes: classes && Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, v.length])), unclassified: classes?.unclassified, pageErrors: errors,
    };
  } finally {
    await A.ctx.close(); await B.ctx.close();
  }
}

const browser = await chromium.launch({ headless: true, executablePath: EXE, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const results = [];
const plan = [];
for (const fx of ['contact', 'hazard']) {
  plan.push([fx, 'control'], [fx, 'ghost'], [fx, 'game'], [fx, 'kinematic'], [fx, 'contacts'], [fx, 'full']);
  for (const s of ['camera', 'ids', 'runRandom', 'impulses', 'staleSupport', 'timing', 'positionImpulse', 'rawGeometry']) plan.push([fx, 'full', [s]]);
  if (fx === 'hazard') for (const s of ['kodiaks', 'bsod', 'hazardHit', 'pool']) plan.push([fx, 'full', [s]]);
}
try {
  for (const [fx, level, skip] of plan) {
    const key = `${fx}:${level}${skip ? `-${skip.join('+')}` : ''}`;
    if (ONLY && !ONLY.some((o) => key.startsWith(o))) continue;
    const t0 = Date.now();
    let r;
    try { r = await runCase(browser, fx, level, skip || []); } catch (e) { r = { fixture: fx, level, skip: (skip || []).join('+') || '-', harnessError: String(e.message || e).slice(0, 300) }; }
    r.wallMs = Date.now() - t0;
    results.push(r);
    if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 1));
    console.log(`${key.padEnd(30)} firstDiv=${String(r.firstDivergentTick).padEnd(5)} (+${r.ticksAfterRestore ?? '-'}) sledDiv=${String(r.firstSledDivergentTick).padEnd(5)} maxPos=${r.maxSledPosErrPx ?? '-'} end=${r.endSledPosErrPx ?? '-'} crash=${r.crashTickA}/${r.crashTickB} ticks=${r.ticksCompared ?? '-'} at=${JSON.stringify(r.subsystemsAtFirst || r.restoreError || r.harnessError || null)}`);
  }
} finally { await browser.close(); }
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 1));
