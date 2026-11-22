/**
 * Issue #140: simulation / presentation CAUSAL ISOLATION probe on the REAL built game.
 *
 *   npm run build && npx vite preview --port 8411 --strictPort &
 *   GAME_URL=http://localhost:8411/ node tools/conformance/causal-isolation-probe.mjs
 *
 * Env: FIXTURES=tricks,hazards,kodiak,bsod  CASES=baseline-repeat,cadence-144,...  OUT=matrix.json
 *      PARALLEL=3  EXPECT_ISOLATION=1 (exit 1 on an unexpected leak)
 *      RESULTS=cells.json: every finished cell is written there as soon as it completes, keyed by build
 *      (the hashed entry script of the served page) + fixture + case; a rerun skips finished cells.
 *
 * Every run gets a fresh Chromium page, RunScene.update is held until the scene exists, the
 * game loop is put to sleep and frames are stepped with game.step(t, dt). Input comes from a
 * PER-TICK tape installed as run.tapePlayer (the ghost-replay hook), so changing the render
 * cadence changes only how many ticks run inside each display frame, never which input a tick
 * sees. (Frame->tick input sampling is issue #115; the `*-polled` cases show that separately.)
 *
 * After every simTick the diagnostic digest (tools/conformance/causal-digest.mjs, NON-AUTHORITATIVE,
 * to be replaced by the issue #152 contract) captures sled compound pose/velocity, the
 * physics/scramble RNG state, Matter world membership and order, contact-pair warm-start
 * impulses, terrain chunks, hazards, pickups, Kodiaks, score, BSOD, crash, timers, plus the
 * gameplay cues (telegraph, SFX, events, crash report). Each perturbation is compared with the
 * fixture's 60 Hz baseline: first divergent tick and subsystem.
 *
 * This file does not edit or import tools/replay-determinism-browser-probe.mjs.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import {
  captureCausalState, safeJson, fnv1a, digestState, instrumentRun, diffDigests, verdict, subsystemClass,
} from './causal-digest.mjs';

const url = process.env.GAME_URL || 'http://localhost:8411/';
const ARGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];
// CHROMIUM_PATH overrides the browser; falls back to the image's pinned headless shell when the
// Playwright-default build is not installed.
const FALLBACK_SHELL = '/opt/pw-browsers/chromium_headless_shell';
const executablePath = process.env.CHROMIUM_PATH
  || (!existsSync(chromium.executablePath()) && existsSync(FALLBACK_SHELL) ? FALLBACK_SHELL : undefined);
const PARALLEL = Math.max(1, Number(process.env.PARALLEL || 3));
const PAGE_SRC = [captureCausalState, safeJson, fnv1a, digestState, instrumentRun].map(String).join('\n')
  + '\nwindow.__cd = { captureCausalState, safeJson, fnv1a, digestState, instrumentRun };';

// ------------------------------------------------------------------ fixtures (per-tick input tapes)
// Times are TICKS (120 Hz). held: {key, from, to, value?}; edges: {key, at} (one-shot `pressed`).
const T = (s) => Math.round(s * 120);
export const FIXTURES = {
  // Airborne tricks: hops, helicopter spin, flips, parachute + air brake in the air, tuck; scramble on
  // for the whole run so the physics/scramble RNG is drawn every tick.
  tricks: {
    seed: 'RPLAY59', ticks: T(10), scramble: true,
    tape: {
      held: [
        { key: 'push', from: 0, to: T(1.8) },
        { key: 'heli', value: 1, from: T(2.7), to: T(2.9) },
        { key: 'tilt', value: -1, from: T(3.0), to: T(3.7) },
        { key: 'push', from: T(4.2), to: T(5.2) },
        { key: 'parachute', from: T(6.0), to: T(6.4) },
        { key: 'airBrake', from: T(6.4), to: T(6.7) },
        { key: 'tilt', value: 1, from: T(6.1), to: T(6.5) },
        { key: 'tuck', from: T(7.0), to: T(8.2) },
        { key: 'hop', from: T(8.6), to: T(8.8) },
      ],
      edges: [{ key: 'hop', at: T(2.6) }, { key: 'hop', at: T(5.9) }, { key: 'parachute', at: T(6.0) },
        { key: 'airBrake', at: T(6.4) }, { key: 'hop', at: T(8.6) }],
    },
  },
  // Deep course (50 km): biome hazards with motion (rolling boulders, gates), collisions, near misses.
  hazards: {
    seed: 'RPLAY59', ticks: T(10), startX: 50000,
    tape: {
      held: [{ key: 'push', from: 0, to: T(1.8) }, { key: 'push', from: T(4.2), to: T(5.2) }, { key: 'tuck', from: T(7), to: T(8.2) }],
      edges: [{ key: 'hop', at: T(2.6) }, { key: 'hop', at: T(5.9) }],
    },
  },
  // Kodiak pack (Sync Level 6, 450 m of credit so the first encounter is due at once).
  kodiak: {
    seed: 'BEAR0', ticks: T(12), level: 6, creditM: 450,
    tape: {
      held: [{ key: 'push', from: 0, to: T(2) }, { key: 'push', from: T(5), to: T(6) }],
      edges: [{ key: 'hop', at: T(3) }, { key: 'hop', at: T(7.5) }, { key: 'hop', at: T(9) }],
    },
  },
  // Biome-sector entry (all biome bits): the sled starts 1500 px before the first sector boundary that enters a biome
  // (found in the page from the run's own sector map), so the biome repaint runs mid-ride, under the sled.
  biome: {
    seed: 'BIOME140@4294967295', ticks: T(10), biomeEntry: true,
    tape: {
      held: [{ key: 'push', from: 0, to: T(2) }, { key: 'tuck', from: T(4), to: T(6) }],
      edges: [{ key: 'hop', at: T(3) }, { key: 'hop', at: T(7) }],
    },
  },
  // BSOD catch: the deletion wall starts 260 px behind the sled's left collision edge (set identically before
  // tick 1 in every run, like startX); the rider pushes briefly, then brakes and the wall catches it (cause 'bsod').
  bsod: {
    seed: 'BSOD140', ticks: T(12), bsodGapPx: 260,
    tape: { held: [{ key: 'push', from: 0, to: T(1) }, { key: 'brakeHeld', from: T(2), to: T(12) }], edges: [{ key: 'hop', at: T(1.5) }] },
  },
};

// ------------------------------------------------------------------ perturbations
// hz: display rate (or `schedule`: 'jitter'); polled: drive input through inputRouter.poll at frame
// granularity instead of the per-tick tape; viewport/dsf: page size and devicePixelRatio;
// noAudioContext: delete AudioContext before the game boots; preStart / postStart / perFrame: page code
// (bodies of (g, run, ctx) => {...}); resize: [{tick, w, h}] node-side viewport changes mid-run;
// atTick: [{tick, code}] page code run once just before the frame that crosses `tick`.
const ZOOM_WRAP = (z) => `const real = run.updateCamera; run.updateCamera = function (dt) { real.call(this, dt); this.cameras.main.setZoom(${z}); this.applyZoomCompensation(${z}); };`;
export const CASES = {
  'baseline-repeat': { hz: 60 },
  'cadence-30': { hz: 30, tag: 'cadence' },
  'cadence-120': { hz: 120, tag: 'cadence' },
  'cadence-144': { hz: 144, tag: 'cadence' },
  'cadence-jitter': { schedule: 'jitter', tag: 'cadence' },
  // Frame-granular input (#115 territory, report only). The *-polled cases are compared with the 60 Hz POLLED run,
  // so they isolate what the display rate does to input sampling; cadence-60-polled itself is compared with the
  // per-tick tape baseline (frame sampling holds a one-tick edge for the whole frame).
  'cadence-60-polled': { hz: 60, polled: true, tag: 'input-sampling (#115, report only)' },
  'cadence-30-polled': { hz: 30, polled: true, baseline: 'cadence-60-polled', tag: 'input-sampling (#115, report only)' },
  'cadence-144-polled': { hz: 144, polled: true, baseline: 'cadence-60-polled', tag: 'input-sampling (#115, report only)' },
  'cadence-jitter-polled': { schedule: 'jitter', polled: true, baseline: 'cadence-60-polled', tag: 'input-sampling (#115, report only)' },
  'camera-zoom-0.5': { hz: 60, postStart: ZOOM_WRAP(0.5) },
  'camera-zoom-2': { hz: 60, postStart: ZOOM_WRAP(2) },
  'camera-scroll': { hz: 60, postStart: 'const real = run.updateCamera; run.updateCamera = function (dt) { real.call(this, dt); this.cameras.main.scrollX += 700; this.cameras.main.scrollY -= 250; };' },
  'camera-shake': { hz: 60, perFrame: 'run.settings.screenShake = true; run.shake(30);' },
  'camera-shake-off': { hz: 60, postStart: 'run.settings = { ...run.settings, screenShake: false };' },
  'fx-off': { hz: 60, postStart: 'for (const k of ["update", "sparks", "ring", "shards"]) if (run.fx[k]) run.fx[k] = () => {}; run.trail.update = () => {};' },
  'fx-storm': { hz: 60, perFrame: 'for (let i = 0; i < 6; i++) run.fx.sparks(run.sled.x, run.sled.y, 0xffffff, 40, 400, 120); run.fx.ring(run.sled.x, run.sled.y, 0xff00ff, 90, 500);' },
  'audio-muted': { hz: 60, preStart: 'const s = g.registry.get("settings"); Object.assign(s, { masterVolume: 0, musicVolume: 0, sfxVolume: 0, windVolume: 0 }); g.registry.get("audioSynth")?.applySettings?.(s);' },
  'audio-none': { hz: 60, preStart: 'g.registry.set("audioSynth", null);' },
  // Installed after the run has started: every audio call the sim makes (playSfx, setSpeed, setAirborne) throws.
  'audio-throwing': { hz: 60, postStart: 'g.registry.set("audioSynth", new Proxy({}, { get: (t, k) => (k === "then" ? undefined : () => { throw new Error("audio down " + String(k)); }) }));' },
  'no-audiocontext': { hz: 60, noAudioContext: true },
  'viewport-1920x1080': { hz: 60, viewport: { width: 1920, height: 1080 } },
  'viewport-390x844-dpr3': { hz: 60, viewport: { width: 390, height: 844 }, dsf: 3 },
  'viewport-resize-midrun': { hz: 60, resize: [{ tick: 300, w: 1280, h: 400 }, { tick: 700, w: 500, h: 900 }, { tick: 1000, w: 960, h: 540 }] },
  'hud-off': { hz: 60, postStart: 'g.scene.stop("UIScene");' },
  'ui-pause-resume': { hz: 60, atTick: [{ tick: 400, code: 'run.scene.pause(); for (let i = 0; i < 30; i++) { ctx.t += 16.667; g.step(ctx.t, 16.667); } run.scene.resume(); g.events.emit("bb:gameResume", {});' }] },
  'settings-motion-midrun': { hz: 60, atTick: [{ tick: 300, code: 'const s = g.registry.get("settings"); s.screenShake = false; s.reducedMotion = true; g.events.emit("bb:settingsChanged", { key: "screenShake", value: false, settings: s });' }] },
  'settings-palette-midrun': { hz: 60, atTick: [{ tick: 300, code: 'const s = g.registry.get("settings"); s.palette = s.palette === "colorblind" ? "default" : "colorblind"; g.events.emit("bb:settingsChanged", { key: "palette", value: s.palette, settings: s });' }] },
  // Biome visuals never change (refreshPalette stubbed out). Before the fix the biome repaint rebuilt the live
  // colliders, so this differed from the baseline at the sector-entry tick.
  'biome-visuals-frozen': { hz: 60, postStart: 'run.refreshPalette = () => {};' },
  // Positive control: a 1e-9 px/step velocity nudge at tick 300 MUST be reported as a causal leak, proving the
  // digest can see a sub-visible physics change.
  'control-physics-nudge': { hz: 60, tag: 'positive control', atTick: [{ tick: 300, code: 'const b = run.sled.body; run.matter.body.setVelocity(b, { x: b.velocity.x + 1e-9, y: b.velocity.y });' }] },
  'combo-all-presentation': {
    schedule: 'jitter', viewport: { width: 390, height: 844 }, dsf: 2,
    preStart: 'g.registry.set("audioSynth", null);',
    postStart: `${ZOOM_WRAP(0.6)} g.scene.stop("UIScene");`,
    perFrame: 'run.settings.screenShake = true; run.shake(20); for (let i = 0; i < 3; i++) run.fx.sparks(run.sled.x, run.sled.y, 0xffffff, 30, 300, 90);',
    resize: [{ tick: 500, w: 1600, h: 500 }],
  },
};

// Which perturbations each fixture runs (full matrix on `tricks`; the core set elsewhere).
const CORE = ['baseline-repeat', 'cadence-30', 'cadence-144', 'cadence-jitter', 'camera-zoom-0.5', 'camera-zoom-2',
  'camera-shake', 'fx-storm', 'audio-none', 'audio-throwing', 'viewport-resize-midrun', 'hud-off', 'settings-palette-midrun', 'combo-all-presentation',
  'control-physics-nudge'];
const PLAN = {
  tricks: Object.keys(CASES),
  hazards: CORE,
  kodiak: CORE,
  bsod: CORE,
  biome: [...CORE, 'biome-visuals-frozen'],
};

// ------------------------------------------------------------------ page side

/** Runs in the page: boot a held run with the fixture and the perturbation's pre/post hooks. */
async function pageSetup({ fx, pt }) {
  const g = window.__bbGame;
  const fn = (code) => (code ? new Function('g', 'run', 'ctx', code) : null);
  const run = g.scene.getScene('RunScene');
  const ctx = { t: 0, frames: 0, digests: [], states: [], fx, pt, errors: [] };
  window.__probe = ctx;
  const prof = g.registry.get('profile');
  if (prof && fx.level != null) prof.level = fx.level;
  fn(pt.preStart)?.(g, run, ctx);
  const realUpdate = run.update;
  let hold = true;
  run.update = function (t, d) { if (!hold) return realUpdate.call(this, t, d); };
  g.scene.getScene('TitleScene').startRun(fx.seed);
  const t0 = performance.now();
  await new Promise((res, rej) => {
    const w = () => (run.sys.isActive() && run.sled ? res() : performance.now() - t0 > 20000
      ? rej(new Error('RunScene did not start within 20 s')) : requestAnimationFrame(w));
    w();
  });
  g.loop.sleep();
  if (fx.scramble) run.scrambleMs = 1e9;
  if (fx.biomeEntry) {
    const ppm = run.terrain.ppm;
    let entry = null;
    for (let sec = 3; sec < 60 && entry == null; sec++) {
      if (run._biomeDefForSector(sec) && !run._biomeDefForSector(sec - 1)) entry = (sec - 1) * 500 * ppm;
    }
    if (entry == null) throw new Error('no biome entry found for ' + fx.seed);
    ctx.biomeEntryX = entry;
    const x0 = entry - 1500;
    run.streamTerrain(x0);
    run.sled.setPose(x0, run.terrain.heightAt(x0) - 15, run.slopeAt(x0), 320, 0);
    // The start sector counts as already announced, so the only biome change is the real mid-ride entry.
    run._biomeSector = run.terrain._sectorOf(x0);
  }
  if (fx.startX != null) {
    run.streamTerrain(fx.startX);
    run.sled.setPose(fx.startX, run.terrain.heightAt(fx.startX) - 15, run.slopeAt(fx.startX), 320, 0);
  }
  if (fx.creditM != null) run.startX = run.sled.x - fx.creditM * 30 - 1;
  if (fx.bsodGapPx != null && run.bsod) run.bsod.wallX = run.sled.body.bounds.min.x - fx.bsodGapPx;

  const EDGE_KEYS = ['hop', 'reset', 'pause', 'airBrake', 'parachute', 'confirm'];
  const padForTick = (tick) => {
    const pad = { push: false, variableHop: true, noAutoNudge: true, divebomb: false, corkscrew: false, tuck: false,
      brakeHeld: false, hop: false, reset: false, airBrake: false, parachute: false, pause: false, tilt: 0, heli: 0,
      pressed: Object.fromEntries(EDGE_KEYS.map((k) => [k, false])), lastSource: 'tape' };
    for (const h of fx.tape.held) if (tick >= h.from && tick < h.to) pad[h.key] = h.value ?? true;
    for (const e of fx.tape.edges) if (tick === e.at) { pad.pressed[e.key] = true; if (e.key in pad && typeof pad[e.key] === 'boolean') pad[e.key] = true; }
    pad.brake = pad.brakeHeld;
    return pad;
  };
  const neutral = () => run.normalizePad(null);
  if (pt.polled) {
    // Frame-granular input (what a live player gets): sample the tape at the tick the frame starts on.
    const fired = new Set();
    run.inputRouter.poll = () => {
      const tick = run.simClock.tick + 1;
      const p = padForTick(tick);
      for (const e of fx.tape.edges) if (!fired.has(e) && tick >= e.at) { fired.add(e); p.pressed[e.key] = true; }
      return p;
    };
  } else {
    run.inputRouter.poll = () => neutral();
    run.tapePlayer = { padAt: (tick) => padForTick(tick), check() {} };
  }
  window.__cd.instrumentRun(run, g, (state, digest) => { ctx.states.push(state); ctx.digests.push(digest); },
    window.__cd.captureCausalState, window.__cd.digestState, window.__cd.safeJson);
  ctx.perFrame = fn(pt.perFrame);
  ctx.atTick = (pt.atTick || []).map((a) => ({ tick: a.tick, run: fn(a.code), done: false }));
  // Deterministic jittery frame schedule (LCG): 4..45 ms frames, the sort a hitchy browser produces.
  let lcg = 1403;
  ctx.nextDt = pt.schedule === 'jitter'
    ? () => { lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0; return 4 + (lcg / 2 ** 32) * 41; }
    : () => 1000 / pt.hz;
  fn(pt.postStart)?.(g, run, ctx);
  hold = false;
  return { ok: true, tick: run.simClock.tick };
}

/** Runs in the page: step display frames until the sim reaches `target` ticks (or the run crashes). */
function pageDrive(target) {
  const g = window.__bbGame;
  const run = g.scene.getScene('RunScene');
  const ctx = window.__probe;
  let guard = 0;
  let stall = 0;
  let lastTick = run.simClock ? run.simClock.tick : 0;
  while (run.simClock && run.simClock.tick < target && !ctx.endedAt && guard++ < 20000 && stall < 600) {
    for (const a of ctx.atTick) if (!a.done && run.simClock.tick + 1 >= a.tick) { a.done = true; a.run(g, run, ctx); }
    ctx.perFrame?.(g, run, ctx);
    const dt = ctx.nextDt();
    ctx.t += dt;
    g.step(ctx.t, dt);
    ctx.frames++;
    stall = run.simClock.tick === lastTick ? stall + 1 : 0;
    lastTick = run.simClock.tick;
    if (run.crashed) ctx.endedAt = run.simClock.tick;
  }
  if (stall >= 600) ctx.stalled = run.simClock.tick;
  return { tick: run.simClock ? run.simClock.tick : null, frames: ctx.frames, crashed: !!run.crashed };
}

// ------------------------------------------------------------------ node side

function deepDiff(a, b, path = '', out = [], max = 12) {
  if (out.length >= max) return out;
  if (Object.is(a, b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const k of keys) deepDiff(a[k], b[k], path ? `${path}.${k}` : k, out, max);
    return out;
  }
  out.push({ path, base: a === undefined ? '(absent)' : a, perturbed: b === undefined ? '(absent)' : b });
  return out;
}

async function runCase(fixtureName, caseName, baseline) {
  const fx = FIXTURES[fixtureName];
  const pt = CASES[caseName];
  const browser = await chromium.launch({ headless: true, args: ARGS, executablePath });
  try {
    const context = await browser.newContext({ viewport: pt.viewport || { width: 960, height: 540 }, deviceScaleFactor: pt.dsf || 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    if (pt.noAudioContext) await page.addInitScript(() => { delete window.AudioContext; delete window.webkitAudioContext; });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(), null, { timeout: 30000 });
    await page.addScriptTag({ content: PAGE_SRC });
    await page.evaluate(pageSetup, { fx, pt });
    const stops = [...(pt.resize || []).map((r) => r.tick), fx.ticks].sort((x, y) => x - y);
    let last = null;
    for (const stop of stops) {
      last = await page.evaluate(pageDrive, Math.min(stop, fx.ticks));
      const rs = (pt.resize || []).find((r) => r.tick === stop);
      if (rs) { await page.setViewportSize({ width: rs.w, height: rs.h }); await page.waitForTimeout(150); }
      if (last.crashed) break;
    }
    // A frame can run several ticks: drop the ones past the fixture length so every case compares the same span.
    const digests = await page.evaluate((n) => window.__probe.digests.filter((d) => d.tick <= n), fx.ticks);
    const meta = await page.evaluate(() => {
      const g = window.__bbGame; const run = g.scene.getScene('RunScene'); const p = window.__probe;
      const s = p.states.at(-1) || {};
      const lc = g.registry.get('lastCrash');
      return { frames: p.frames, stalled: p.stalled ?? null, ticks: run.simClock?.tick, crashed: !!run.crashed, cause: run.crashed ? lc?.cause ?? null : null, crashTick: p.endedAt ?? null,
        score: s.score?.total ?? null, scramble: s.rng?.physicsScramble ?? null, scrambleStart: p.states[0]?.rng?.physicsScramble ?? null,
        bodies: s.world?.count ?? null, hazardsSeen: new Set(p.states.flatMap((x) => x.hazards.map((h) => `${h[0]}:${h[1]}`))).size,
        hazardHits: Math.max(0, ...p.states.map((x) => x.hazards.filter((h) => h[4]).length)),
        nearMisses: s.score?.nearMisses ?? 0, kodiakEvents: p.states.flatMap((x) => x.events).filter((e) => e[0] === 'bb:kodiak').length,
        sfx: [...new Set(p.states.flatMap((x) => x.sfx.map((q) => q[0])))], airTicks: p.states.filter((x) => x.sled && !x.sled.grounded).length,
        bsodCaught: !!s.bsod?.caught, biomeEntryX: p.biomeEntryX ?? null,
        biomeEntryTick: p.biomeEntryX == null ? null : (p.states.find((x) => x.sled && x.sled.parts[0][2] >= p.biomeEntryX)?.tick ?? null), viewport: [innerWidth, innerHeight, devicePixelRatio], audio: !!g.registry.get('audioSynth') };
    });
    const res = { fixture: fixtureName, case: caseName, tag: pt.tag || null, meta, errors };
    if (!baseline) { res.digests = digests; res.states = await page.evaluate(() => window.__probe.states); return res; }
    const diff = diffDigests(baseline.digests, digests);
    res.diff = { ...diff, verdict: verdict(diff) };
    if (diff.first) {
      const tick = diff.first.tick;
      const mine = await page.evaluate((t) => window.__probe.states.find((s) => s.tick === t), tick);
      const base = baseline.states.find((s) => s.tick === tick);
      res.detail = Object.fromEntries(diff.first.subsystems.map((k) => [k, deepDiff(base[k], mine[k], k, [], 6)]));
    }
    if (diff.firstAuthoritative && diff.firstAuthoritative.tick !== diff.first?.tick) {
      const tick = diff.firstAuthoritative.tick;
      const mine = await page.evaluate((t) => window.__probe.states.find((s) => s.tick === t), tick);
      const base = baseline.states.find((s) => s.tick === tick);
      res.authDetail = Object.fromEntries(diff.firstAuthoritative.subsystems.map((k) => [k, deepDiff(base[k], mine[k], k, [], 6)]));
    }
    return res;
  } finally { await browser.close(); }
}

async function pool(items, n, fnc) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fnc(items[k]); }
  }));
  return out;
}

function fmtRow(r) {
  const d = r.diff;
  if (!d) return `${r.fixture.padEnd(8)} ${r.case.padEnd(26)} ERROR ${String(r.error).split('\n')[0]}`;
  const per = Object.entries(d.perSubsystem).filter(([, t]) => t != null).map(([k, t]) => `${k}@${t}`).join(' ');
  return `${r.fixture.padEnd(8)} ${r.case.padEnd(26)} ${d.verdict.padEnd(12)} first=${d.first ? `${d.first.tick}:${d.first.subsystems.join('+')}` : '-'} `
    + `auth=${d.firstAuthoritative ? `${d.firstAuthoritative.tick}:${d.firstAuthoritative.subsystems.join('+')}` : '-'} ticks=${r.meta.ticks} frames=${r.meta.frames}${r.against !== 'baseline-repeat' ? ` vs=${r.against}` : ''}${r.meta.stalled != null ? ` STALLED@${r.meta.stalled}` : ''}${per ? ` [${per}]` : ''}`;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const fixtures = (process.env.FIXTURES || Object.keys(FIXTURES).join(',')).split(',').filter(Boolean);
  const onlyCases = process.env.CASES ? process.env.CASES.split(',') : null;
  const RESULTS = process.env.RESULTS || null;
  const html = await (await fetch(url)).text();
  const build = (html.match(/assets\/[^"']+\.js/) || ['unknown'])[0];
  let cells = {};
  if (RESULTS && existsSync(RESULTS)) { try { cells = JSON.parse(await readFile(RESULTS, 'utf8')); } catch (e) { cells = {}; } }
  const cellKey = (f, c) => `${build}|${f}|${c}`;
  let saving = Promise.resolve();
  const saveCell = (r) => {
    if (!RESULTS) return;
    const { states, digests, ...slim } = r;
    cells[cellKey(r.fixture, r.case)] = slim;
    saving = saving.then(() => writeFile(RESULTS, JSON.stringify(cells)));
  };
  console.log('BUILD', build);
  const report = { kind: 'bb-causal-isolation-matrix/diagnostic', url, generatedAt: new Date().toISOString(), fixtures: {}, rows: [] };
  for (const f of fixtures) {
    const planned = PLAN[f].filter((c) => !onlyCases || onlyCases.includes(c));
    const todo = planned.filter((c) => !cells[cellKey(f, c)] || cells[cellKey(f, c)].error);
    if (!todo.length) {
      console.log('SKIP_FIXTURE (all cells cached)', f);
      for (const c of planned) { const r = cells[cellKey(f, c)]; console.log(fmtRow(r)); report.rows.push(r); }
      continue;
    }
    const base = await runCase(f, 'baseline-repeat', null);
    if (base.errors.length) console.log('BASELINE_PAGE_ERRORS', f, base.errors);
    report.fixtures[f] = { baseline: base.meta, tape: FIXTURES[f].tape, ticks: FIXTURES[f].ticks };
    console.log('BASELINE', f, JSON.stringify(base.meta));
    const cases = todo;
    for (const c of planned) if (!todo.includes(c)) report.rows.push(cells[cellKey(f, c)]);
    const extra = {};
    for (const b of new Set(cases.map((c) => CASES[c].baseline).filter(Boolean))) {
      extra[b] = await runCase(f, b, null);
      console.log('REFERENCE', f, b, JSON.stringify(extra[b].meta));
    }
    const rows = await pool(cases, PARALLEL, async (c) => {
      const against = CASES[c].baseline ? extra[CASES[c].baseline] : base;
      let r;
      try { r = { ...(await runCase(f, c, against)), against: CASES[c].baseline || 'baseline-repeat' }; }
      catch (e) { r = { fixture: f, case: c, error: String(e && e.stack || e) }; }
      saveCell(r);
      return r;
    });
    for (const r of rows) {
      console.log(fmtRow(r));
      if (r.errors?.length) console.log('  PAGE_ERRORS', r.errors.slice(0, 3));
      if (r.detail) console.log('  first-detail', JSON.stringify(r.detail).slice(0, 900));
      if (r.authDetail) console.log('  auth-detail ', JSON.stringify(r.authDetail).slice(0, 900));
      report.rows.push(r);
    }
  }
  await saving;
  if (process.env.OUT) await writeFile(process.env.OUT, JSON.stringify(report, null, 1));
  const unexpected = report.rows.filter((r) => !r.diff || (r.diff.verdict === 'causal-leak' && !(r.tag || '').includes('#115') && r.tag !== 'positive control')
    || (r.tag === 'positive control' && r.diff.verdict !== 'causal-leak'));
  console.log('SUMMARY', JSON.stringify(report.rows.reduce((m, r) => { const v = r.diff?.verdict || 'error'; m[v] = (m[v] || 0) + 1; return m; }, {})));
  if (process.env.EXPECT_ISOLATION === '1' && unexpected.length) {
    console.log('UNEXPECTED_LEAKS', unexpected.map((r) => `${r.fixture}/${r.case}`).join(', '));
    process.exit(1);
  }
}
export { runCase, readFile, subsystemClass };
