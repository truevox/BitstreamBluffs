/**
 * OWNER: gameplay engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * The run. Lifecycle (see ARCHITECTURE.md sections 5-6 for the full contract):
 *  create(): read REG.SEED / REG.CONTENT / REG.INPUT / REG.SAVE_STORE; build Rng-seeded TerrainGenerator, ScoreManager,
 *    TrickTracker, GlitchDirector, PhysicsTuner, DailyPatch rule; scene.launch(SCENES.UI); GlitchPipeline.install(this);
 *    emit EVT.RUN_START.
 *  update(time, delta): poll input -> stepWorld() sub-steps -> TrickTracker.update -> ScoreManager -> emit events
 *    -> TerrainGenerator.update(x) (add/remove chunks) -> GlitchDirector.update -> camera.
 *  crash: ScoreManager.onCrash, emit CRASH, build RunRecord, saveStore.saveRun, set REG.LAST_RECORD, emit RUN_END,
 *    after <= TIMING.crashToGameOverMs scene.start(SCENES.GAME_OVER).
 *  pause: on input `pressed.pause`: emit GAME_PAUSE, scene.pause(), scene.launch(SCENES.PAUSE, {runTimeMs}).
 *  shutdown: remove every game.events listener it added, stop UI scene.
 *
 * Notes for the integrator:
 *  - RunScene is the ONLY gameplay emitter. All pure systems are driven from here and never emit.
 *  - Physics advances only through stepWorld() (<= 8 ms sub-steps); slow-mo scales the delta, not the step limit.
 *  - Everything per-run lives on `this` and is torn down in teardown(); a retry re-enters create() on the same instance.
 */
import Phaser from 'phaser';
import {
  SCENES, REG, GAME_WIDTH, GAME_HEIGHT, PIXELS_PER_METER, PHYSICS, STORAGE, TIMING,
} from '../constants.js';
import { EVT } from '../events.js';
import { SaveStore } from '../systems/SaveStore.js';
import { TerrainGenerator } from '../systems/TerrainGenerator.js';
import { ScoreManager } from '../systems/ScoreManager.js';
import { TrickTracker } from '../systems/TrickTracker.js';
import { GlitchDirector } from '../systems/GlitchDirector.js';
import { DailyPatch } from '../systems/DailyPatch.js';
import { PhysicsTuner, stepWorld, TUNING } from '../systems/PhysicsTuner.js';
import { GlitchPipeline } from '../shaders/GlitchPipeline.js';
import { getPalette } from '../ui/Palette.js';
import { HUD_SPEED_EVENT } from './UIScene.js';
import { Sled } from '../entities/Sled.js';
import { TerrainMesh } from '../entities/TerrainMesh.js';
import { Hazard } from '../entities/Hazard.js';
import { PowerUp } from '../entities/PowerUp.js';
import { TrailParticles } from '../entities/TrailParticles.js';
import { Background } from '../entities/Background.js';
import { Fx } from '../entities/Fx.js';
import { ShardField } from '../entities/Shard.js';
import { BestMarker } from '../entities/BestMarker.js';
import { AirTelegraph } from '../entities/AirTelegraph.js';
import { installTerrainContactFix } from '../systems/TerrainContact.js';
import { HintScheduler } from '../systems/HintScheduler.js';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** Minimum delay between a crash and GameOver so the explosion reads (must stay <= TIMING.crashToGameOverMs). */
const CRASH_TO_GAMEOVER_MS = Math.min(950, TIMING.crashToGameOverMs);
const SAFE_SAMPLE_EVERY_MS = 120;
const SAFE_HISTORY_MS = 3000;
const SLOWMO_CAP_MS = 3000;
/** Spawn this far past terrain x=0 so the rear runner has ground under it. */
const SPAWN_RUNIN_PX = 44;
const TUTORIAL_KEY = 'bb.tutorialDone';
const TUCK_SHOWS_KEY = 'bb.tuckShows';
/**
 * First-run hint triggers (the scheduling rules live in systems/HintScheduler.js). Kept here, not in PhysicsTuner.
 * hop: show when the next ground hazard is within HOP_HINT_LEAD_S of travel (but at least HOP_HINT_MIN_PX); other hints are
 * held back while it is within HOP_DANGER_S so they cannot eat the warning window. flip: show on the approach to a launch lip.
 */
const HOP_HINT_LEAD_S = 1.2;
const HOP_HINT_MIN_PX = 350;
const HOP_HINT_MAX_PX = 1300;
const HOP_DANGER_S = 3.4;
const FLIP_APPROACH_S = 1.3;
const FLIP_APPROACH_MIN_PX = 160;
const FLIP_AIR_MS = 250;
const BOOST_HINT_MS = 2200;
/** The tuck hint (an advanced technique) waits for this much run time and for the first landing. */
const TUCK_HINT_MIN_RUN_MS = 12000;
/**
 * Second zoom stage: TUNING.zoomMin is reached at TUNING.zoomSpeedHi (600 px/s); past that the camera keeps pulling out to
 * ZOOM_FAR_MIN at ZOOM_FAR_SPEED_HI. Measured (tools/sim/shots.mjs zoom): at 850+ px/s only 0.33-0.45 s of terrain was visible ahead
 * of the sled, too little to see a ground hazard coming; the clamp in updateCamera already allows 0.6.
 */
const ZOOM_FAR_MIN = 0.62;
const ZOOM_FAR_SPEED_HI = 1200;
/** Extra look-ahead (px, on top of TUNING.lookAheadMaxPx) that ramps in between 600 and 1000 px/s; the follow lag eats the base look-ahead at speed. */
const LOOK_FAR_EXTRA_PX = 90;
/** The rider is never allowed closer than this many screen px to the left edge. */
const RIDER_MIN_SCREEN_X = 36;
const smooth01 = (t) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };

/** Tutorial hints already completed on this device. SaveStore.sanitizeSettings drops unknown keys, so use our own key. */
function loadTutorialDone() {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(TUTORIAL_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (e) { return new Set(); }
}
function saveTutorialDone(set) {
  try { if (globalThis.localStorage) globalThis.localStorage.setItem(TUTORIAL_KEY, JSON.stringify([...set])); } catch (e) { /* ignore */ }
}

/** How many times the tuck hint has been shown on this device (it is retired after TUNING.tuckHintMaxShows). */
function loadTuckShows() {
  try {
    const n = Number(globalThis.localStorage && globalThis.localStorage.getItem(TUCK_SHOWS_KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch (e) { return 0; }
}
function saveTuckShows(n) {
  try { if (globalThis.localStorage) globalThis.localStorage.setItem(TUCK_SHOWS_KEY, String(n)); } catch (e) { /* ignore */ }
}

export class RunScene extends Phaser.Scene {
  constructor() {
    super(SCENES.RUN);
  }

  // ------------------------------------------------------------------ lifecycle

  create() {
    const reg = this.registry;
    this.content = reg.get(REG.CONTENT) || { chunks: [], hazards: {}, powerups: {}, terrainMods: {}, palettes: {} };
    this.inputRouter = reg.get(REG.INPUT) || null;
    this.saveStore = reg.get(REG.SAVE_STORE) || null;
    this.settings = reg.get(REG.SETTINGS) || {};
    // One-shot edges (Esc that closed a menu view, Space that retried, ...) pile up while no scene polls the router; a
    // stale `pressed.pause` paused the run on its first frame. Drop them before the run starts.
    try { if (this.inputRouter) this.inputRouter.poll(); } catch (e) { /* ignore */ }
    this.palette = getPalette(this.game);
    this.seed = String(reg.get(REG.SEED) != null ? reg.get(REG.SEED) : 'default');
    this.startedAt = Date.now();
    this.runId = `${this.startedAt}-${this.seed}`;

    // daily rule (read ONCE per run)
    const daily = DailyPatch.getDailyInfo();
    this.dailyRuleId = (daily && daily.rule && daily.rule.id) || 'none';
    this.dailyMods = (daily && daily.rule && daily.rule.modifiers) || {};

    // pure systems
    this.terrain = new TerrainGenerator({
      seed: this.seed,
      chunkDefs: this.content.chunks,
      hazardDefs: this.content.hazards,
      powerupDefs: this.content.powerups,
      modDefs: this.content.terrainMods,
    });
    this.heightFn = (x) => this.terrain.heightAt(x); // allocated once; reads this.terrain at call time
    this.score = new ScoreManager({ pxPerMeter: PIXELS_PER_METER });
    this.score.reset();
    this.tricks = new TrickTracker();
    this.glitch = new GlitchDirector({ seed: this.seed });
    this.tuner = new PhysicsTuner();

    // run state
    this.runTimeMs = 0;
    this._leaving = false;
    this._hudMs = 0;
    this._despawn = [];
    this.currentPhys = null;
    this.crashed = false;
    this.crashTimerMs = 0;
    this.pendingCrash = null;
    this.trickCounts = {};
    this.bestCombo = 1;
    this.maxAirtimeMs = 0;
    this.lastTotal = 0;
    this.slowMs = 0;
    this.slowFactor = PHYSICS.slowFactor;
    this.scrambleMs = 0;
    this.boostMs = 0;
    this.boostFactor = 1;
    this.slowmoMs = 0;
    this.slowmoScale = 0.5;
    this.shieldCharges = 0;
    this.openingGraces = 0;
    this.activeZones = new Map();
    this.hazards = new Map();
    this.powerups = new Map();
    this.collectedPowerups = new Set();
    this.safeSamples = [];
    this._safeTimer = 0;
    this.resetCooldownMs = 0;
    this.shakeAmp = 0;
    this._contactQueue = [];
    this._landingShake = 0;
    this._frameDt = 16.7;
    this.hitStopMs = 0;
    this.blinkMs = 0;
    this._zoom = 1;
    this._zoomKick = 0;
    this._airTricks = 0;
    this.shardChain = 0;
    this.shardChainAt = -1e9;
    this.shardTotal = 0;
    this.shardCount = 0;
    this.nearMissCount = 0;
    this._steepMs = 0;
    this._landings = 0; // landings survived this run (the tuck hint waits for the first one)
    this.tuckShows = loadTuckShows();
    this.newBestDone = false;
    this.tutDone = loadTutorialDone();
    this.tutShown = new Set();
    this.tutTimers = { stall: 0 };
    this.hints = new HintScheduler({ done: this.tutDone });

    // physics world: manual stepping only
    const world = this.matter.world;
    world.autoUpdate = false;
    world.engine.positionIterations = 8;
    world.engine.velocityIterations = 6;
    world.engine.gravity.y = PHYSICS.gravityPxS2 / 1000;
    installTerrainContactFix(Phaser.Physics.Matter.Matter);

    // visuals / entities
    this.cameras.main.setBackgroundColor(this.palette.bg);
    this.bg = new Background(this, this.palette);
    this.mesh = new TerrainMesh(this, this.palette, this.content.terrainMods);
    this.fx = new Fx(this, this.palette);
    this.trail = new TrailParticles(this, this.palette);
    this.shardField = new ShardField(this, this.palette);
    this.airTelegraph = new AirTelegraph(this, this.palette);
    this.streaks = this.add.graphics().setDepth(12).setBlendMode(Phaser.BlendModes.ADD);
    this.flashRect = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0xffffff, 0)
      .setOrigin(0).setScrollFactor(0).setDepth(100);

    // initial terrain buffer, then the sled on the surface
    this.streamTerrain(0);
    const start = this.safeStartPosition();
    // spawn a few body-lengths in so the rear runner is over solid ground (terrain begins exactly at start.x)
    const spawnX = start.x + SPAWN_RUNIN_PX;
    const spawnY = this.terrain.heightAt(spawnX);
    const spawnAng = this.slopeAt(spawnX);
    this.startX = spawnX;
    this.sled = new Sled(this, spawnX, spawnY - 14, this.palette);
    this.sled.setPose(spawnX, spawnY - 15, spawnAng, 50 * Math.cos(spawnAng * DEG), 50 * Math.sin(spawnAng * DEG));
    this.startGate = this.add.graphics().setDepth(6);
    this.drawStartGate(this.startGate, start.x + 14, this.terrain.heightAt(start.x + 14));
    this.snapCamera();
    // best-distance gate (device best from the save store's in-memory run list; skipped when there is none)
    this.bestM = 0;
    try {
      const runs = this.saveStore && this.saveStore.runs;
      if (Array.isArray(runs)) for (const r of runs) if (r && r.distanceM > this.bestM) this.bestM = Math.floor(r.distanceM);
    } catch (e) { this.bestM = 0; }
    this.bestMarker = this.bestM >= 20
      ? new BestMarker(this, this.palette, this.startX + this.bestM * PIXELS_PER_METER, this.bestM) : null;

    // events
    this._onCollide = (event) => {
      const pairs = event && event.pairs;
      if (!pairs) return;
      for (let i = 0; i < pairs.length; i++) this.handlePair(pairs[i]);
    };
    this.matter.world.on('collisionstart', this._onCollide);
    this.matter.world.on('collisionactive', this._onCollide);
    this._onSettings = (payload) => this.onSettingsChanged(payload);
    this._onResume = () => {
      if (this.inputRouter && this.inputRouter.setEnabled) this.inputRouter.setEnabled(true);
      // consume the stale one-shot edge (the Esc that resumed) so it cannot re-pause immediately
      try { if (this.inputRouter) this.inputRouter.poll(); } catch (e) { /* ignore */ }
    };
    this.game.events.on(EVT.SETTINGS_CHANGED, this._onSettings);
    this.game.events.on(EVT.GAME_RESUME, this._onResume);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);

    // post-FX + HUD + go
    GlitchPipeline.install(this);
    this.scene.stop(SCENES.UI);
    this.scene.launch(SCENES.UI);
    this.game.events.emit(EVT.RUN_START, {
      runId: this.runId, seed: this.seed, dailyRuleId: this.dailyRuleId, startedAt: this.startedAt,
    });
  }

  /** Remove every listener / pooled object / body (runs on scene shutdown). @returns {void} */
  teardown() {
    try {
      this.game.events.off(EVT.SETTINGS_CHANGED, this._onSettings);
      this.game.events.off(EVT.GAME_RESUME, this._onResume);
    } catch (e) { /* ignore */ }
    try {
      if (this.matter && this.matter.world) {
        this.matter.world.off('collisionstart', this._onCollide);
        this.matter.world.off('collisionactive', this._onCollide);
      }
    } catch (e) { /* ignore */ }
    const safe = (o) => { try { if (o) o.destroy(); } catch (e) { /* world already torn down */ } };
    for (const list of this.hazards ? this.hazards.values() : []) list.forEach(safe);
    for (const list of this.powerups ? this.powerups.values() : []) list.forEach(safe);
    this.hazards = new Map();
    this.powerups = new Map();
    safe(this.sled);
    safe(this.mesh);
    safe(this.trail);
    safe(this.fx);
    safe(this.bg);
    safe(this.shardField);
    safe(this.bestMarker);
    safe(this.airTelegraph);
    safe(this.streaks);
    this.shardField = this.bestMarker = this.streaks = this.airTelegraph = null;
    this.sled = this.mesh = this.trail = this.fx = this.bg = null;
    this.terrain = null;
    this.tricks = null;
    this.glitch = null;
    this.score = null;
    this.safeSamples = [];
    this._contactQueue = [];
    try { this.scene.stop(SCENES.UI); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ terrain streaming

  /** Ask the generator to stream around x and mirror its adds/removals into mesh, hazards and power-ups. */
  streamTerrain(x) {
    const res = this.terrain.update(x) || {};
    const removed = res.removed || [];
    const added = res.added || [];
    for (const idx of removed) this.dropChunk(idx);
    for (const chunk of added) this.takeChunk(chunk);
    // Defensive reconcile (first call, or a generator that only reports through getActiveChunks()).
    if (this.mesh.chunks.size === 0 && this.terrain.getActiveChunks) {
      for (const chunk of this.terrain.getActiveChunks()) if (!this.mesh.chunks.has(chunk.index)) this.takeChunk(chunk);
    }
  }

  takeChunk(chunk) {
    if (!chunk || this.mesh.chunks.has(chunk.index)) return;
    this.mesh.addChunk(chunk);
    const hz = [];
    for (const spawn of chunk.hazards || []) {
      const def = this.content.hazards[spawn.defId];
      if (!def) continue;
      const h = new Hazard(this, def, spawn, this.palette);
      if (def.placement === 'air') {
        // the launch lip this air hazard belongs to (nearest lip before it): the STAY LOW telegraph stands there
        let lip = null;
        for (const l of chunk.launches || []) if (l.x < spawn.x && (!lip || l.x > lip.x)) lip = l;
        h.lip = lip ? { x: lip.x, y: lip.y } : null;
      }
      hz.push(h);
    }
    if (hz.length) this.hazards.set(chunk.index, hz);
    const pu = [];
    (chunk.powerups || []).forEach((spawn, i) => {
      const def = this.content.powerups[spawn.defId];
      if (!def || this.collectedPowerups.has(`${chunk.index}:${i}`)) return;
      const p = new PowerUp(this, def, spawn, this.palette);
      p.key = `${chunk.index}:${i}`;
      pu.push(p);
    });
    if (pu.length) this.powerups.set(chunk.index, pu);
    if (this.shardField) this.shardField.addChunk(chunk);
  }

  dropChunk(idx) {
    this.mesh.removeChunk(idx);
    if (this.shardField) this.shardField.removeChunk(idx);
    const hz = this.hazards.get(idx);
    if (hz) hz.forEach((h) => h.destroy());
    this.hazards.delete(idx);
    const pu = this.powerups.get(idx);
    if (pu) pu.forEach((p) => p.destroy());
    this.powerups.delete(idx);
  }

  /** Neon start pylon with a blinking beacon, drawn once. */
  drawStartGate(g, x, y) {
    const p = this.palette;
    g.lineStyle(5, p.cyan, 0.15);
    g.lineBetween(x, y, x, y - 70);
    g.lineStyle(2, p.cyan, 1);
    g.lineBetween(x, y, x, y - 70);
    g.lineStyle(1.5, p.text, 0.9);
    g.strokePoints([{ x: x - 7, y: y - 70 }, { x: x + 7, y: y - 70 }, { x: x + 7, y: y - 58 }, { x: x - 7, y: y - 58 }], true, true);
    g.fillStyle(p.lime, 0.8);
    g.fillRect(x - 5, y - 68, 10, 8);
    g.lineStyle(1, p.cyan, 0.5);
    for (let i = 1; i <= 4; i++) g.lineBetween(x, y - i * 12, x + 12, y - i * 12 + 4);
  }

  safeStartPosition() {
    let sp = null;
    try { sp = this.terrain.getStartPosition(); } catch (e) { /* fall through */ }
    const x = sp && Number.isFinite(sp.x) ? sp.x : 0;
    const y = sp && Number.isFinite(sp.y) ? sp.y : this.terrain.heightAt(x);
    return { x, y };
  }

  slopeAt(x) {
    const s = this.terrain.slopeDegAt(x);
    return Number.isFinite(s) ? s : 0;
  }

  /** Emit an event only if its constant exists (UI engineer adds the fun-pass names to events.js). */
  emitIf(name, payload) {
    if (name) this.game.events.emit(name, payload);
  }

  /** One-shot SFX through the registry audio (never throws). */
  playSfx(name, opts) {
    try {
      const audio = this.registry.get(REG.AUDIO);
      if (audio) audio.playSfx(name, opts);
    } catch (e) { /* audio must never break the loop */ }
  }

  /** Award a bonus through ScoreManager.addBonus when present, then publish the score. @returns {boolean} */
  bonus(points, kind) {
    if (!this.score || typeof this.score.addBonus !== 'function') return false;
    this.score.addBonus(points, kind);
    this.emitScore();
    return true;
  }

  // ------------------------------------------------------------------ collisions

  /** A head/torso brush on a concave transition is forgiven while the sled is grounded and roughly aligned with the slope. */
  headForgiven() {
    const sled = this.sled;
    if (sled.msSinceContact > 150) return false;
    const rel = Math.abs(((sled.angleDeg - sled.groundAngleDeg + 540) % 360 + 360) % 360 - 180);
    return rel <= 70;
  }

  handlePair(pair) {
    if (this.crashed || !this.sled || !this.sled.body) return;
    const a = pair.bodyA;
    const b = pair.bodyB;
    const sb = this.sled.body;
    let part;
    let other;
    if (a && a.parent === sb) { part = a; other = b; } else if (b && b.parent === sb) { part = b; other = a; } else return;
    if (!other) return;
    switch (other.label) {
      case 'terrain':
        if (part.label === 'skid' || part.label === 'deck') this.sled.noteGroundContact();
        else if (this.headForgiven()) this.sled.noteGroundContact();
        else if (!this.pendingCrash) this.pendingCrash = { cause: 'terrain' };
        break;
      case 'hazard':
        if (other.bbHazard && !other.bbHazard.hit) this._contactQueue.push(other.bbHazard);
        break;
      case 'powerup':
        if (other.bbPowerUp && !other.bbPowerUp.collected) this._contactQueue.push(other.bbPowerUp);
        break;
      case 'pad':
        if (other.bbPad) this._contactQueue.push(other);
        break;
      default:
        break;
    }
  }

  /** Resolve sensor overlaps gathered during a sub-step. */
  processContacts() {
    const q = this._contactQueue;
    if (!q.length) return;
    for (let i = 0; i < q.length; i++) {
      const o = q[i];
      if (o instanceof Hazard) this.onHazard(o);
      else if (o instanceof PowerUp) this.onPowerUp(o);
      else if (o && o.bbPad) this.onPad(o.bbPad);
    }
    q.length = 0;
  }

  onPad(pad) {
    const now = this.runTimeMs;
    if (pad._last != null && now - pad._last < 250) return;
    pad._last = now;
    const mul = this.sled ? 1 : 1;
    const zoneMul = this.currentPhys ? this.currentPhys.bounceMul : 1;
    const up = pad.boost * mul * Math.max(1, zoneMul);
    this.sled.launchUp(up);
    this.fx.ring(pad.x, pad.y - 6, this.palette.lime, 26, 320);
    this.fx.sparks(pad.x, pad.y - 6, this.palette.lime, 10, 140, 120);
  }

  onHazard(h) {
    if (h.hit || this.crashed) return;
    if (this.sled.invulnerableMs > 0) return;
    h.hit = true;
    const def = h.def;
    const eff = def.onHit || { effect: 'crash' };
    const kind = eff.effect;
    const dur = kind === 'crash' ? 0 : (eff.durationMs != null ? eff.durationMs : (kind === 'scramble' ? PHYSICS.scrambleDurationMs : 1500));
    this.game.events.emit(EVT.HAZARD_HIT, { hazardId: def.id, effect: kind, durationMs: dur, x: h.cx, y: h.cy });
    if (kind === 'crash') {
      if (!this.pendingCrash) this.pendingCrash = { cause: 'hazard', hazardId: def.id };
    } else if (kind === 'slow') {
      this.slowMs = dur;
      this.slowFactor = eff.speedFactor != null ? eff.speedFactor : PHYSICS.slowFactor;
      this.sled.scaleVelocity(this.slowFactor);
      this.fx.sparks(h.cx, h.cy, h.color, 14, 200);
      this.shake(2);
    } else if (kind === 'scramble') {
      this.scrambleMs = dur;
      this.fx.sparks(h.cx, h.cy, h.color, 16, 160, 80);
      this.shake(1.5);
    }
    if (h.gfx) h.gfx.setAlpha(0.4);
  }

  onPowerUp(p) {
    if (p.collected || this.crashed) return;
    p.collected = true;
    if (p.key) this.collectedPowerups.add(p.key);
    const def = p.def;
    const eff = def.effect || {};
    let durationMs = 0;
    let charges = 0;
    if (eff.kind === 'slowmo') {
      durationMs = eff.durationMs || 1000;
      this.slowmoMs = Math.min(SLOWMO_CAP_MS, this.slowmoMs + durationMs);
      this.slowmoScale = eff.timeScale || 0.5;
    } else if (eff.kind === 'speedBoost') {
      durationMs = eff.durationMs || 3000;
      this.boostMs = durationMs;
      this.boostFactor = eff.speedFactor || 1.3;
      this.sled.scaleVelocity(this.boostFactor);
    } else if (eff.kind === 'shield') {
      this.shieldCharges += eff.charges || 1;
      charges = this.shieldCharges;
      this.sled.shield = true;
    }
    this.fx.ring(p.spawn.x, p.spawn.y, p.color, 34, 420);
    this.fx.sparks(p.spawn.x, p.spawn.y, p.color, 12, 180);
    this.game.events.emit(EVT.POWERUP_COLLECTED, { id: def.id, durationMs, charges });
    // remove the pickup immediately (cannot be destroyed inside a Matter event callback chain, so defer to frame end)
    this._despawn = this._despawn || [];
    this._despawn.push(p);
  }

  // ------------------------------------------------------------------ input

  normalizePad(raw) {
    const p = raw || {};
    const pr = p.pressed || {};
    return {
      push: !!p.push,
      tilt: Number.isFinite(p.tilt) ? p.tilt : 0,
      tuck: !!p.tuck,
      brake: !!p.brake,
      hop: !!p.hop,
      reset: !!p.reset,
      heli: p.heli > 0 ? 1 : p.heli < 0 ? -1 : 0,
      airBrake: !!p.airBrake,
      parachute: !!p.parachute,
      pause: !!p.pause,
      pressed: {
        hop: !!pr.hop, reset: !!pr.reset, pause: !!pr.pause, airBrake: !!pr.airBrake, parachute: !!pr.parachute, confirm: !!pr.confirm,
      },
      lastSource: p.lastSource || 'keyboard',
    };
  }

  // ------------------------------------------------------------------ main loop

  update(time, delta) {
    if (!this.sled) return;
    const dt = clamp(Number.isFinite(delta) ? delta : 16.7, 0, 50);
    this._frameDt = dt;

    if (this.crashed) {
      this.updateCrashed(dt);
      return;
    }

    const pad = this.normalizePad(this.inputRouter ? this.inputRouter.poll() : null);
    if (pad.pressed.pause) {
      this.pauseRun();
      return;
    }
    this.runTimeMs += dt;
    this._hudMs = (this._hudMs || 0) + dt;
    if (this._hudMs >= 100) {
      this._hudMs = 0;
      // flow fields resync the HUD meter (timeout drains in run-clock time, which slow-mo stretches)
      this.game.events.emit(HUD_SPEED_EVENT, {
        speedPxS: this.sled.speed, flow: this.score.getFlow(), flowFrac: this.score.getFlowTimeoutFraction(),
      });
    }

    // timers (real time)
    this.tickEffects(dt);
    this.resetCooldownMs = Math.max(0, this.resetCooldownMs - dt);
    if (pad.pressed.reset && this.resetCooldownMs <= 0) this.manualReset();

    // physics context
    const zoneDefs = this.getZoneDefs(this.sled.x);
    const sled = this.sled;
    sled.groundAngleDeg = this.slopeAt(sled.x);
    sled.scrambled = this.scrambleMs > 0;
    const ctx = {
      tucked: pad.tuck,
      zones: zoneDefs,
      daily: this.dailyMods,
      scrambled: this.scrambleMs > 0,
      slowed: this.slowMs > 0,
      slowFactor: this.slowFactor,
      speedBoost: this.boostMs > 0 ? this.boostFactor : 1,
      timeMs: this.runTimeMs,
      parachute: sled.parachuteMs > 0,
      airBrake: sled.airBrakeActive,
      airborne: !sled.grounded,
      braking: pad.brake,
    };
    const phys = this.tuner.getEffective(ctx);
    this.currentPhys = phys;

    // sub-stepped physics; slow-mo scales the delta, never the 8 ms limit
    sled.dropAheadDeg = this.dropAhead(sled);
    this.airForecast(sled);
    let simDt = dt * (this.slowmoMs > 0 ? this.slowmoScale : 1);
    if (this.blinkMs > 0) { this.blinkMs -= dt; simDt *= 0.35; }
    if (this.hitStopMs > 0) { this.hitStopMs -= dt; simDt = 0; }
    stepWorld(
      this.matter.world,
      simDt,
      (stepMs) => sled.applyControls(pad, phys, stepMs),
      (stepMs) => {
        sled.endStep(stepMs);
        this.processContacts();
      },
    );
    this.flushDespawn();
    // flow timeout runs on the same scaled run clock as physics (slow-mo stretches it, pause / hit-stop freeze it)
    this.emitFlow(this.score.tick(simDt));

    // SFX with no event: push / hop (+ wind speed every frame)
    const audio = this.registry.get(REG.AUDIO);
    if (audio) {
      try {
        if (sled.hopPulse) audio.playSfx('hop');
        if (sled.pushPulse) audio.playSfx('push');
        if (audio.setSpeed) audio.setSpeed(sled.speed);
      } catch (e) { /* audio must never break the loop */ }
    }
    this._hopped = !!sled.hopPulse;
    this._pushed = !!sled.pushPulse;
    sled.hopPulse = 0;
    sled.pushPulse = 0;

    // ground slope for landing alignment (post-step position)
    sled.groundAngleDeg = this.slopeAt(sled.x);

    // void check (fell into a wireless gap / off the world)
    if (!this.pendingCrash) {
      const gy = this.terrain.heightAt(sled.x);
      if (!Number.isFinite(sled.y) || (Number.isFinite(gy) && sled.y > gy + TUNING.voidDepthPx)) {
        this.pendingCrash = { cause: 'chasm' };
      }
    }

    // trick tracking (always fed; flagged crashed on the frame a crash is detected)
    const fs = sled.getFrameState(this.runTimeMs, dt);
    // a hazard hit that a shield charge (or post-respawn grace) will absorb leaves the sled flying: keep its air phase
    const absorbed = !!this.pendingCrash && this.pendingCrash.cause === 'hazard' && (this.shieldCharges > 0 || sled.invulnerableMs > 0);
    fs.crashed = !!this.pendingCrash && !absorbed;
    const upd = this.tricks.update(fs) || {};
    this.maxAirtimeMs = Math.max(this.maxAirtimeMs, upd.airtimeMs || 0, sled.airtimeMs);

    if (!this.pendingCrash || absorbed) this.handleTricksAndLanding(upd, fs);
    else if (upd.landing && upd.landing.quality === 'crash') { /* already crashing */ }

    // zones, safe-ground samples
    this.updateZones(sled.x);
    this.sampleSafeGround(dt, fs);

    // crash resolution (may be negated by Hashed Backup)
    if (this.pendingCrash) this.resolveCrash(fs);

    if (!this.crashed) {
      this.updateFun(dt, pad, Math.max(0, (sled.x - this.startX) / PIXELS_PER_METER));
      // distance
      const metres = Math.max(0, (sled.x - this.startX) / PIXELS_PER_METER);
      if (this.score.setDistance(metres)) {
        this.game.events.emit(EVT.DISTANCE_CHANGED, { meters: Math.floor(this.score.distanceM) });
        this.emitScore();
      }

      // terrain streaming
      this.streamTerrain(sled.x);

      // glitch schedule
      const gr = this.glitch.update(this.runTimeMs, this.score.distanceM) || {};
      for (const e of gr.ended || []) this.game.events.emit(EVT.GLITCH_END, { id: e.id });
      for (const e of gr.started || []) {
        this.game.events.emit(EVT.GLITCH_START, { id: e.id, kind: e.kind, durationMs: e.durationMs, intensity: e.intensity });
      }
    }

    this.renderFrame(dt, pad);
  }

  /** Visuals shared by live and crashed frames that need the sled. */
  renderFrame(dt) {
    const sled = this.sled;
    if (!sled || !this.cameras.main) return;
    sled.shield = this.shieldCharges > 0;
    if (!this.crashed) {
      sled.render(dt);
      // trail anchored at the rear runner
      const a = sled.body.angle;
      const c = Math.cos(a);
      const s = Math.sin(a);
      this.trail.update(sled.x + c * -16 - s * 6, sled.y + s * -16 + c * 6, sled.speed);
    }
    const fxDt = this.hitStopMs > 0 || (this.crashed && this.crashTimerMs < TUNING.hitStopCrashMs) ? dt * 0.08 : dt;
    this.updateCamera(dt);
    const cam = this.cameras.main;
    const halfW = GAME_WIDTH / (2 * cam.zoom);
    const left = cam.scrollX + GAME_WIDTH / 2 - halfW;
    const right = cam.scrollX + GAME_WIDTH / 2 + halfW;
    this._view = { left, right, top: cam.scrollY + GAME_HEIGHT / 2 - GAME_HEIGHT / (2 * cam.zoom), bottom: cam.scrollY + GAME_HEIGHT / 2 + GAME_HEIGHT / (2 * cam.zoom) };
    this.mesh.cull(left - 40, right + 40);
    const t = this.runTimeMs;
    for (const list of this.hazards.values()) for (const h of list) h.update(t, left, right);
    for (const list of this.powerups.values()) for (const p of list) p.update(t, left, right);
    this.fx.update(fxDt, this.heightFn);
    if (this.shardField) this.shardField.update(t, left, right);
    if (this.bestMarker) this.bestMarker.update(t, sled.x, this.heightFn);
    this.drawStreaks(t);
    this.bg.update(cam.scrollX, t, sled.speed);
    if (this.flashRect.alpha > 0) this.flashRect.setAlpha(Math.max(0, this.flashRect.alpha - dt / 350));
  }

  /** Airborne only: ballistic ms to touchdown and the ground slope there (sled.airEtaMs / airSlopeDeg), for Sled's hands-off levelling. */
  airForecast(sled) {
    if (sled.grounded) { sled.airEtaMs = Infinity; sled.airSlopeDeg = null; return; }
    const g = (this.currentPhys && this.currentPhys.gravityPxS2) || 900;
    for (let ms = 20; ms <= 2500; ms += 20) {
      const ts = ms / 1000;
      const x = sled.x + sled.vx * ts;
      if (sled.y + sled.vy * ts + 0.5 * g * ts * ts + 14 >= this.terrain.heightAt(x)) { sled.airEtaMs = ms; sled.airSlopeDeg = this.slopeAt(x); return; }
    }
    sled.airEtaMs = Infinity;
    sled.airSlopeDeg = null;
  }

  /** How many degrees steeper (downhill) the ground gets a short way ahead; large for kickers / drops. */
  dropAhead(sled) {
    const ahead = clamp(Math.abs(sled.vx) * 0.1, 24, 90);
    const here = this.slopeAt(sled.x);
    return this.slopeAt(sled.x + ahead) - here;
  }

  /** Subtle speed streaks (world space, additive), only at high speed. */
  drawStreaks(t) {
    const g = this.streaks;
    if (!g) return;
    g.clear();
    const sled = this.sled;
    const k = smooth01((sled.speed - TUNING.streakSpeedLo) / (TUNING.streakSpeedHi - TUNING.streakSpeedLo));
    if (k <= 0.02 || !this._view || this.crashed) return;
    const v = this._view;
    const w = v.right - v.left;
    const h = v.bottom - v.top;
    const sp = sled.speed || 1;
    const dx = sled.vx / sp;
    const dy = sled.vy / sp;
    const len = 26 + 60 * k;
    g.lineStyle(1, this.palette.text, 0.22 * k);
    for (let i = 0; i < 16; i++) {
      const fx = (((i * 0.6180339 + 0.13) % 1) * w * 1.0 - sled.x * (0.35 + (i % 4) * 0.12) + w * 8) % w;
      const fy = ((i * 0.3819660 + 0.07) % 1) * h * 0.85 + ((t * 0.02 * (1 + i % 3)) % 6);
      const x = v.left + (fx + w) % w;
      const y = v.top + fy;
      g.lineBetween(x, y, x - dx * len, y - dy * len);
    }
  }

  tickEffects(dt) {
    if (this.slowMs > 0) {
      this.slowMs -= dt;
      if (this.slowMs <= 0) {
        this.slowMs = 0;
        this.game.events.emit(EVT.EFFECT_END, { effect: 'slow' });
      }
    }
    if (this.scrambleMs > 0) {
      this.scrambleMs -= dt;
      if (this.scrambleMs <= 0) {
        this.scrambleMs = 0;
        this.sled.scrambled = false;
        this.game.events.emit(EVT.EFFECT_END, { effect: 'scramble' });
      }
    }
    if (this.boostMs > 0) {
      this.boostMs -= dt;
      if (this.boostMs <= 0) {
        this.boostMs = 0;
        this.game.events.emit(EVT.POWERUP_EXPIRED, { id: 'packetBurst', reason: 'timeout' });
      }
    }
    if (this.slowmoMs > 0) {
      this.slowmoMs -= dt;
      if (this.slowmoMs <= 0) {
        this.slowmoMs = 0;
        this.game.events.emit(EVT.POWERUP_EXPIRED, { id: 'clockPulse', reason: 'timeout' });
      }
    }
  }

  flushDespawn() {
    if (!this._despawn || !this._despawn.length) return;
    for (const p of this._despawn) {
      for (const [idx, list] of this.powerups) {
        const i = list.indexOf(p);
        if (i >= 0) {
          list.splice(i, 1);
          if (!list.length) this.powerups.delete(idx);
          break;
        }
      }
      p.destroy();
    }
    this._despawn.length = 0;
  }

  // ------------------------------------------------------------------ tricks / landings / score

  emitScore() {
    const total = this.score.getTotal();
    const delta = total - this.lastTotal;
    this.lastTotal = total;
    this.game.events.emit(EVT.SCORE_CHANGED, {
      total, distancePoints: this.score.getDistancePoints(), trickPoints: this.score.trickPoints, delta,
    });
  }

  emitCombo(reason) {
    const snap = this.score.getSnapshot();
    this.bestCombo = Math.max(this.bestCombo, snap.multiplier);
    this.game.events.emit(EVT.COMBO_CHANGED, {
      multiplier: snap.multiplier, tricks: snap.comboTricks, pendingPoints: snap.pendingPoints, reason,
    });
  }

  /** Publish a ScoreManager FlowChange: FLOW_LOST when cleared, else FLOW_CHANGED when the value moved. */
  emitFlow(fc) {
    if (!fc) return;
    if (fc.lost) {
      this.game.events.emit(EVT.FLOW_LOST, { previous: fc.previous, reason: fc.reason });
    } else if (fc.changed) {
      this.game.events.emit(EVT.FLOW_CHANGED, {
        flow: fc.flow, previous: fc.previous, reason: fc.reason, timeoutFrac: fc.timeoutFrac, best: fc.best,
      });
    }
  }

  handleTricksAndLanding(upd, fs) {
    for (const t of upd.tricks || []) {
      const r = this.score.addTrick(t);
      const n = Math.max(1, t.count || 1);
      this.trickCounts[t.type] = (this.trickCounts[t.type] || 0) + n;
      this.game.events.emit(EVT.TRICK, {
        type: t.type, count: n, value: r.value, isNew: r.isNew, airtimeMs: t.airtimeMs != null ? t.airtimeMs : upd.airtimeMs || 0,
      });
      this._airTricks += n;
      if (/flip$/i.test(t.type)) this.tutDoneId('flip');
      this.emitCombo('trick');
      this.fx.sparks(fs.x, fs.y - 14, r.isNew ? this.palette.amber : this.palette.cyan, 8, 150, 60);
    }
    let l = upd.landing;
    if (!l) return;
    this.maxAirtimeMs = Math.max(this.maxAirtimeMs, l.airtimeMs || 0);
    const airTricks = this._airTricks;
    this._airTricks = 0;
    // forgiveness: clearly-bad-but-not-head-first landings become a recoverable wobble instead of a crash
    if (l.quality === 'crash' && Math.abs(l.angleDeg || 0) <= TUNING.forgiveAngleDeg
      && (l.impactSpeedPxS || 0) < TUNING.forgiveImpactPxS) {
      l = { ...l, quality: 'sloppy' };
    }
    if (l.quality === 'crash') {
      this.game.events.emit(EVT.LANDING, {
        quality: 'crash', angleDeg: l.angleDeg || 0, impactSpeedPxS: l.impactSpeedPxS || 0, airtimeMs: l.airtimeMs || 0,
        bonusPoints: 0, bankedPoints: 0, hard: true, x: fs.x, y: fs.y,
      });
      this.pendingCrash = { cause: 'badLanding' };
      return;
    }
    const pre = this.score.getSnapshot();
    const mult = pre.multiplier || 1;
    const nTricks = Math.max(airTricks, (pre.comboTricks || []).length);
    const r = this.score.onLanding(l);
    this.game.events.emit(EVT.LANDING, {
      quality: l.quality, angleDeg: l.angleDeg || 0, impactSpeedPxS: l.impactSpeedPxS || 0, airtimeMs: l.airtimeMs || 0,
      bonusPoints: r.bonus, bankedPoints: r.banked, hard: !!l.hard, x: fs.x, y: fs.y,
      // additive (HUD): named combo, the multipliers applied, and whether an unfinished helicopter spin cost a grade
      comboName: r.comboName || '', comboMult: r.multiplierUsed, flowUsed: r.flowUsed, midSpin: !!l.midSpin,
    });
    this.emitFlow(r.flowChange);
    this.emitCombo('landing');
    this.emitScore();
    const col = l.quality === 'perfect' ? this.palette.lime : l.quality === 'sloppy' ? this.palette.amber : this.palette.cyan;
    const imp = l.impactSpeedPxS || 0;
    this.fx.sparks(fs.x, fs.y + 8, col, Math.round(clamp(6 + imp / 45, 6, 28)), clamp(110 + imp * 0.25, 110, 280), 90);
    if (l.quality === 'perfect') this.fx.ring(fs.x, fs.y + 10, this.palette.lime, 30, 360);
    if (l.hard) this.shake(TUNING.shakeHardLanding);
    if (l.quality === 'perfect' || l.hard) {
      this.hitStopMs = Math.max(this.hitStopMs, TUNING.hitStopLandingMs);
      this.sled.squash = l.hard ? 1 : 0.6;
    } else if (imp > 250) this.sled.squash = 0.35;
    this._landings += 1;
    this.applyLandingBoost(l, mult, nTricks, fs);
  }

  /** Trick -> speed loop (TUNING.boost*): a clean landing after tricks gives a forward burst and a stretch of low drag. */
  applyLandingBoost(l, mult, nTricks, fs) {
    const sled = this.sled;
    if (l.quality === 'sloppy') {
      sled.wobble(TUNING.sloppySpeedKeep);
      return;
    }
    let amt = 0;
    if (nTricks > 0) {
      amt = TUNING.boostBasePxS * mult * (1 + TUNING.boostTrickCountBonus * (nTricks - 1));
      if (l.quality === 'perfect') amt *= TUNING.boostPerfectMul;
      amt = Math.min(TUNING.boostCapPxS, amt);
    } else if (l.quality === 'perfect') {
      amt = TUNING.boostPerfectNoTrickPxS;
    }
    if (amt <= 0) return;
    sled.addForwardSpeed(amt);
    sled.boostMs = TUNING.boostDragMs;
    this.lastBoost = { amountPxS: Math.round(amt), t: this.runTimeMs };
    this.emitIf(EVT.LANDING_BOOST, { amountPxS: Math.round(amt), quality: l.quality, comboMult: mult, tricks: nTricks });
    const k = amt / TUNING.boostCapPxS;
    const sp = sled.speed || 1;
    const bx = fs.x - (sled.vx / sp) * 18;
    const by = fs.y - (sled.vy / sp) * 18 + 6;
    this.fx.ring(fs.x, fs.y + 6, this.palette.amber, 38 + 30 * k, 420);
    this.fx.sparks(bx, by, this.palette.lime, 10 + Math.round(14 * k), 260 + 160 * k, 20);
    this.fx.sparks(bx, by, this.palette.amber, 6, 200, 10);
    this._zoomKick = Math.max(this._zoomKick, 0.025 + 0.04 * k);
    this.shake(1 + 1.5 * k);
  }

  // ------------------------------------------------------------------ fun-pass systems

  /** Emit scheduler transitions (UIScene draws one hint at a time) and persist what they imply. */
  applyHintEvents(events) {
    for (const e of events) {
      if (e.show) this.tutShown.add(e.id); else this.tutShown.delete(e.id);
      this.emitIf(EVT.TUTORIAL_HINT, e);
      if (e.id === 'tuck' && e.show) {
        this.tuckShows += 1;
        saveTuckShows(this.tuckShows);
      } else if (!e.show && ((e.id === 'boost') || (e.id === 'tuck' && this.tuckShows >= TUNING.tuckHintMaxShows))) {
        this.tutDoneId(e.id); // explained once / shown often enough
      }
    }
  }

  /** The player did what the hint asks: hide it and never show it again (persisted). */
  tutDoneId(id) {
    if (this.tutDone.has(id)) return;
    const ev = this.hints.complete(id, this.runTimeMs);
    saveTutorialDone(this.tutDone);
    this.applyHintEvents(ev);
  }

  /** Per-frame: shards, near misses, milestones / best marker, first-run hints. */
  updateFun(dt, pad, metres) {
    const sled = this.sled;
    const now = this.runTimeMs;

    // shards
    if (this.shardField) {
      const got = this.shardField.collect(sled.x, sled.y - 6, TUNING.shardRadiusPx);
      for (const sh of got) {
        if (now - this.shardChainAt > TUNING.shardChainMs) this.shardChain = 0;
        this.shardChain += 1;
        this.shardChainAt = now;
        const points = Math.min(TUNING.shardPointsCap, TUNING.shardPointsPerChain * this.shardChain);
        this.bonus(points, 'shard');
        this.shardTotal += points;
        this.shardCount = (this.shardCount || 0) + 1;
        this.emitIf(EVT.SHARD_COLLECTED, { chain: this.shardChain, points, total: this.shardTotal, count: this.shardCount, x: sh.x, y: sh.y });
        this.fx.ring(sh.x, sh.y, this.palette.lime, 16 + Math.min(14, this.shardChain * 2), 260);
        this.fx.sparks(sh.x, sh.y, this.palette.lime, 6 + Math.min(8, this.shardChain), 150);
      }
    }

    // near misses + first-hazard hint
    let hazardDx = Infinity;
    const marks = [];
    for (const list of this.hazards.values()) {
      for (const h of list) {
        if (h.hit || (h.def.onHit && h.def.onHit.effect !== 'crash')) continue;
        // air hazards (roguePacket) float: hy is the box CENTRE, not a ground contact, and hopping is the wrong answer
        const air = h.def.placement === 'air';
        const dxh = h.cx - sled.x;
        if (!air && dxh > 0 && dxh < hazardDx) hazardDx = dxh;
        if (air && !h.warned && !h.hit && dxh > 0 && dxh < TUNING.airWarnAheadPx) {
          h.warned = true;
          h.alert = true;
          this.playSfx('airWarn');
        }
        if (air && h.alert && h.lip && dxh > 0) marks.push({ lip: h.lip, box: { x: h.cx, y: h.cy } });
        const side = sled.x >= h.cx ? 1 : -1;
        if (h._side === -1 && side === 1 && !h.nearMissed) {
          const dy = sled.y - h.cy;
          const below = air ? TUNING.airNearMissBelowPx : TUNING.nearMissBelowPx;
          // air hazards: flying UNDER it (airborne at the box x) is the normal line and pays; the window covers the whole no-hop family
          if (air && (sled.invulnerableMs > 0 || dy <= h.h / 2)) {
            // no payout while passing through the box under grace, and only a sled BELOW the box bottom counts
          } else if ((!air || !sled.grounded) && dy > -(h.h / 2 + TUNING.nearMissAbovePx) && dy < h.h / 2 + below) {
            h.nearMissed = true;
            this.nearMissCount = (this.nearMissCount || 0) + 1;
            this.bonus(TUNING.nearMissPoints, 'nearMiss');
            this.emitIf(EVT.NEAR_MISS, { hazardType: h.def.id, points: TUNING.nearMissPoints, x: h.cx, y: h.cy });
            this.blinkMs = TUNING.nearMissSlowMs;
            const fy = air ? h.cy : h.cy - h.h / 2;
            this.fx.sparks(h.cx, fy, this.palette.amber, 12, 220, 60);
            this.fx.ring(h.cx, fy, this.palette.amber, 26, 300);
          }
        }
        h._side = side;
      }
    }

    if (this.airTelegraph) this.airTelegraph.update(now, sled.x, marks);

    // milestones + best marker
    // ScoreManager pays each completed sector exactly once (addBonus 'milestone'); the scene only announces it
    for (const m of this.score.checkMilestones(metres)) {
      this.emitScore();
      this.emitIf(EVT.MILESTONE, { sector: m.sector, distanceM: m.distanceM, points: m.points });
      this.flashRect.setFillStyle(this.palette.cyan, 1).setAlpha(0.2);
      this.fx.ring(sled.x, sled.y, this.palette.cyan, 70, 600);
      this.fx.sparks(sled.x, sled.y - 6, this.palette.cyan, 14, 240, 40);
    }
    if (this.bestM > 0 && !this.newBestDone && metres > this.bestM) {
      this.newBestDone = true;
      this.emitIf(EVT.NEW_BEST, { distanceM: Math.floor(metres), previousBestM: this.bestM });
      if (this.bestMarker) this.bestMarker.markPassed();
      this.flashRect.setFillStyle(this.palette.amber, 1).setAlpha(0.28);
      this.fx.ring(sled.x, sled.y, this.palette.amber, 80, 700);
      this.fx.sparks(sled.x, sled.y - 6, this.palette.amber, 20, 280, 60);
    }

    // first-run hints: triggers only; HintScheduler decides what is on screen (one at a time, readable, prioritised)
    if (this._pushed) this.tutDoneId('push');
    if (this._hopped && this.tutShown.has('hop')) this.tutDoneId('hop');
    if (pad.tuck && sled.grounded) this.tutDoneId('tuck');
    this.tutTimers.stall = sled.grounded && sled.speed < 20 && now > 800 ? this.tutTimers.stall + dt : 0;
    const wants = {};
    wants.push = this.tutTimers.stall > 700;
    // hop: HOP_HINT_LEAD_S of travel before the hazard (it enters the screen about a second before the sled gets there)
    const hopLead = clamp(sled.speed * HOP_HINT_LEAD_S, HOP_HINT_MIN_PX, HOP_HINT_MAX_PX);
    wants.hop = hazardDx < hopLead;
    const danger = !this.tutDone.has('hop') && hazardDx < sled.speed * HOP_DANGER_S + HOP_HINT_MIN_PX;
    // flip: on the approach to a launch lip (learn it before the jump), and in the air until a trick starts
    const lipAhead = !this.tutDone.has('flip') && sled.grounded && this.launchAheadPx(sled.x) < Math.max(FLIP_APPROACH_MIN_PX, sled.speed * FLIP_APPROACH_S);
    wants.flip = lipAhead || (!sled.grounded && sled.airtimeMs > FLIP_AIR_MS && this._airTricks === 0);
    wants.boost = this.lastBoost != null && now - this.lastBoost.t < BOOST_HINT_MS;
    // tuck: a steep grounded descent, only once the first jump and landing are behind the player
    const steep = sled.grounded && !pad.tuck && sled.groundAngleDeg >= TUNING.tuckHintSlopeDeg && sled.speed > 150;
    this._steepMs = steep ? this._steepMs + dt : 0;
    wants.tuck = this._landings > 0 && now > TUCK_HINT_MIN_RUN_MS && this.tuckShows < TUNING.tuckHintMaxShows && (this._steepMs > TUNING.tuckHintMs || this.tutShown.has('tuck') && steep);
    this.applyHintEvents(this.hints.update(now, wants, danger));
  }

  /** Distance (px) from x to the next generated launch lip ahead, or Infinity. */
  launchAheadPx(x) {
    let best = Infinity;
    for (const ch of this.terrain.activeList) {
      if (ch.endX < x) continue;
      for (const l of ch.launches || []) if (l.x > x && l.x - x < best) best = l.x - x;
      if (best < Infinity) break;
    }
    return best;
  }

  // ------------------------------------------------------------------ zones

  getZoneDefs(x) {
    let zones = [];
    try { zones = this.terrain.getZonesAt(x) || []; } catch (e) { zones = []; }
    const out = [];
    for (const z of zones) {
      const def = this.content.terrainMods[z.modId];
      if (def) out.push(def);
    }
    return out;
  }

  updateZones(x) {
    let zones = [];
    try { zones = this.terrain.getZonesAt(x) || []; } catch (e) { zones = []; }
    const now = new Map();
    for (const z of zones) now.set(`${z.modId}:${Math.round(z.x0)}`, z);
    for (const [k, z] of now) {
      if (!this.activeZones.has(k)) {
        this.game.events.emit(EVT.ZONE_ENTER, { modId: z.modId, x0: z.x0, x1: z.x1 });
      }
    }
    for (const [k, z] of this.activeZones) {
      if (!now.has(k)) this.game.events.emit(EVT.ZONE_EXIT, { modId: z.modId, x0: z.x0, x1: z.x1 });
    }
    this.activeZones = now;
  }

  // ------------------------------------------------------------------ safe ground / respawn

  sampleSafeGround(dt, fs) {
    this._safeTimer += dt;
    const t = this.runTimeMs;
    while (this.safeSamples.length && t - this.safeSamples[0].t > SAFE_HISTORY_MS) this.safeSamples.shift();
    if (this._safeTimer < SAFE_SAMPLE_EVERY_MS) return;
    this._safeTimer = 0;
    if (!this.sled.grounded || this.pendingCrash) return;
    const rel = Math.abs(((fs.angleDeg - fs.groundAngleDeg + 540) % 360) - 180);
    if (rel > 28) return;
    // origin y of the sled so that the runners sit on the ground at this x
    const gy = this.terrain.heightAt(fs.x);
    if (!Number.isFinite(gy)) return;
    this.safeSamples.push({ t, x: fs.x, y: gy - 14, vx: fs.vx, vy: fs.vy, ang: this.slopeAt(fs.x) });
  }

  pickSafe(minAgeMs) {
    const t = this.runTimeMs;
    for (let i = this.safeSamples.length - 1; i >= 0; i--) {
      if (t - this.safeSamples[i].t >= minAgeMs) return this.safeSamples[i];
    }
    return this.safeSamples[0] || null;
  }

  respawnAt(sample, reason, speedKeep, minAlong = 60) {
    const s = this.sled;
    let x;
    let y;
    let ang;
    let vx;
    let vy;
    if (sample) {
      x = sample.x; y = sample.y; ang = sample.ang; vx = sample.vx; vy = sample.vy;
    } else {
      x = s.x; y = this.terrain.heightAt(s.x) - 16; ang = this.slopeAt(s.x);
      vx = s.vx; vy = 0;
    }
    const sp = Math.hypot(vx, vy);
    const keep = sp > 1 ? Math.min(1, 380 / sp) * speedKeep : 0;
    const dirx = Math.cos(ang * DEG);
    const diry = Math.sin(ang * DEG);
    const along = Math.max(minAlong, sp * keep);
    s.setPose(x, y - 4, ang, dirx * along, diry * along);
    s.invulnerableMs = TUNING.invulnerableMs;
    this._airTricks = 0;
    this.tricks.reset();
    this.trail.reset();
    this.safeSamples.length = 0;
    this.fx.ring(x, y, this.palette.cyan, 40, 400);
    this.snapCamera();
    return { x, y };
  }

  manualReset() {
    const sample = this.pickSafe(250);
    const r = this.score.penalizeReset() || { comboPenalty: 0, pointsLost: 0 };
    this.emitFlow(r.flowChange);
    const pos = this.respawnAt(sample, 'manual', 0.6);
    this.resetCooldownMs = 600;
    // timed pickups / hazard effects end with the respawn
    if (this.boostMs > 0) { this.boostMs = 0; this.game.events.emit(EVT.POWERUP_EXPIRED, { id: 'packetBurst', reason: 'respawn' }); }
    if (this.slowmoMs > 0) { this.slowmoMs = 0; this.game.events.emit(EVT.POWERUP_EXPIRED, { id: 'clockPulse', reason: 'respawn' }); }
    if (this.slowMs > 0) { this.slowMs = 0; this.game.events.emit(EVT.EFFECT_END, { effect: 'slow' }); }
    if (this.scrambleMs > 0) { this.scrambleMs = 0; this.sled.scrambled = false; this.game.events.emit(EVT.EFFECT_END, { effect: 'scramble' }); }
    this.game.events.emit(EVT.RESPAWN, { reason: 'manual', x: pos.x, y: pos.y, comboPenalty: r.comboPenalty || 0 });
    this.emitCombo('reset');
    this.emitScore();
  }

  // ------------------------------------------------------------------ crash

  resolveCrash(fs) {
    const c = this.pendingCrash;
    this.pendingCrash = null;
    const speed = Math.hypot(fs.vx, fs.vy);
    if (this.sled.invulnerableMs > 0 && c.cause !== 'chasm') return; // brief grace after a respawn / backup
    const distM = (fs.x - this.startX) / PIXELS_PER_METER;
    if (c.cause !== 'hazard' && c.cause !== 'chasm' && distM < TUNING.openingGraceM && this.openingGraces < TUNING.openingGraceMax) {
      // opening grace: recover instead of ending the run (no Hashed Backup charge used)
      this.openingGraces += 1;
      this.sled.invulnerableMs = Math.max(this.sled.invulnerableMs, 1200);
      this.fx.ring(fs.x, fs.y, this.palette.amber, 46, 450);
      this.fx.sparks(fs.x, fs.y, this.palette.amber, 12, 220);
      this.shake(1.5);
      this.flashRect.setFillStyle(this.palette.amber, 1).setAlpha(0.2);
      const dropped = this.score.getSnapshot().comboTricks.length;
      this.emitFlow(this.score.onCrash());
      const pos = this.respawnAt(this.pickSafe(800), 'backup', 0.9, 250);
      this.game.events.emit(EVT.RESPAWN, { reason: 'backup', x: pos.x, y: pos.y, comboPenalty: dropped });
      this.emitCombo('crash');
      return;
    }
    if (this.shieldCharges > 0) {
      this.shieldCharges -= 1;
      this.game.events.emit(EVT.CRASH, {
        cause: c.cause, x: fs.x, y: fs.y, speedPxS: speed, hazardId: c.hazardId, negated: true,
      });
      this.game.events.emit(EVT.POWERUP_EXPIRED, { id: 'hashedBackup', reason: 'consumed' });
      this.sled.invulnerableMs = Math.max(this.sled.invulnerableMs, 1200);
      this.fx.ring(fs.x, fs.y, this.palette.amber, 46, 450);
      this.fx.sparks(fs.x, fs.y, this.palette.amber, 20, 260);
      this.shake(2.5);
      this.flashRect.setFillStyle(this.palette.amber, 1).setAlpha(0.25);
      if (c.cause !== 'hazard') {
        // body/landing/void crash: the sled is wrecked, put it back on safe ground (pending combo dropped, tracker reset)
        const dropped = this.score.getSnapshot().comboTricks.length;
        this.emitFlow(this.score.onShieldHit(true));
        const pos = this.respawnAt(this.pickSafe(800), 'backup', 0.8);
        this.game.events.emit(EVT.RESPAWN, { reason: 'backup', x: pos.x, y: pos.y, comboPenalty: dropped });
        this.emitCombo('crash');
      } else {
        // a hazard hit absorbed by the shield (e.g. mid-air): the jump goes on, so the pending combo stays untouched and
        // only the flow bonus is halved (dropping it would re-pay later flips at their full cumulative value)
        this.emitFlow(this.score.onShieldHit(false));
      }
      return;
    }
    this.doCrash(c, fs, speed);
  }

  doCrash(c, fs, speed) {
    this.crashed = true;
    this.crashTimerMs = 0;
    this.emitFlow(this.score.onCrash());
    this.emitCombo('crash');
    this.game.events.emit(EVT.CRASH, {
      cause: c.cause, x: fs.x, y: fs.y, speedPxS: speed, hazardId: c.hazardId, negated: false,
    });
    const p = this.palette;
    this.fx.shards(fs.x, fs.y, fs.vx, fs.vy, [p.cyan, p.magenta, p.lime, p.amber, p.text], 46);
    this.fx.ring(fs.x, fs.y, p.danger, 64, 500);
    this.fx.sparks(fs.x, fs.y, p.text, 24, 320);
    this.sled.vanish();
    this.shake(TUNING.shakeCrash);
    this.flashRect.setFillStyle(0xffffff, 1).setAlpha(0.55);

    // persist + hand off
    const snap = this.score.getSnapshot();
    const record = {
      version: STORAGE.saveVersion,
      id: this.runId,
      seed: this.seed,
      dailyRuleId: this.dailyRuleId,
      startedAt: this.startedAt,
      endedAt: Date.now(),
      durationMs: Math.round(this.runTimeMs),
      score: Math.max(0, Math.round(snap.total)),
      distanceM: Math.floor(snap.distanceM),
      trickPoints: Math.round(snap.trickPoints),
      tricks: { ...this.trickCounts },
      bestCombo: Math.max(this.bestCombo, snap.bestCombo || 1),
      bestFlow: Math.max(1, snap.bestFlow || 1), // not hashed; SaveStore's sanitiser may drop it, GameOver reads it from here
      maxAirtimeMs: Math.round(this.maxAirtimeMs),
      cause: 'crash',
      shards: this.shardCount || 0,
      nearMisses: this.nearMissCount || 0,
      bonusPoints: Math.round(snap.bonusPoints || 0),
      ledgerHash: '',
    };
    record.ledgerHash = SaveStore.computeLedgerHash(record);
    this.registry.set(REG.LAST_RECORD, record);
    try {
      if (this.saveStore) {
        const pr = this.saveStore.saveRun(record);
        if (pr && pr.catch) pr.catch(() => {});
      }
    } catch (e) { /* saving must never break the loop */ }
    this.game.events.emit(EVT.RUN_END, { record });
  }

  updateCrashed(dt) {
    this.crashTimerMs += dt;
    this.renderFrame(dt);
    if (this.crashTimerMs >= CRASH_TO_GAMEOVER_MS && !this._leaving) {
      this._leaving = true;
      this.scene.stop(SCENES.UI);
      this.scene.start(SCENES.GAME_OVER);
    }
  }

  // ------------------------------------------------------------------ pause

  pauseRun() {
    this.game.events.emit(EVT.GAME_PAUSE, { runTimeMs: this.runTimeMs });
    this.scene.pause();
    this.scene.launch(SCENES.PAUSE, { runTimeMs: this.runTimeMs, runId: this.runId });
  }

  // ------------------------------------------------------------------ settings

  onSettingsChanged(payload) {
    if (payload && payload.settings) this.settings = payload.settings;
    if (payload && payload.key === 'palette' && this.sled) this.refreshPalette();
  }

  refreshPalette() {
    this.palette = getPalette(this.game);
    this.cameras.main.setBackgroundColor(this.palette.bg);
    this.sled.palette = this.palette;
    this.trail.setPalette(this.palette);
    this.bg.setPalette(this.palette);
    this.fx.palette = this.palette;
    if (this.airTelegraph) this.airTelegraph.setPalette(this.palette);
    this.mesh.setPalette(this.palette);
    for (const chunk of this.terrain.getActiveChunks()) {
      if (!this.mesh.chunks.has(chunk.index)) continue;
      this.mesh.addChunk(chunk); // redraws (removes + re-adds)
      const hz = this.hazards.get(chunk.index);
      if (hz) hz.forEach((h) => { h.palette = this.palette; h.color = this.palette[h.def.colorKey] != null ? this.palette[h.def.colorKey] : this.palette.danger; });
      const pu = this.powerups.get(chunk.index);
      if (pu) pu.forEach((p) => { p.palette = this.palette; p.color = this.palette[p.def.colorKey] != null ? this.palette[p.def.colorKey] : this.palette.cyan; });
    }
  }

  // ------------------------------------------------------------------ camera

  shake(amp) {
    if (this.settings && this.settings.screenShake === false) return;
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  snapCamera() {
    const cam = this.cameras.main;
    const s = this.sled;
    this._camX = s.x - GAME_WIDTH * 0.38;
    this._camY = s.y - GAME_HEIGHT / 3;
    this._zoom = 1;
    cam.setZoom(1);
    this.applyZoomCompensation(1);
    cam.scrollX = Math.round(this._camX);
    cam.scrollY = Math.round(this._camY);
  }

  /** Screen-space layers (background, flash) live at scroll factor 0; counter-scale them so camera zoom does not shrink them. */
  applyZoomCompensation(z) {
    const k = 1 / z;
    const px = (GAME_WIDTH * (z - 1)) / (2 * z);
    const py = (GAME_HEIGHT * (z - 1)) / (2 * z);
    if (this.bg && this.bg.gfx) this.bg.gfx.setScale(k).setPosition(px, py);
    if (this.flashRect) this.flashRect.setScale(k).setPosition(px, py);
  }

  updateCamera(dt) {
    const cam = this.cameras.main;
    const s = this.sled;
    // Look ahead in the direction of travel; Y keeps ~1/3 of the screen above the rider and peeks lower when falling.
    const look = clamp(s.vx * TUNING.lookAheadSec, -TUNING.lookAheadMaxPx * 0.5, TUNING.lookAheadMaxPx)
      + LOOK_FAR_EXTRA_PX * smooth01((s.vx - 600) / 400);
    const tx = s.x + look - GAME_WIDTH * 0.38;
    const ty = s.y - GAME_HEIGHT / 3 - clamp(s.vy * 0.05, -26, 34);
    const kx = 1 - Math.exp((-TUNING.cameraLerpX * dt) / 1000);
    // follow faster the quicker the sled moves vertically (bounce pads / big drops must never push it off screen)
    const ky = 1 - Math.exp((-(TUNING.cameraLerpY + clamp(Math.abs(s.vy) / 90, 0, 7)) * dt) / 1000);
    this._camX += (tx - this._camX) * kx;
    this._camY += (ty - this._camY) * ky;
    // hard guarantee: keep the rider inside the visible band
    const margin = 34;
    if (s.y - this._camY < margin) this._camY = s.y - margin;
    else if (s.y - this._camY > GAME_HEIGHT - margin) this._camY = s.y - (GAME_HEIGHT - margin);
    let ox = 0;
    let oy = 0;
    if (this.shakeAmp > 0.15) {
      // per-pixel RNG jitter, decaying
      ox = Math.round((Math.random() * 2 - 1) * this.shakeAmp);
      oy = Math.round((Math.random() * 2 - 1) * this.shakeAmp);
      this.shakeAmp *= Math.exp(-dt / 140);
    } else {
      this.shakeAmp = 0;
    }
    // ... and horizontally: the extra look-ahead must not push the rider off the left edge (the zoom below keeps the rider at
    // screen x = s.x - _camX whatever the zoom, so this is a plain screen-px bound)
    if (s.x - this._camX < RIDER_MIN_SCREEN_X) this._camX = s.x - RIDER_MIN_SCREEN_X;
    // never show far past the start edge of the world
    if (this._camX < -30) this._camX = -30;

    // speed zoom: 1.0 at rest -> zoomMin at zoomSpeedHi, smoothed, with a brief extra pull-out on boosts. Stepped to 0.005
    // so the vector terrain does not shimmer from continuous sub-pixel scale changes.
    const zNear = 1 - (1 - TUNING.zoomMin) * smooth01((s.speed - TUNING.zoomSpeedLo) / (TUNING.zoomSpeedHi - TUNING.zoomSpeedLo));
    const zt = zNear - (TUNING.zoomMin - ZOOM_FAR_MIN) * smooth01((s.speed - TUNING.zoomSpeedHi) / (ZOOM_FAR_SPEED_HI - TUNING.zoomSpeedHi));
    this._zoom += (zt - this._zoom) * (1 - Math.exp((-TUNING.zoomLerp * dt) / 1000));
    this._zoomKick = Math.max(0, this._zoomKick - dt / 260 * 0.05);
    const z = Math.round(clamp(this._zoom - this._zoomKick, 0.6, 1.2) * 200) / 200;
    if (z !== cam.zoom) {
      cam.setZoom(z);
      this.applyZoomCompensation(z);
    }
    // keep the rider at the same screen position whatever the zoom (zoom pivots on the screen centre)
    const px0 = s.x - this._camX;
    const py0 = s.y - this._camY;
    let sx = s.x - GAME_WIDTH / 2 - (px0 - GAME_WIDTH / 2) / z;
    const sy = s.y - GAME_HEIGHT / 2 - (py0 - GAME_HEIGHT / 2) / z;
    const visLeft = sx + GAME_WIDTH / 2 - GAME_WIDTH / (2 * z);
    if (visLeft < -30) sx += -30 - visLeft;
    cam.scrollX = Math.round(sx) + ox;
    cam.scrollY = Math.round(sy) + oy;
  }
}
