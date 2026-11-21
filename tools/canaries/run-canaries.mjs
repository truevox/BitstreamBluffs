/**
 * Issue #117 golden-canary runner (TEST INFRASTRUCTURE ONLY).
 *
 * Drives the REAL game (Phaser + Matter, the built bundle served by the preview server) frame by frame with a
 * scripted input tape, exactly like tools/replay-determinism-browser-probe.mjs: RunScene.update is held from
 * the moment the scene exists, the game loop is put to sleep, and frames are stepped with game.step(t, dt) so
 * no wall-clock frame ever reaches the simulation. It does NOT force scramble, does not touch src/** and does
 * not write to the ghost library.
 *
 *   GAME_URL=http://127.0.0.1:8317/ node tools/canaries/run-canaries.mjs
 *   ONLY=flip-edge,cruise-points node tools/canaries/run-canaries.mjs
 *   RECORD_GOLDEN=1 node tools/canaries/run-canaries.mjs        # or --record-golden
 *
 * Env:
 *   GAME_URL     default http://127.0.0.1:8317/
 *   CANARY_DIR   default tools/canaries/corpus
 *   OUT_DIR      default tools/canaries/out
 *   ONLY         comma-separated canary ids
 *   RECORD_GOLDEN=1 / --record-golden  also write the records to tools/canaries/golden/
 *
 * One fresh browser context (and page) per canary, so no IndexedDB / profile / registry state leaks between
 * runs. Exit code is non-zero ONLY on a harness error; physics divergence is the differ's job.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { SIM_TICK_HZ, SIM_TICK_MS } from '../../src/systems/SimClock.js';
import { RUN_RANDOM_VERSION } from '../../src/systems/RunRandom.js';
import {
  GHOST_TAPE_FORMAT, GHOST_TAPE_VERSION, GHOST_PHYSICS_VERSION,
} from '../../src/systems/ghost/GhostTape.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const GAME_URL = process.env.GAME_URL || 'http://127.0.0.1:8317/';
const CANARY_DIR = path.resolve(ROOT, process.env.CANARY_DIR || 'tools/canaries/corpus');
const OUT_DIR = path.resolve(ROOT, process.env.OUT_DIR || 'tools/canaries/out');
const GOLDEN_DIR = path.resolve(ROOT, 'tools/canaries/golden');
const RECORD_GOLDEN = process.env.RECORD_GOLDEN === '1' || process.argv.includes('--record-golden');
const ONLY = new Set((process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean));

/** Keys a tape may name, and the router-pad field each one writes. */
const TAPE_KEYS = Object.freeze({
  push: 'push', tuck: 'tuck', hop: 'hop', heli: 'heli', tilt: 'tilt', airBrake: 'airBrake',
  parachute: 'parachute', divebomb: 'divebomb', corkscrew: 'corkscrew', pause: 'pause', brake: 'brake',
  // Normalized pad names (RunScene.normalizePad / GhostTape BOOL_FIELDS). S is `brakeHeld` on the
  // normalized pad and `brake` on the router pad, so brakeHeld is accepted as an alias of brake.
  brakeHeld: 'brake',
});
/** Router-pad one-shot edges a tape `edges` entry may name. */
const EDGE_KEYS = new Set(['hop', 'reset', 'pause', 'airBrake', 'parachute', 'confirm']);
/** Layout-derived normalized fields. Not router inputs: accepted only when they agree with `controlLayout`. */
const LAYOUT_KEYS = new Set(['variableHop', 'noAutoNudge']);

const EVENT_KINDS = new Set(['pause', 'stall', 'crash']);
/** A stalled display frame: a background tab returning. SimClock drops the backlog beyond its cap. */
const STALL_FRAME_MS = 2500;
const NEUTRAL_TICK_MS = 60_000;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Validate one corpus file up-front so a typo fails the harness, never silently changes a run. */
function validateCanary(c) {
  const where = `corpus/${c && c.id ? c.id : '?'}.json`;
  assert(c && typeof c.id === 'string' && c.id, `${where}: missing id`);
  assert(typeof c.description === 'string' && c.description.trim(), `${where}: missing description`);
  assert(typeof c.seed === 'string' && c.seed, `${where}: missing seed`);
  assert(Number.isInteger(c.biomeMask) && c.biomeMask >= 0, `${where}: biomeMask must be a non-negative integer`);
  assert(c.startX == null || (Number.isFinite(c.startX) && c.startX >= 0), `${where}: startX must be null or >= 0`);
  assert([30, 60, 120].includes(c.hz), `${where}: hz must be 30, 60 or 120`);
  assert(Number.isFinite(c.durationMs) && c.durationMs > 0 && c.durationMs % 100 === 0, `${where}: durationMs must be a positive multiple of 100`);
  assert(c.input && typeof c.input === 'object', `${where}: missing input`);
  const held = c.input.held || [];
  const edges = c.input.edges || [];
  const events = c.input.events || [];
  for (const h of held) {
    assert(h && TAPE_KEYS[h.key], `${where}: unknown held key "${h && h.key}"`);
    assert(Number.isFinite(h.from) && Number.isFinite(h.to) && h.from >= 0 && h.to >= h.from, `${where}: held ${h.key} needs from <= to`);
    assert(h.from % 100 === 0 && h.to % 100 === 0, `${where}: held ${h.key} times must be multiples of 100 ms`);
    assert(h.value === undefined || typeof h.value === 'number' || typeof h.value === 'boolean', `${where}: held ${h.key} value must be a number or boolean`);
  }
  for (const e of edges) {
    assert(e && EDGE_KEYS.has(e.key), `${where}: unknown edge key "${e && e.key}"`);
    assert(Number.isFinite(e.at) && e.at >= 0 && e.at % 100 === 0, `${where}: edge ${e.key} at must be a multiple of 100 ms`);
  }
  for (const ev of events) {
    assert(ev && EVENT_KINDS.has(ev.do), `${where}: unknown event "${ev && ev.do}"`);
    assert(Number.isFinite(ev.atMs) && ev.atMs >= 0 && ev.atMs % 100 === 0, `${where}: event atMs must be a multiple of 100 ms`);
  }
  for (const h of held) {
    if (LAYOUT_KEYS.has(h.key)) {
      const want = h.value === undefined ? true : !!h.value;
      assert(want === true, `${where}: ${h.key} can only be true with the non-classic control layout`);
    }
  }
  assert(c.controlLayout == null || ['tricksRight', 'tricksLeft', 'classic'].includes(c.controlLayout),
    `${where}: controlLayout must be tricksRight, tricksLeft or classic`);
  return c;
}

/** Read every corpus file, sorted by id, ordered stably by id. */
async function loadCorpus() {
  const names = (await readdir(CANARY_DIR)).filter((n) => n.endsWith('.json')).sort();
  assert(names.length > 0, `no canary JSON found in ${CANARY_DIR}`);
  const canaries = [];
  for (const name of names) {
    const raw = await readFile(path.join(CANARY_DIR, name), 'utf8');
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { throw new Error(`corpus/${name}: invalid JSON: ${e.message}`); }
    assert(parsed.id === name.replace(/\.json$/, ''), `corpus/${name}: id "${parsed.id}" must match the file name`);
    canaries.push(validateCanary(parsed));
  }
  const dupes = new Set();
  for (const c of canaries) {
    assert(!dupes.has(c.id), `duplicate canary id ${c.id}`);
    dupes.add(c.id);
  }
  const selected = ONLY.size ? canaries.filter((c) => ONLY.has(c.id)) : canaries;
  assert(selected.length > 0, `ONLY selected no canary (${[...ONLY].join(',')})`);
  return selected;
}

async function pingServer() {
  let res;
  try {
    res = await fetch(GAME_URL, { method: 'GET' });
  } catch (e) {
    throw new Error(`preview server unreachable at ${GAME_URL}: ${e.message}. STOP: start it externally and re-run.`);
  }
  assert(res.ok, `preview server at ${GAME_URL} answered HTTP ${res.status}`);
}

/**
 * In-page: run one canary and return its record. Everything here runs inside the page, so it must not close
 * over Node values except `spec`.
 */
async function runInPage(spec) {
  // Page-local copies: page.evaluate serialises this function, so it cannot see Node-side module constants.
  const KEYS = {
    push: 'push', tuck: 'tuck', hop: 'hop', heli: 'heli', tilt: 'tilt', airBrake: 'airBrake',
    parachute: 'parachute', divebomb: 'divebomb', corkscrew: 'corkscrew', pause: 'pause', brake: 'brake',
    brakeHeld: 'brake',
  };
  const g = window.__bbGame;
  const run = g.scene.getScene('RunScene');
  const title = g.scene.getScene('TitleScene');
  if (!run.__realUpdate) run.__realUpdate = run.update;
  let hold = true;
  run.update = function (t, d) { if (!hold) return run.__realUpdate.call(this, t, d); };

  // Fixed, physics-neutral settings: OS reduced motion (the context also asks for it) and no shake are cosmetic
  // only; controlLayout drives the layout-derived pad fields a tape may name.
  const settings = g.registry.get('settings');
  if (settings) {
    settings.reduceMotion = 'on';
    settings.screenShake = false;
    if (spec.controlLayout) settings.controlLayout = spec.controlLayout;
  }

  title.startRun(spec.seed, spec.biomeMask);
  await new Promise((res) => { const w = () => (run.sys.isActive() && run.sled ? res() : requestAnimationFrame(w)); w(); });
  g.loop.sleep();
  if (spec.startX != null) {
    run.streamTerrain(spec.startX);
    run.sled.setPose(spec.startX, run.terrain.heightAt(spec.startX) - 15, run.slopeAt(spec.startX), 320, 0);
  }

  // ---- tape -> router pad ---------------------------------------------------------------------------------
  let clock = 0;
  const pendingEdges = (spec.input.edges || []).map((e) => ({ ...e, fired: false }));
  const padEdge = { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false };
  let pauseEdge = false;
  const neutral = () => ({
    push: false, tilt: 0, heli: 0, tuck: false, hop: false, pause: false, brake: false,
    airBrake: false, parachute: false, divebomb: false, corkscrew: false,
    pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false },
  });
  run.inputRouter.poll = () => {
    const pad = neutral();
    for (const h of spec.input.held || []) {
      if (clock >= h.from && clock < h.to) pad[KEYS[h.key]] = h.value === undefined ? true : h.value;
    }
    for (const e of pendingEdges) {
      if (!e.fired && clock >= e.at) { e.fired = true; pad.pressed[e.key] = true; if (e.key in pad) pad[e.key] = true; }
    }
    if (pauseEdge) { pauseEdge = false; pad.pressed.pause = true; }
    return pad;
  };

  // ---- feature evidence (read-only observers of the REAL live game) ---------------------------------------
  // These prove a canary actually reaches its named feature. They only listen to the game's own events and read
  // public scene state; nothing here writes gameplay state.
  const nowMs = () => Math.round(run.simClock.tick * run.simClock.tickMs * 1000) / 1000;
  const feature = {
    landings: [], tricks: [], hazardHits: [], pads: [], zones: [], bsodBluffs: [],
    airborneEpisodes: [], airborneTotalMs: 0, maxAirtimeMs: 0, maxAirtimeTick: null,
    minBsodGapPx: null, bsodCaughtTick: null, startChunk: null,
    lips: [], lipCrossings: [], slopeKicks: [], biomeCrossings: [], _lastBiomeKey: null,
  };
  // Real generator launch lips / bounce pads / hills in the live chunk window. `lips` is geometry the canary may
  // cross; a crossing with an airborne phase right after is what proves a "bump".
  try {
    for (const c of run.terrain.getActiveChunks()) {
      for (const l of c.launches || []) feature.lips.push({ x: Math.round(l.x), y: Math.round(l.y), angleDeg: Math.round(l.angleDeg * 10) / 10, airS: Math.round(l.airS * 1000) / 1000, chunk: c.index });
    }
  } catch (e) { /* probe only */ }
  const lap = g.events;
  lap.on('bb:landing', (p) => feature.landings.push({
    tick: run.simClock.tick, t: nowMs(), x: p.x, quality: p.quality, airtimeMs: p.airtimeMs,
    angleDeg: p.angleDeg, impactSpeedPxS: p.impactSpeedPxS, detail: p,
  }));
  lap.on('bb:trick', (p) => feature.tricks.push({
    tick: run.simClock.tick, t: nowMs(), type: p.type, count: p.count, value: p.value, airtimeMs: p.airtimeMs,
  }));
  lap.on('bb:hazardHit', (p) => feature.hazardHits.push({ tick: run.simClock.tick, t: nowMs(), hazardId: p.hazardId, effect: p.effect, x: p.x }));
  lap.on('bb:zoneEnter', (p) => feature.zones.push({ tick: run.simClock.tick, t: nowMs(), modId: p.modId, x0: p.x0, x1: p.x1 }));
  lap.on('bb:bsodBluff', (p) => feature.bsodBluffs.push({ tick: run.simClock.tick, t: nowMs(), chain: p.chain }));
  const realOnPad = run.onPad;
  run.onPad = function (pad) {
    feature.pads.push({ tick: run.simClock.tick, t: nowMs(), x: pad && pad.x, boost: pad && pad.boost });
    return realOnPad.call(this, pad);
  };
  // The terrain lips/bounce pads a canary passes: real generator output, so "bump" can be proved against geometry.
  try {
    const c0 = run.terrain.getChunkAt(originXProbe());
    if (c0) feature.startChunk = { index: c0.index, biome: c0.biome || null, sector: c0.sector, breather: !!c0.breather, startX: c0.startX, endX: c0.endX };
  } catch (e) { /* probe only */ }
  function originXProbe() { return spec.startX != null ? spec.startX : (run.startX != null ? run.startX : run.sled.x); }

  // ---- per-tick instrumentation (read-only) ---------------------------------------------------------------
  const stats = {
    inputChanges: 0, airborneTicks: 0, timeToFirstInputMs: null,
    pausedMs: 0, stallCount: 0, stallDeltaMs: 0, ticks: 0, totalSimMs: 0,
  };
  let lastSig = null;
  let airEpisode = null;
  let crashTick = null;
  let crashCause = null;
  let crashHazardId = null;
  let expectCrash = false;
  let maxY = -Infinity;
  let maxX = -Infinity;
  let minTickX = Infinity;
  let scoreBaseline = null;
  const originX = spec.startX != null ? spec.startX : (run.startX != null ? run.startX : run.sled.x);
  const originY = run.sled.y;
  const ppm = run.terrain && Number.isFinite(run.terrain.ppm) ? run.terrain.ppm : 20;
  const sigOf = (pad) => [
    pad.push ? 1 : 0, pad.tuck ? 1 : 0, pad.brake ? 1 : 0, pad.hop ? 1 : 0, pad.pause ? 1 : 0,
    pad.airBrake ? 1 : 0, pad.parachute ? 1 : 0, pad.divebomb ? 1 : 0, pad.corkscrew ? 1 : 0,
    pad.heli || 0, Number.isFinite(pad.tilt) ? pad.tilt : 0,
    pad.pressed && pad.pressed.hop ? 1 : 0, pad.pressed && pad.pressed.reset ? 1 : 0,
    pad.pressed && pad.pressed.pause ? 1 : 0, pad.pressed && pad.pressed.airBrake ? 1 : 0,
    pad.pressed && pad.pressed.parachute ? 1 : 0, pad.pressed && pad.pressed.confirm ? 1 : 0,
  ].join(',');
  const neutralSig = sigOf(neutral());
  const realSimTick = run.simTick;
  run.simTick = function (dt, pad) {
    const sig = sigOf(pad || {});
    if (sig !== lastSig) {
      lastSig = sig;
      stats.inputChanges++;
      if (stats.timeToFirstInputMs == null && sig !== neutralSig) {
        stats.timeToFirstInputMs = Math.round(this.simClock.tick * this.simClock.tickMs * 1000) / 1000;
      }
    }
    const r = realSimTick.call(this, dt, pad);
    // Score is measured from this canary's own first tick: a startX teleport would otherwise inject the whole
    // run-start distance as distance points before the canary's first input is even delivered.
    if (scoreBaseline == null) scoreBaseline = this.score?.getTotal?.() ?? 0;
    const sled = this.sled;
    if (sled && !sled.grounded) stats.airborneTicks++;
    if (sled) {
      if (sled.x > maxX) maxX = sled.x;
      if (sled.y > maxY) maxY = sled.y;
      if (sled.x < minTickX) minTickX = sled.x;
      // airborne episodes from the real sled ground flag (post-tick)
      if (!sled.grounded && airEpisode == null) airEpisode = { startTick: this.simClock.tick, startT: nowMs(), x: sled.x };
      if (sled.grounded && airEpisode != null) {
        const dur = Math.round((nowMs() - airEpisode.startT) * 1000) / 1000;
        feature.airborneEpisodes.push({ startTick: airEpisode.startTick, endTick: this.simClock.tick, startT: airEpisode.startT, x: airEpisode.x, durationMs: dur, airtimeMs: Math.round(sled.airtimeMs || 0) });
        feature.airborneTotalMs += dur;
        // A lip crossing: the airborne episode began within LIP_WINDOW_PX of a real generator launch lip.
        for (const lip of feature.lips) {
          if (Math.abs(airEpisode.x - lip.x) <= 140 && !feature.lipCrossings.some((c) => c.lipX === lip.x)) {
            feature.lipCrossings.push({ lipX: lip.x, lipAngleDeg: lip.angleDeg, startTick: airEpisode.startTick, endTick: this.simClock.tick, x: Math.round(airEpisode.x), durationMs: dur, landX: Math.round(sled.x) });
          }
        }
        if (sled.airtimeMs > feature.maxAirtimeMs) { feature.maxAirtimeMs = Math.round(sled.airtimeMs); feature.maxAirtimeTick = this.simClock.tick; }
        airEpisode = null;
      }
      if (airEpisode != null && sled.airtimeMs > feature.maxAirtimeMs) { feature.maxAirtimeMs = Math.round(sled.airtimeMs); feature.maxAirtimeTick = this.simClock.tick; }
    }
    // closest approach to the deletion wall (BSOD), from the live authoritative snapshot
    if (this.bsodState && this.bsodState.active && Number.isFinite(this.bsodState.gapPx)) {
      if (feature.minBsodGapPx == null || this.bsodState.gapPx < feature.minBsodGapPx) {
        feature.minBsodGapPx = Math.round(this.bsodState.gapPx * 100) / 100;
      }
    }
    if (this.bsodCaught && feature.bsodCaughtTick == null) feature.bsodCaughtTick = this.simClock.tick;
    // Biome / sector boundary crossings from the real generator chunk map (a chunk carries its biome id).
    if (sled && this.terrain) {
      try {
        const c = this.terrain.getChunkAt(sled.x);
        if (c) {
          const key = c.biome || 'base';
          if (feature._lastBiomeKey !== key) {
            feature._lastBiomeKey = key;
            feature.biomeCrossings.push({ tick: this.simClock.tick, t: nowMs(), x: Math.round(sled.x), biome: c.biome || null, sector: c.sector, chunk: c.index });
          }
        }
      } catch (e) { /* probe only */ }
    }
    if (this.crashed && crashTick == null) {
      crashTick = this.simClock.tick;
      const lc = g.registry.get('lastCrash');
      crashCause = (lc && lc.cause) || null;
      crashHazardId = (lc && lc.hazardId) || null;
    }
    return r;
  };

  // ---- frame loop -----------------------------------------------------------------------------------------
  const tickMs = run.simClock.tickMs;
  const simNow = () => Math.round(run.simClock.tick * tickMs * 1000) / 1000;
  const checkpoints = [];
  let nextCheckpointTick = 0;
  const canaryScore = () => {
    const total = run.score?.getTotal?.();
    if (!Number.isFinite(total)) return null;
    return Math.round(total - (scoreBaseline == null ? 0 : scoreBaseline));
  };
  const sample = () => {
    const b = run.sled.body;
    checkpoints.push([
      simNow(), run.sled.x, run.sled.y, b.angle, b.velocity.x, b.velocity.y,
      canaryScore(),
    ]);
  };
  const events = (spec.input.events || []).map((e) => ({ ...e, done: false }));
  const dtNormal = 1000 / spec.hz;
  let t = 0;
  let frames = 0;
  let stalledThisFrame = false;
  hold = false;

  const stepScene = (delta) => { t += delta; frames++; g.step(t, delta); };

  // Flush queued SceneManager operations (pause/resume go through the scene plugin queue) without advancing
  // simulation: a delta of 0 advances 0 ticks of the fixed clock.
  const flushScene = (rounds = 4) => { for (let i = 0; i < rounds; i++) stepScene(0); };

  while (!run.crashed && run.simClock.tick * tickMs < spec.durationMs && frames < spec.durationMs / dtNormal + 600) {
    clock = simNow();
    let delta = stalledThisFrame ? spec.stallFrameMs : dtNormal;
    stalledThisFrame = false;
    if (run.simClock.tick >= nextCheckpointTick) { sample(); nextCheckpointTick = run.simClock.tick + Math.round(1000 / tickMs); }

    // Tape events due at (or before) this frame's sim clock.
    for (const ev of events) {
      if (ev.done || clock < ev.atMs) continue;
      ev.done = true;
      if (ev.do === 'stall') { stalledThisFrame = true; delta = spec.stallFrameMs; stats.stallCount++; stats.stallDeltaMs += spec.stallFrameMs; }
      else if (ev.do === 'crash') { expectCrash = true; } // declared outcome; the run must reach it naturally
      else if (ev.do === 'pause') {
        // Ask for a pause through the game's own one-shot edge, let the scene manager honour it, hold for a few
        // paused real frames, then resume through PauseScene's real _doResume() path (the cosmetic outro is
        // skipped so the resumed tick is deterministic).
        const before = run.simClock.tick;
        pauseEdge = true;
        stepScene(delta);
        pauseEdge = false;
        let guard = 0;
        while (!run.sys.isPaused() && guard++ < 8) stepScene(0);
        if (!run.sys.isPaused()) throw new Error('pause event: RunScene did not pause');
        const pausedAt = run.simClock.tick;
        for (let i = 0; i < 5; i++) stepScene(16.7);
        stats.pausedMs += Math.round((run.simClock.tick - pausedAt) === 0 ? 5 * 16.7 : 0);
        const pauseScene = g.scene.getScene('PauseScene');
        if (pauseScene && typeof pauseScene._doResume === 'function' && pauseScene.sys.isActive()) pauseScene._doResume();
        else { run.scene.resume('RunScene'); g.events.emit('bb:gameResume', { runTimeMs: run.runTimeMs, runId: run.runId, reason: 'manual', pauseToken: 'canary', gym: false }); }
        guard = 0;
        while (run.sys.isPaused() && guard++ < 8) stepScene(0);
        if (run.simClock.tick !== before) throw new Error('pause event: simulation advanced while paused');
        continue;
      }
    }

    stepScene(delta);
    if (run.simClock.tick >= nextCheckpointTick) { sample(); nextCheckpointTick = run.simClock.tick + Math.round(1000 / tickMs); }
  }
  // Last sample so the final pose/score is always in the record (an extra column, not a scheduled second).
  if (!checkpoints.length) sample();

  stats.ticks = run.simClock.tick;
  stats.totalSimMs = run.simClock.tick * tickMs;
  const scores = checkpoints.map((c) => c[6]).filter((v) => Number.isFinite(v));
  stats.scoreMean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  stats.scoreMin = scores.length ? Math.min(...scores) : 0;
  stats.scoreMax = scores.length ? Math.max(...scores) : 0;
  stats.droppedMs = run.simClock.droppedMs || 0;

  const score = canaryScore() ?? 0;
  // How far THIS canary got, from its own origin (a startX teleport is the origin, not world 0).
  const furthestX = Number.isFinite(maxX) ? maxX : run.sled?.x;
  const distance = Number.isFinite(furthestX) ? Math.max(0, (furthestX - originX) / ppm) : 0;

  const result = {
    crashed: !!run.crashed,
    crashTick: run.crashed ? crashTick : null,
    cause: run.crashed ? crashCause : null,
    hazardId: run.crashed ? crashHazardId : null,
    score: Math.round(score),
    distance: Math.round(distance),
    endTick: run.simClock.tick,
  };
  if (expectCrash) result.expectedCrash = true;

  return {
    id: spec.id,
    simVersion: spec.simVersion,
    seed: spec.seed,
    biomeMask: spec.biomeMask,
    hz: spec.hz,
    startX: spec.startX ?? null,
    durationMs: spec.durationMs,
    checkpoints,
    result,
    stats,
    origin: { x: Math.round(originX * 100) / 100, y: Math.round(originY * 100) / 100, ppm },
    verification: {
      xReached: Number.isFinite(maxX) ? Math.round(maxX) : null,
      xMinTick: Number.isFinite(minTickX) ? Math.round(minTickX) : null,
      yReached: Number.isFinite(maxY) ? Math.round(maxY) : null,
      frames,
      paused: stats.pausedMs > 0,
      stalled: stats.stallCount > 0,
    },
    feature,
  };
}

const SIM_VERSION = Object.freeze({
  simTickHz: SIM_TICK_HZ,
  runRandomVersion: RUN_RANDOM_VERSION,
  ghostTapeFormat: GHOST_TAPE_FORMAT,
  ghostTapeVersion: GHOST_TAPE_VERSION,
  ghostPhysicsVersion: GHOST_PHYSICS_VERSION,
});

function oneLine(rec) {
  const r = rec.result;
  const s = rec.stats;
  const crash = r.crashed ? `crash@${r.crashTick}(${r.cause}${r.hazardId ? ':' + r.hazardId : ''})` : 'no-crash';
  return `${rec.id.padEnd(20)} ${crash.padEnd(34)} score=${String(r.score).padStart(5)} dist=${String(r.distance).padStart(5)}m endTick=${String(r.endTick).padStart(5)} airborne=${String(s.airborneTicks).padStart(5)} inputs=${String(s.inputChanges).padStart(3)} tti=${s.timeToFirstInputMs == null ? '-' : s.timeToFirstInputMs + 'ms'}${s.stallCount ? ` stalls=${s.stallCount} dropped=${s.droppedMs}ms` : ''}${s.pausedMs ? ' paused' : ''}`;
}

async function main() {
  await pingServer();
  const canaries = await loadCorpus();
  await mkdir(OUT_DIR, { recursive: true });
  if (RECORD_GOLDEN) await mkdir(GOLDEN_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--mute-audio', '--disable-audio-output'],
  });
  const records = [];
  const failures = [];
  try {
    for (const canary of canaries) {
      const started = Date.now();
      const context = await browser.newContext({
        viewport: { width: 960, height: 540 },
        reducedMotion: 'reduce',
        deviceScaleFactor: 1,
        locale: 'en-US',
        timezoneId: 'UTC',
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      try {
        await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(), null, { timeout: 30000 });
        const spec = {
          id: canary.id,
          seed: canary.seed,
          biomeMask: canary.biomeMask,
          startX: canary.startX ?? null,
          hz: canary.hz,
          durationMs: canary.durationMs,
          controlLayout: canary.controlLayout || null,
          input: canary.input,
          simVersion: SIM_VERSION,
          stallFrameMs: STALL_FRAME_MS,
        };
        const rec = await page.evaluate(runInPage, spec);
        assert(pageErrors.length === 0, `${canary.id}: page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
        assert(rec && rec.id === canary.id, `${canary.id}: record id mismatch`);
        assert(Array.isArray(rec.checkpoints) && rec.checkpoints.length > 0, `${canary.id}: no checkpoints recorded`);
        if (rec.result.expectedCrash && !rec.result.crashed) {
          rec.harnessWarning = 'declared a crash event but the run never crashed';
        }
        const file = path.join(OUT_DIR, `${canary.id}.json`);
        await writeFile(file, `${JSON.stringify(rec, null, 2)}\n`);
        if (RECORD_GOLDEN) await writeFile(path.join(GOLDEN_DIR, `${canary.id}.json`), `${JSON.stringify(rec, null, 2)}\n`);
        records.push(rec);
        console.log(oneLine(rec));
        if (rec.harnessWarning) console.warn(`  warning: ${rec.harnessWarning}`);
        console.log(`  ${((Date.now() - started) / 1000).toFixed(1)}s  hz=${canary.hz} dur=${canary.durationMs}ms  simVersion=${JSON.stringify(rec.simVersion)}`);
      } catch (e) {
        failures.push({ id: canary.id, error: String(e && e.message ? e.message : e) });
        console.error(`FAIL ${canary.id}: ${e && e.message ? e.message : e}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log('');
  console.log(`recorded ${records.length}/${canaries.length} canaries -> ${path.relative(ROOT, OUT_DIR)}${RECORD_GOLDEN ? ` (and ${path.relative(ROOT, GOLDEN_DIR)})` : ''}`);
  if (failures.length) {
    console.error(`harness failures: ${failures.map((f) => f.id).join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
