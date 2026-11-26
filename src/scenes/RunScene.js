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
  TERRAIN,
} from '../constants.js';
import { EVT } from '../events.js';
import { SaveStore, LEDGER_HASH_V, UPGRADE_LEDGER_HASH_V,DRAFT_LEDGER_HASH_V } from '../systems/SaveStore.js';
import { upgradeLoadoutForRun, upgradeEffects, canopyBluffRecoveryMs } from '../systems/PermanentUpgrades.js';
import {DRAFT_RULES_VERSION,DRAFT_BUDGET,validDraftRanks,draftActiveRanks} from '../systems/DailyDraft.js';
import { TerrainGenerator } from '../systems/TerrainGenerator.js';
import { detectBiomeVisits } from '../systems/BiomeDiscovery.js';
import { ScoreManager } from '../systems/ScoreManager.js';
import { TrickTracker } from '../systems/TrickTracker.js';
import { GlitchDirector } from '../systems/GlitchDirector.js';
import { DailyPatch } from '../systems/DailyPatch.js';
import { boostEffects, loadoutForRun, headStartOpening, openingSpeedMul } from '../systems/Boosts.js';
import { sameBoardAs } from '../systems/Ranking.js';
import { resolveCosmetics } from '../systems/Cosmetics.js';
import { PhysicsTuner, stepWorld, TUNING, BASE_STEP_MS, pxPerSecToStep } from '../systems/PhysicsTuner.js';
import { runRandomStreams } from '../systems/RunRandom.js';
import { SimClock } from '../systems/SimClock.js';
import { GhostRecorder, TapePlayer, quantizeTilt, TRACE_EVERY } from '../systems/ghost/GhostTape.js';
import { runRandomState } from '../systems/RunRandom.js';
import { GhostRider } from '../entities/GhostRider.js';
import { guestPracticeEligible } from '../systems/ghost/GuestPractice.js';
import { validateTakeoverDescriptor, createTakeoverRecorder, seekStep, traceOf, SEEK_MAX_TICKS_PER_FRAME, SEEK_BUDGET_MS, COVERAGE_FINGERPRINT_ONLY, REFUSALS as TAKEOVER_REFUSALS } from '../systems/replay/Takeover.js';
import { liveFingerprint } from '../systems/replay/PostcardChallenge.js';
import { BlackHole } from '../entities/BlackHole.js';
import { isReducedMotion } from '../ui/Motion.js';
import { cosmeticRandom } from '../systems/CosmeticRandom.js';
import { resolveReplaySetup } from '../systems/replay/manifest.js';
import { scheduleRunEvidence, RULESET_KEY, BUILD_ID_KEY } from '../systems/replay/evidenceCapture.js';
import { SIM_REVISION } from '../systems/replay/ruleset.js';
import { CURRENT_RULESET_ID } from '../systems/replay/currentRulesetId.js';
import { magnetStrength, pullStep, magnetSpawn, magnetHolePos, magnetsDropFor } from '../systems/ShardMagnet.js';
import { kodiaksEnabledFor, kodiakEncounter, spawnKodiakPack, stepKodiakPack, kodiakBox, kodiakHits, kodiakKnockback, KODIAK_KNOCK, KODIAK_VERSION, KODIAK_DEFS } from '../systems/Kodiaks.js';
import { KodiakRider } from '../entities/KodiakRider.js';
import { emptyWards, addWard, tickWards, isWarded, wardMsLeft, wardSpeedMul } from '../systems/Wards.js';
import {
  gustImpulse, hazardColor, blindVisibility, blindOverlayAlpha, glideFrictionMul, stabilizeToleranceDeg, stabilizeBounceMul,
  resolveLanding, hazardEffectDurationMs, timedPowerupMs, addShieldSource, spendShieldSource, shieldChargesFor, springRebound,
} from '../systems/BiomeEffects.js';
import { GlitchPipeline } from '../shaders/GlitchPipeline.js';
import { getPalette, getPaletteCss } from '../ui/Palette.js';
import { HUD_SPEED_EVENT } from './UIScene.js';
import { Sled } from '../entities/Sled.js';
import { TerrainMesh } from '../entities/TerrainMesh.js';
import { Hazard } from '../entities/Hazard.js';
import { PowerUp } from '../entities/PowerUp.js';
import { TrailParticles } from '../entities/TrailParticles.js';
import { Background } from '../entities/Background.js';
import { beesAt } from '../systems/MicroBees.js';
import { BiomeFx } from '../entities/BiomeFx.js';
import { bridgeLook, bridgeProgress } from '../systems/BiomeTransition.js';
import { WorldDanceEnvelope, worldDanceMotionAllowed, readWorldDanceAudio } from '../systems/WorldDance.js';
import { SongBillboard } from '../entities/SongBillboard.js';
import { Fx } from '../entities/Fx.js';
import { ShardField } from '../entities/Shard.js';
import { BestMarker } from '../entities/BestMarker.js';
import { LastDeathMarker } from '../entities/LastDeathMarker.js';
import { crashReport, crashBeat, deathMarkerX } from '../systems/CrashReport.js';
import { layoutMarkerLabels, joinedMarkerHeight } from '../systems/MarkerLayout.js';
import { AirTelegraph } from '../entities/AirTelegraph.js';
import { GroundTelegraph } from '../entities/GroundTelegraph.js';
import { planTelegraphMarks as planTelegraph, TelegraphTracker } from '../systems/HazardTelegraph.js';
import { speedZoom, ZOOM_FLOOR } from '../systems/CameraZoom.js';
import { installTerrainContactFix } from '../systems/TerrainContact.js';
import { installPortableMatter } from '../systems/MatterPortable.js';
import { HintScheduler } from '../systems/HintScheduler.js';
import { BsodPursuit, BSOD_DEFAULTS, emptyBsodState } from '../systems/BsodPursuit.js';
import { bsodWindVisualStrength } from '../systems/BsodWindVisual.js';
import { GYM_READY_MS, gymSetupForProfile, placeGymWall, GYM_MASTERY_CHAIN, advanceGymReadyMs, gymBeatSuggestion } from '../systems/BsodGym.js';
import { BsodBluffTracker } from '../systems/BsodBluffTracker.js';
import pmath from '../systems/pmath.js';

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
/** The speed -> zoom curve (three stages, floor 0.45) lives in systems/CameraZoom.js since the readable-chaos pass. */
/** Extra look-ahead (px, on top of TUNING.lookAheadMaxPx) that ramps in between 600 and 1000 px/s; the follow lag eats the base look-ahead at speed. */
const LOOK_FAR_EXTRA_PX = 90;
/** Readable chaos: a further look-ahead between 850 and 1300 px/s. The 5.5 /s follow lags speed / 5.5 px behind (218 px at 1200), which left the rider ~130 px in. */
const LOOK_ULTRA_EXTRA_PX = 110;
/** The rider is never allowed closer than this many screen px to the left edge. */
const RIDER_MIN_SCREEN_X = 36;
const smooth01 = (t) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };
/** Production uses actual Matter bounds; fallback supports legacy scene test doubles. */
const sledLeftCollisionEdge = (sled) => Number.isFinite(sled?.body?.bounds?.min?.x) ? sled.body.bounds.min.x : sled.x - 20;

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
    // RunScene is one instance across runs and the palette above is the base one: forget the previous run's biome, or a
    // retry that ends where it began (Debutmont) would skip its opening repaint, motif and BIOME_ENTER (#65).
    this._biomeId = undefined;
    this._lookId = undefined; // #65 presentation: the look follows the same reset
    // W4 cosmetics: resolved ONCE per run, from the profile, for the same reason the biome mask is: the
    // sled, the trail and the drawn colours must not disagree with each other mid-run.
    this.look = this._resolveLook();
    // A ghost replay (issue #56) is driven entirely by its tape header: the recorded course, loadout and
    // upgrades, never the current profile (which may have levelled up and enabled new biomes since).
    this._replayTape = reg.get(REG.GHOST_REPLAY) || null;
    if (this._replayTape) reg.remove(REG.GHOST_REPLAY);
    // Fail closed: even a malformed or externally planted handoff may only
    // start an unranked practice session, NEVER an ordinary credited run.
    const candidate = reg.get(REG.GUEST_PRACTICE);
    reg.remove(REG.GUEST_PRACTICE);
    this.guestPractice = candidate !== undefined && candidate !== null;
    this.guestPracticeTape = this.guestPractice && guestPracticeEligible(candidate) ? candidate : null;
    // An untrusted guest must never be promoted into TapePlayer/input replay,
    // even if a stale earlier replay handoff was still in the registry.
    if(this.guestPractice)this._replayTape=null;
    // #72 Replay Takeover: a one-shot descriptor (REG.TAKEOVER), read and cleared like GUEST_PRACTICE. FAIL CLOSED: a
    // descriptor that does not validate against THIS build never falls through to an ordinary (ranked) run. The sim
    // prefix is re-simulated from the tape (authoritative), then control is handed over; the whole run is UNRANKED.
    const takeoverCandidate = reg.get(REG.TAKEOVER);
    reg.remove(REG.TAKEOVER);
    this.takeover = null;
    if (takeoverCandidate !== undefined && takeoverCandidate !== null) {
      const verdict = validateTakeoverDescriptor(takeoverCandidate, { rulesetId: CURRENT_RULESET_ID, guestPractice: this.guestPractice });
      if (!verdict.ok) { this._refuseTakeover(verdict); return; }
      this.takeover = { descriptor: takeoverCandidate, phase: 'seeking', targetTick: takeoverCandidate.tick, seekTicks: 0, seekMs: 0, seekFrames: 0 };
      this._replayTape = takeoverCandidate.tape; // TapePlayer drives ticks 1..N, then it is dropped at handoff
    }
    // Takeover and guest practice share one predicate for every write site (record, XP, shards, missions, ghost library,
    // evidence, tutorial flags, progression stores). Set before tick 0 and never changed mid-run.
    this.unrankedPractice = this.guestPractice || !!this.takeover;
    const replay = this._replayTape;
    // Replay Contract R-1..R-4: a replay resolves daily rule, Sync Level and Kodiak/magnet flags from the recorded
    // tape/manifest, never from the clock, the live profile or the live registry flags.
    const rp = replay ? resolveReplaySetup(replay, { rules: DailyPatch.RULES }) : null;
    this.seed = replay ? String(replay.seed) : String(reg.get(REG.SEED) != null ? reg.get(REG.SEED) : 'default');
    // Named seeded streams for this run (issue #59). Rebuilt from the seed on every create.
    this.runRandom = runRandomStreams(this.seed);
    this.simClock = new SimClock();
    // W3: resolved ONCE per run, from the registry (a daily run sets the date-derived mask). Never
    // re-read mid-run, so the terrain, the stats scope and the saved record cannot disagree.
    const maskReg = reg.get(REG.BIOME_MASK);
    this.biomeMask = replay ? (Number(replay.biomeMask) || 0) >>> 0 : Number.isFinite(maskReg) ? maskReg >>> 0 : 0;
    this.startedAt = Date.now();
    this.runId = `${this.startedAt}-${this.seed}`;
    // A manual pause is a distinct session, never a death or title transition.
    // Audio can pair and cancel turntable effects without guessing scene state.
    this._manualPauseSeq = 0;
    this._manualPausePending = false;

    // Decision 2: is this the OFFICIAL Daily? Only when the DAILY RUN item asked for it (REG.DAILY_OFFICIAL)
    // AND the seed is today's daily seed. Any other run on a `daily-YYYY-MM-DD` seed is a practice run.
    // The today check means a retry or a pause-restart after 00:00 UTC cannot back-fill yesterday.
    const seedDay = DailyPatch.dateKeyFromSeed(this.seed);
    const todayKey = DailyPatch.getDailyInfo().dateKey;
    this.dailyOfficial = !replay && !this.guestPractice && !this.unrankedPractice && reg.get(REG.DAILY_OFFICIAL) === true && seedDay !== null && seedDay === todayKey;
    // Separate ranked Daily lane. A typed seed, Gym or stale-date retry
    // can NEVER turn itself into an official competitive Draft.
    this.dailyMode=this.dailyOfficial&&reg.get(REG.DAILY_MODE)==='draft'?'draft':'classic';
    // daily rule (read ONCE per run). A run on a daily seed plays THAT date's rule (decision 2: a practice
    // run of a past date replays that date, FAIRNESS-2); every other run plays today's rule as before.
    const seedDayInfo = seedDay ? DailyPatch.infoForDateKey(seedDay) : null;
    const daily = rp ? { rule: rp.dailyRule } : seedDayInfo ? { rule: seedDayInfo.rule } : DailyPatch.getDailyInfo();
    this.dailyRuleId = (daily && daily.rule && daily.rule.id) || 'none';
    // W4 loadout: the boosts the player switched on, read from the profile. Absent profile or absent
    // boosts means a clean run, which is the default-off rule.
    // The owned set (`unlocked.boosts`, granted at Sync Level 8 / 15) gates them: a toggle switched on
    // before the boost is unlocked does nothing and does not mark the run modded (Boosts.boostEffects).
    const prof = this.registry.get(REG.PROFILE) || {};
    this.bsodGym = !replay && !this.guestPractice && !this.unrankedPractice && reg.get(REG.BSOD_GYM) === true && prof.bsodGym?.owned === true;
    this.loadout = { boosts: (prof && prof.boosts && typeof prof.boosts === 'object') ? { ...prof.boosts } : {} };
    const owned = prof && prof.unlocked && typeof prof.unlocked === 'object' ? prof.unlocked.boosts : null;
    this.unlockedBoosts = owned && typeof owned === 'object' ? { ...owned } : {};
    // Permanent upgrades are opt-in, frozen for the run, and never applied to official Dailies.
    this.upgradeRun = upgradeLoadoutForRun(prof, { daily: this.dailyOfficial });
    if(this.dailyMode==='draft'){
      // Draft completely disregards owned/upgraded ranks. The saved one-run
      // snapshot comes ONLY from the free fixed-budget editor, never BANK.
      const proposed=reg.get(REG.DAILY_DRAFT_RANKS);
      const ranks=draftActiveRanks(validDraftRanks(proposed)?proposed:{});
      this.upgradeRun={enabled:Object.keys(ranks).length>0,ranks,effects:upgradeEffects(ranks)};
    }
    if (replay) {
      // The recorded upgrade ranks and boosts, exactly; nothing from the live profile.
      const ranks = replay.upgradeRanks && typeof replay.upgradeRanks === 'object' ? { ...replay.upgradeRanks } : {};
      this.upgradeRun = { enabled: Object.keys(ranks).length > 0, ranks, effects: upgradeEffects(ranks) };
      const boosts = Array.isArray(replay.boosts) ? replay.boosts : [];
      this.loadout = { boosts: Object.fromEntries(boosts.map((id) => [id, true])) };
      this.unlockedBoosts = Object.fromEntries(boosts.map((id) => [id, true]));
    }
    this.upgradeFx = this.upgradeRun.effects;
    // Shard Magnets drop from Sync Level 5, and on every Daily (equal pickups on an official board).
    // A ghost replay restores the recorded choice so the course matches.
    this.magnetsDrop = rp ? rp.magnetsDrop
      : magnetsDropFor({ level: prof.level, daily: this.dailyOfficial === true || this.dailyMode === 'draft' });
    // Issue #47: hostile Kodiaks from the proposed Sync Level, never on Dailies or in the Gym (no event rule yet).
    this.kodiaksOn = rp ? rp.kodiaksOn
      : kodiaksEnabledFor({ level: prof.level, daily: this.dailyOfficial === true || this.dailyMode === 'draft', gym: this.bsodGym === true });
    // Packs are one type ('same') or mixed; a Settings switch while Marvin playtests which is better.
    this.kodiakPackMode = rp ? rp.kodiakPackMode
      : this.settings?.kodiakPacks === 'mixed' ? 'mixed' : 'same';
    this.kodiaks = [];
    this.kodiakNext = 0;
    this.kodiakShoveCdMs = 0; // immunity window after a bear shove (sim ms)
    // Player abilities and BSOD behavior are unchanged in the Gym. Only the
    // starting pose, pursuit gap/speed and post-catch retry are different.
    this.gymSetup = this.bsodGym ? gymSetupForProfile(prof) : null;
    // Every Gym attempt—including first entry—starts with the same short,
    // deterministic READY hold. Music may decorate it, never delay physics.
    this.gymReadyMs = this.bsodGym ? GYM_READY_MS : 0;
    this.gymBeatWaitMs = 0;
    this.gymBeatSnapshot = null;
    this.dailyMods = (daily && daily.rule && daily.rule.modifiers) || {};

    // pure systems — the exact same deterministic world factory is also used
    // when a Gym attempt restarts at its ORIGINAL launch position.
    this.terrain = this.createTerrainGenerator();
    this.heightFn = (x) => this.terrain.heightAt(x); // allocated once; reads this.terrain at call time
    this.score = new ScoreManager({ pxPerMeter: PIXELS_PER_METER });
    this.score.reset();
    this.tricks = new TrickTracker();
    this.glitch = new GlitchDirector({ seed: this.seed });
    this.tuner = new PhysicsTuner();

    // run state
    this.runTimeMs = 0;
    this.gymAttemptStartTimeMs = 0;
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
    this.shieldSources = []; // B2: which pickup each shield charge came from (BiomeEffects.spendShieldSource)
    this._resetBiomeEffects();
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
    installPortableMatter(Phaser.Physics.Matter.Matter); // #121: Matter's trig/pow/acos through pmath, before any body is built

    // visuals / entities
    this.cameras.main.setBackgroundColor(this.palette.bg);
    this.bg = new Background(this, this.palette);
    // #65 presentation: the biome glitch sets and the arcade bridge look. Render-only (BiomeFx reads the camera and the
    // run clock; nothing it does reaches terrain, physics, hazards or score).
    this._veil = 0;
    this._bridgeSpan = null;
    this._lookScratch = { veil: 0, lookId: null, t: -1 }; // bridgeLook's result, reused every frame
    this.biomeFx = new BiomeFx(this, this.palette, getPalette(this.game, null), this.bg);
    this.worldDance = new WorldDanceEnvelope();
    this.songBillboard = new SongBillboard(this);
    // Retain a live MediaQueryList so an OS reduced-motion change is seen
    // without creating a new query object every render frame.
    try { this._worldDanceMotionQuery=typeof matchMedia==='function'
      ?matchMedia('(prefers-reduced-motion: reduce)'):null; }
    catch { this._worldDanceMotionQuery=null; }
    this.mesh = new TerrainMesh(this, this.palette, this.content.terrainMods);
    // #253: BEST/DIED HERE are presentation. Their lookahead height reads must
    // never pre-generate terrain beyond the chunks already joined in Matter.
    this.markerHeightFn = (x) => joinedMarkerHeight(x, this.mesh.chunks);
    this.fx = new Fx(this, this.palette);
    this.trail = new TrailParticles(this, this.palette, this.look && this.look.trail);
    this.shardField = new ShardField(this, this.palette);
    this.airTelegraph = new AirTelegraph(this, this.palette);
    this.groundTelegraph = new GroundTelegraph(this, this.palette);
    this.teleTracker = new TelegraphTracker();
    this._teleMarks = [];
    this.streaks = this.add.graphics().setDepth(12).setBlendMode(Phaser.BlendModes.ADD);
    this.flashRect = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0xffffff, 0)
      .setOrigin(0).setScrollFactor(0).setDepth(100);
    // B0 `blind`: a dimming layer under the flash (the HUD is a separate scene above it, so it stays readable).
    // Fill alpha 1 and object alpha 0: a Rectangle draws fillAlpha x alpha, so updateBlindOverlay's alpha is the opacity.
    this.blindRect = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, this.palette.bg, 1)
      .setOrigin(0).setScrollFactor(0).setDepth(99).setAlpha(0);

    // initial terrain buffer, then the sled on the surface
    this._chunkQueue = new Map(); // a retry re-enters create() on this instance: no stale queued chunks
    // The scene instance outlives the run (scene.start re-enters create()). The biome announcement compares the sled's
    // biome with the last one it saw (`_biomeId`, reset above, before the look reads it). Before #140 the palette
    // repaint also rebuilt terrain colliders, so this affected physics by session position; since #140 it is a
    // presentation/cue reset. Keep every run like run #1.
    // Presentation state of the previous run (a stale boost hint at run start, a stale POWERUP_EXPIRED id):
    this.lastBoost = null;
    this.boostId = null;
    // Defensive: update() rewrites these every frame, so today they carry nothing over.
    this._hopped = false;
    this._pushed = false;
    this.streamTerrain(0);
    const start = this.safeStartPosition();
    // spawn a few body-lengths in so the rear runner is over solid ground (terrain begins exactly at start.x)
    const spawnX = start.x + SPAWN_RUNIN_PX;
    const spawnY = this.terrain.heightAt(spawnX);
    const spawnAng = this.slopeAt(spawnX);
    this.startX = spawnX;
    // Gym score/distance is per practice attempt; normal runs keep startX.
    this.gymAttemptStartX = spawnX;
    this.gymStartX = spawnX;
    this.sled = new Sled(this, spawnX, spawnY - 14, this.palette, this.look);
    this.sled.setPose(spawnX, spawnY - 15, spawnAng, 50 * pmath.cos(spawnAng * DEG), 50 * pmath.sin(spawnAng * DEG));
    // W4 boosts. Applied at spawn from the loadout chosen before the run: the shield reuses the Hashed
    // Backup charge counter the pickup already feeds, and Head Start scales the launch velocity through
    // the same method the speed-boost pickup uses. No physics constant is touched.
    // Decision 2: only the OFFICIAL Daily refuses boosts. A typed daily seed is a practice run, so its
    // boosts apply and make it MODDED like any other boosted run.
    const isDaily = this.dailyOfficial;
    const boostOpts = { daily: isDaily, unlocked: this.unlockedBoosts };
    this.boostFx = boostEffects(this.loadout, boostOpts);
    this.modded = this.dailyMode==='draft'||this.boostFx.modded || this.upgradeRun.enabled;
    // The ids that actually applied, written onto the record (and so into the v2 ledger hash).
    const applied = loadoutForRun(this.loadout, boostOpts).boosts;
    this.appliedBoosts = Object.keys(applied).filter((id) => applied[id]).sort();
    // Decision 4: Head Start's opening surge (a speedBoost multiplier that fades to 1; see physicsContext).
    this.opening = headStartOpening(this.loadout, boostOpts);
    if (this.boostFx.shieldCharges > 0) {
      this.shieldCharges = (this.shieldCharges || 0) + this.boostFx.shieldCharges;
      this.sled.shield = true;
    }
    if (this.boostFx.speedFactor !== 1) this.sled.scaleVelocity(this.boostFx.speedFactor);
    // An actual Gym attempt starts at a prepared launch pose. After that,
    // NORMAL sled physics, boosts, aero, progression and pursuer acceleration
    // are authoritative. Never override an upgrade or rank-12 refill rule.
    if (this.bsodGym) {
      const setup = this.gymSetup;
      this.sled.setPose(spawnX, spawnY - setup.launchHeightPx, 0,
        setup.launchSpeedPxS, setup.launchRisePxS);
    }
    // Authoritative physical chase: gap is measured from the wall's leading
    // edge to the compound sled body left bound, not center x.
    this.sled.canopyFuelFullMs = PHYSICS.parachuteDurationMs * this.upgradeFx.canopyFuelMul;
    this.sled.parachuteFuelMs = this.sled.canopyFuelFullMs;
    this.bsod = new BsodPursuit({
      sledLeftEdgeX: sledLeftCollisionEdge(this.sled),
      level: rp ? rp.syncLevel : prof.level,
      config: { ...BSOD_DEFAULTS,
        accelerationPxS2: BSOD_DEFAULTS.accelerationPxS2 * this.upgradeFx.bsodAccelerationMul },
    });
    if (this.bsodGym) placeGymWall(this.bsod, sledLeftCollisionEdge(this.sled), this.gymSetup);
    this.bsodState = this.bsod.state(sledLeftCollisionEdge(this.sled), this.sled.vx, 1);
    this.bsodCaught = false;
    this.bsodBluffs = new BsodBluffTracker();
    this.bsodEdge = this.add.graphics().setDepth(16);
    this.windPom = this.add.graphics().setDepth(22);
    this.startGate = this.add.graphics().setDepth(6);
    this.drawStartGate(this.startGate, start.x + 14, this.terrain.heightAt(start.x + 14));
    this.snapCamera();
    // best-distance gate (device best from the save store's in-memory run list; skipped when there is none).
    // Only runs on the board THIS run lands on count (Ranking.sameBoardAs): a clean run must not chase, or
    // be told it fell short of, a Head Start run's distance. boostFx carries this run's `modded`.
    this.bestM = 0;
    try {
      const runs = !this.bsodGym && this.saveStore && this.saveStore.runs;
      const boardIdentity = {...this.boostFx,dailyMode:this.dailyMode,seed:this.seed};
      boardIdentity.modded = this.modded; // input snapshot, NOT a ranking decision
      const onBoard = sameBoardAs(boardIdentity);
      if (Array.isArray(runs)) for (const r of runs) if (r && onBoard(r) && r.distanceM > this.bestM) this.bestM = Math.floor(r.distanceM);
    } catch (e) { this.bestM = 0; }
    this.bestMarker = this.bestM >= 20
      ? new BestMarker(this, this.palette, this.startX + this.bestM * PIXELS_PER_METER, this.bestM) : null;
    // Readable Chaos phase 3: DIED HERE at the last crash x, only on a same-seed, same-mask retry
    const lastCrash = this.registry.get(REG.LAST_CRASH);
    const deathX = deathMarkerX(lastCrash, this.seed, this.biomeMask);
    this.deathMarker = deathX != null ? new LastDeathMarker(this, this.palette, deathX, lastCrash.distM) : null;
    this._lastHopMs = null;

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
      this._manualPausePending = false;
      if (this.inputRouter && this.inputRouter.setEnabled) this.inputRouter.setEnabled(true);
      // consume the stale one-shot edge (the Esc that resumed) so it cannot re-pause immediately
      try { if (this.inputRouter) this.inputRouter.poll(); } catch (e) { /* ignore */ }
      // A beat prediction predating a user-controlled pause is no longer a
      // reliable launch deadline. Release once on resume, without querying
      // music again or extending the hold. The original 1000ms READY, if
      // incomplete, remains paused and resumes normally.
      if (this.bsodGym && this.gymBeatSnapshot) {
        // A paused suggestion cannot count as a synchronized beat even if
        // the music happens to be near its original due time on resume.
        this.gymBeatSnapshot = null;
        this.finishGymReady();
      }
    };
    // Audio is presentation: a failing engine must never break run start or the emitter (issue #140).
    this._onMusicTrackChange = (payload) => {
      try { this.songBillboard?.showTrack(payload, this.registry.get(REG.AUDIO)); } catch { /* no billboard */ }
    };
    this.game.events.on(EVT.MUSIC_TRACK_CHANGED,this._onMusicTrackChange);
    this.game.events.on(EVT.SETTINGS_CHANGED, this._onSettings);
    this.game.events.on(EVT.GAME_RESUME, this._onResume);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);

    // post-FX + HUD + go
    GlitchPipeline.install(this);
    this.scene.stop(SCENES.UI);
    this.scene.launch(SCENES.UI);
    // A track may already be playing from the Title jukebox. Introduce it
    // once when entering the first run, never once per scene retry.
    try {
      const playing=this.registry.get(REG.AUDIO)?.jukeboxSnapshot?.();
      if(playing?.state==='playing'&&playing.current)
        this.songBillboard?.showTrack(playing.current,this.registry.get(REG.AUDIO));
    } catch { /* a throwing audio engine must not stop the run from starting (issue #140) */ }
    this._initGhosts();
    this.game.events.emit(EVT.RUN_START, {
      runId: this.runId, seed: this.seed, dailyRuleId: this.dailyRuleId, startedAt: this.startedAt,
      dailyOfficial: this.dailyOfficial, // additive (decision 2): lets the HUD tell the Daily from practice
      dailyMode:this.dailyMode,
      gym: this.bsodGym === true, // Gym READY remains an independent mode
      practice: this.unrankedPractice === true, // explicitly unranked: suppress mission/award toasts
      ...(this.takeover ? { takeover: true } : {}), // #72: UNRANKED PRACTICE / TAS
    });
  }

  /**
   * Ghosts (issue #56). Normal and Daily runs record a tape from the first tick; Gym practice
   * never does. Ghosts for this exact course load asynchronously and join at the current tick.
   */
  _initGhosts() {
    this.ghostRiders = [];
    const token = this._ghostToken = (this._ghostToken || 0) + 1;
    const replay = this._replayTape;
    this.tapePlayer = replay ? new TapePlayer(replay) : null;
    // Ghosts are cosmetic: a recorder that cannot start must never stop the run from starting.
    try { this.ghostRecorder = this.bsodGym || replay || this.guestPractice ? null : new GhostRecorder(this._ghostHeader()); }
    catch (e) { this.ghostRecorder = null; }
    if(this.guestPractice){
      // Just ONE visual-only guest, never a Matter body or an input driver;
      // no asynchronous local library fetch and no persistence.
      if(this.guestPracticeTape){
        try {this.ghostRiders=[new GhostRider(this,{tape:this.guestPracticeTape,roles:['guest']},this.palette)];}
        catch{this.ghostRiders=[];}
      }
      return;
    }
    const lib = this.registry.get(REG.GHOSTS);
    if (!lib || this.bsodGym || replay) return;
    const st = this.settings || {};
    const show = { best: st.ghostBest !== false, latest: st.ghostLatest !== false, fav0: true, fav1: true, fav2: true };
    // A missing/older simRevision is never a current-terrain display ghost.
    // The source revision is available synchronously even if the validated
    // runtime ruleset's asynchronous loader has not completed at run start.
    const loadedRevision = this.registry.get(RULESET_KEY)?.doc?.simRevision;
    const simRevision = loadedRevision === SIM_REVISION ? loadedRevision : SIM_REVISION;
    lib.ghostsFor(this.seed, this.biomeMask, show, { simRevision }).then((list) => {
      if (token !== this._ghostToken || !this.sys?.isActive?.()) return;
      this.ghostRiders = list.map((g) => new GhostRider(this, g, this.palette));
    }).catch(() => { /* ghosts are cosmetic */ });
  }

  /** Everything a replay needs that the seed alone does not reconstruct. */
  _ghostHeader() {
    const b = this.sled.body;
    return {
      seed: this.seed, biomeMask: this.biomeMask || 0,
      // Use the registered, verified ruleset when present. A run can begin
      // before the nonblocking ruleset-loader finishes; the same build's
      // compile-time SIM_REVISION is the safe fallback, not legacy physicsVersion.
      simRevision: this.registry.get(RULESET_KEY)?.doc?.simRevision === SIM_REVISION
        ? this.registry.get(RULESET_KEY).doc.simRevision : SIM_REVISION,
      // #72: the exact ruleset id of THIS build (compile-time, synchronous; never null in a real build) and, once the
      // ruleset has loaded, its build id. A takeover refuses tapes without a matching rulesetId. Header only: neither
      // field is a causal input, a checkpoint, a fingerprint channel or part of the RunRecord / ledger hash.
      rulesetId: CURRENT_RULESET_ID,
      buildId: typeof this.registry.get(BUILD_ID_KEY) === 'string' ? this.registry.get(BUILD_ID_KEY) : null,
      mode: this.bsodGym ? 'gym' : this.dailyMode === 'draft' ? 'daily-draft' : this.dailyOfficial ? 'daily' : 'normal',
      dailyRuleId: this.dailyRuleId || null,
      dailyRuleSource: DailyPatch.dateKeyFromSeed(this.seed) ? 'seed-date' : 'clock-at-start',
      syncLevel: Number.isFinite(this.registry.get(REG.PROFILE)?.level) ? Math.max(1, this.registry.get(REG.PROFILE).level) : 1,
      bsod: { leftEdgeX: sledLeftCollisionEdge(this.sled),
        initial: { wallX: this.bsod.wallX, wallSpeedPxS: this.bsod.wallSpeedPxS, accelerationPxS2: this.bsod.accelerationPxS2 } },
      controlLayout: this.settings?.controlLayout || 'tricksRight',
      boosts: [...(this.appliedBoosts || [])],
      upgradeRanks: this.upgradeRun?.enabled ? { ...this.upgradeRun.ranks } : null,
      magnetsDrop: this.magnetsDrop === true,
      kodiaksOn: this.kodiaksOn === true,
      kodiakPackMode: this.kodiakPackMode,
      kodiakVersion: KODIAK_VERSION,
      startPose: [b.position.x, b.position.y, b.angle, b.velocity.x, b.velocity.y, b.angularVelocity],
      random: runRandomState(this.runRandom),
      startedAt: this.startedAt,
    };
  }

  _saveGhostTape(record) {
    if (this.unrankedPractice) { this.ghostRecorder = null; return; } // #72: never a library tape or an evidence capture
    const rec = this.ghostRecorder;
    this.ghostRecorder = null;
    if (!rec) return;
    try {
      const tape = rec.finish({ runId: record.id, distanceM: record.distanceM, score: record.score, endedAt: record.endedAt });
      this.registry.set(REG.LAST_GHOST_TAPE, tape);
      const pr = this.registry.get(REG.GHOSTS)?.saveRun(tape);
      if (pr && pr.catch) pr.catch(() => {});
      // Replay evidence (#116): runs in a later task (never on this frame), never throws; failures are logged and left on the registry.
      scheduleRunEvidence(tape, rec, { registry: this.registry, ruleset: this.registry.get(RULESET_KEY) });
    } catch (e) { /* a ghost must never break the end of a run */ }
  }

  /**
   * Issue #47: one Kodiak PACK at a time, on the seeded schedule (Kodiaks.kodiakEncounter). Runs inside the
   * fixed tick; collision is a tick-exact box test per bear (no Matter body). Contact is never a crash: the bear
   * shoves the sled back and up (Kodiaks.kodiakKnockback), once per bear, with a shared immunity window so a pack
   * cannot chain shoves. A shoved bear earns no pass bonus; a clean pass scores.
   */
  updateKodiaks(dt) {
    if (!this.kodiaksOn || this.crashed || !this.sled) return;
    const sled = this.sled;
    if (this.kodiakShoveCdMs > 0) this.kodiakShoveCdMs = Math.max(0, this.kodiakShoveCdMs - dt);
    if (!this.kodiaks.length) {
      const enc = kodiakEncounter(this.seed, this.kodiakNext, this.kodiakPackMode);
      if ((sled.x - this.startX) / PIXELS_PER_METER < enc.atM) return;
      this.kodiakNext++;
      this.kodiaks = spawnKodiakPack(this.seed, enc, { x: sled.x, vx: sled.vx });
      const sides = [...new Set(enc.members.map((m) => KODIAK_DEFS[m].from))];
      this.emitIf(EVT.KODIAK, { type: 'incoming', mode: enc.mode, members: enc.members.map((m) => KODIAK_DEFS[m].short),
        from: sides.length > 1 ? 'both' : sides[0] });
    }
    const landX = !sled.grounded && Number.isFinite(sled.airEtaMs) ? sled.x + sled.vx * sled.airEtaMs / 1000 : null;
    const steps = stepKodiakPack(this.kodiaks, { x: sled.x, vx: sled.vx, grounded: sled.grounded, landX, etaMs: sled.airEtaMs }, dt);
    const sledBox = { x: sled.x - 18, y: sled.y - 20, w: 36, h: 30 };
    for (const { k, ev } of steps) {
      const gy = this.terrain.heightAt(k.x);
      if (Number.isFinite(gy)) k.groundY = gy; else if (!Number.isFinite(k.groundY)) k.groundY = sled.y;
      if (ev.telegraph) {
        this.playSfx('groundWarn', { brace: ev.telegraph === 'real' });
        this.emitIf(EVT.KODIAK, { type: 'telegraph', id: k.def.id, short: k.def.short, real: ev.telegraph === 'real' });
      }
      if (!k.hit && this.kodiakShoveCdMs <= 0 && !(sled.invulnerableMs > 0) && kodiakHits(kodiakBox(k.x, k.groundY), sledBox)) {
        k.hit = true;
        const shove = kodiakKnockback(k, sled);
        this._addSledVelocity(shove.dvx, shove.dvy);
        this.kodiakShoveCdMs = KODIAK_KNOCK.immunityMs;
        this.fx.sparks(k.x, k.groundY - 14, k.def.accent, 16, 220);
        this.shake(3);
        this.playSfx('push');
        this.emitIf(EVT.KODIAK, { type: 'shove', id: k.def.id, short: k.def.short, n: k.n, member: k.member, dvx: shove.dvx, dvy: shove.dvy });
      }
      // Passing a bear (it was ahead and now is behind) scores; clearing it in the air scores more.
      const ahead = sled.x > k.x;
      if (ahead && !k.sledAhead && !k.hit) {
        const air = !sled.grounded, points = air ? 250 : 150;
        this.bonus(points, 'kodiak');
        this.emitIf(EVT.KODIAK, { type: 'passed', id: k.def.id, short: k.def.short, air, points });
      }
      k.sledAhead = ahead;
    }
    if (this.kodiaks.every((k) => k.done)) {
      this.emitIf(EVT.KODIAK, { type: 'gone' });
      this.kodiaks = [];
    }
  }

  /** Remove every listener / pooled object / body (runs on scene shutdown). @returns {void} */
  teardown() {
    this.gymBeatSnapshot = null;
    this.gymBeatWaitMs = 0;
    try {
      this.game.events.off(EVT.MUSIC_TRACK_CHANGED,this._onMusicTrackChange);
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
    safe(this.biomeFx);
    this.biomeFx = null;
    safe(this.songBillboard);
    this.songBillboard=null;
    safe(this.blackHole);
    this.blackHole = null;
    safe(this.kodiakRider);
    this.kodiakRider = null;
    this.kodiaks = [];
    (this.ghostRiders || []).forEach(safe);
    this.ghostRiders = [];
    this._ghostToken = (this._ghostToken || 0) + 1;
    this.worldDance?.reset();
    this.worldDance = null;
    this._worldDanceMotionQuery=null;
    safe(this.shardField);
    safe(this.bestMarker);
    safe(this.deathMarker);
    this.deathMarker = null;
    safe(this.airTelegraph);
    safe(this.groundTelegraph);
    this.groundTelegraph = null;
    safe(this.streaks);
    safe(this.bsodEdge);
    safe(this.windPom);
    this.deactivateBsod();
    this.bsod = null;
    this.bsodEdge = this.windPom = null;
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

  /** Active Space Mountain has no atmosphere, even though the BSOD still chases. */
  bsodAtmosphere() {
    if (!this.terrain || !this.sled || !this.biomeMask) return 1;
    const biome = this._biomeDefAt(this.sled.x);
    return biome && biome.id === 'space-mountain' ? 0 : 1;
  }

  /** Authoritative BSOD event must not let a faulty *observer* abort collision
   * resolution. The actual audio subscriber additionally handles its own errors,
   * so a failing mixer cannot suppress unrelated listeners. */
  publishBsodState(state) {
    try { this.game?.events?.emit?.(EVT.BSOD_STATE_CHANGED, state); }
    catch (e) {
      if (!this._bsodObserverErrorLogged) {
        this._bsodObserverErrorLogged = true;
        console.warn('BSOD observer failed; gameplay continues', e);
      }
    }
  }

  /** Reset wind/music subscriptions on end, abort or teardown; never mutate the music mixer. */
  deactivateBsod() {
    if (this.bsodBluffs) this.bsodBluffs.reset();
    if (!this.bsod || !this.bsod.active) return;
    this.bsodState = this.bsod.stop();
    this.publishBsodState(emptyBsodState());
  }

  /** World-coordinate visual cues. They do not affect physics, danger, input or accessibility settings. */
  drawBsodCues() {
    const s = this.sled, view = this._view, state = this.bsodState;
    const wall = this.bsodEdge, pom = this.windPom;
    if (!s || !view) return;
    if (wall && wall.clear) {
      wall.clear();
      if (this.bsod && (this.bsod.active || this.bsodCaught) && this.bsod.wallX > view.left) {
        const edge = Math.min(view.right, this.bsod.wallX);
        const width = Math.max(0, edge - (view.left - 12));
        const y = view.top - 15, height = view.bottom - view.top + 30;
        wall.fillStyle(this.palette.magenta, 0.23);
        wall.fillRect(view.left - 12, y, width, height);
        wall.lineStyle(3, this.palette.magenta, 0.95);
        wall.lineBetween(this.bsod.wallX, y, this.bsod.wallX, y + height);
      }
    }
    if (pom && pom.clear) {
      pom.clear();
      // Sled._draw supplies an exact helmet/drone anchor in rendered world coords.
      // Never leave a free-floating pom after the rider vanishes on BSOD impact.
      if (s.hidden || s.inWorld === false || !s.windPomAnchor) return;
      const wind = state && state.active ? state.relativeAirX : 0;
      const strength = bsodWindVisualStrength(state);
      const dir = wind > 0 ? 1 : wind < 0 ? -1 : 0;
      const { x: anchorX, y: anchorY } = s.windPomAnchor;
      // The visual THREAT cue has a gentle, continuous buildup instead of
      // saturating from raw relative airspeed while the BSOD is still far.
      // At zero wind the pom dangles; at close range it stretches and rises.
      // Signed wind direction remains authoritative; all physics is unchanged.
      const endX = anchorX + dir * (5 + 23 * strength);
      const endY = anchorY + 5 - 12 * strength;
      pom.lineStyle(1.6, this.palette.text, 0.50 + 0.44 * strength);
      pom.lineBetween(anchorX, anchorY, endX, endY);
      pom.fillStyle(this.palette.amber, 0.62 + 0.35 * strength);
      pom.fillCircle(endX, endY, 2.6 + 0.4 * strength);
    }
  }

  /** A real close approach followed by a parachute escape; zero score for proximity alone. */
  updateBsodBluff(airBrakeKicked = false, physicalTouchdowns = [], kickSample = null) {
    if (!this.bsodBluffs || !this.sled || !this.bsodState) return;
    // The scorer otherwise sees only the LAST substep of an 8ms frame.
    // A real Matter touchdown followed by a buffered Hop in that frame
    // separates TWO flights: the earlier one loses its canopy/AirBrake
    // credit before the new one can arm. Grounded update does not award.
    for (const contact of physicalTouchdowns) {
      const d=contact.bsodState || this.bsodState;
      this.bsodBluffs.update({
        active: !!d.active, gapPx:d.gapPx,
        playerX:contact.fs.x,nowMs:contact.fs.timeMs,
        grounded:true,crashed:!!this.bsodCaught,
      });
    }
    const s = this.sled, danger = this.bsodState;
    // Resolve the approach at the actual pre-controls kick position. An
    // encounter that arms only at the end of this tick cannot claim this kick.
    // Observe any already-completed escape BEFORE recording the new kick.
    if (kickSample && airBrakeKicked && !this.bsodCaught && !this.crashed) {
      const early = this.bsodBluffs.update({ ...kickSample, airbrakeKicked: false });
      if (early) this.awardBsodBluff(early);
      this.bsodBluffs.recordPaidAirBrake();
    }
    const event = this.bsodBluffs.update({
      active: danger.active, gapPx: danger.gapPx, playerX: s.x, nowMs: this.runTimeMs,
      grounded: !!s.grounded, crashed: !!this.crashed || !!this.bsodCaught,
      canopyDeployed: (s.parachuteMs || 0) > 0,
      airbrakeKicked: !!airBrakeKicked && !kickSample, // sampled callers only; real controls supply kickSample
      relativeAirX: danger.relativeAirX,
      atmosphereDensity: danger.atmosphereDensity,
    });
    if (event) this.awardBsodBluff(event);
  }

  awardBsodBluff(event) {
    const s = this.sled;
    // Existing near-miss accounting feeds scoring, missions, achievements and run records.
    this.nearMissCount = (this.nearMissCount || 0) + 1;
    this.bonus(event.points, 'nearMiss');
    // Milestone perk: ONLY an actual, verified midair Bluff refills part of
    // an upgraded canopy. This is off in clean and official Daily runs.
    const rank = this.upgradeRun?.enabled ? this.upgradeRun.ranks?.canopy : 0;
    const full = s.canopyFuelFullMs || PHYSICS.parachuteDurationMs;
    const spent = Number.isFinite(s.parachuteFuelMs) ? s.parachuteFuelMs : full;
    const recovery = canopyBluffRecoveryMs(rank, event.chain, full);
    const newFuel = Math.min(full, spent + recovery);
    const canopyRecoveredMs = Math.max(0, newFuel - spent);
    if (canopyRecoveredMs > 0) s.parachuteFuelMs = newFuel;
    // Only the FIRST actually survived escape reveals a secret shop item.
    // No hints, previews, or tutorial actions exist before that event.
    const store = this.registry?.get?.(REG.PROGRESSION)?.store;
    // Stamp the actual live achievement BEFORE the store marks the Gym as
    // discovered. Otherwise legacy-migration logic would infer a historical
    // unlock at timestamp zero and swallow the real first-time reveal toast.
    const achieved = !this.bsodGym && !this.unrankedPractice ? store?.recordBsodBluff?.(event.chain,Date.now()) : null;
    const discovered = !this.bsodGym && !this.unrankedPractice && store?.discoverBsodGym?.();
    if (discovered?.discovered || achieved?.added?.length)
      this.registry?.set?.(REG.PROFILE, store.profile);
    // The nested Easter egg is earned ONLY by five genuine scored escapes
    // WITHOUT LANDING in the GYM. Normal-world chains never advance it.
    if (this.bsodGym && event.chain >= GYM_MASTERY_CHAIN) {
      const mastery = store?.unlockGymSetup?.();
      if (mastery?.unlocked) {
        this.registry?.set?.(REG.PROFILE, mastery.profile);
        this.game.events.emit(EVT.GYM_SETUP_UNLOCKED, {});
      }
    }
    const payload = {
      hazardType: 'bsod', points: event.points, x: s.x, y: s.y,
      ...(discovered?.discovered ? { gymDiscovered: true } : {}),
      ...(achieved?.added?.length ? { achievementsEarned: achieved.added.map(x=>x.id) } : {}),
      chain: event.chain, surfing: event.surfing, closestGapPx: event.closestGapPx,
      ...(canopyRecoveredMs > 0 ? { canopyRecoveredMs } : {}),
    };
    this.game.events.emit(EVT.NEAR_MISS, payload);
    this.game.events.emit(EVT.BSOD_BLUFF, payload);
  }

  /** Stable world factory: practice retries regenerate the same launch track,
   * rather than teleporting the rider into terrain streamed far down-course. */
  createTerrainGenerator() {
    return new TerrainGenerator({
      seed: this.seed,
      chunkDefs: this.content.chunks,
      hazardDefs: this.content.hazards,
      powerupDefs: this.content.powerups,
      modDefs: this.content.terrainMods,
      biomeDefs: Object.values(this.content.biomes || {}),
      biomeMask: this.biomeMask,
    });
  }

  /** Restore the entire Gym course between attempts: physical terrain bodies,
   * hit hazards, picked-up items, and collected shards. We only call this
   * AFTER Matter stepping has completed, never from collision callbacks.
   * The same seed/mask and generation rules are reused; physics unchanged. */
  resetGymWorld() {
    if (!this.mesh?.chunks || !this.terrain?.getActiveChunks || !this.content) return;
    for (const index of [...this.mesh.chunks.keys()]) this.dropChunk(index);
    this.terrain = this.createTerrainGenerator();
    this.collectedPowerups?.clear?.();
    this.shardField?.collected?.clear?.();
    this.shardField?.byChunk?.clear?.();
    this.activeZones?.clear?.();
    this._despawn?.splice?.(0);
    this.glitch = new GlitchDirector({seed:this.seed});
    this._chunkQueue = new Map();
    this.streamTerrain(0);
  }

  // ------------------------------------------------------------------ terrain streaming

  /** Ask the generator to stream around x and mirror its adds/removals into mesh, hazards and power-ups. */
  /**
   * The biome definition at world x, or null for an arcade bridge / no content. Asks the generator, so the
   * palette, the BIOME_ENTER announcement and the terrain itself (arcade bridges included) cannot disagree.
   * Pure w.r.t. game state.
   * @param {number} x world px
   * @returns {Object|null}
   */
  _biomeDefAt(x) {
    return this._biomeDefById(this.terrain.biomeAtX(x));
  }

  _biomeDefById(id) {
    return id ? (this.content.biomes || {})[id] || null : null;
  }

  /**
   * #65 presentation: the biome whose look (palette, motif, glitch set) the world wears. Equals the generator's biome
   * except across an arcade bridge, where the outgoing look holds through the dissolve and the incoming look is on
   * before the bridge ends (BiomeTransition.bridgeLook). Reduced motion is the hard cut: the generator's answer.
   * @returns {string|null|undefined}
   */
  _lookBiomeId() {
    return this._lookId !== undefined ? this._lookId : this._biomeId;
  }

  /**
   * Recompute the look and the dissolve veil from the sled's x and repaint when the look changes. Presentation only:
   * the generator's own biome (BIOME_ENTER, discovery, music) is untouched. A bridge's span is cached while the sled
   * is inside it, so the generator is asked once per bridge, not once per frame.
   * @param {string|null} biomeNow terrain.biomeAtX(sled.x)
   * @param {boolean} paletteOwed the generator's biome changed and a repaint was owed (entering a biome, or leaving one)
   */
  _updateLook(biomeNow, paletteOwed) {
    const x = this.sled.x;
    let span = null;
    if (biomeNow === null && this.terrain.bridgeSpanAt && this.terrain.biomeDefs && this.terrain.biomeDefs.length) {
      span = this._bridgeSpan;
      if (!span || x < span.startX || x >= span.endX) span = this._bridgeSpan = this.terrain.bridgeSpanAt(x);
    } else this._bridgeSpan = null;
    const look = bridgeLook(span, x, biomeNow, !isReducedMotion(this), this._lookScratch || (this._lookScratch = { veil: 0, lookId: null, t: -1 }));
    this._veil = look.veil;
    const lookChanged = look.lookId !== this._lookId;
    const firstLook = this._lookId === undefined;
    this._lookId = look.lookId;
    if (paletteOwed || (lookChanged && (this._biomeDefById(look.lookId) || !firstLook))) this.refreshPalette();
  }

  streamTerrain(x) {
    const res = this.terrain.update(x) || {};
    if (!this._chunkQueue) this._chunkQueue = new Map();
    for (const idx of res.removed || []) { this._chunkQueue.delete(idx); this.dropChunk(idx); }
    for (const chunk of res.added || []) this._chunkQueue.set(chunk.index, chunk);
    // Defensive reconcile (first call, or a generator that only reports through getActiveChunks()).
    if (this.mesh.chunks.size === 0 && this.terrain.getActiveChunks) {
      for (const chunk of this.terrain.getActiveChunks()) if (!this.mesh.chunks.has(chunk.index)) this._chunkQueue.set(chunk.index, chunk);
    }
    // Issue #59: a chunk's colliders, hazards, pickups and shards join the world on the first tick the sled is
    // within the generator's own fill-ahead bound of it, never earlier. Cosmetic terrain reads (minimap, billboard,
    // camera) can make the generator build chunks ahead of time on any display frame; gating here keeps the tick a
    // chunk becomes physical a function of the sled's position alone, so replays and 30/60/120 Hz runs stay exact.
    const bound = x + TERRAIN.bufferAheadScreens * (this.terrain.screenW || GAME_WIDTH);
    for (const idx of [...this._chunkQueue.keys()].sort((a, b) => a - b)) {
      const chunk = this._chunkQueue.get(idx);
      if (chunk.startX >= bound) break;
      this._chunkQueue.delete(idx);
      this.takeChunk(chunk);
    }
  }

  takeChunk(chunk) {
    if (!chunk || this.mesh.chunks.has(chunk.index)) return;
    this.mesh.addChunk(chunk);
    const hz = [];
    const spawns = chunk.hazards || [];
    for (let hazardOrdinal = 0; hazardOrdinal < spawns.length; hazardOrdinal++) {
      const spawn = spawns[hazardOrdinal];
      const def = this.content.hazards[spawn.defId];
      if (!def) continue;
      const h = new Hazard(this, def, spawn, this.palette);
      h.hid = `${chunk.index}:${hazardOrdinal}`; // stable id (chunk + spawn ordinal): keys TelegraphTracker, serializable
      h.simStepped = true; // its motion (rolls, gates) moves the sensor body: advanced in simTick, not per frame
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
    // Shard Magnet: one optional extra pickup per chunk, from its own seeded stream (never in the chunk data).
    // Drops from Sync Level 5 (always on Dailies); MYRIAD MAGNETS raises the chance.
    const magnetDef = this.content.powerups.shardMagnet;
    if (magnetDef && this.magnetsDrop && !this.collectedPowerups.has(`${chunk.index}:magnet`)) {
      let spawn = null;
      try { spawn = magnetSpawn(this.seed, chunk, magnetDef, (x) => this.terrain.heightAt(x), PIXELS_PER_METER, this.upgradeFx?.magnetSpawnMul); } catch (e) { /* a pickup never breaks streaming */ }
      if (spawn) {
        const p = new PowerUp(this, magnetDef, spawn, this.palette);
        p.key = `${chunk.index}:magnet`;
        pu.push(p);
      }
    }
    if (pu.length) this.powerups.set(chunk.index, pu);
    if (this.shardField) this.shardField.addChunk(chunk);
  }

  dropChunk(idx) {
    this.mesh.removeChunk(idx);
    if (this.shardField) this.shardField.removeChunk(idx);
    const hz = this.hazards.get(idx);
    if (hz) hz.forEach((h) => h.destroy());
    this.hazards.delete(idx);
    if (this.teleTracker) this.teleTracker.forgetChunk(idx);
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
    if (this._seeking) return; // #72: a seek re-simulates seconds of play in a few frames; it must be silent
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
    if (h.isPassable && h.isPassable(this.runTimeMs)) return; // B3: an open Gear Gate is passed (stays armed)
    h.hit = true;
    const def = h.def;
    const eff = def.onHit || { effect: 'crash' };
    const kind = eff.effect;
    // B0 ward: a warded hazard (by id) or effect does nothing at all and reports no hit (Wards.js)
    if (isWarded(this.wards, { hazardId: def.id }) || isWarded(this.wards, { effect: kind })) {
      this.fx.ring(h.cx, h.cy, this.palette.cyan, 22, 260);
      if (h.gfx) h.gfx.setAlpha(0.4);
      return;
    }
    const dur = hazardEffectDurationMs(eff);
    this.game.events.emit(EVT.HAZARD_HIT, { hazardId: def.id, effect: kind, durationMs: dur, x: h.cx, y: h.cy });
    if (kind === 'crash') {
      if (!this.pendingCrash) {
        this.pendingCrash = { cause: 'hazard', hazardId: def.id };
        this._crashHazard = h; // crash report: the entity, for its telegraph arrival (pendingCrash keeps its shape)
      }
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
    } else if (kind === 'blind') {
      // B0: a flash, then a dimming overlay (BiomeEffects.blindOverlayAlpha; never below 35 % visibility, no crash)
      this.blindMs = dur;
      this.blindTotalMs = dur;
      this.blindVis = blindVisibility(eff.visibility);
      this.flashRect.setFillStyle(0xffffff, 1).setAlpha(0.45);
      this.fx.sparks(h.cx, h.cy, h.color, 12, 160, 60);
    } else if (kind === 'gust') {
      // B0: one bounded velocity kick (BiomeEffects.gustImpulse, <= 180 px/s)
      const g = gustImpulse(eff.impulsePxS);
      this._addSledVelocity(g.dvx, g.dvy);
      this.fx.sparks(h.cx, h.cy, h.color, 10, 220, 40);
      this.shake(1);
    }
    if (h.gfx) h.gfx.setAlpha(0.4);
  }

  /** Add a velocity (px/s) to the sled body (B0 gust). Sled caches px/s from the body; keep the cache in step. */
  _addSledVelocity(dvx, dvy) {
    const s = this.sled;
    if (!s || !s.inWorld || !s.body || (!dvx && !dvy)) return;
    const Body = Phaser.Physics.Matter.Matter.Body;
    const v = Body.getVelocity(s.body);
    Body.setVelocity(s.body, { x: v.x + pxPerSecToStep(dvx, BASE_STEP_MS), y: v.y + pxPerSecToStep(dvy, BASE_STEP_MS) });
    s.vx += dvx;
    s.vy += dvy;
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
      this.boostId = def.id; // B1: Maple Wax expires under its own id, not packetBurst's
      this.sled.scaleVelocity(this.boostFactor);
    } else if (eff.kind === 'shield') {
      this.shieldCharges += eff.charges || 1;
      // B2: a biome shield (Heat Shield) shares the pool but keeps its own HUD chip and charge count
      this.shieldSources = addShieldSource(this.shieldSources, def.id, eff.charges || 1);
      charges = shieldChargesFor(this.shieldSources, def.id, this.shieldCharges);
      this.sled.shield = true;
    } else if (eff.kind === 'ward') {
      // B0: switches off its listed mods / hazards / effects for 4-6 s (Wards.js; PhysicsTuner and onHazard consult it)
      this.wards = addWard(this.wards, def.id, eff);
      durationMs = wardMsLeft(this.wards, def.id);
      // B1: a ward's optional speed boost (Slick Wax Spray 1.1): an instant kick now, and wardSpeedMul in the tuner context
      // while the ward lasts. Kept apart from boostMs so a Packet Burst / Maple Wax never overwrites it (or vice versa).
      const wf = this.wards.wards.find((w) => w.id === def.id).speedFactor;
      if (wf > 1) this.sled.scaleVelocity(wf);
    } else if (eff.kind === 'glide') {
      // B0: lower ground friction (PhysicsTuner glideFrictionMul)
      durationMs = timedPowerupMs(eff);
      if (this.glideMs > 0 && this.glideId !== def.id) this.game.events.emit(EVT.POWERUP_EXPIRED, { id: this.glideId, reason: 'replaced' });
      this.glideMs = durationMs;
      this.glideMul = glideFrictionMul(eff.frictionMul);
      this.glideId = def.id;
    } else if (eff.kind === 'magnet') {
      // Shard Magnet: pulls shards in for durationMs. Strength = def x MAGNET PULL upgrade (never time).
      // MAGNET MEASURE stretches the duration.
      durationMs = Math.round(timedPowerupMs(eff) * (this.upgradeFx?.magnetDurationMul || 1));
      this.magnetMs = durationMs;
      this.magnetEff = eff;
      this.magnetId = def.id;
    } else if (eff.kind === 'stabilize') {
      // B0: wider landing tolerance (BiomeEffects.resolveLanding) and optional bounce damping
      durationMs = timedPowerupMs(eff);
      if (this.stabilizeMs > 0 && this.stabilizeId !== def.id) this.game.events.emit(EVT.POWERUP_EXPIRED, { id: this.stabilizeId, reason: 'replaced' });
      this.stabilizeMs = durationMs;
      this.stabilizeDeg = stabilizeToleranceDeg(eff.landingToleranceDeg);
      this.stabilizeBounce = stabilizeBounceMul(eff.bounceMul);
      this.stabilizeId = def.id;
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
      tilt: quantizeTilt(p.tilt), // 1/127 steps: an analog tilt replays exactly from a ghost tape
      variableHop: (this.settings?.controlLayout || 'tricksRight') !== 'classic',
      noAutoNudge: (this.settings?.controlLayout || 'tricksRight') !== 'classic',
      divebomb: !!p.divebomb,
      corkscrew: !!p.corkscrew,
      tuck: !!p.tuck,
      brake: !!p.brake || (!!p.airBrake && !!this.sled && this.sled.grounded),
      brakeHeld: !!p.brake, // simTick re-derives `brake` from this and the sled's grounded state each tick
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

  /** Release gameplay unconditionally. A stale beat affects only whether
   * the optional music alignment was successful, NEVER whether the sled GOes.
   * Clear the one-shot snapshot before emitting, so event listeners cannot
   * accidentally turn a completed release into another audio wait.
   */
  finishGymReady() {
    const timing = this.gymBeatSnapshot;
    this.gymBeatSnapshot = null;
    this.gymBeatWaitMs = 0;
    let onBeat = false;
    if (timing) {
      try { onBeat = this.registry?.get?.(REG.AUDIO)?.isBeatTimingCurrent?.(timing) === true; }
      catch { /* failed audio cannot prevent GO */ }
    }
    this.game.events.emit(EVT.GYM_READY_GO, { onBeat });
  }

  update(time, delta) {
    if (!this.sled) return;
    const dt = clamp(Number.isFinite(delta) ? delta : 16.7, 0, 50);
    this._frameDt = dt;

    if (this.crashed) {
      this.updateCrashed(dt);
      return;
    }

    // #72: SEEKING (re-simulating the tape prefix) and READY (frozen at tick N) are not live play.
    if (this.takeover && this.takeover.phase !== 'live') { this._updateTakeoverPrelude(); return; }

    // Every attempt first freezes real-time gameplay for ~1000ms. Only at
    // that boundary can MUSIC SUGGEST a verified regular pulse <=300ms away.
    // The optional delay is Gym-owned, never a music-engine timer or physics
    // step. Both holds freeze the rider, pursuer, score and run clock.
    if (this.bsodGym && (this.gymReadyMs > 0 || this.gymBeatWaitMs > 0)) {
      const readyPad = this.normalizePad(this.inputRouter ? this.inputRouter.poll() : null);
      if (readyPad.pressed.pause) { this.pauseRun(); return; }
      if (this.gymReadyMs > 0) {
        // The physics delta is capped at 50ms, not the real-time READY.
        this.gymReadyMs = advanceGymReadyMs(this.gymReadyMs, delta);
        if (this.gymReadyMs === 0) {
          const timing = gymBeatSuggestion(this.registry?.get?.(REG.AUDIO));
          if (timing) {
            this.gymBeatSnapshot = timing;
            this.gymBeatWaitMs = timing.waitMs;
          } else this.finishGymReady();
        }
      } else {
        // No requery and never wait for a second pulse. A late/suspended tab
        // must not prolong the hold beyond the supplied original suggestion.
        this.gymBeatWaitMs = advanceGymReadyMs(this.gymBeatWaitMs, delta);
        let audioNow = NaN;
        try { audioNow = this.registry?.get?.(REG.AUDIO)?.ctx?.currentTime; }
        catch { /* audio cannot block a release */ }
        if (this.gymBeatWaitMs === 0 ||
            (Number.isFinite(audioNow) && audioNow >= this.gymBeatSnapshot?.dueAudioTime))
          this.finishGymReady();
      }
      this.renderFrame(0);
      return;
    }

    const rawPad = this.inputRouter ? this.inputRouter.poll() : null;
    const polled = this.normalizePad(rawPad);
    if (polled.pressed.pause) {
      this.pauseRun();
      return;
    }
    // Fixed simulation tick (issue #59): real frame time feeds an accumulator and the game
    // advances only in whole SIM_TICK_MS ticks, so one input tape gives one run at any
    // display rate. Rendering stays once per display frame.
    if (!this.simClock) this.simClock = new SimClock();
    const ticks = this.simClock.advance(dt);
    // A ghost tape under replay (REG.GHOST_REPLAY) replaces live input tick by tick.
    const pads = this.tapePlayer
      ? Array.from({ length: ticks }, (_, i) => this.tapePlayer.padAt(this.simClock.tick + 1 + i))
      // Issue #115: timestamped key changes go to the tick whose window contains them (`time` is the
      // rAF time, the same clock as KeyboardEvent.timeStamp); see SimClock.padsFor.
      : this.simClock.padsFor(polled, ticks, {
        frameTime: time, timeline: rawPad && rawPad.timeline, normalize: (raw) => this.normalizePad(raw),
      });
    let pad = polled;
    for (const tickPad of pads) {
      pad = tickPad;
      const r = this._stepTick(tickPad);
      if (r === 'hold') { this.renderFrame(0); return; }
      if (this.crashed) break;
      // #67: the postcard window ends on its exact tick, whatever the display rate (extra ticks of this frame are dropped).
      if (this.takeover && this.takeover.windowEndTick && this.simClock.tick >= this.takeover.windowEndTick) { this._endPostcardWindow(); return; }
    }
    if (this.takeover && this.takeover.windowEndTick && !this._leaving) {
      this.game.events.emit(EVT.TAKEOVER_STATE, { phase: 'window', tick: this.simClock.tick, windowTicks: this.takeover.windowTicks,
        remainingTicks: Math.max(0, this.takeover.windowEndTick - this.simClock.tick) });
    }
    for (const g of this.ghostRiders || []) g.update(this.simClock.tick);
    this.renderFrame(dt, pad);
  }

  /**
   * The per-tick body shared by live play, tape replay and the takeover seek (#72): advance the tick counter, record the
   * pad, run the simulation tick, then checkpoint / verify. One definition, so a seeked prefix cannot drift from a replay.
   * @returns {'hold'|undefined}
   */
  _stepTick(tickPad, verify = true) {
    const tick = ++this.simClock.tick;
    // Air brake on the ground brakes: decided per tick, not per display frame.
    tickPad.brake = !!tickPad.brakeHeld || (!!tickPad.airBrake && !!this.sled?.grounded);
    this.ghostRecorder?.input(tick, tickPad);
    const r = this.simTick(this.simClock.tickMs, tickPad);
    if (!this.crashed) {
      this.ghostRecorder?.afterTick(tick, this);
      if (verify) this.tapePlayer?.check(tick, this);
    }
    return r;
  }

  /** One authoritative replay tick from the TapePlayer (the replay branch of update(), without the frame). */
  stepReplayTick(opts = {}) {
    const verify = opts.verify !== false;
    const r = this._stepTick(this.tapePlayer.padAt(this.simClock.tick + 1), verify);
    if (verify) this._verifyTraceSample();
    // The camera and `_view` are presentation (the simulation does not read them), but the diagnostic kit still hashes them as
    // PRESENTATION_READ_BY_SIM. Advance them once per tick, as a replay shown at 120 display frames per second does, so the
    // state at N matches such a replay exactly. A replay shown at another display rate differs in the camera's dt-dependent
    // sub-pixel position only: cosmetic. Draw, fx, audio and particles stay skipped.
    if (!this.crashed) { this.updateCamera(this.simClock.tickMs); this._updateView(); }
    return r;
  }

  /**
   * #72: checkpoints are 1 s apart; the tape's pose trace is every TRACE_EVERY ticks and was stored as float32. On every
   * trace tick of a seek the sled pose must equal it EXACTLY (after fround), which narrows undetected divergence from 119
   * ticks to 3. Reuses TapePlayer.desync, so the seek driver aborts on it like on a failed checkpoint.
   */
  _verifyTraceSample() {
    const tp = this.tapePlayer, tick = this.simClock.tick;
    if (!tp || tp.desync || this.crashed || tick % TRACE_EVERY !== 0) return;
    const trace = traceOf(tp.tape); // works with or without a takeover; a truncated trace verifies only the samples it has
    const i = (tick / TRACE_EVERY - 1) * 3;
    if (i + 2 >= trace.length) return;
    const b = this.sled.body;
    const got = [Math.fround(b.position.x), Math.fround(b.position.y), Math.fround(b.angle)];
    if (got[0] !== trace[i] || got[1] !== trace[i + 1] || got[2] !== trace[i + 2]) {
      tp.desync = { tick, via: 'trace', want: [trace[i], trace[i + 1], trace[i + 2]], got };
    }
  }

  /**
   * Re-simulate the loaded tape up to tick `target` (default: the takeover tick), at most `maxTicks` / `budgetMs` per call,
   * with presentation suppressed (events, SFX, music reads). Every sim-read system still runs, because it is the real
   * simTick: terrain streaming, chunk take/drop, hazards, telegraph, BSOD, tricks, score. Callable without a takeover
   * (#66 will re-simulate candidates off-screen through this).
   * @returns {{done:boolean, tick:number, steps:number, desync?:object, crashed?:boolean}}
   */
  seekTo(target = this.takeover?.targetTick, opts = {}) {
    if (!this.tapePlayer || !Number.isFinite(target)) return { done: false, tick: this.simClock.tick, steps: 0, desync: { tick: this.simClock.tick, reason: this.tapePlayer ? 'no-target' : 'no-tape' } };
    const restore = this._muteForSeek();
    try { return seekStep(this, target, opts); } finally { restore(); }
  }

  /** Suppress presentation side effects of a seek; returns the function that undoes it. */
  _muteForSeek() {
    const ev = this.game && this.game.events;
    const own = ev && Object.prototype.hasOwnProperty.call(ev, 'emit');
    const prior = ev && ev.emit;
    this._seeking = true;
    if (ev) ev.emit = () => true;
    return () => {
      this._seeking = false;
      if (!ev) return;
      if (own) ev.emit = prior; else delete ev.emit;
    };
  }

  /**
   * One simulation tick: every causal gameplay system (timers, physics, contacts,
   * BSOD, tricks, score, pickups, hazards, streaming, glitch schedule). `dt` is always
   * SimClock.tickMs; slow-mo, blink and hit-stop scale the physics delta inside it.
   * @returns {'hold'|undefined} 'hold' when a Gym retry froze the new attempt.
   */
  simTick(dt, pad) {
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

    // B3 hazard motion (rolling boulders, gates) moves sensor bodies: once per tick, before physics (issue #59).
    for (const list of this.hazards.values()) for (const h of list) if (h.motion) h.stepMotion(this.runTimeMs);

    // physics context
    const zoneDefs = this.getZoneDefs(this.sled.x);
    const sled = this.sled;
    sled.groundAngleDeg = this.slopeAt(sled.x);
    sled.scrambled = this.scrambleMs > 0 && !isWarded(this.wards, { effect: 'scramble' });
    const phys = this.tuner.getEffective(this.physicsContext(pad, zoneDefs));
    this.currentPhys = phys;
    // Read-only same-tick geyser cooldown witness for music: an ordinary
    // jump cannot count as a geyser, and audio never feeds back into physics.
    const geyserCooldownBeforeMs = Number.isFinite(sled.geyserCooldownMs)
      ? Math.max(0, sled.geyserCooldownMs) : 0;

    // sub-stepped physics; slow-mo scales the delta, never the 8 ms limit
    sled.dropAheadDeg = this.dropAhead(sled);
    this.airForecast(sled);
    let simDt = dt * (this.slowmoMs > 0 ? this.slowmoScale : 1);
    if (this.blinkMs > 0) { this.blinkMs -= dt; simDt *= 0.35; }
    if (this.hitStopMs > 0) { this.hitStopMs -= dt; simDt = 0; }
    // A fixed input tick can run while physics is frozen. Preserve only
    // a valid unspent airborne press until the next actual controls step.
    // The tape retains the original edge; this causal latch is fingerprinted.
    if (simDt === 0 && pad.pressed.airBrake && !sled.grounded && !sled.airBrakeKickUsed)
      sled.airBrakePressPending = true;
    // A real contact can occur in one Matter substep and a buffered coyote
    // Hop relaunch in the NEXT substep of this same fixed tick. The final
    // sled frame would be airborne and otherwise lose the paid AirBrake
    // touchdown (or attach its points to a later unrelated landing).
    // Buffer actual contact snapshots before any later substep modifies pose.
    const substepTouchdowns=[];
    const landingLedger = { entries: [], combo: null, airTricks: 0 };
    let stepElapsedMs=0, kickSinceTouchdown=false, bluffKickSample=null;
    stepWorld(
      this.matter.world,
      simDt,
      (stepMs) => {
        const air = this.bsod ? this.bsod.state(sledLeftCollisionEdge(sled), sled.vx, this.bsodAtmosphere()) : null;
        // The kick is applied before Matter or the wall advances.
        const kickSample = air && {
          active: air.active, gapPx: air.gapPx, playerX: sled.x,
          nowMs: this.runTimeMs - dt + (simDt > 0 ? stepElapsedMs / simDt * dt : 0),
          grounded: !!sled.grounded, crashed: !!this.bsodCaught || (!!this.pendingCrash &&
            !(this.pendingCrash.cause === 'hazard' && (this.shieldCharges > 0 || sled.invulnerableMs > 0))),
          canopyDeployed: (sled.parachuteMs || 0) > 0,
          relativeAirX: air.relativeAirX, atmosphereDensity: air.atmosphereDensity,
        };
        sled.applyControls(pad, phys, stepMs, air);
        if (sled.airBrakeKickPulse) bluffKickSample = kickSample;
        // Integrate visual helicopter yaw over the upcoming physical
        // interval, BEFORE Matter can register a touchdown at its end.
        sled.stepHeli(stepMs);
      },
      (stepMs) => {
        const actualTouchdown=!!sled.endStep(stepMs);
        stepElapsedMs+=stepMs;
        // Preserve Flow expiry before the matching landing in the ledger;
        // yaw was already advanced before Matter resolved the contact.
        landingLedger.entries.push({ stepMs });
        const paidKick=!!sled.airBrakeKickPulse;
        if (paidKick) kickSinceTouchdown=true;
        sled.airBrakeKickPulse=0; // retain actual event in local ordered tick evidence
        if (actualTouchdown) {
          // Map the physical substep to the corresponding fixed run-clock
          // timestamp; slow-mo changes the physics delta, not the run clock.
          const atMs=this.runTimeMs-dt+
            (simDt>0 ? Math.min(1,stepElapsedMs/simDt)*dt : 0);
          const contactFs=sled.getFrameState(atMs,stepMs);
          // Grade against the real CONTACT slope, not the ground angle
          // sampled at the beginning of this potentially long fixed tick.
          // Terrain progression is unchanged; this read uses the same
          // existing slopeAt mechanism as the final-frame landing.
          contactFs.groundAngleDeg=this.slopeAt(contactFs.x);
          contactFs.grounded=true;
          contactFs.input.airBrakeKicked=kickSinceTouchdown;
          substepTouchdowns.push({fs:contactFs,kicked:kickSinceTouchdown});
          kickSinceTouchdown=false;
          bluffKickSample=null;
        }
        this.processContacts();
        // The BSOD advances with the SAME capped physics substeps as the sled. A fast wall cannot
        // jump over the rider between render frames. Do not depend on audio or animation timers.
        if (this.bsod && !this.bsodCaught) {
          this.bsod.advance(stepMs, sledLeftCollisionEdge(sled));
          const s = this.bsod.state(sledLeftCollisionEdge(sled), sled.vx, this.bsodAtmosphere());
          if (actualTouchdown) substepTouchdowns[substepTouchdowns.length-1].bsodState=s;
          if (s.gapPx <= 0) {
            this.bsodCaught = true;
            this.pendingCrash = { cause: 'bsod' };
          }
        }
        if (actualTouchdown) {
          // The contact has been resolved by Matter and sensor handlers,
          // and we know whether a terminal hazard/BSOD took priority.
          // Settle a REAL landing now, BEFORE the next physics substep:
          // wobble/boost/spring rebound must act on THIS flight's body,
          // not on a buffered new Hop that launches in the next substep.
          const absorbed=!!this.pendingCrash &&
            this.pendingCrash.cause==='hazard' &&
            (this.shieldCharges>0 || sled.invulnerableMs>0);
          if ((!this.pendingCrash || absorbed) && !landingLedger.badLanding)
            this.settlePhysicalTouchdown(substepTouchdowns[substepTouchdowns.length-1].fs, landingLedger);
        }
      },
    );
    this.flushDespawn();
    // One authoritative post-physics snapshot per frame. Music will subscribe later; physics never
    // reads from that subscriber. An inactive/reset snapshot is emitted at run termination.
    if (this.bsod && !this.crashed) {
      this.bsodState = this.bsod.state(sledLeftCollisionEdge(sled), sled.vx, this.bsodAtmosphere());
      this.publishBsodState(this.bsodState);
    }
    // The ledger retains the exact substep Flow/landing chronology;
    // only surviving ticks may commit the landing awards.

    // SFX with no event: push / hop (+ wind speed every frame)
    const audio = this._seeking ? null : this.registry.get(REG.AUDIO);
    if (audio) {
      try {
        if (sled.hopPulse) audio.playSfx('hop');
        if (sled.pushPulse) audio.playSfx('push');
        if (audio.setSpeed) audio.setSpeed(sled.speed);
        if (audio.setAirborne) audio.setAirborne(!sled.grounded);
        // Music consumes authentic physical observations ONLY. No changes
        // to controls, replay frames, causal RNG, force or recorded beats.
        audio.setGeyserMotion?.({
          beforeCooldownMs: geyserCooldownBeforeMs,
          afterCooldownMs: sled.geyserCooldownMs || 0,
          launchAvailable: !!phys.geyserLaunch,
          vy: sled.vy,
        });
        audio.setThermalMotion?.({
          active: zoneDefs.some(def => def?.id === 'thermalUpdraft') &&
            !isWarded(this.wards, { modId: 'thermalUpdraft' }),
          gravityPxS2: phys.gravityPxS2, vy: sled.vy, grounded: !!sled.grounded,
        });
        // #306: audio must sample the already-JOINED collision mesh,
        // never TerrainGenerator.heightAt() (whose _chunkAt mutates caches
        // and can queue new terrain). No joined sample => no new audio input.
        if (this.mesh?.chunks) {
          const terrainY = joinedMarkerHeight(sled.x, this.mesh.chunks);
          if (Number.isFinite(terrainY)) {
            audio.setSpaceMotion?.({
              gravityPxS2: phys.gravityPxS2,
              terrainY, riderY: sled.y, vy: sled.vy, grounded: !!sled.grounded,
            });
            audio.setHydrostaticMotion?.({
              terrainY, riderY: sled.y, vy: sled.vy, grounded: !!sled.grounded,
            });
          }
        }
      } catch (e) { /* audio must never break the loop */ }
    }
    if (sled.hopPulse) this._lastHopMs = this.runTimeMs; // crash report: the hop verdict
    this._hopped = !!sled.hopPulse;
    this._pushed = !!sled.pushPulse;
    const airBrakeKickedThisTick = kickSinceTouchdown; // only the current flight
    sled.airBrakeKickPulse = 0; // consumed per substep; always zero at replay checkpoint
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

    // Trick yaw was advanced through each physical substep, including
    // any touchdown, rather than applying an extra full-tick rotation here.
    const fs = sled.getFrameState(this.runTimeMs, dt);
    if (substepTouchdowns.length) {
      // This is a NEW flight after a genuine physical contact. Count only
      // the interval since the most recent touchdown, never pre-contact time.
      const lastContactMs=substepTouchdowns[substepTouchdowns.length-1].fs.timeMs;
      fs.dtMs=Math.max(0,this.runTimeMs-lastContactMs);
    }
    fs.input.airBrakeKicked = airBrakeKickedThisTick; // earlier kicks were settled at real contacts
    // a hazard hit that a shield charge (or post-respawn grace) will absorb leaves the sled flying: keep its air phase
    const absorbed = !!this.pendingCrash && this.pendingCrash.cause === 'hazard' && (this.shieldCharges > 0 || sled.invulnerableMs > 0);
    fs.crashed = !!this.pendingCrash && !absorbed;
    // All genuine touches already applied their physical consequences.
    // Score/event publication remains staged until crash priority is known.
    const upd = this.tricks.update(fs) || {};
    this.maxAirtimeMs = Math.max(this.maxAirtimeMs, upd.airtimeMs || 0, sled.airtimeMs);

    // A fallback final-frame landing must be graded before committing any
    // earlier touchdown rewards. It cannot outrank a terminal wall/hazard.
    const finalLanding = (!this.pendingCrash || absorbed) ? this.gradeLanding(upd.landing) : null;
    if (finalLanding?.quality === 'crash') {
      landingLedger.badLanding = true;
      landingLedger.entries.push({ crashLanding: finalLanding, fs });
    }
    // Sensor/void causes have priority over provisional contact grading.
    // A shield-absorbed hazard plus a bad landing still requires a backup
    // respawn, as in the prior final-frame landing path.
    if (landingLedger.badLanding && (!this.pendingCrash || absorbed))
      this.pendingCrash = { cause: 'badLanding' };

    // zones, safe-ground samples
    this.updateZones(sled.x);
    this.sampleSafeGround(dt, fs);

    // Issue #47: the Kodiak rival (if one is out) runs, telegraphs and may shove the sled this tick.
    this.updateKodiaks(dt);

    // Collision with the deletion wall always wins if any other contact/landing happened during this frame.
    if (this.bsodCaught) this.pendingCrash = { cause: "bsod" };
    const survivedLanding = !this.pendingCrash || (this.pendingCrash.cause === 'hazard' &&
      (this.shieldCharges > 0 || sled.invulnerableMs > 0));
    this.commitTouchdownLedger(landingLedger, survivedLanding);
    if (survivedLanding) this.handleTricksAndLanding(upd, fs, { gradedLanding: finalLanding });
    // crash resolution (may be negated by Hashed Backup, except the BSOD)
    if (this.pendingCrash) this.resolveCrash(fs);
    // The replacement attempt remains frozen even for this crash frame.
    if (this.bsodGym && this.gymReadyMs > 0) return 'hold';

    if (!this.crashed) {
      // A physical landing split the flight. Only a paid kick AFTER the
      // last contact belongs to this relaunched encounter; never carry a
      // tick-wide pre-touchdown brake bonus into the new flight.
      this.updateBsodBluff(
        substepTouchdowns.length ? kickSinceTouchdown : airBrakeKickedThisTick,
        substepTouchdowns, bluffKickSample);
      // Gym may continue through the same terrain, but score/distance belongs
      // only to the current attempt. Never recredit earlier travel on a retry.
      const origin = this.bsodGym ? this.gymAttemptStartX : this.startX;
      const metres = Math.max(0, (sled.x - origin) / PIXELS_PER_METER);
      this.updateFun(dt, pad, metres);
      // distance
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
      const c = pmath.cos(a);
      const s = pmath.sin(a);
      this.trail.update(sled.x + c * -16 - s * 6, sled.y + s * -16 + c * 6, sled.speed);
    }
    // the crash beat (CrashReport.crashBeat): hit-stop, then 400 ms of FX at 0.25x; visual only, the run clock is stopped
    const fxDt = this.hitStopMs > 0 ? dt * 0.08 : this.crashed ? dt * crashBeat(this.crashTimerMs, TUNING.hitStopCrashMs).fxScale : dt;
    this.updateCamera(dt);
    const cam = this.cameras.main;
    const { left, right } = this._updateView();
    this.mesh.cull(left - 40, right + 40);
    const t = this.runTimeMs;
    for (const list of this.hazards.values()) for (const h of list) h.update(t, left, right);
    for (const list of this.powerups.values()) for (const p of list) p.update(t, left, right);
    this.fx.update(fxDt, this.heightFn);
    if (this.shardField) this.shardField.update(t, left, right);
    if (this.kodiaks?.length || this.kodiakRider) {
      if (!this.kodiakRider) this.kodiakRider = new KodiakRider(this, this.palette);
      this.kodiakRider.update(this.crashed ? [] : this.kodiaks, this._view, cam.zoom, t, isReducedMotion(this));
    }
    if (this.magnetMs > 0 && !this.crashed) {
      if (!this.blackHole) this.blackHole = new BlackHole(this, this.palette);
      this.blackHole.update(t, magnetHolePos(sled.x, sled.y), magnetStrength(this.magnetEff, this.upgradeFx?.magnetMul), this.magnetMs, isReducedMotion(this));
    } else this.blackHole?.update(t, null, null, 0);
    if (this.bestMarker) this.bestMarker.update(t, sled.x, this.markerHeightFn);
    if (this.deathMarker) this.deathMarker.update(t, sled.x, this.markerHeightFn);
    if (this.bestMarker && this.deathMarker) {
      // BEST and DIED HERE are often at the same x: lay their labels out together so they never overprint
      const known = (m) => (m.y != null ? { x: m.x, y: m.y } : null);
      const L = layoutMarkerLabels(known(this.bestMarker), known(this.deathMarker));
      this.bestMarker.setPlacement(L.best);
      this.deathMarker.setPlacement(L.death);
    }
    this.drawStreaks(t);
    if (this.groundTelegraph) this.groundTelegraph.update(t, this.crashed ? null : this._teleMarks, this._view, cam.zoom, this.terrain?.activeList);
    // Visual-only world dance: no music player/beat-grid mutation, and no
    // hidden synthetic tempo. With a muted/paused song or reduced motion the
    // backdrop returns immediately to its original neutral geometry.
    const danceAllowed=worldDanceMotionAllowed(this.settings,
      this._worldDanceMotionQuery?.matches===true);
    const audio=this.registry?.get?.(REG.AUDIO);
    // Never throws: a failing audio engine must not stop the frame (and with it Phaser's loop), issue #140.
    const {sample,meter}=readWorldDanceAudio(audio,danceAllowed);
    const dance=this.worldDance?.update(sample,dt,meter)||0;
    // Reuse an actual original-mix onset from WorldDance; never fabricate
    // a musical beat or let the cosmetic gear pulse change the run.
    if (sample && this.worldDance?.lastAccentMs === sample.timeMs) {
      try { audio?.onSteampunkRecordedAccent?.(sample); } catch {}
    }
    this.bg.update(cam.scrollX, t, sled.speed,this.worldDance?.visualStrength||0);
    // The existing decorative bees OWN their positions. Sound follows
    // them only when they are actually on screen in Micro Mountain.
    // Optional WebAudio can fail while instantiating bee voices. It must NOT
    // prevent the next physics/frame update or the rest of the UI from drawing.
    try {
      if (audio?.setMicroBees) {
        const visible = this.bg.motif === 'dew-drops' && this.bg.bees === true && !this.crashed;
        const positions = visible ? beesAt(cam.scrollX, t, this.bg.decorSeed) : [];
        const riderScreenX = GAME_WIDTH / 2 +
          (sled.x - (cam.scrollX + GAME_WIDTH / 2)) * cam.zoom;
        audio.setMicroBees(positions, riderScreenX);
      }
    } catch { /* presentation-only audio must never stop Phaser's frame loop */ }
    if (this.biomeFx) this.biomeFx.update(cam.scrollX, t, this._veil || 0, isReducedMotion(this), this.worldDance?.skylineBands);
    this.songBillboard?.update(dt,dance,!danceAllowed);
    this.drawBsodCues();
    if (this.flashRect.alpha > 0) this.flashRect.setAlpha(Math.max(0, this.flashRect.alpha - dt / 350));
    this.updateBlindOverlay();
  }

  /** The visible world rectangle from the camera (`_view`). Shared by renderFrame and the takeover seek (#72). */
  _updateView() {
    const cam = this.cameras.main;
    const halfW = GAME_WIDTH / (2 * cam.zoom);
    const left = cam.scrollX + GAME_WIDTH / 2 - halfW;
    const right = cam.scrollX + GAME_WIDTH / 2 + halfW;
    this._view = { left, right, top: cam.scrollY + GAME_HEIGHT / 2 - GAME_HEIGHT / (2 * cam.zoom), bottom: cam.scrollY + GAME_HEIGHT / 2 + GAME_HEIGHT / (2 * cam.zoom) };
    return this._view;
  }

  /**
   * The PhysicsTuner context for this frame: zones, daily rule, timed hazard effects and power-ups (B0: wards, glide,
   * stabilize). A warded slow / scramble stops acting while the ward lasts.
   * @param {Object} pad normalized pad.
   * @param {Object[]} [zoneDefs] mod defs under the sled (default: looked up at the sled x).
   */
  physicsContext(pad, zoneDefs) {
    const sled = this.sled;
    return {
      tucked: !!pad.tuck,
      zones: zoneDefs || this.getZoneDefs(sled.x),
      daily: this.dailyMods,
      scrambled: this.scrambleMs > 0 && !isWarded(this.wards, { effect: 'scramble' }),
      slowed: this.slowMs > 0 && !isWarded(this.wards, { effect: 'slow' }),
      slowFactor: this.slowFactor,
      // Decision 4: Head Start's opening surge multiplies in for its window only (exactly 1 afterwards).
      speedBoost: (this.boostMs > 0 ? this.boostFactor : 1) * wardSpeedMul(this.wards)
        * openingSpeedMul(this.opening, this.bsodGym
          ? this.runTimeMs - this.gymAttemptStartTimeMs : this.runTimeMs),
      upgradeEffects: this.upgradeFx,
      timeMs: this.runTimeMs,
      parachute: !!pad.parachute && !sled.grounded && (sled.parachuteFuelMs ?? PHYSICS.parachuteDurationMs) > 0,
      airBrake: !!pad.airBrake && !sled.grounded,
      atmosphereDensity: this.bsodAtmosphere(),
      airborne: !sled.grounded,
      braking: !!pad.brake,
      wards: this.wards,
      glideFrictionMul: this.glideMs > 0 ? this.glideMul : 1,
      stabilizeBounceMul: this.stabilizeMs > 0 ? this.stabilizeBounce : 1,
    };
  }

  /** B0 biome effect state (wards, glide, stabilize, blind), cleared at run start. */
  _resetBiomeEffects() {
    this.wards = emptyWards();
    this.glideMs = 0;
    this.glideMul = 1;
    this.glideId = null;
    this.stabilizeMs = 0;
    this.stabilizeDeg = 0;
    this.stabilizeBounce = 1;
    this.stabilizeId = null;
    this.blindMs = 0;
    this.blindTotalMs = 0;
    this.blindVis = 1;
    this.magnetMs = 0;
    this.magnetEff = null;
    this.magnetId = null;
  }

  /** B0: end every biome effect now (manual reset), reporting each the way its HUD chip expects. */
  _endBiomeEffects(reason) {
    for (const w of this.wards.wards) this.game.events.emit(EVT.POWERUP_EXPIRED, { id: w.id, reason });
    if (this.glideMs > 0) this.game.events.emit(EVT.POWERUP_EXPIRED, { id: this.glideId, reason });
    if (this.stabilizeMs > 0) this.game.events.emit(EVT.POWERUP_EXPIRED, { id: this.stabilizeId, reason });
    if (this.blindMs > 0) this.game.events.emit(EVT.EFFECT_END, { effect: 'blind' });
    if (this.magnetMs > 0) this.game.events.emit(EVT.POWERUP_EXPIRED, { id: this.magnetId, reason });
    this._resetBiomeEffects();
    this.updateBlindOverlay();
  }

  /** B0 timers (real time, like the other effects). */
  tickBiomeEffects(dt) {
    const r = tickWards(this.wards, dt);
    for (const id of r.expired) this.game.events.emit(EVT.POWERUP_EXPIRED, { id, reason: 'timeout' });
    if (this.glideMs > 0) {
      this.glideMs -= dt;
      if (this.glideMs <= 0) { this.glideMs = 0; this.game.events.emit(EVT.POWERUP_EXPIRED, { id: this.glideId, reason: 'timeout' }); }
    }
    if (this.stabilizeMs > 0) {
      this.stabilizeMs -= dt;
      if (this.stabilizeMs <= 0) { this.stabilizeMs = 0; this.game.events.emit(EVT.POWERUP_EXPIRED, { id: this.stabilizeId, reason: 'timeout' }); }
    }
    if (this.magnetMs > 0) {
      this.magnetMs -= dt;
      if (this.magnetMs <= 0) { this.magnetMs = 0; this.game.events.emit(EVT.POWERUP_EXPIRED, { id: this.magnetId, reason: 'timeout' }); }
    }
    if (this.blindMs > 0) {
      this.blindMs -= dt;
      if (this.blindMs <= 0) { this.blindMs = 0; this.game.events.emit(EVT.EFFECT_END, { effect: 'blind' }); }
    }
  }

  /** B0: alpha of the blind overlay for this frame (0 when not blinded or when blind is warded). */
  updateBlindOverlay() {
    if (!this.blindRect) return;
    const a = this.blindMs > 0 && !isWarded(this.wards, { effect: 'blind' }) ? blindOverlayAlpha(this.blindMs, this.blindTotalMs, this.blindVis) : 0;
    if (this.blindRect.alpha !== a) this.blindRect.setAlpha(a);
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
    this.tickBiomeEffects(dt);
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
        this.game.events.emit(EVT.POWERUP_EXPIRED, { id: this.boostId || 'packetBurst', reason: 'timeout' });
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

  /** Grade once at the actual contact, before a later pickup can change tolerance. */
  gradeLanding(landing) {
    if (!landing) return null;
    let l = resolveLanding(landing, this.stabilizeMs > 0 ? this.stabilizeDeg : 0, TUNING);
    if (l.shortAirBrakeTouchdown && l.quality === 'perfect') l = { ...l, quality: 'good' };
    return l;
  }

  /** Apply causal body changes at contact, but stage score/event publication.
   * The preview only needs combo types and trick count (not points or Flow).
   * Clock steps and real score operations are committed in their original order.
   */
  settlePhysicalTouchdown(fs, ledger = null) {
    const upd = this.tricks.update(fs) || {};
    this.maxAirtimeMs = Math.max(this.maxAirtimeMs || 0, upd.airtimeMs || 0);
    if (!ledger) { this.handleTricksAndLanding(upd, fs); return upd; }
    const l = this.gradeLanding(upd.landing);
    if (l?.quality === 'crash') {
      // Do not occupy pendingCrash: subsequent sensor hits must be able
      // to report their true cause (especially a fatal hazard).
      ledger.badLanding = true;
      ledger.entries.push({ crashLanding: l, fs });
      return upd;
    }
    if (!ledger.combo) {
      ledger.combo = new Set(this.score.getSnapshot().comboTricks);
      ledger.airTricks = this._airTricks;
    }
    for (const t of upd.tricks || []) {
      ledger.combo.add(t.type);
      ledger.airTricks += Math.max(1, t.count || 1);
    }
    let boostEvent;
    if (l) {
      const types = [...ledger.combo];
      boostEvent = this.applyLandingPhysics(l, this.score.getMultiplier(types),
        Math.max(ledger.airTricks, types.length), fs, false);
      ledger.combo.clear();
      ledger.airTricks = 0;
    }
    ledger.entries.push({ upd, fs, options: {
      gradedLanding: l, physicalApplied: true, boostEvent,
      zoneScoreMul: l ? this._zoneScoreMulAt(fs.x) : undefined,
    } });
    return upd;
  }

  /** A terminal collision anywhere in the tick forfeits its staged rewards.
   * Flow still advances, and older banked points and unrelated bonuses survive.
   */
  commitTouchdownLedger(ledger, survived) {
    for (const entry of ledger.entries) {
      if (entry.stepMs !== undefined) this.emitFlow(this.score.tick(entry.stepMs));
      else if (survived && entry.upd) this.handleTricksAndLanding(entry.upd, entry.fs, entry.options);
      else if (entry.crashLanding && this.pendingCrash?.cause === 'badLanding') {
        this.emitCrashLanding(entry.crashLanding, entry.fs);
      }
    }
  }

  emitCrashLanding(l, fs) {
    this.game.events.emit(EVT.LANDING, {
      quality: 'crash', angleDeg: l.angleDeg || 0, impactSpeedPxS: l.impactSpeedPxS || 0,
      airtimeMs: l.airtimeMs || 0, bonusPoints: 0, bankedPoints: 0, hard: true, x: fs.x, y: fs.y,
    });
  }

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

  handleTricksAndLanding(upd, fs, options = {}) {
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
    const l = options.gradedLanding === undefined ? this.gradeLanding(upd.landing) : options.gradedLanding;
    if (!l) return;
    this.maxAirtimeMs = Math.max(this.maxAirtimeMs, l.airtimeMs || 0);
    const airTricks = this._airTricks;
    this._airTricks = 0;
    if (l.quality === 'crash') {
      this.emitCrashLanding(l, fs);
      this.pendingCrash = { cause: 'badLanding' };
      return;
    }
    const pre = this.score.getSnapshot();
    const mult = pre.multiplier || 1;
    const nTricks = Math.max(airTricks, (pre.comboTricks || []).length);
    const r = this.score.onLanding(l, { zoneScoreMul: options.zoneScoreMul ?? this._zoneScoreMulAt(fs.x) });
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
    if (options.physicalApplied) {
      if (options.boostEvent) this.emitIf(EVT.LANDING_BOOST, options.boostEvent);
    } else this.applyLandingPhysics(l, mult, nTricks, fs);
  }

  applyLandingPhysics(l, mult, nTricks, fs, publish = true) {
    if (l.shortAirBrakeTouchdown) {
      // Micro-touches cannot manufacture boost/rebound, but still pay wobble.
      if (l.quality === 'sloppy') this.sled.wobble(TUNING.sloppySpeedKeep);
      return;
    }
    const event = this.applyLandingBoost(l, mult, nTricks, fs, publish);
    this.applySpringRebound(l, fs);
    return event;
  }

  /**
   * Sky Jellyfish felt bounce: a scored (non-crash) landing inside a zone with `physics.landingRebound` throws the sled
   * back away from the landing slope by BiomeEffects.springRebound of its impact speed (bounded, decaying; the Rails
   * damp the share in PhysicsTuner). Sled.launchNormal preserves the along-slope velocity, so a descent never turns
   * forward speed into extra bounce. Runs after the landing boost, so a sloppy wobble's velocity cut does not eat the
   * rebound.
   */
  applySpringRebound(l, fs) {
    const share = this.currentPhys ? this.currentPhys.landingRebound : 0;
    const up = springRebound(l.impactSpeedPxS || 0, share);
    if (!(up > 0)) return;
    const angle = fs && Number.isFinite(fs.groundAngleDeg) ? fs.groundAngleDeg : this.sled.groundAngleDeg;
    this.sled.launchNormal(up, Number.isFinite(angle) ? angle : 0);
    if (fs) this.fx.ring(fs.x, fs.y + 8, this.palette.lime, 20, 260);
  }

  /** Trick -> speed loop (TUNING.boost*): a clean landing after tricks gives a forward burst and a stretch of low drag. */
  applyLandingBoost(l, mult, nTricks, fs, publish = true) {
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
    const event = { amountPxS: Math.round(amt), quality: l.quality, comboMult: mult, tricks: nTricks };
    if (publish) this.emitIf(EVT.LANDING_BOOST, event);
    const k = amt / TUNING.boostCapPxS;
    const sp = sled.speed || 1;
    const bx = fs.x - (sled.vx / sp) * 18;
    const by = fs.y - (sled.vy / sp) * 18 + 6;
    this.fx.ring(fs.x, fs.y + 6, this.palette.amber, 38 + 30 * k, 420);
    this.fx.sparks(bx, by, this.palette.lime, 10 + Math.round(14 * k), 260 + 160 * k, 20);
    this.fx.sparks(bx, by, this.palette.amber, 6, 200, 10);
    this._zoomKick = Math.max(this._zoomKick, 0.025 + 0.04 * k);
    this.shake(1 + 1.5 * k);
    return event;
  }

  // ------------------------------------------------------------------ fun-pass systems

  /** Emit scheduler transitions (UIScene draws one hint at a time) and persist what they imply. */
  applyHintEvents(events) {
    for (const e of events) {
      if (e.show) this.tutShown.add(e.id); else this.tutShown.delete(e.id);
      this.emitIf(EVT.TUTORIAL_HINT, e);
      if (e.id === 'tuck' && e.show) {
        this.tuckShows += 1;
        if (!this.bsodGym && !this.unrankedPractice) saveTuckShows(this.tuckShows);
      } else if (!e.show && ((e.id === 'boost') || (e.id === 'tuck' && this.tuckShows >= TUNING.tuckHintMaxShows))) {
        this.tutDoneId(e.id); // explained once / shown often enough
      }
    }
  }

  /** The player did what the hint asks: hide it and never show it again (persisted). */
  tutDoneId(id) {
    if (this.tutDone.has(id)) return;
    const ev = this.hints.complete(id, this.runTimeMs);
    // Practice hints may be completed for this session, but never consume a
    // first-run hint in the player's permanent normal-game tutorial history.
    if (!this.bsodGym && !this.unrankedPractice) saveTutorialDone(this.tutDone);
    this.applyHintEvents(ev);
  }

  /** Per-frame: shards, near misses, milestones / best marker, first-run hints. */
  updateFun(dt, pad, metres) {
    const sled = this.sled;
    const now = this.runTimeMs;

    // shards
    if (this.shardField) {
      let got = this.shardField.collect(sled.x, sled.y - 6, TUNING.shardRadiusPx);
      if (this.magnetMs > 0) {
        // Shards fall into the hole (hovering over the rider) and are collected there.
        const m = magnetStrength(this.magnetEff, this.upgradeFx?.magnetMul), h = magnetHolePos(sled.x, sled.y);
        this.shardField.pull(h.x, h.y, m.radius, (sx, sy, x, y) => pullStep(sx, sy, x, y, m.radius, m.speed, dt));
        got = got.concat(this.shardField.collect(h.x, h.y, TUNING.shardRadiusPx));
      }
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
    this.updateGroundTelegraph(now);

    // milestones + best marker
    // ScoreManager pays each completed sector exactly once (addBonus 'milestone'); the scene only announces it
    for (const m of this.score.checkMilestones(metres)) {
      this.emitScore();
      this.emitIf(EVT.MILESTONE, { sector: m.sector, distanceM: m.distanceM, points: m.points });
      this.flashRect.setFillStyle(this.palette.cyan, 1).setAlpha(0.2);
      this.fx.ring(sled.x, sled.y, this.palette.cyan, 70, 600);
      this.fx.sparks(sled.x, sled.y - 6, this.palette.cyan, 14, 240, 40);
    }
    // W3: announce the biome we are in, when it changes. Driven by the sled's current position rather
    // than by chunk callbacks so it cannot fire out of order or twice for one crossing. #65: the biome is the
    // generator's own answer at the sled's x, so an arcade bridge (null) is its own stretch: entering it and
    // entering the next biome each fire once, and a run opens in the home biome.
    const biomeNow = this.terrain.biomeAtX(this.sled.x);
    const biomeChanged = this._biomeId !== biomeNow;
    let def = null;
    let first = false;
    if (biomeChanged) {
      first = this._biomeId === undefined;
      this._biomeId = biomeNow;
      def = this._biomeDefById(biomeNow);
      const sectorNow = this.terrain._sectorOf(this.sled.x);
      if (def) this.emitIf(EVT.BIOME_ENTER, { id: def.id, name: def.name, sector: sectorNow, entering: true });
      else if (!first) this.emitIf(EVT.BIOME_ENTER, { id: null, name: 'Bitstream', sector: sectorNow, entering: false });
    }
    // The biome's palette only takes effect if something applies it. Repaint on entry AND on exit
    // back to arcade terrain, or the tint would persist past the biome that owns it. refreshPalette repaints graphics
    // only (#140: colliders are never touched), so it runs when the generator's biome changed and a repaint was actually
    // owed: a run with no biome content never repaints beyond a palette setting change. #65 presentation: the look
    // (what the world is painted as) can change at other x than that (inside an arcade bridge) and repaints the same way.
    this._updateLook(biomeNow, biomeChanged && (def !== null || !first));
    // The real terrain generator, not the visual dissolve or a guessed
    // timer, owns Arcade corridor position; music only reads its progress.
    if (biomeNow === null || biomeNow === 'bitstream-bluffs') {
      // The bridge corridor and terrain decisions are authoritative. Optional
      // WebAudio/FX-param failures must not break this gameplay transition.
      try {
        const span = biomeNow === null ? this._bridgeSpan : null;
        this.registry?.get?.(REG.AUDIO)?.setArcadeTransition?.({
          bridge: !!span,
          progress: span ? Math.max(0, Math.min(1, bridgeProgress(span, sled.x))) : 0,
        });
      } catch { /* a broken audio graph cannot interrupt terrain/simulation */ }
    }
    if (this.bestM > 0 && !this.newBestDone && metres > this.bestM) {
      this.newBestDone = true;
      if(!this.unrankedPractice)this.emitIf(EVT.NEW_BEST, { distanceM: Math.floor(metres), previousBestM: this.bestM });
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

  /**
   * Ground-hazard telegraph (systems/HazardTelegraph.js): plan this frame's marks (drawn by entities/GroundTelegraph.js in
   * renderFrame) and play each hazard's warn / hop cue once. The speed-based horizon never reads the camera.
   * @param {number} now run time (ms).
   */
  updateGroundTelegraph(now) {
    const sled = this.sled;
    const live = [];
    for (const list of this.hazards.values()) for (const h of list) live.push(h);
    const landX = !sled.grounded && Number.isFinite(sled.airEtaMs) ? sled.x + sled.vx * sled.airEtaMs / 1000 : null;
    const isMuted = (h) => isWarded(this.wards, { hazardId: h.def.id }) || isWarded(this.wards, { effect: h.def.onHit ? h.def.onHit.effect : 'crash' });
    const marks = planTelegraph(live, { x: sled.x, vx: sled.vx, speed: sled.speed, grounded: sled.grounded, landX }, { isMuted, nowMs: now });
    for (const e of this.teleTracker.update(now, marks)) {
      if (e.type === 'warn') {
        e.ref.teleAtMs = now; // read by the measurement harness and the gate; nothing in the game depends on it
        if (e.sound) this.playSfx('groundWarn', { brace: e.kind === 'brace' });
      } else this.playSfx('hopCue');
    }
    this._teleMarks = marks;
  }

  /** Savestate hook (#119): the telegraph tracker's plain-data state. */
  snapshotTelegraph() { return this.teleTracker.snapshot(); }

  /**
   * Savestate hook (#119): restore the tracker, then re-stamp `teleAtMs` on the (freshly built) live hazards from it, so
   * nothing re-warns and the crash-report/harness timestamp matches the uninterrupted run.
   * @param {ReturnType<TelegraphTracker['snapshot']>} snap
   */
  restoreTelegraph(snap) {
    this.teleTracker.restore(snap);
    for (const list of this.hazards.values()) for (const h of list) {
      const w = this.teleTracker.firstWarnMs(h);
      if (w !== null) h.teleAtMs = w;
    }
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

  /**
   * Product of the scoring multipliers of the mod zones at x (W3). Only mods that define `scoreMul`
   * contribute, so physics-only zones leave scoring untouched. Bounded by the data, and multiplied
   * rather than summed so two overlapping echo zones cannot compound into a runaway payout.
   * @param {number} x world px
   * @returns {number} >= 1
   */
  _zoneScoreMulAt(x) {
    let mul = 1;
    for (const def of this.getZoneDefs(x)) {
      if (def && Number.isFinite(def.scoreMul) && def.scoreMul > 1) mul *= def.scoreMul;
    }
    return mul;
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
    const sp = pmath.hypot(vx, vy);
    const keep = sp > 1 ? Math.min(1, 380 / sp) * speedKeep : 0;
    const dirx = pmath.cos(ang * DEG);
    const diry = pmath.sin(ang * DEG);
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

  /** End temporary pickups/hazards consistently on manual and Gym recovery.
   * Permanent upgrade/loadout settings are intentionally not modified. */
  clearTemporaryEffects(reason) {
    if (this.boostMs > 0) this.game.events.emit(EVT.POWERUP_EXPIRED,
      { id: this.boostId || 'packetBurst', reason });
    if (this.slowmoMs > 0) this.game.events.emit(EVT.POWERUP_EXPIRED,
      { id: 'clockPulse', reason });
    if (this.slowMs > 0) this.game.events.emit(EVT.EFFECT_END, { effect: 'slow' });
    if (this.scrambleMs > 0) this.game.events.emit(EVT.EFFECT_END, { effect: 'scramble' });
    this.boostMs = 0;
    this.boostFactor = 1;
    this.boostId = null;
    this.slowmoMs = 0;
    this.slowMs = 0;
    this.scrambleMs = 0;
    if (this.sled) this.sled.scrambled = false;
    this._endBiomeEffects(reason);
  }

  manualReset() {
    const sample = this.pickSafe(250);
    const r = this.score.penalizeReset() || { comboPenalty: 0, pointsLost: 0 };
    this.emitFlow(r.flowChange);
    const pos = this.respawnAt(sample, 'manual', 0.6);
    this.resetCooldownMs = 600;
    // Shared cleanup prevents different recovery paths from retaining hazard timers.
    this.clearTemporaryEffects('respawn');
    this.game.events.emit(EVT.RESPAWN, { reason: 'manual', x: pos.x, y: pos.y, comboPenalty: r.comboPenalty || 0 });
    this.emitCombo('reset');
    this.emitScore();
  }

  // ------------------------------------------------------------------ crash

  resolveCrash(fs) {
    const c = this.pendingCrash;
    this.pendingCrash = null;
    const speed = pmath.hypot(fs.vx, fs.vy);
    // The advancing deletion wall overrides even shield, respawn grace and opening grace.
    if (c.cause === 'bsod') { this.doCrash(c, fs, speed); return; }
    if (this.sled.invulnerableMs > 0 && c.cause !== 'chasm') {
      // Grace prevents death, not the failure of a completed bad landing.
      // Its provisional combo belongs to the ended flight, never a later one.
      if (c.cause === 'badLanding') {
        this._airTricks = 0;
        this.tricks.reset();
        this.emitFlow(this.score.onCrash());
        this.emitCombo('crash');
        this.emitScore();
      }
      return;
    }
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
      const spent = spendShieldSource(this.shieldSources); // B2: expire the chip of the pickup whose charge this was
      this.shieldSources = spent.sources;
      this.game.events.emit(EVT.CRASH, {
        cause: c.cause, x: fs.x, y: fs.y, speedPxS: speed, hazardId: c.hazardId,
        negated: true, fatal: false, runId: this.runId,
      });
      this.game.events.emit(EVT.POWERUP_EXPIRED, { id: spent.id, reason: 'consumed' });
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

  /** Non-ranked practice retry: never advance a normal life/ledger.
   * Rebuild the same course, repeat the player-selected initial conditions,
   * then hold physics for one second. Once released the normal live-world
   * wall and canopy rules resume unchanged. */
  resetBsodGym() {
    if (!this.bsodGym || !this.sled || !this.bsod) return;
    const sled = this.sled;
    // Rebuild fixed-seed terrain, hazards, pickups and shards as well as the
    // player so repeated attempts truly rehearse the same initial situation.
    this.resetGymWorld();
    // Reset to a repeatable practice launch, not farther along a random
    // course. These are allowed initial conditions, never special movement.
    const setup = this.gymSetup || gymSetupForProfile(this.registry?.get?.(REG.PROFILE));
    const x = this.gymStartX ?? this.startX;
    const y = this.terrain.heightAt(x) - setup.launchHeightPx;
    sled.setPose(x, y, 0, setup.launchSpeedPxS, setup.launchRisePxS);
    sled.parachuteFuelMs = sled.canopyFuelFullMs;
    sled.invulnerableMs = 0;
    // Each attempt starts with the same actually-enabled bonus loadout, with
    // normal timed boosts and their duration restarting for the new attempt.
    this.shieldCharges = this.boostFx?.shieldCharges || 0;
    this.shieldSources = [];
    sled.shield = this.shieldCharges > 0;
    this.openingGraces = 0;
    this.gymAttemptStartTimeMs = this.runTimeMs;
    this.gymAttemptStartX = x;
    this.pendingCrash = null;
    this.bsodCaught = false;
    this.crashed = false;
    this.hitStopMs = 0;
    this.blinkMs = 0;
    this.clearTemporaryEffects('gym-retry');
    // Starting the NEXT attempt may reposition the wall. Once released,
    // the existing BsodPursuit.advance() strictly moves it forward; we
    // NEVER reverse the wall or change its live-run acceleration.
    placeGymWall(this.bsod, sledLeftCollisionEdge(sled), setup);
    this.bsodBluffs?.reset?.();
    this._airTricks = 0;
    this._landings = 0;
    this._steepMs = 0;
    this._lastHopMs = null;
    this._hopped = false;
    this._pushed = false;
    this.shardChainAt = -1e9;
    this.safeSamples?.splice?.(0);
    this._safeTimer = 0;
    this._contactQueue?.splice?.(0);
    this.trail?.reset?.();
    this.resetCooldownMs = 0;
    // Each retry is a NEW training attempt. Do not retain the previous
    // attempt's score/combos/shard tally in the HUD or its internal trackers.
    this.score?.reset?.();
    this.tricks?.reset?.();
    this.nearMissCount = 0;
    this.shardCount = 0;
    this.shardTotal = 0;
    this.shardChain = 0;
    this.trickCounts = {};
    this.bestCombo = 1;
    this.maxAirtimeMs = 0;
    this.lastTotal = 0;
    this.gymRetries = (this.gymRetries || 0) + 1;
    this.gymReadyMs = GYM_READY_MS;
    this.gymBeatWaitMs = 0;
    this.gymBeatSnapshot = null;
    // Reset HUD and show the beat; no frame may advance the wall until it ends.
    this.game?.events?.emit?.(EVT.GYM_ATTEMPT_RESET,
      { attempt: this.gymRetries, readyMs: GYM_READY_MS });
    if (this.score) this.emitScore();
    this.bsodState = this.bsod.state(sledLeftCollisionEdge(sled), sled.vx, this.bsodAtmosphere());
    this.publishBsodState(this.bsodState);
  }

  doCrash(c, fs, speed) {
    if (this.bsodGym) {
      // Gym is a sandbox. Every impact restores a playable attempt in-place:
      // no run record, progression, leaderboard, shards or earned achievements.
      this.resetBsodGym();
      return;
    }
    this.crashed = true;
    this.deactivateBsod();
    this.crashTimerMs = 0;
    this.emitFlow(this.score.onCrash());
    this.emitCombo('crash');
    // A third-party/music observer may fail while constructing optional
    // scratch/count-in audio. Fatal score, record, and GameOver must still
    // finish; audio is never authoritative over a life ending.
    try {
      this.game.events.emit(EVT.CRASH, {
        cause: c.cause, x: fs.x, y: fs.y, speedPxS: speed, hazardId: c.hazardId,
        negated: false, fatal: true, runId: this.runId,
      });
    } catch (e) { console.warn('Fatal crash observer failed; finalizing run anyway',e); }
    const p = this.palette;
    this.fx.shards(fs.x, fs.y, fs.vx, fs.vy, [p.cyan, p.magenta, p.lime, p.amber, p.text], 46);
    this.fx.ring(fs.x, fs.y, p.danger, 64, 500);
    this.fx.sparks(fs.x, fs.y, p.text, 24, 320);
    this.sled.vanish();
    this.shake(TUNING.shakeCrash);
    this.flashRect.setFillStyle(0xffffff, 1).setAlpha(0.55);
    if(!this.unrankedPractice)this.reportCrash(c, fs);

    // Untrusted guest practice and a takeover (#72) NEVER create a RunRecord, GhostLibrary tape, award, score submission,
    // evidence capture or RUN_END. A guest ends with RUN_ABORT->Title; a takeover keeps its tape in memory only
    // (REG.LAST_TAKEOVER_TAPE) and ends with RUN_ABORT->TakeoverEnd.
    if(this.unrankedPractice){ this._storeTakeoverTape(c.cause); return; }
    // A replay is a re-simulation of an existing run: it never saves a record, awards progress or records a tape.
    if (this.tapePlayer) return;
    // persist + hand off
    const snap = this.score.getSnapshot();
    const record = {
      version: STORAGE.saveVersion,
      id: this.runId,
      seed: this.seed,
      dailyRuleId: this.dailyRuleId,
      // W3: only recorded when non-zero; absent reads as mask 0 everywhere (the v2 hash canonicalises it
      // to 0), so old and new mask-0 runs stay comparable.
      ...(this.biomeMask ? { biomeMask: this.biomeMask } : {}),
      startedAt: this.startedAt,
      endedAt: Date.now(),
      durationMs: Math.round(this.runTimeMs),
      score: Math.max(0, Math.round(snap.total)),
      distanceM: Math.floor(snap.distanceM),
      trickPoints: Math.round(snap.trickPoints),
      tricks: { ...this.trickCounts },
      bestCombo: Math.max(this.bestCombo, snap.bestCombo || 1),
      bestFlow: Math.max(1, snap.bestFlow || 1), // stored and v2-hashed since decision 6
      maxAirtimeMs: Math.round(this.maxAirtimeMs),
      cause: 'crash',
      // W4: set only when a boost was actually active. Ranking keeps it off clean boards; since decision 6
      // the v2 ledger hash covers it, with the ids of the boosts that applied.
      ...(this.modded ? { modded: true, boosts: [...(this.appliedBoosts || [])] } : {}),
      ...(this.upgradeRun?.enabled || this.dailyMode==='draft'
        ? { upgradeRanks: { ...this.upgradeRun.ranks } } : {}),
      ...(this.dailyMode==='draft'?{
        dailyMode:'draft',draftRulesVersion:DRAFT_RULES_VERSION,draftBudget:DRAFT_BUDGET,
      }:{}),
      // Decision 2: true only for the official Daily (DAILY RUN item, today's seed). Written on every
      // record so a v2 record is never mistaken for a legacy one (Ranking.isOfficialDaily).
      dailyOfficial: this.dailyOfficial === true,
      shards: this.shardCount || 0,
      nearMisses: this.nearMissCount || 0,
      bonusPoints: Math.round(snap.bonusPoints || 0),
      // Decision 6: new records are ledger-hash v2 (every gameplay and result field).
      hashV: this.dailyMode==='draft'?DRAFT_LEDGER_HASH_V:
        this.upgradeRun?.enabled ? UPGRADE_LEDGER_HASH_V : LEDGER_HASH_V,
      ledgerHash: '',
    };
    record.ledgerHash = SaveStore.computeLedgerHash(record);
    this.registry.set(REG.LAST_RECORD, record);
    this._saveGhostTape(record);
    try {
      if (this.saveStore) {
        const pr = this.saveStore.saveRun(record);
        if (pr && pr.catch) pr.catch(() => {});
      }
    } catch (e) { /* saving must never break the loop */ }
    // Decision 3: which biomes this run entered / rode through (pure, BiomeDiscovery). Beside the record, never
    // in it, so the RunRecord and its ledger hash are unchanged. Furthest x = the ScoreManager's furthest metres.
    const biomeVisits = detectBiomeVisits({
      biomeAt: (x) => this.terrain.biomeAtX(x),
      furthestX: Math.max(fs.x, this.startX + (snap.distanceM || 0) * PIXELS_PER_METER), crashX: fs.x, pxPerMeter: PIXELS_PER_METER,
    });
    this.game.events.emit(EVT.RUN_END, { record, biomeVisits });
  }

  /**
   * Readable Chaos phase 3: name the killer and time the hop (systems/CrashReport.js) into REG.LAST_CRASH. Only a crash
   * that ends the run gets here (an absorbed one returns in resolveCrash). Registry only; reads state, changes none.
   * @param {{cause:string, hazardId?:string}} c @param {{x:number}} fs
   */
  reportCrash(c, fs) {
    const hz = this.content && this.content.hazards;
    const h = this._crashHazard;
    const ent = c.cause === 'hazard' && h && h.def && h.def.id === c.hazardId ? h : null;
    const def = ent ? ent.def : c.hazardId ? (hz && hz[c.hazardId]) || null : null;
    const arrivalMs = ent && this.teleTracker ? this.teleTracker.lastArrivalMs(ent) : null;
    this.registry.set(REG.LAST_CRASH, crashReport({
      runId: this.runId, seed: this.seed, biomeMask: this.biomeMask, cause: c.cause, def, x: fs.x, startX: this.startX,
      pxPerMeter: PIXELS_PER_METER, lastHopMs: this._lastHopMs, arrivalMs, crashMs: this.runTimeMs,
    }));
  }

  // ------------------------------------------------------------------ #72 replay takeover (UNRANKED PRACTICE / TAS)

  /** Fail closed: a takeover that does not validate NEVER becomes an ordinary run. Back to TITLE with a visible reason. */
  _refuseTakeover(verdict) {
    this.sled = null; // update() is a no-op until the next create(): nothing was built
    this.ghostRecorder = null; // no recorder, no tape driver: a refused takeover never records anything
    this.tapePlayer = null;
    this.takeover = null;
    this.unrankedPractice = true;
    this._leaving = true;
    this._postTakeoverNotice(verdict.reason, verdict.message);
    try {
      this.game.events.emit(EVT.RUN_ABORT, { runId: null, reason: 'takeover-refused', practice: true, takeover: true, why: verdict.reason });
    } catch (e) { console.warn('Takeover refusal observer failed; continuing', e); }
    try { this.scene.stop(SCENES.UI); } catch (e) { /* not launched */ }
    this.scene.start(SCENES.TITLE);
  }

  _postTakeoverNotice(reason, message) {
    try { this.registry.set(REG.TAKEOVER_NOTICE, { reason, message, at: Date.now() }); } catch (e) { /* the notice is optional */ }
  }

  /** A takeover that cannot continue (desync during the seek, prefix crash, recorder failure): visible reason, TITLE, never continue. */
  _abortTakeover(reason, detail) {
    if (this._leaving) return;
    this._leaving = true;
    const msg = reason === 'desync'
      ? `the tape desynced at tick ${detail && detail.desync ? detail.desync.tick : '?'} (${detail && detail.desync && detail.desync.via === 'trace' ? 'pose' : 'checkpoint'}); takeover cancelled`
      : reason === 'prefix-crash' ? 'the replay crashed before the chosen tick; takeover cancelled'
        : reason === 'fingerprint' ? TAKEOVER_REFUSALS.fingerprint
        : reason === 'error' ? `takeover failed (${String((detail && detail.message) || detail || 'error').slice(0, 80)})` : 'takeover could not start';
    if (this.takeover) { this.takeover.phase = 'aborted'; this.takeover.abort = { reason, detail: detail || null }; }
    this._postTakeoverNotice(reason, msg);
    this.ghostRecorder = null;
    this.tapePlayer = null;
    try {
      this.game.events.emit(EVT.RUN_ABORT, { runId: this.runId, reason: 'takeover-aborted', practice: true, takeover: true, why: reason });
    } catch (e) { console.warn('Takeover abort observer failed; continuing', e); }
    this.scene.stop(SCENES.UI);
    this.scene.start(SCENES.TITLE);
  }

  /** SEEKING (bounded re-simulation of ticks 1..N) and READY (frozen at N, waiting for the player). */
  _updateTakeoverPrelude() {
    try { this._takeoverPreludeStep(); } catch (e) {
      // An exception anywhere in the seek / READY path must end at the title with a reason, never a frozen black screen.
      console.warn('Takeover failed; returning to the title', e);
      this._abortTakeover('error', e);
    }
  }

  _takeoverPreludeStep() {
    const t = this.takeover;
    if (!t || this._leaving) return;
    if (t.phase === 'seeking') {
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      // #67: a postcard has no checkpoints / trace to verify against; its authority is the fingerprint compared in _finishSeek.
      const fpOnly = t.descriptor.coverage === COVERAGE_FINGERPRINT_ONLY;
      const r = this.seekTo(t.targetTick, { maxTicks: SEEK_MAX_TICKS_PER_FRAME, budgetMs: SEEK_BUDGET_MS, ...(fpOnly ? { verify: false } : {}) });
      t.seekMs += (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      t.seekTicks += r.steps;
      t.seekFrames++;
      if (r.desync) { this._abortTakeover('desync', r); return; }
      if (r.crashed) { this._abortTakeover('prefix-crash', r); return; }
      if (r.done) { this._finishSeek(); return; }
      this.game.events.emit(EVT.TAKEOVER_STATE, { phase: 'seeking', tick: r.tick, target: t.targetTick, pct: Math.floor(100 * r.tick / t.targetTick) });
      return;
    }
    if (t.phase !== 'ready') return;
    // READY: the sim is paused at tick N and the frame is drawn. The key that ends it is consumed here.
    const polled = this.normalizePad(this.inputRouter ? this.inputRouter.poll() : null);
    // #67: while the postcard view is open over READY (t.modal), the READY / pause keys belong to it, not to the run.
    if (polled.pressed.pause && !t.modal) { this.pauseRun(); return; }
    this.renderFrame(0);
    if (!t.modal && (polled.pressed.hop || polled.pressed.confirm)) this._takeoverGo();
  }

  /**
   * Everything the player-facing HUD shows, read from the AUTHORITATIVE sim state (#72): active power-up / ward / glide /
   * stabilize / magnet / shield chips with their remaining time, timed hazard effects, terrain zones, combo, flow, score,
   * distance and speed. UIScene is event driven and heard none of the muted seek, so it is rebuilt from this at tick N.
   * Pure read: changes nothing.
   */
  hudSnapshot() {
    const power = [];
    const add = (id, remainingMs, charges = 0) => {
      if (!id) return;
      const eff = (this.content && this.content.powerups && this.content.powerups[id] && this.content.powerups[id].effect) || {};
      const total = Math.max(remainingMs, Number.isFinite(eff.durationMs) ? eff.durationMs : 0);
      power.push({ id, remainingMs: Math.round(remainingMs), totalMs: Math.round(total), charges });
    };
    if (this.boostMs > 0) add(this.boostId || 'packetBurst', this.boostMs);
    if (this.slowmoMs > 0) add('clockPulse', this.slowmoMs);
    for (const id of new Set(this.shieldSources || [])) {
      const c = shieldChargesFor(this.shieldSources, id, this.shieldCharges);
      if (c > 0) add(id, 0, c);
    }
    for (const w of (this.wards && this.wards.wards) || []) add(w.id, w.msLeft);
    if (this.glideMs > 0) add(this.glideId, this.glideMs);
    if (this.stabilizeMs > 0) add(this.stabilizeId, this.stabilizeMs);
    if (this.magnetMs > 0) add(this.magnetId, this.magnetMs);
    const effects = [];
    if (this.slowMs > 0) effects.push({ effect: 'slow', remainingMs: Math.round(this.slowMs) });
    if (this.scrambleMs > 0) effects.push({ effect: 'scramble', remainingMs: Math.round(this.scrambleMs) });
    if (this.blindMs > 0) effects.push({ effect: 'blind', remainingMs: Math.round(this.blindMs) });
    const snap = this.score.getSnapshot();
    return {
      power, effects, zones: [...(this.activeZones ? this.activeZones.values() : [])].map((z) => z.modId),
      score: this.score.getTotal(), meters: Math.floor(this.score.distanceM), speedPxS: this.sled.speed,
      multiplier: snap.multiplier, tricks: snap.comboTricks, pendingPoints: snap.pendingPoints,
      flow: this.score.getFlow(), flowFrac: this.score.getFlowTimeoutFraction(),
    };
  }

  /** Seek reached tick N: drop the presentation debris of the re-simulation, draw the frame, wait for the player. */
  _finishSeek() {
    const t = this.takeover;
    // #67: the postcard's trust check. The combined fingerprint of the state this build just re-simulated at tick N must equal
    // the one the sender's build captured; otherwise this prefix does not reproduce here and the takeover is REFUSED.
    if (t.descriptor.coverage === COVERAGE_FINGERPRINT_ONLY) {
      let got = null;
      try { got = liveFingerprint(this); } catch (e) { got = null; }
      if (got !== t.descriptor.expectedFingerprint) { this._abortTakeover('fingerprint', { want: t.descriptor.expectedFingerprint, got, tick: this.simClock.tick }); return; }
    }
    t.phase = 'ready';
    try {
      // The seek made fx particles / shake / flash that were never updated or drawn: they belong to no frame the player saw.
      if (this.fx) { for (const it of this.fx.items || []) it.on = false; this.fx.active = 0; this.fx.gfx?.clear?.(); }
      this.flashRect?.setAlpha?.(0);
    } catch (e) { /* presentation only */ }
    // No frame is drawn here: the first READY update draws it (renderFrame(0)), so the state reached at N is left untouched.
    // Keys pressed while the seek ran must not auto-confirm READY: only a fresh press after this point counts.
    try { if (this.inputRouter) this.inputRouter.poll(); } catch (e) { /* ignore */ }
    // The seek ran muted: bring EVERY HUD element to the state at tick N (UIScene only: no SFX, no popups).
    this.emitScore();
    this.game.events.emit(EVT.DISTANCE_CHANGED, { meters: Math.floor(this.score.distanceM) });
    try { this.game.events.emit(EVT.HUD_RESYNC, this.hudSnapshot()); } catch (e) { console.warn('HUD resync failed; continuing', e); }
    if (this.bsodState) this.publishBsodState(this.bsodState);
    this.game.events.emit(EVT.TAKEOVER_STATE, { phase: 'ready', tick: this.simClock.tick, target: t.targetTick, pct: 100 });
  }

  /**
   * Handoff at tick N. Drop the tape driver, zero the sub-tick clock and every carried edge, drain the input router so the
   * key that ended READY (and anything pressed while seeking) is consumed and can never become a hop / trick edge on tick
   * N + 1, and start recording the independent live suffix.
   */
  _takeoverGo() {
    const t = this.takeover;
    if (!t || t.phase !== 'ready') return;
    try {
      this.ghostRecorder = createTakeoverRecorder(t.descriptor);
    } catch (e) { console.warn('Takeover recorder failed', e); this._abortTakeover('recorder', null); return; }
    this.tapePlayer = null;
    this.simClock.accMs = 0;
    this.simClock._edges = null;
    this.simClock._timeline = null;
    try { if (this.inputRouter) this.inputRouter.poll(); } catch (e) { /* ignore */ }
    t.phase = 'live';
    t.liveFromTick = this.simClock.tick;
    // #67: a postcard is a bounded challenge: survive until N + windowTicks, or crash inside it. Ordinary takeovers have no window.
    const pw = t.descriptor.postcard;
    if (pw && Number.isSafeInteger(pw.windowTicks)) { t.windowTicks = pw.windowTicks; t.windowEndTick = t.targetTick + pw.windowTicks; }
    this.game.events.emit(EVT.TAKEOVER_STATE, { phase: 'live', tick: this.simClock.tick, target: t.targetTick, pct: 100 });
  }

  /** Keep the live suffix tape in MEMORY ONLY (REG.LAST_TAKEOVER_TAPE). Never GhostLibrary, IDB, localStorage or evidence. */
  _storeTakeoverTape(cause) {
    const rec = this.ghostRecorder;
    this.ghostRecorder = null;
    if (!this.takeover) return;
    this.takeover.cause = cause || 'crash';
    this._recordPostcardOutcome(this.takeover.cause);
    if (!rec) return;
    try {
      const snap = this.score.getSnapshot();
      const tape = rec.finish({ runId: `${this.runId}:takeover`, distanceM: Math.floor(snap.distanceM), score: Math.max(0, Math.round(snap.total)), cause: this.takeover.cause });
      this.takeover.endTick = tape.endTick;
      this.registry.set(REG.LAST_TAKEOVER_TAPE, tape);
    } catch (e) { /* the practice tape is a convenience; it must never break the end of a run */ }
  }

  /** #67: how a postcard attempt ended. `survived` = reached N + window; a crash / BSOD catch inside the window = `crashed` at +ticks. */
  _recordPostcardOutcome(cause) {
    const t = this.takeover;
    if (!t || !t.windowEndTick || t.outcome) return;
    const base = { windowTicks: t.windowTicks, atTick: this.simClock.tick };
    if (cause === 'survived') t.outcome = { result: 'survived', crashOffsetTicks: null, ...base };
    else if (cause === 'quit') t.outcome = { result: 'quit', crashOffsetTicks: null, ...base };
    else t.outcome = { result: 'crashed', crashOffsetTicks: Math.max(1, this.simClock.tick - t.targetTick), cause, ...base };
  }

  /** #67: reached the last tick of the window alive. Same exit as a crash (tape in memory, RUN_ABORT, the end screen); never GAME_OVER. */
  _endPostcardWindow() {
    if (this._leaving || !this.takeover) return;
    this._leaving = true;
    this._storeTakeoverTape('survived');
    this._leaveTakeover('survived');
  }

  /** End a takeover that is still going (PauseScene QUIT): keep the tape, then leave like a crash would. */
  endTakeover(cause = 'quit') {
    if (!this.takeover || this._leaving) return false;
    if (this.takeover.phase === 'live') this._storeTakeoverTape(cause);
    this._leaving = true;
    this._leaveTakeover(cause);
    return true;
  }

  /** RUN_ABORT {takeover-ended, practice, takeover}, then the small end screen: retry from the same tick, or back. Never GAME_OVER. */
  _leaveTakeover(cause) {
    const t = this.takeover;
    try {
      this.game.events.emit(EVT.RUN_ABORT, { runId: this.runId, reason: 'takeover-ended', practice: true, takeover: true, cause });
    } catch (e) { console.warn('Takeover end observer failed; continuing', e); }
    try { this.scene.stop(SCENES.UI); } catch (e) { /* ignore */ }
    this.scene.start(SCENES.TAKEOVER_END, { descriptor: t.descriptor, cause, endTick: t.endTick ?? null, liveFromTick: t.liveFromTick ?? t.targetTick, outcome: t.outcome || null });
  }

  updateCrashed(dt) {
    this.crashTimerMs += dt;
    this.renderFrame(dt);
    if (this.crashTimerMs >= CRASH_TO_GAMEOVER_MS && !this._leaving) {
      this._leaving = true;
      if (this.takeover) { this._leaveTakeover(this.takeover.cause || 'crash'); return; }
      if(this.guestPractice){
        this.game.events.emit(EVT.RUN_ABORT,{runId:this.runId,reason:'guest-practice-ended',practice:true});
        this.scene.stop(SCENES.UI);
        this.scene.start(SCENES.TITLE);
        return;
      }
      this.scene.stop(SCENES.UI);
      this.scene.start(SCENES.GAME_OVER);
    }
  }

  // ------------------------------------------------------------------ pause

  pauseRun() {
    // A held Escape/input edge must not dispatch two scratch starts or launch
    // two PauseScenes. This is only the intentional player pause path; death
    // and automatic scene transitions never route through this method.
    if (this._manualPausePending || this.scene?.isPaused?.(SCENES.RUN)) return;
    this._manualPausePending = true;
    const pauseToken = `${this.runId}:${++this._manualPauseSeq}`;
    const manual = { runTimeMs: this.runTimeMs, runId: this.runId,
      reason: 'manual', pauseToken, gym: this.bsodGym === true, practice: this.guestPractice === true,
      ...(this.takeover ? { takeover: true } : {}) };
    // The transition must complete even if an audio/third-party observer
    // throws while constructing its scratch. Nothing may hold gameplay hostage.
    try { this.game.events.emit(EVT.GAME_PAUSE, manual); }
    catch (e) { console.warn('Manual pause observer failed; pausing anyway', e); }
    this.scene.pause();
    this.scene.launch(SCENES.PAUSE, manual);
  }

  // ------------------------------------------------------------------ settings

  onSettingsChanged(payload) {
    if (payload && payload.settings) this.settings = payload.settings;
    // A palette toggle (Pause > Settings) is presentation: repaint only, never rebuild colliders (issue #140).
    if (payload && payload.key === 'palette' && this.sled) this.refreshPalette();
  }

  /**
   * Resolve the equipped cosmetics into colours. Reads the profile, then hands off to the pure resolver so
   * the colourblind safety rule lives in one tested place rather than in the draw loop.
   * @returns {{rider:string, glow:string, trail:string[], theme:string}|null}
   */
  _resolveLook() {
    const reg = this.registry;
    const profile = reg.get(REG.PROFILE) || null;
    const settings = reg.get(REG.SETTINGS) || {};
    const hex = getPaletteCss(this.game, this._biomeDefById(this._lookBiomeId()));
    return resolveCosmetics(profile, this.palette, hex, {
      colorblind: settings.palette === 'colorblind',
    });
  }

  /**
   * Repaint the world in the current palette (+ the active sector's biome tint). Graphics only: terrain chunks are
   * repainted with TerrainMesh.redrawChunk and their colliders are never touched (issue #140). Used by the palette
   * setting AND on entering / leaving a biome sector. A biome's gameplay (zone mods, hazards, pickups) is chunk data
   * read by the sim (getZoneDefs, takeChunk); collider material is fixed (TerrainMesh._takeBody), so rebuilding the
   * colliders here only reshuffled body ids/order and dropped contact warm-start state. Owner-approved physics change
   * (SIM_REVISION 2).
   */
  refreshPalette() {
    // W3: the active sector's biome tints the world. Passing the def (not just an id) keeps this a
    // pure function of current state, so a palette toggle mid-biome repaints to the right place.
    const biomeDef = this._biomeDefById(this._lookBiomeId());
    this.palette = getPalette(this.game, biomeDef);
    // W3: the biome's `background` motif, and back to the base backdrop when the sector has no biome.
    // setMotif(null) is the exit case: a motif must not outlive the sector that owns it.
    if (this.bg) this.bg.setMotif(biomeDef && biomeDef.background ? biomeDef.background : null);
    this.cameras.main.setBackgroundColor(this.palette.bg);
    if (this.blindRect) this.blindRect.setFillStyle(this.palette.bg, 1); // B0 blind overlay follows the palette
    this.sled.palette = this.palette;
    // A palette toggle can turn colourblind ON, which refuses every cosmetic: the sled and trail have to
    // be re-resolved, not just repainted, or a paid hue would survive the accessibility switch.
    this.look = this._resolveLook();
    if (this.sled) this.sled.look = this.look;
    if (this.trail) { this.trail.setPalette(this.palette); this.trail.setStops(this.look && this.look.trail); }
    this.bg.setPalette(this.palette);
    if (this.biomeFx) {
      this.biomeFx.setPalettes(this.palette, getPalette(this.game, null));
      this.biomeFx.setLook(biomeDef ? biomeDef.id : null);
    }
    this.fx.palette = this.palette;
    if (this.airTelegraph) this.airTelegraph.setPalette(this.palette);
    if (this.groundTelegraph) this.groundTelegraph.setPalette(this.palette);
    this.mesh.setPalette(this.palette);
    for (const chunk of this.terrain.getActiveChunks()) {
      if (!this.mesh.chunks.has(chunk.index)) continue;
      this.mesh.redrawChunk(chunk); // graphics only; colliders stay
      const hz = this.hazards.get(chunk.index);
      if (hz) hz.forEach((h) => { h.palette = this.palette; h.color = hazardColor(h.def, this.palette); });
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
    if (this.biomeFx) this.biomeFx.applyZoomCompensation(k, px, py);
    if (this.flashRect) this.flashRect.setScale(k).setPosition(px, py);
    if (this.blindRect) this.blindRect.setScale(k).setPosition(px, py);
  }

  updateCamera(dt) {
    const cam = this.cameras.main;
    const s = this.sled;
    // Look ahead in the direction of travel; Y keeps ~1/3 of the screen above the rider and peeks lower when falling.
    const look = clamp(s.vx * TUNING.lookAheadSec, -TUNING.lookAheadMaxPx * 0.5, TUNING.lookAheadMaxPx)
      + LOOK_FAR_EXTRA_PX * smooth01((s.vx - 600) / 400) + LOOK_ULTRA_EXTRA_PX * smooth01((s.vx - 850) / 450)
      - 225 * smooth01((this.bsodState && this.bsodState.proximity01) || 0);
    const tx = s.x + look - GAME_WIDTH * 0.38;
    const ty = s.y - GAME_HEIGHT / 3 - clamp(s.vy * 0.05, -26, 34);
    const kx = 1 - pmath.exp((-TUNING.cameraLerpX * dt) / 1000);
    // follow faster the quicker the sled moves vertically (bounce pads / big drops must never push it off screen)
    const ky = 1 - pmath.exp((-(TUNING.cameraLerpY + clamp(Math.abs(s.vy) / 90, 0, 7)) * dt) / 1000);
    this._camX += (tx - this._camX) * kx;
    this._camY += (ty - this._camY) * ky;
    // hard guarantee: keep the rider inside the visible band
    const margin = 34;
    if (s.y - this._camY < margin) this._camY = s.y - margin;
    else if (s.y - this._camY > GAME_HEIGHT - margin) this._camY = s.y - (GAME_HEIGHT - margin);
    let ox = 0;
    let oy = 0;
    if (this.takeover && this.takeover.phase === 'ready') {
      // #72: the frozen READY frame neither jitters nor decays nor consumes the visual camera RNG, so the state the seek
      // reached at tick N is exactly the state of an uninterrupted replay at N, however long the player waits.
    } else if (this.shakeAmp > 0.15) {
      // per-pixel RNG jitter, decaying
      ox = Math.round(((this.runRandom?.visualCamera || cosmeticRandom('visual/camera')).next() * 2 - 1) * this.shakeAmp);
      oy = Math.round(((this.runRandom?.visualCamera || cosmeticRandom('visual/camera')).next() * 2 - 1) * this.shakeAmp);
      this.shakeAmp *= pmath.exp(-dt / 140);
    } else {
      this.shakeAmp = 0;
    }
    // ... and horizontally: the extra look-ahead must not push the rider off the left edge (the zoom below keeps the rider at
    // screen x = s.x - _camX whatever the zoom, so this is a plain screen-px bound)
    if (s.x - this._camX < RIDER_MIN_SCREEN_X) this._camX = s.x - RIDER_MIN_SCREEN_X;
    // The BSOD camera pullback must NEVER drive the rider off the right edge or hide all terrain ahead.
    const riderMaxScreenX = GAME_WIDTH - 72;
    if (s.x - this._camX > riderMaxScreenX) this._camX = s.x - riderMaxScreenX;
    // never show far past the start edge of the world
    if (this._camX < -30) this._camX = -30;

    // speed zoom: 1.0 at rest -> zoomMin at zoomSpeedHi, smoothed, with a brief extra pull-out on boosts. Stepped to 0.005
    // so the vector terrain does not shimmer from continuous sub-pixel scale changes.
    const zt = speedZoom(s.speed);
    this._zoom += (zt - this._zoom) * (1 - pmath.exp((-TUNING.zoomLerp * dt) / 1000));
    this._zoomKick = Math.max(0, this._zoomKick - dt / 260 * 0.05);
    const crashZoom = this.crashed ? crashBeat(this.crashTimerMs, TUNING.hitStopCrashMs).zoomMul : 1; // crash beat zoom-in
    const z = Math.round(clamp((this._zoom - this._zoomKick) * crashZoom, ZOOM_FLOOR, 1.2) * 200) / 200;
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
