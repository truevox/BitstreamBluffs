/**
 * #119: importable, non-global RunScene state engine extracted from the proven
 * Heavy-Mode V3 experiment. NO state capture is installed automatically.
 *
 * This is a trusted internal runtime *mechanism*, not a serialized-public
 * schema, a restorable slot admission, or proof that a saved game is ranked.
 * The caller MUST require an exact registered layout, a complete tick-zero
 * GhostRecorder prefix and an independently validated disposable fresh scene.
 * No player UI or trusted server path may consume this module until those
 * separate gates pass. Original experiment remains a separate reference.
 *
 * Identical state transforms to tools/savestate-experiment/game-state-kit.js;
 * only the module boundary/globals and strict mode are changed. Intentional
 * source drift requires a new equivalence proof.
 */
import {createMatterSnapshotKit} from '../../../tools/savestate-experiment/matter-snapshot-kit.js';
import * as recorderKit from '../../../tools/savestate-experiment/recorder-snapshot-kit.js';
import {captureRecorderState, restoreRecorderState} from './recorderState.js';
import {captureRunRandomState, restoreRunRandomState, captureSimClockState, restoreSimClockState} from './primitiveState.js';
import {runRandomStreams} from '../RunRandom.js';
import {SimClock} from '../SimClock.js';
import {canonicalBytes, parseCanonical} from '../replay/canonicalJson.js';
import {digestOf} from '../replay/canonicalSha256.js';
import {captureCausalState} from '../replay/fingerprintCapture.js';
import {fingerprintState} from '../replay/fingerprint.js';
import {CURRENT_RULESET_ID} from '../replay/currentRulesetId.js';
import {SIM_REVISION} from '../replay/ruleset.js';
// Stable simulator entity identities must survive production JS class-name
// minification. Imported constructors are trusted local types, not string
// tags supplied by a saved file or by user content.
import {Hazard} from '../../entities/Hazard.js';
import {PowerUp} from '../../entities/PowerUp.js';
import {Sled} from '../../entities/Sled.js';
import {ShardField} from '../../entities/Shard.js';

/** Explicit dependency injection: no mutation of window/globalThis/Phaser. */
export function createDiagnosticRunSceneRestoreKit(Phaser) {
  return createInternalKit(Phaser,recorderKit);
}

function createInternalKit(Phaser,recorderAdapter) {
  if (!Phaser?.Physics?.Matter?.Matter) throw Error('RunScene restore: missing Phaser Matter engine');
  const injected = Object.freeze({
    Phaser,
    __ssMatterKit: createMatterSnapshotKit(Phaser.Physics.Matter.Matter),
    __ssRecorderKit: recorderAdapter,
    __ssCanonical: true,
    Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array,
    Int8Array, Int16Array, Int32Array,
  });
  return installRunSceneStateKit(injected);
}

/**
 * Full-snapshot-only operational seam. This is still an INTERNAL diagnostic
 * format until a registered layout + exact-build serialized admission exists.
 * No save/restore UI is wired; the caller must dispose a failed destination.
 * Excludes ablation/partial-restore mechanisms from the production interface.
 */
export function createRunSceneRestoreKit(Phaser) {
  const kit = createDiagnosticRunSceneRestoreKit(Phaser);
  return strictWorldKit(kit);
}

const normal = run => !!run && !run.unrankedPractice && !run.bsodGym &&
    !run.guestPractice && !run.coachSim && !run.takeover && !run.crashed &&
    !run._leaving && !!run.ghostRecorder && !run.tapePlayer && !run._replayTape;
function strictWorldKit(kit) {
  const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
  // Reject truncated or inconsistent internal causal sections before any
  // disposable-world mutation. This is NOT a stored-file trust boundary.
  const complete = snap => {
    if (!record(snap?.game) || !record(snap?.classes) ||
        !Array.isArray(snap.classes.SIM) || !Array.isArray(snap.classes.unclassified) ||
        snap.classes.unclassified.length || !record(snap.config) ||
        !record(snap.matter) || !record(snap.camera) || !record(snap.telegraph) ||
        !Array.isArray(snap.meshOrder) || !Array.isArray(snap.ghost) ||
        snap.ghost.length !== 8 || !Array.isArray(snap.pool) || snap.pool.length) return false;
    const declared = snap.classes.SIM;
    const actual = Object.keys(snap.game);
    if (declared.length !== actual.length || new Set(declared).size !== declared.length ||
        !declared.every(k => typeof k === 'string' &&
          kit.CLASS[k] === 'SIM' && Object.prototype.hasOwnProperty.call(snap.game,k))) return false;
    return ['simClock','runRandom','terrain','sled','score'].every(k =>
      Object.prototype.hasOwnProperty.call(snap.game,k));
  };
  return Object.freeze({
    capture(run) {
      if (!normal(run) || !Number.isSafeInteger(run.simClock?.tick) || run.simClock.tick < 0)
        throw Error('production snapshot refused: only complete normal live runs');
      const snap=kit.capture(run,{withConfig:true,withRecorder:true});
      if (snap.kind!=='bb-runscene-diagnostic-snapshot'||snap.diagnosticOnly!==true||
          !Array.isArray(snap.audit)||snap.audit.length||!snap.recorder||!complete(snap))
        throw Error('production snapshot refused: incomplete causal/recorder capture');
      return snap;
    },
    restore(run,snap) {
      if (!normal(run) || run.mesh?._bodyPool || run.simClock?.tick!==0 || run.ghostRecorder.lastTick!==0 ||
          run.ghostRecorder.inputs.length || !snap || typeof snap!=='object' ||
          snap.kind!=='bb-runscene-diagnostic-snapshot'||snap.diagnosticOnly!==true||
          !Array.isArray(snap.audit)||snap.audit.length || !snap.recorder || !complete(snap))
        throw Error('production restore refused: only intact complete snapshot into fresh normal run');
      // Always full Matter/contact reconstruction + strict recorder preflight.
      // Never accept a user-controllable restore level, skip list or relaxed QA.
      return kit.restore(run,snap,'full',{strict:true,skip:[]});
    },
    digests: kit.digests,
  });
}

// Defense in depth for INTERNAL diagnostic data only. This is not a
// registered per-class schema or an authorization to accept external bytes.
const unsafeKey=k=>k==='__proto__'||k==='prototype'||k==='constructor';
function assertInternalGraph(root){
  const pending=[[root,0]],seen=new Set();
  let budget=1000000;
  while(pending.length){
    const [v,depth]=pending.pop();
    if(--budget<0||depth>80)throw Error('native restore: graph limit');
    if(v===null||v===undefined||typeof v==='boolean'||typeof v==='string')continue;
    if(typeof v==='number'&&Number.isFinite(v))continue;
    if(!v||typeof v!=='object'||seen.has(v))throw Error('native restore: invalid graph value/alias');
    seen.add(v);
    const arr=Array.isArray(v),proto=Object.getPrototypeOf(v);
    if(arr?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)
      throw Error('native restore: invalid graph prototype');
    const props=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(props);
    if(arr&&keys.length!==v.length+1)throw Error('native restore: sparse/extra graph array');
    for(const k of keys){
      if(arr&&k==='length')continue;
      const d=props[k];
      if(typeof k!=='string'||unsafeKey(k)||!Object.hasOwn(d,'value')||!d.enumerable||
         (arr&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.length)))
        throw Error('native restore: unsafe graph field');
      pending.push([d.value,depth+1]);
    }
  }
}
function exactKeys(obj,keys){
  return !!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
    Object.keys(obj).length===keys.length&&keys.every(k=>Object.hasOwn(obj,k));
}

/** Native component integration for a disposable internal fresh-world candidate.
 * The reflective scene/Matter graph is STILL diagnostic and may only originate
 * from trusted application capture. Do not connect this to bytes from storage
 * or an untrusted file. A production per-class schema and transaction owner
 * must replace that graph admission before a player UI may call it.
 */
export function createNativeRunSceneRestoreKit(Phaser) {
  const context=(run,runId=run.runId,tick=run.simClock.tick)=>({
    runId,tick,buildId:run.registry.get('currentBuildId'),
    rulesetId:CURRENT_RULESET_ID,simRevision:SIM_REVISION,
  });
  const exactDigest=(value)=>digestOf(value);
  const fp=run=>fingerprintState(captureCausalState(run));
  const nativeRecorder={
    captureRecorderPrefix(run){
      return parseCanonical(captureRecorderState(run.ghostRecorder,context(run)));
    },
    prepareRecorderPrefix(run,section,tick){
      if(!section||typeof section.runId!=='string'||section.tick!==tick)
        throw Error('native restore: recorder boundary mismatch');
      const recorder=restoreRecorderState(canonicalBytes(section),run.ghostRecorder,context(run,section.runId,tick));
      return {recorder,runId:section.runId,startedAt:recorder.header.startedAt};
    },
    applyRecorderPrefix(run,prepared){
      run.ghostRecorder=prepared.recorder;
      run.runId=prepared.runId;
      run.startedAt=prepared.startedAt;
    },
  };
  const internal=createInternalKit(Phaser,nativeRecorder);
  const world=strictWorldKit(internal);
  const boundary=run=>{
    if(!normal(run)||run.dailyOfficial||run.dailyMode==='draft'||run.guestPracticeTape!=null||
       !run.registry||run.ghostRecorder.lastTick!==run.simClock?.tick)
      throw Error('native restore: only complete normal tick boundary');
  };
  return Object.freeze({
    projectConfig(run){return internal.projectConfig(run);},
    // INTERNAL staging helper: reconstruct the exact leading graph identity
    // sequence from already validated detached native sections, not wire tags.
    // The caller must bind the terrain recipe against trusted fresh options.
    projectEarly(run,clockState,rngState,terrain,queue,collectedKeys){
      boundary(run);
      const clock=new SimClock(run.simClock.tickMs,run.simClock.maxTicks);
      const rng=runRandomStreams(run.seed);
      restoreSimClockState(clock,clockState);
      restoreRunRandomState(rng,rngState);
      return internal.projectEarly(run,clock,rng,terrain,queue,new Set(collectedKeys));
    },
    capture(run){
      boundary(run);
      const ctx=context(run);
      const clock=captureSimClockState(run.simClock);
      const rng=captureRunRandomState(run.runRandom);
      const snap={kind:'bb-internal-native-world-candidate',version:1,ctx,clock,rng,
        fingerprint:fp(run),world:world.capture(run)};
      assertInternalGraph(snap);
      return snap;
    },
    restore(run,snap){
      boundary(run);
      assertInternalGraph(snap);
      if(run.simClock.tick!==0||!exactKeys(snap,['kind','version','ctx','clock','rng','fingerprint','world'])||snap.kind!=='bb-internal-native-world-candidate'||snap.version!==1)
        throw Error('native restore: fresh candidate required');
      const ctx=context(run,snap.ctx?.runId,snap.ctx?.tick);
      if(exactDigest(ctx)!==exactDigest(snap.ctx)||!Number.isSafeInteger(ctx.tick)||ctx.tick<0||
         snap.world?.ghost?.[0]!==ctx.tick||snap.clock?.tick!==ctx.tick||
         snap.world?.recorder?.runId!==ctx.runId)
        throw Error('native restore: identity/tick mismatch');
      // Validate through the shipped native class adapters into detached
      // fresh objects BEFORE any scene mutation. The graph restore must
      // preserve its native references, so verify their state rather than
      // replacing the objects and breaking aliases.
      const clock=new SimClock(run.simClock.tickMs,run.simClock.maxTicks);
      const rng=runRandomStreams(run.seed);
      restoreSimClockState(clock,snap.clock);
      restoreRunRandomState(rng,snap.rng);
      const wantClock=exactDigest(captureSimClockState(clock));
      const wantRng=exactDigest(captureRunRandomState(rng));
      const result=world.restore(run,snap.world);
      if(run.runId!==ctx.runId||run.simClock.tick!==ctx.tick||
         exactDigest(captureSimClockState(run.simClock))!==wantClock||
         exactDigest(captureRunRandomState(run.runRandom))!==wantRng||
         exactDigest(fp(run))!==exactDigest(snap.fingerprint))
        throw Error('native restore: reconstructed world mismatch; discard candidate');
      const got=parseCanonical(captureRecorderState(run.ghostRecorder,ctx));
      if(exactDigest(got)!==exactDigest(snap.world.recorder))
        throw Error('native restore: reconstructed recorder mismatch; discard candidate');
      return result;
    },
  });
}

/**
 * Originally tested in the #119 Heavy Mode feasibility harness; this module
 * retains that source-equivalent mechanism with explicit imports and no
 * global install. NOT a trusted serialized-admission or player Save/Resume UI.
 * Digests remain diagnostic and non-authoritative (#152 owns canonical hashes).
 *
 * The RunScene field table below is the machine-checked half of the state inventory in
 * docs/determinism/savestate-feasibility.md: every own property of RunScene must be classified, or capture
 * throws. That is the "incomplete snapshot fails visibly" property applied to game state.
 *
 * Receives Matter and recorder APIs through a private injected object, never runtime globals.
 */
function installRunSceneStateKit(global) {
  const Matter = global.Phaser.Physics.Matter.Matter;
  const P = global.Phaser;

  // ------------------------------------------------------------------ RunScene field classification
  // SIM: causal simulation state, captured and restored. ORDER MATTERS: decode runs in this order, and the world
  // rebuild (chunks -> colliders, hazards, pickups) happens right after 'terrain' and 'collectedPowerups'.
  const SIM = ['simClock', 'runRandom', 'terrain', 'collectedPowerups', '_chunkQueue', 'hazards', 'powerups', 'shardField',
    'sled', 'runTimeMs', '_hudMs', 'crashed', 'crashTimerMs', 'pendingCrash', '_crashHazard', 'trickCounts', 'bestCombo',
    'maxAirtimeMs', 'lastTotal', 'slowMs', 'slowFactor', 'scrambleMs', 'boostMs', 'boostFactor', 'boostId', 'slowmoMs',
    'slowmoScale', 'shieldCharges', 'shieldSources', 'openingGraces', 'activeZones', 'safeSamples', '_safeTimer',
    'resetCooldownMs', '_contactQueue', 'hitStopMs', 'blinkMs', '_airTricks', 'shardChain', 'shardChainAt', 'shardTotal',
    'shardCount', 'nearMissCount', '_steepMs', '_landings', 'newBestDone', 'tutShown', 'tutTimers', 'tutDone', 'tuckShows',
    'hints', 'score', 'tricks', 'glitch', 'bsod', 'bsodState', 'bsodCaught', 'bsodBluffs', 'kodiaks', 'kodiakNext',
    'currentPhys', 'wards', 'glideMs', 'glideMul', 'glideId', 'stabilizeMs', 'stabilizeDeg', 'stabilizeBounce',
    'stabilizeId', 'blindMs', 'blindTotalMs', 'blindVis', 'magnetMs', 'magnetEff', 'magnetId', '_hopped', '_pushed',
    '_lastHopMs', '_despawn', '_biomeId', 'gymAttemptStartTimeMs', 'gymAttemptStartX', 'gymReadyMs',
    'gymBeatWaitMs', 'gymBeatSnapshot', '_manualPausePending', '_manualPauseSeq', '_leaving', '_teleMarks',
    'respawnGraceMs', 'hashedBackupUsed', '_lastLanding', '_flow', 'kodiakShoveCdMs', 'lastBoost'];
  // PRESENTATION_READ_BY_SIM: presentation state the tick reads today (issue #155: updateGroundTelegraph reads
  // this._view.right, built from the camera in renderFrame). Required for exact equivalence until #155 lands.
  const PRESENTATION_READ_BY_SIM = ['_view', '_camX', '_camY', '_zoom', '_zoomKick', 'shakeAmp', '_landingShake'];
  // SERIALIZED_BY_HOOK: TelegraphTracker is plain data keyed by stable hazard ids (Hazard.hid) since #119 Phase 2, with its
  // own snapshot()/restore() (RunScene.snapshotTelegraph/restoreTelegraph). It drives audio cues and h.teleAtMs.
  // Ablation 'telegraph' skips it (the pre-Phase-2 behavior: a fresh tracker re-warns and re-stamps teleAtMs).
  const SERIALIZED_BY_HOOK = ['teleTracker'];
  // CONFIG: rebuilt deterministically at create() from seed + registry + profile; verified equal, never restored.
  const CONFIG = ['seed', 'biomeMask', 'dailyOfficial', 'dailyRuleId', 'dailyMode', 'dailyMods', 'bsodGym', 'loadout',
    'unlockedBoosts', 'upgradeRun', 'upgradeFx', 'magnetsDrop', 'kodiaksOn', 'kodiakPackMode', 'gymSetup', 'startX',
    'gymStartX', 'boostFx', 'modded', 'appliedBoosts', 'opening', 'content', 'settings', 'bestM', 'tuner',
    // #69: one-shot registry guest mode cannot be reconstructed from seed alone.
    // We explicitly REFUSE guest practice capture/restore below; only false is admitted.
    '_replayTape', 'guestPractice'];
  // METADATA: wall-clock or recording state; not simulation (but a resumed run's ghost tape needs it, see doc).
  // #72/#69: guestPractice, guestPracticeTape, takeover and unrankedPractice select the unranked write policy; _seeking only
  // gates presentation during a takeover re-simulation. None is simulation state.
  const METADATA = ['runId', 'startedAt', 'ghostRecorder', 'tapePlayer', '_ghostToken', '_bsodObserverErrorLogged',
    'takeover', 'unrankedPractice', '_seeking',
    // #66: coachSim marks a hidden candidate re-simulation; crashInfo is the cause the coach reads back after a crash
    'coachSim', 'crashInfo'];
  // PRESENTATION: render-only objects and per-frame visual state.
  // look/palette are re-resolved when the biome sector changes (RunScene ~L2383): derived presentation, not CONFIG.
  const PRESENTATION = ['look', 'palette', 'bg', 'worldDance', 'songBillboard', 'mesh', 'fx', 'trail', 'airTelegraph', 'groundTelegraph',
    'streaks', 'flashRect', 'blindRect', 'bsodEdge', 'windPom', 'startGate', 'bestMarker', 'deathMarker', 'ghostRiders',
    'kodiakRider', 'blackHole', '_worldDanceMotionQuery', '_frameDt', 'heightFn', 'shake',
    // SIM9: bridge look/veil and cached span are visual; marker height reads joined mesh,
    // not speculative terrain. Matches the shipped RunScene fingerprint exclusions.
    '_lookId', '_veil', '_bridgeSpan', '_lookScratch', 'biomeFx', 'markerHeightFn',
    // #69: the untrusted imported tape only paints a noncolliding ghost.
    // It is never restored as authoritative input, and its mode is refused.
    'guestPracticeTape'];
  // INFRA: Phaser scene systems, handlers, services.
  const INFRA = ['add', 'anims', 'cache', 'cameras', 'children', 'data', 'events', 'game', 'input', 'lights', 'load',
    'make', 'matter', 'plugins', 'registry', 'renderer', 'scale', 'scene', 'sound', 'sys', 'textures', 'time', 'tweens',
    'inputRouter', 'saveStore', 'update', '_onCollide', '_onSettings', '_onResume', '_onMusicTrackChange', 'facebook'];

  const PRESENTATION_SUBFIELDS = new Set(['palette', 'look', 'gfx', 'color']);

  const CLASS = new Map();
  for (const [cls, list] of Object.entries({ SIM, PRESENTATION_READ_BY_SIM, SERIALIZED_BY_HOOK, CONFIG, METADATA, PRESENTATION, INFRA })) for (const k of list) CLASS.set(k, cls);

  function classifyScene(run) {
    const out = { unclassified: [] };
    for (const k of Object.keys(run)) {
      const c = CLASS.get(k);
      if (!c) out.unclassified.push(k);
      else (out[c] = out[c] || []).push(k);
    }
    return out;
  }

  // ------------------------------------------------------------------ body identity
  function bodyIndex(run) {
    const keyOf = new Map();
    keyOf.set(run.sled.body, 'sled');
    for (const [idx, rec] of run.mesh.chunks) {
      rec.bodies.forEach((b, i) => keyOf.set(b, `terrain:${idx}:${i}`));
      rec.pads.forEach((b, i) => keyOf.set(b, `pad:${idx}:${i}`));
    }
    for (const [idx, list] of run.hazards) list.forEach((h, i) => { if (h.body) keyOf.set(h.body, `hazard:${idx}:${i}`); });
    for (const list of run.powerups.values()) for (const p of list) if (p.body) keyOf.set(p.body, `powerup:${p.key}`);
    (run.mesh._bodyPool || []).forEach((b, i) => keyOf.set(b, `pool:${i}`));
    const byKey = new Map([...keyOf].map(([b, k]) => [k, b]));
    return { keyOf: (b) => keyOf.get(b), byKey };
  }

  // ------------------------------------------------------------------ generic encode / decode
  function ctorName(v) {
    // Entity schemas use explicit immutable `Hazard`/`PowerUp`/`Sled` tags.
    // esbuild shortens runtime constructor.name in production. Derive these
    // exact identities from the classes themselves instead of trusting a
    // minified name or loosening the strict native saved-state schema.
    if (v instanceof Hazard) return 'Hazard';
    if (v instanceof PowerUp) return 'PowerUp';
    if (v instanceof Sled) return 'Sled';
    if (v instanceof ShardField) return 'ShardField';
    const p = Object.getPrototypeOf(v);
    return !p || p === Object.prototype ? null : (p.constructor && p.constructor.name) || '?';
  }
  function presentationKind(v) {
    if (v instanceof P.Scene) return 'scene';
    if (v instanceof P.GameObjects.GameObject) return 'gameobject';
    if (P.Cameras && v instanceof P.Cameras.Scene2D.Camera) return 'camera';
    if (P.Physics.Matter.World && v instanceof P.Physics.Matter.World) return 'matterworld';
    if (P.Events && v instanceof P.Events.EventEmitter) return 'emitter';
    if (typeof EventTarget !== 'undefined' && v instanceof EventTarget) return 'dom';
    if (v === global) return 'window';
    return null;
  }
  function contentIndex(run) {
    const m = new Map();
    const walk = (v, path, depth) => {
      if (!v || typeof v !== 'object' || m.has(v) || depth > 6) return;
      m.set(v, path);
      for (const k of Object.keys(v)) walk(v[k], `${path}/${k}`, depth + 1);
    };
    walk(run.content, '', 0);
    return m;
  }
  function resolveContent(run, path) {
    let v = run.content;
    if(typeof path!=='string'||(path!==''&&!path.startsWith('/')))throw Error('restore: invalid content path');
    for (const part of path.split('/').slice(1)) {
      if(unsafeKey(part)||!v||!Object.hasOwn(v,part))throw Error('restore: invalid content reference');
      v=v[part];
    }
    if (v === undefined) throw new Error(`restore: content path ${path} missing`);
    return v;
  }

  function makeEncoder(run, keyOfBody) {
    const inWorld = new Set(Matter.Composite.allBodies(run.matter.world.engine.world));
    const ids = new Map();
    const content = contentIndex(run);
    const audit = [];
    const skipped = [];
    function enc(v, path) {
      if (v === undefined) return { __u: 1 };
      if (v === null) return null;
      const t = typeof v;
      if (t === 'number') return Number.isFinite(v) && !Object.is(v, -0) ? v : { __num: Object.is(v, -0) ? '-0' : String(v) };
      if (t === 'string' || t === 'boolean') return v;
      if (t === 'function' || t === 'symbol' || t === 'bigint') { skipped.push(`${path}:${t}`); return { __skip: t }; }
      const pk = presentationKind(v);
      if (pk) { skipped.push(`${path}:${pk}`); return { __skip: pk }; }
      if (v.type === 'dead-body') return { __deadBody: v.label };
      if (v.type === 'body' && Array.isArray(v.parts)) {
        const k = keyOfBody(v);
        if (k == null && !inWorld.has(v)) {
          // A body that has left the world (e.g. the hazard kept in _crashHazard after its chunk was dropped).
          // Sim state still references it; it can never collide again, so it restores as a dead placeholder.
          skipped.push(`${path}:dead-body`);
          return { __deadBody: v.label };
        }
        if (k == null) audit.push(`${path}: Matter body ${v.label} has no stable key`);
        return { __body: k };
      }
      if (v instanceof WeakMap || v instanceof WeakSet || v instanceof WeakRef) { audit.push(`${path}: ${v.constructor.name} is not enumerable (identity-keyed state)`); return { __skip: 'weak' }; }
      if (content.has(v)) return { __content: content.get(v) };
      if (ids.has(v)) return { __alias: ids.get(v) };
      const id = ids.size;
      ids.set(v, id);
      if (Array.isArray(v)) return { __id: id, __arr: v.map((x, i) => enc(x, `${path}[${i}]`)) };
      if (v instanceof Map) return { __id: id, __map: [...v].map(([k, x]) => [enc(k, `${path}<key>`), enc(x, `${path}.get(${String(k)})`)]) };
      if (v instanceof Set) return { __id: id, __set: [...v].map((x, i) => enc(x, `${path}<${i}>`)) };
      if (ArrayBuffer.isView(v)) return { __id: id, __ta: v.constructor.name, data: Array.from(v) };
      const o = {};
      for (const k of Object.keys(v)) {
        // Presentation sub-fields inside sim objects (Hazard.palette, sled.look, ...). The biome palette is
        // re-resolved per sector, so these are derived presentation; Phase 2 schemas would simply omit them.
        if (PRESENTATION_SUBFIELDS.has(k)) { o[k] = { __skip: 'presentation-field' }; continue; }
        const d = Object.getOwnPropertyDescriptor(v, k);
        if (d.get || d.set) { audit.push(`${path}.${k}: accessor property`); continue; }
        o[k] = enc(v[k], `${path}.${k}`);
      }
      return { __id: id, __c: ctorName(v), __obj: o };
    }
    return { enc, audit, skipped };
  }

  function protoRegistry(run) {
    const reg = new Map();
    const seen = new Set();
    const walk = (v, depth) => {
      if (!v || typeof v !== 'object' || seen.has(v) || depth > 8 || presentationKind(v)) return;
      seen.add(v);
      const c = ctorName(v);
      if (c && !reg.has(c)) reg.set(c, Object.getPrototypeOf(v));
      if (v instanceof Map) { for (const x of v.values()) walk(x, depth + 1); return; }
      if (v instanceof Set || Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
      if (v.type === 'body') return;
      for (const k of Object.keys(v)) walk(v[k], depth + 1);
    };
    for (const k of SIM) walk(run[k], 0);
    return reg;
  }

  // Classes that may be materialized when the fresh scene has no live instance (pure data + methods).
  const MATERIALIZABLE = (name, proto) => proto && !('scene' in (proto || {}));

  function makeDecoder(run, bodyByKey) {
    const restored = new Map();
    const reg = protoRegistry(run);
    const log = [];
    function dec(n, live, path) {
      if (n === null || typeof n !== 'object') return n;
      if (n.__u) return undefined;
      if ('__num' in n) return n.__num === '-0' ? -0 : Number(n.__num);
      if (n.__skip) return live;
      if ('__body' in n) {
        const b = bodyByKey(n.__body);
        if (!b) throw new Error(`restore: ${path}: no live body ${n.__body}`);
        return b;
      }
      if ('__deadBody' in n) return { type: 'dead-body', label: n.__deadBody, parts: [], position: { x: NaN, y: NaN } };
      if ('__content' in n) return resolveContent(run, n.__content);
      if ('__alias' in n) {
        if (!restored.has(n.__alias)) throw new Error(`restore: ${path}: alias ${n.__alias} used before its target was restored`);
        return restored.get(n.__alias);
      }
      if ('__arr' in n) {
        const arr = Array.isArray(live) ? live : [];
        restored.set(n.__id, arr);
        const out = n.__arr.map((x, i) => dec(x, arr[i], `${path}[${i}]`));
        arr.length = 0;
        for (const x of out) arr.push(x);
        return arr;
      }
      if ('__map' in n) {
        const m = live instanceof Map ? live : new Map();
        restored.set(n.__id, m);
        const entries = n.__map.map(([k, x]) => { const key = dec(k, undefined, `${path}<key>`); return [key, dec(x, m.get(key), `${path}.get(${String(key)})`)]; });
        m.clear();
        for (const [k, x] of entries) m.set(k, x);
        return m;
      }
      if ('__set' in n) {
        const s = live instanceof Set ? live : new Set();
        restored.set(n.__id, s);
        const vals = n.__set.map((x, i) => dec(x, undefined, `${path}<${i}>`));
        s.clear();
        for (const x of vals) s.add(x);
        return s;
      }
      if ('__ta' in n) {
        if(!['Float32Array','Float64Array','Uint8Array','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array'].includes(n.__ta))
          throw Error('restore: unsupported typed array');
        const T=global[n.__ta],t=new T(n.data);restored.set(n.__id,t);return t;
      }
      // object
      let target = live && typeof live === 'object' && ctorName(live) === n.__c ? live : null;
      if (!target) {
        if (n.__c === null) target = {};
        else {
          const proto = reg.get(n.__c);
          if (!proto || !MATERIALIZABLE(n.__c, proto)) throw new Error(`restore: ${path}: cannot materialize class ${n.__c} (no live instance in the fresh scene)`);
          target = Object.create(proto);
          log.push(`materialized ${n.__c} at ${path}`);
        }
      }
      restored.set(n.__id, target);
      for (const k of Object.keys(n.__obj)) {
        if(unsafeKey(k))throw Error('restore: unsafe object field');
        const sn = n.__obj[k];
        if (sn && typeof sn === 'object' && sn.__skip && !(k in target)) continue; // nothing live to keep
        target[k] = dec(sn, target[k], `${path}.${k}`);
      }
      for (const k of Object.keys(target)) {
        if (k in n.__obj) continue;
        const v = target[k];
        if (typeof v === 'function' || (v && typeof v === 'object' && presentationKind(v))) continue;
        log.push(`deleted extra live field ${path}.${k}`);
        delete target[k];
      }
      return target;
    }
    return { dec, log };
  }

  // ------------------------------------------------------------------ scene capture / restore
  const MKit = () => global.__ssMatterKit;

  function captureCamera(run) {
    const c = run.cameras.main;
    const o = { scrollX: c.scrollX, scrollY: c.scrollY, zoom: c.zoom, rotation: c.rotation };
    for (const k of PRESENTATION_READ_BY_SIM) o[k] = run[k] && typeof run[k] === 'object' ? { ...run[k] } : run[k];
    return o;
  }
  function restoreCamera(run, o) {
    const c = run.cameras.main;
    c.setZoom(o.zoom); c.scrollX = o.scrollX; c.scrollY = o.scrollY; c.rotation = o.rotation;
    for (const k of PRESENTATION_READ_BY_SIM) run[k] = o[k] && typeof o[k] === 'object' ? { ...o[k] } : o[k];
  }

  function poolState(run, keyOf) {
    return (run.mesh._bodyPool || []).map((b) => ({
      raw: MKit().captureBodyRaw ? MKit().captureBodyRaw(b) : null,
      id: b.id,
      mass: [b.area, b.mass, b.inertia, b.inverseMass, b.inverseInertia, b.density],
      original: b._original ? { ...b._original } : null,
      verts: b.vertices.length,
    }));
  }

  /**
   * Full diagnostic capture of the scene at a tick boundary.
   * @returns {{ghost:Array, game:object, matter:object, camera:object, meshOrder:number[], pool:Array, classes:object, audit:string[], skipped:number}}
   */
  function capture(run, opt = {}) {
    // The consumed one-shot guest trace has no safe fresh-world reconstruction.
    // Even a valid unranked race is NOT a trusted suspend snapshot. Reject it
    // before accessing/mutating the Matter world or reading capture fields.
    if (run.guestPractice === true || run.guestPracticeTape != null)
      throw new Error('capture: unranked guest practice is not savestate-admitted');
    const ix = bodyIndex(run);
    const classes = classifyScene(run);
    const audit = [];
    if (classes.unclassified.length) audit.push(`RunScene fields not classified: ${classes.unclassified.join(',')}`);
    const { enc, audit: encAudit, skipped } = makeEncoder(run, ix.keyOf);
    const fields = {};
    for (const k of SIM) if (Object.prototype.hasOwnProperty.call(run, k)) fields[k] = enc(run[k], k);
    audit.push(...encAudit);
    const b = run.sled.body;
    const ghost = [run.simClock.tick, b.position.x, b.position.y, b.angle, b.velocity.x, b.velocity.y, b.angularVelocity, Math.round(run.score?.getTotal?.() ?? 0)];
    const engine = run.matter.world.engine;
    const matter = MKit().capture(engine, ix.keyOf, { selectBody: () => true });
    if (matter.audit.length) audit.push(...matter.audit.map((a) => `matter ${a}`));
    const out = {
      kind: 'bb-runscene-diagnostic-snapshot', version: 1, diagnosticOnly: true,
      ghost, game: fields, telegraph: run.snapshotTelegraph ? run.snapshotTelegraph() : null, matter, camera: captureCamera(run),
      meshOrder: [...run.mesh.chunks.keys()],
      pool: poolState(run, ix.keyOf),
      config: opt.withConfig ? projectConfig(run) : undefined,
      classes, audit, skipped: skipped.length,
      recorder: opt.withRecorder ? global.__ssRecorderKit.captureRecorderPrefix(run) : undefined,
    };
    return out;
  }

  /** The chunk object for an index from the (restored) generator. */
  function chunkByIndex(run, idx) {
    const lists = [run.terrain.activeList, run.terrain.getActiveChunks && run.terrain.getActiveChunks()];
    for (const l of lists) if (l) for (const c of l) if (c && c.index === idx) return c;
    if (run._chunkQueue && run._chunkQueue.has(idx)) return run._chunkQueue.get(idx);
    return null;
  }

  /**
   * Restore into a FRESH RunScene (created with the same seed/config, held at tick 0).
   * levels: 'ghost' | 'game' | 'kinematic' | 'contacts' | 'full'; opt.skip: ablations
   * ('camera', 'pool', 'ids', 'runRandom', 'kodiaks', 'bsod', 'hazardHit', plus Matter-kit ablations
   * 'impulses', 'staleSupport', 'timing', 'worldOrder', 'detectorOrder', 'positionImpulse', 'deltaTime', 'rawGeometry').
   */
  function restore(run, snap, level, opt = {}) {
    const skip = new Set(opt.skip || []);
    const LV = ['ghost', 'game', 'kinematic', 'contacts', 'full'];
    const L = LV.indexOf(level);
    if (L < 0) throw new Error(`restore: unknown level ${level}`);
    if (!snap || snap.kind !== 'bb-runscene-diagnostic-snapshot' || snap.version !== 1) throw new Error('restore: bad snapshot kind/version');
    // Same fail-closed rule for the DESTINATION and any claimed guest-mode
    // snapshot. Never reinterpret an untrusted ghost as normal ranked state.
    if (run.guestPractice === true || run.guestPracticeTape != null ||
        (snap.config && Object.prototype.hasOwnProperty.call(snap.config, 'guestPractice') && snap.config.guestPractice !== 'false'))
      throw new Error('restore: unranked guest practice is not savestate-admitted');
    if (L > 0 && opt.strict !== false && snap.audit.length) throw new Error(`restore: snapshot is incomplete: ${snap.audit.join(' | ')}`);
    // Validate the entire recorder section before touching the fresh world.
    const preparedRecorder = global.__ssCanonical
      ? global.__ssRecorderKit.prepareRecorderPrefix(run,snap.recorder,snap.ghost[0]) : null;
    if (global.__ssCanonical) {
      const configKeys=CONFIG.filter(k=>k in run&&k!=='content'&&k!=='tuner');
      if(!exactKeys(snap.config,configKeys)||configKeys.some(k=>JSON.stringify(run[k])!==snap.config[k]))
        throw Error('restore: CONFIG differs from fresh scene');
      if(!Array.isArray(snap.classes?.SIM)||new Set(snap.classes.SIM).size!==snap.classes.SIM.length||
         !snap.classes.SIM.every(k=>SIM.includes(k))||!exactKeys(snap.game,snap.classes.SIM))
        throw Error('restore: incomplete SIM field inventory');
      if (!Array.isArray(snap.pool) || snap.pool.length || run.mesh._bodyPool?.length)
        throw new Error('restore: legacy collider pool cannot be restored into canonical geometry');
      MKit().preflight(snap.matter);
      // Retired detector terrain entries are validated by the V3 Matter preflight.
    }
    const engine = run.matter.world.engine;
    const tickMs = run.simClock.tickMs;
    if (L === 0) {
      // GhostTape checkpoint semantics: sled pose/velocity + tick (+ the run clock it implies). The world is
      // whatever a naive restore can rebuild: stream terrain around the sled.
      const [tick, x, y, a, vx, vy, w] = snap.ghost;
      run.streamTerrain(x);
      const sb = run.sled.body;
      Matter.Body.setAngle(sb, a);
      Matter.Body.setPosition(sb, { x, y });
      Matter.Body.setVelocity(sb, { x: vx, y: vy });
      Matter.Body.setAngularVelocity(sb, w);
      run.sled._sync();
      run.simClock.tick = tick;
      run.runTimeMs = tick * tickMs;
      return { level, log: [] };
    }
    // Ablation baselines: what the FRESH scene has, re-applied after the restore (experiment only).
    const fresh = {
      rng: Object.fromEntries(Object.entries(run.runRandom).map(([k, v]) => [k, v && v.state])),
      bsod: Object.fromEntries(Object.entries(run.bsod || {}).filter(([, v]) => typeof v !== 'object' && typeof v !== 'function')),
    };
    // 1) generator + collected set, 2) world rebuild in the snapshot's chunk order, 3) everything else.
    let ix = bodyIndex(run);
    const dcd = makeDecoder(run, (k) => ix.byKey.get(k));
    const order = SIM.filter((k) => k in snap.game);
    const early = ['simClock', 'runRandom', 'terrain', 'collectedPowerups', '_chunkQueue'];
    for (const k of early) if (k in snap.game) run[k] = dcd.dec(snap.game[k], run[k], k);
    for (const idx of [...run.mesh.chunks.keys()]) run.dropChunk(idx);
    run.hazards.clear(); run.powerups.clear();
    for (const idx of snap.meshOrder) {
      const ch = chunkByIndex(run, idx);
      if (!ch) throw new Error(`restore: chunk ${idx} not available from the restored generator`);
      run.takeChunk(ch);
    }
    ix = bodyIndex(run);
    for (const k of SIM) {
      if (k in run && !(k in snap.game)) { dcd.log.push(`deleted SIM field absent from snapshot: ${k}`); delete run[k]; }
    }
    if (snap.config) {
      for (const [k, v] of Object.entries(snap.config)) if (JSON.stringify(run[k]) !== v) throw new Error(`restore: CONFIG ${k} differs from the snapshot (fresh scene built with different config)`);
    }
    for (const k of order) if (!early.includes(k)) run[k] = dcd.dec(snap.game[k], run[k], k);
    // The marker palette key is derived, not a serialized color. A
    // freshly materialized mark has no live color for the skip marker to
    // preserve; rebuild exactly as planTelegraphMarks does.
    for (const mark of run._teleMarks || [])
      mark.color = mark.state === 'go' ? 'lime' : mark.kind === 'hop' ? 'danger' : 'amber';
    if (snap.telegraph && !skip.has('telegraph')) run.restoreTelegraph(snap.telegraph);
    if (skip.has('runRandom')) for (const [k, st] of Object.entries(fresh.rng)) if (run.runRandom[k]) run.runRandom[k].state = st;
    if (skip.has('kodiaks')) { run.kodiaks = []; run.kodiakNext = 0; }
    if (skip.has('bsod')) { Object.assign(run.bsod, fresh.bsod); run.bsodCaught = false; }
    if (skip.has('hazardHit')) for (const list of run.hazards.values()) for (const h of list) h.hit = false;
    // Matter
    const mlevel = L === 1 ? 'pose' : L === 2 ? 'kinematic' : L === 3 ? 'contacts' : (skip.has('ids') ? 'contacts' : 'full');
    let msnap = snap.matter;
    if (L <= 2) msnap = { ...msnap, bodies: { sled: msnap.bodies.sled } };
    // Pool bodies are outside the world; the Matter kit's strict body-set check covers world bodies only.
    const worldKeys = (k) => !String(k).startsWith('pool:');
    const msnapW = { ...msnap, ids: Object.fromEntries(Object.entries(msnap.ids).filter(([k]) => worldKeys(k))), bodies: Object.fromEntries(Object.entries(msnap.bodies).filter(([k]) => worldKeys(k))) };
    const mres = MKit().restore(engine, msnapW, ix.keyOf, mlevel, { skip: [...skip], completePreflight: !!global.__ssCanonical });
    run.sled._sync();
    if (L >= 4 && !skip.has('pool')) restorePool(run, snap.pool);
    if (L >= 4 && !skip.has('ids')) Matter.Common._nextId = snap.matter.nextId;
    if (L >= 4 && !skip.has('camera')) restoreCamera(run, snap.camera);
    if (preparedRecorder) global.__ssRecorderKit.applyRecorderPrefix(run,preparedRecorder);
    return { level, matter: mres, log: dcd.log };
  }

  function restorePool(run, pool) {
    // SIM9 has canonical terrain colliders. Never recreate legacy pooled
    // geometry in the production-importable or diagnostic restore paths.
    if (!Array.isArray(pool) || pool.length || run.mesh._bodyPool != null)
      throw new Error('restore: legacy collider pool cannot be restored into canonical geometry');
  }

  // ------------------------------------------------------------------ diagnostics
  function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  /** Diagnostic per-tick digests (non-authoritative). Sub-system granular so the first divergent one is named. */
  /** Key-order-insensitive JSON: object property insertion order is not state (array/Map/Set order is). */
  function canon(v) {
    if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
    if (v && typeof v === 'object') {
      // alias numbering follows traversal (= key) order; keep only the fact that it is an alias
      if ('__alias' in v) return '"<alias>"';
      if ('__obj' in v) {
        // keys whose value is a skip marker (scene, world, presentation) carry no state
        const o = {};
        for (const k of Object.keys(v.__obj)) { const x = v.__obj[k]; if (!(x && typeof x === 'object' && ('__skip' in x || '__u' in x))) o[k] = x; }
        return `{"__c":${JSON.stringify(v.__c)},"__obj":${canon(o)}}`;
      }
    }
    if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => k !== '__id').sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
    return JSON.stringify(v);
  }
  function digests(run, cap = capture(run)) {
    const out = {};
    for (const k of Object.keys(cap.game)) out[k] = fnv(canon(cap.game[k]));
    const m = cap.matter;
    const sorted = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
    out['matter.bodies'] = fnv(sorted(m.bodies));
    out['matter.worldOrder'] = fnv(JSON.stringify(m.worldOrder));
    out['matter.detectorOrder'] = fnv(JSON.stringify([m.worldModified,global.__ssCanonical||!m.worldModified?m.detectorOrder:m.worldOrder]));
    out['matter.pairs'] = fnv(JSON.stringify(m.pairs));
    out['matter.ids'] = fnv(sorted(m.ids) + m.nextId);
    out['matter.timing'] = fnv(JSON.stringify(m.timing));
    if (global.__ssCanonical) {
      out['matter.gravity'] = fnv(JSON.stringify(m.gravity));
      out['matter.statics'] = fnv(canon(m.statics));
    }
    out['camera(#155)'] = fnv(JSON.stringify(cap.camera));
    out['pool'] = fnv(JSON.stringify(cap.pool));
    // Use the actual compiled game's recorder fingerprint method, with a
    // throwaway receiver: no mutation of the live recorder or its history.
    if (global.__ssCanonical) {
      if (cap.audit.length) throw new Error('incomplete diagnostic capture: '+cap.audit.join(' | '));
      const recorder = run.ghostRecorder;
      if (typeof recorder?._fingerprint !== 'function') throw new Error('compiled canonical fingerprint unavailable');
      const receipt = { fingerprints: [], fingerprintErrorCount: 0, fingerprintErrors: [] };
      recorder._fingerprint.call(receipt, run.simClock.tick, run);
      const fp = receipt.fingerprints[0];
      if (receipt.fingerprintErrorCount || receipt.fingerprints.length !== 1 ||
          fp.tick !== run.simClock.tick || !fp.combined || Object.keys(fp.subsystems).length !== 13)
        throw new Error('canonical fingerprint failed: '+JSON.stringify(receipt.fingerprintErrors));
      out['canonical.combined'] = fp.combined;
      for (const [key, value] of Object.entries(fp.subsystems)) out['canonical.'+key] = value;
      out['telegraph'] = fnv(canon(cap.telegraph));
    }
    const b = run.sled.body;
    out.__sled = [b.position.x, b.position.y, b.angle, b.velocity.x, b.velocity.y, b.angularVelocity];
    out.__score = run.score.getTotal();
    out.__crashed = !!run.crashed;
    out.__tick = run.simClock.tick;
    return out;
  }

  /** Step n ticks (one per frame); keep this batch's captures so the first divergent tick can be inspected. */
  function runBatch(ss, n) {
    const res = [];
    ss.ring = new Map();
    for (let i = 0; i < n; i++) {
      ss.step(1);
      if (!ss.run.sled) { res.push(null); break; }
      const cap = capture(ss.run);
      ss.ring.set(ss.run.simClock.tick, cap);
      res.push(digests(ss.run, cap));
    }
    return res;
  }

  function projectConfig(run){
    return Object.fromEntries(CONFIG.filter(k=>k in run&&k!=='content'&&k!=='tuner').map(k=>[k,JSON.stringify(run[k])]));
  }
  function projectEarly(run,clock,rng,terrain,queue,collected){
    const {enc,audit}=makeEncoder(run,bodyIndex(run).keyOf);
    const values={simClock:clock,runRandom:rng,terrain,collectedPowerups:collected,_chunkQueue:queue};
    const game=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,enc(v,k)]));
    if(audit.length)throw Error('early projection: '+audit.join(' | '));
    return game;
  }
  return Object.freeze({capture,restore,digests,runBatch,classifyScene,bodyIndex,projectEarly,projectConfig,CLASS:Object.fromEntries(CLASS)});
}
