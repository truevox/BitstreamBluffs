// #116 acceptance on the REAL RunScene (headless harness from #165: real create/update, real Matter, rendering stubbed):
// record a run, then replay its tape under a different UTC date, a different profile Sync Level, different Kodiak/magnet
// settings and hostile live registry flags. Fingerprints must be identical and compareRuns must say `match`. Negative
// controls: mutants of RunScene with R-1 / R-2 / R-3 removed, and a tampered manifest. Also the end-to-end evidence path.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';

const { installPhaserStub, createRun } = await import('./headlessRun.js');
const { Phaser } = installPhaserStub(jest);
Phaser.VERSION = '3.90.0'; // the stub has no VERSION; real Phaser does (RunScene passes it to the evidence path)
const { RunScene } = await import('../../src/scenes/RunScene.js');
const { REG } = await import('../../src/constants.js');
const { DailyPatch } = await import('../../src/systems/DailyPatch.js');
const { captureCausalState } = await import('../../src/systems/replay/fingerprintCapture.js');
const { fingerprintState, compareRuns } = await import('../../src/systems/replay/fingerprint.js');
const { FP_PREFIX } = await import('../../src/systems/replay/canonicalBinary.js');
const { EvidenceStore } = await import('../../src/systems/replay/evidenceStore.js');
const { GhostLibrary } = await import('../../src/systems/ghost/GhostLibrary.js');
const { EVIDENCE_STATUS_KEY, EVIDENCE_STORE_KEY, RULESET_KEY, buildRunEvidence } = await import('../../src/systems/replay/evidenceCapture.js');
const { FP_SCHEMAS, FP_SUBSYSTEMS } = await import('../../src/systems/replay/fingerprintSchemas.js');
const { validateEvidenceBundle, bundleDigest, resolveReplaySetup } = await import('../../src/systems/replay/manifest.js');
const { TapePlayer } = await import('../../src/systems/ghost/GhostTape.js');
const { canonicalBytes, parseCanonical } = await import('../../src/systems/replay/canonicalJson.js');
const { digestOf } = await import('../../src/systems/replay/canonicalSha256.js');
const { fakeIdb } = await import('./fakeIdb.js');

// The game loads the committed ruleset (tools/ruleset/current.json + archive) at boot and puts it on the registry.
const CURRENT = JSON.parse(fs.readFileSync('tools/ruleset/current.json', 'utf8'));
const RULESET = { rulesetId: CURRENT.rulesetId, doc: JSON.parse(fs.readFileSync(CURRENT.archivePath, 'utf8')) };
const resolveRuleset = (id) => (id === RULESET.rulesetId ? RULESET.doc : null);
const waitFor = async (get, ms = 3000) => { const t0 = Date.now(); let v; while ((v = get()) === undefined && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 5)); return v; };

const SEED = 'RPLAY164';
const REC_SETTINGS = { kodiakPacks: 'mixed' }; // the recording used mixed packs; replays run under other live settings
const END = 600;
const REC_LEVEL = 8; // >= 6 (Kodiaks) and >= 5 (magnets): the recording had bears and magnets on
const padFor = (tick) => ({
  push: tick < 300, tilt: tick > 420 && tick < 460 ? -1 : 0, variableHop: true, noAutoNudge: true, tuck: tick > 500 && tick < 540,
  pressed: { hop: (tick >= 350 && tick <= 352) || tick === 560 }, // consecutive-tick edges (C11)
  hop: tick >= 350 && tick <= 352,
});

const dayWithRule = (id, from = Date.UTC(2026, 10, 21, 12)) => {
  for (let i = 0; i < 40; i++) {
    const d = new Date(from + i * 86400000);
    if (DailyPatch.getDailyInfo(d).rule.id === id) return d;
  }
  throw new Error(`no day with rule ${id}`);
};
const DAY_REC = dayWithRule('featherweight');
const DAY_OTHER = dayWithRule('heavyPackets');
const DAY_THIRD = dayWithRule('slickLines');

const FAKE_ONLY_DATE = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'];
const setDay = (d) => jest.useFakeTimers({ now: d, doNotFake: FAKE_ONLY_DATE });

const tick = (scene) => scene.update(0, scene.simClock.tickMs);

/** A live recording at DAY_REC: returns the scene (not yet ended). */
function liveScene(SceneClass = RunScene, over = {}) {
  setDay(DAY_REC);
  const scene = createRun(SceneClass, REG, { seed: SEED, level: REC_LEVEL, settings: REC_SETTINGS, ...over });
  scene.registry.set(RULESET_KEY, RULESET);
  scene.inputRouter = { poll: () => padFor(scene.simClock.tick + 1), setEnabled() {} };
  return scene;
}

const roundTrip = (v) => JSON.parse(JSON.stringify(v));

/** Replay scene factory: the recorded tape under hostile conditions. */
function replayScene(SceneClass, tape, { day, level, settings, gym = true } = {}) {
  setDay(day);
  class Replay extends SceneClass {
    create() {
      this.registry.set(REG.GHOST_REPLAY, roundTrip(tape));
      if (gym) { this.registry.set(REG.BSOD_GYM, true); this.registry.set(REG.DAILY_OFFICIAL, true); this.registry.set(REG.DAILY_MODE, 'draft'); }
      super.create();
    }
  }
  return createRun(Replay, REG, { seed: 'NOT-THE-RECORDED-SEED', level, settings, profile: { bsodGym: { owned: true }, boosts: { errorCorrection: true }, unlocked: { boosts: { errorCorrection: true } } } });
}

/** RunTrace for compareRuns. `make()` builds a fresh scene; `reference` supplies the recorded checkpoints (else sampled). */
function trace(make, { reference = null, causalDigest = 'sha256:same' } = {}) {
  const sample = (to, onTick) => {
    const scene = make();
    const out = [];
    while (scene.simClock.tick < to && !scene.crashed) {
      tick(scene);
      const t = scene.simClock.tick;
      if (onTick) onTick(scene, t);
      if (t % 120 === 0) out.push(fingerprintState(captureCausalState(scene)));
    }
    return out;
  };
  let cached = null;
  return {
    causalDigest,
    get checkpoints() {
      if (reference) return reference;
      cached = cached || sample(END).map((f) => ({ tick: f.tick, combined: f.combined, subsystems: f.subsystems }));
      return cached;
    },
    resimulate: ({ fromTick, toTick }) => {
      const out = [];
      sample(toTick, (scene, t) => { if (t > fromTick) out.push(fingerprintState(captureCausalState(scene))); });
      return out;
    },
    dumpAt: (t) => { let st; sample(t, (scene, tt) => { if (tt === t) st = captureCausalState(scene); }); return st; },
  };
}

// ---- the recording (once) -------------------------------------------------------------------------------------------
let rec; // { tape, bundleBytes, status, store, recorder, fingerprints }

beforeAll(async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {}); // memory-only evidence store warns by design
  const scene = liveScene();
  const store = new EvidenceStore({ idb: null, storage: null });
  await store.init();
  scene.registry.set(EVIDENCE_STORE_KEY, store);
  while (scene.simClock.tick < END) tick(scene);
  expect(scene.crashed).toBe(false);
  expect(scene.kodiaksOn).toBe(true);
  expect(scene.magnetsDrop).toBe(true);
  const recorder = scene.ghostRecorder;
  const tapeHolder = {};
  scene.registry.set(REG.GHOSTS, { saveRun: (t) => { tapeHolder.saved = t; return Promise.resolve(); } });
  scene._saveGhostTape({ id: 'rec-1', distanceM: Math.floor(scene.score.distanceM), score: Math.round(scene.score.getTotal()), endedAt: 1 });
  const syncStatus = scene.registry.get(EVIDENCE_STATUS_KEY); // S3: nothing may have been built on the run-end frame
  const status = await waitFor(() => scene.registry.get(EVIDENCE_STATUS_KEY));
  const tape = scene.registry.get(REG.LAST_GHOST_TAPE);
  rec = { tape, status, syncStatus, store, recorder, scene, ghostSaved: tapeHolder.saved,
    bytes: status.ok ? await store.get(status.digest) : null };
  jest.useRealTimers();
}, 60000);

afterEach(() => jest.useRealTimers());

describe('the live run produced evidence', () => {
  test('the hook saved a bundle: status ok, ghost still saved, tape unchanged in shape', () => {
    expect(rec.status).toMatchObject({ ok: true, detail: 'combined', outcome: 'valid' });
    expect(rec.ghostSaved).toBe(rec.tape);
    expect(rec.tape.edgeRows).toBe('every-tick');
    expect(rec.tape.endTick).toBe(END);
    expect(rec.recorder.fingerprintErrors).toEqual([]);
    expect(rec.tape.syncLevel).toBe(REC_LEVEL);
  });

  test('S3: nothing is built on the run-end frame: no status right after _saveGhostTape, the ghost save is synchronous', () => {
    expect(rec.syncStatus).toBeUndefined();
    expect(rec.ghostSaved).toBeDefined();
  });

  test('the bundle verifies: digest = sha256 of its bytes, manifest valid under the in-build ruleset, fingerprints are stored', () => {
    const { rulesetId } = RULESET;
    const v = validateEvidenceBundle(rec.bytes, resolveRuleset);
    expect(v).toMatchObject({ ok: true, outcome: 'valid', reasons: [] });
    expect(bundleDigest(rec.bytes)).toBe(rec.status.digest);
    expect(v.manifest.causal.sim.rulesetId).toBe(rulesetId);
    expect(v.manifest.causal.checkpoints).toMatchObject({ detail: 'combined', algo: 'xxh32x2' });
    expect(v.bundle.checkpoints.map((r) => r[0])).toEqual([120, 240, 360, 480, 600]);
    expect(v.bundle.checkpoints.map((r) => `${FP_PREFIX}${r[1]}`)).toEqual(rec.recorder.fingerprints.map((f) => f.combined));
    expect(v.manifest.causal.loadout.magnetsDrop).toBe(true);
    expect(v.manifest.causal.kodiak.enabled).toBe(true);
    expect(v.manifest.causal.bsod.syncLevel).toBe(REC_LEVEL);
    expect(v.manifest.causal.course.dailyRuleId).toBe('featherweight');
    expect(v.manifest.causal.kodiak.packMode).toBe('mixed');
    // per-subsystem schema versions come from FP_SCHEMAS (#165), not constants; the capture error count is recorded
    expect(v.manifest.causal.checkpoints.schemas).toEqual(Object.fromEntries(FP_SUBSYSTEMS.map((n) => [n, FP_SCHEMAS[n].version])));
    expect(v.manifest.info.capture).toEqual({ errorCount: 0 });
    // the bundle carries no wall-clock or identity data
    const text = Buffer.from(rec.bytes).toString('utf8');
    for (const k of ['startedAt', 'endedAt', 'runId', 'controlLayout', 'rec-1']) expect(text).not.toContain(k);
  });

  test('the manifest binds the committed ruleset of this build (tools/ruleset/current.json)', () => {
    expect(parseCanonical(rec.bytes).manifest.causal.sim.rulesetId).toBe(CURRENT.rulesetId);
  });

  test('capture errors: a non-zero count is recorded, drops the fingerprints and validates as inconclusive, never a pass', () => {
    const fake = { fingerprints: rec.recorder.fingerprints, fingerprintErrorCount: 2, fingerprintErrors: [] };
    const { bundle, detail, errorCount } = buildRunEvidence({ tape: rec.tape, recorder: fake, ruleset: RULESET });
    expect([detail, errorCount]).toEqual(['none', 2]);
    expect(bundle.manifest.info.capture).toEqual({ errorCount: 2 });
    expect(bundle.checkpoints).toEqual([]);
    const v = validateEvidenceBundle(canonicalBytes(bundle), resolveRuleset);
    expect(v).toMatchObject({ ok: true, outcome: 'inconclusive' });
    expect(v.reasons).toEqual([{ outcome: 'inconclusive', reason: 'fingerprint-capture-errors', pointer: '/info/capture/errorCount', expected: 0, actual: 2 }]);
  });

  test('BSOD initial values recorded by _ghostHeader equal the real constructor (no inconclusive outcome)', () => {
    expect(rec.status.outcome).toBe('valid');
  });

  test('end to end: export, import into a fresh store (own IndexedDB), digest verifies, GhostLibrary._collect does not touch it', async () => {
    const idb = fakeIdb();
    const a = await new EvidenceStore({ idb, storage: null }).init();
    const digest = await a.importBundle(rec.bytes, { expectedDigest: rec.status.digest });
    expect(digest).toBe(rec.status.digest);
    const exported = await a.exportBundle(digest);
    const b = await new EvidenceStore({ idb: fakeIdb(), storage: null }).init();
    expect(await b.importBundle(exported.bytes, { expectedDigest: exported.digest })).toBe(digest);
    expect(Buffer.from(await b.get(digest)).equals(Buffer.from(rec.bytes))).toBe(true);
    // GhostLibrary churn in the same IndexedDB factory
    const prev = globalThis.indexedDB;
    globalThis.indexedDB = idb;
    try {
      const lib = new GhostLibrary();
      await lib.init();
      expect(lib.backend).toBe('idb');
      const mk = (id, d) => ({ ...roundTrip(rec.tape), runId: id, distanceM: d });
      await lib.saveRun(mk('g1', 100)); await lib.saveRun(mk('g2', 5)); await lib.saveRun(mk('g3', 6));
      expect(await lib.getTape('g2')).toBeNull(); // collected
      const reopened = await new EvidenceStore({ idb, storage: null }).init();
      expect(reopened.has(digest)).toBe(true);
    } finally { globalThis.indexedDB = prev; }
  });

  test('failures are surfaced, never thrown, and never block the ghost save', async () => {
    const scene = liveScene();
    while (scene.simClock.tick < 240) tick(scene);
    const failing = { rulesetResolver: null, durable: true, put: async () => { const e = new Error('full'); e.code = 'quota-exceeded'; throw e; } };
    scene.registry.set(EVIDENCE_STORE_KEY, failing);
    const saved = [];
    scene.registry.set(REG.GHOSTS, { saveRun: (t) => { saved.push(t); return Promise.resolve(); } });
    const warn = console.warn;
    warn.mockClear();
    expect(() => scene._saveGhostTape({ id: 'x', distanceM: 1, score: 1, endedAt: 1 })).not.toThrow();
    expect(saved).toHaveLength(1);
    expect(await waitFor(() => scene.registry.get(EVIDENCE_STATUS_KEY))).toMatchObject({ ok: false, code: 'quota-exceeded' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('quota-exceeded'));
    // a build with no ruleset at all: still no throw
    const s2 = liveScene();
    s2.registry.set(RULESET_KEY, undefined);
    while (s2.simClock.tick < 120) tick(s2);
    expect(() => s2._saveGhostTape({ id: 'y', distanceM: 1, score: 1, endedAt: 1 })).not.toThrow();
    expect(await waitFor(() => s2.registry.get(EVIDENCE_STATUS_KEY))).toMatchObject({ ok: false, code: 'no-ruleset' });
  });
});

describe('same tape, hostile replay conditions: identical fingerprints (acceptance for #116)', () => {
  const reference = () => rec.recorder.fingerprints.map((f) => ({ tick: f.tick, combined: f.combined, subsystems: f.subsystems }));
  const recordedTrace = () => trace(() => liveScene(), { reference: reference() });

  const conditions = [
    ['a different UTC day (heavyPackets), Sync Level 1, bears/magnets off in the live profile, hostile Gym/Daily registry flags',
      { day: DAY_OTHER, level: 1, settings: { kodiakPacks: 'same' } }],
    ['another UTC day (slickLines) and a far higher Sync Level', { day: DAY_THIRD, level: 40, settings: {} }],
  ];

  test.each(conditions)('replay under %s', async (_name, env) => {
    const probe = replayScene(RunScene, rec.tape, env);
    // the replay resolved its inputs from the tape, not from the environment
    expect(probe.seed).toBe(SEED);
    expect(probe.dailyRuleId).toBe('featherweight');
    expect(probe.kodiaksOn).toBe(true);
    expect(probe.magnetsDrop).toBe(true);
    expect(probe.kodiakPackMode).toBe('mixed'); // recorded value, not the live setting
    expect(probe.appliedBoosts).toEqual([]); // the live profile's boosts/upgrades are ignored
    expect(probe.upgradeRun.enabled).toBe(false);
    expect(probe.bsodGym).toBe(false);
    expect(probe.dailyOfficial).toBe(false);
    expect(probe.dailyMode).toBe('classic');
    expect(DailyPatch.getDailyInfo().rule.id).not.toBe('featherweight'); // the faked clock really points at another rule
    const result = await compareRuns(recordedTrace(), trace(() => replayScene(RunScene, rec.tape, env)));
    expect(result.status).toBe('match');
    expect(result.firstDivergentCheckpoint).toBeNull();
    // and every stored checkpoint was actually compared (5 checkpoints)
    const sampled = trace(() => replayScene(RunScene, rec.tape, env)).checkpoints;
    expect(sampled.map((c) => c.combined)).toEqual(rec.recorder.fingerprints.map((f) => f.combined));
    expect(sampled).toHaveLength(5);
  });

  test('the tape also replays against the exact sled checkpoints (TapePlayer) at a different date and level', () => {
    const scene = replayScene(RunScene, rec.tape, { day: DAY_OTHER, level: 1, settings: {} });
    while (scene.simClock.tick < END) tick(scene);
    expect(scene.tapePlayer.desync).toBeNull();
    expect(scene.tapePlayer.checked).toBe(5);
  });

  test('consecutive-tick edges (C11) were recorded as separate rows and replayed', () => {
    const rows = rec.tape.inputs;
    let t = 0;
    const edgeTicks = rows.map((r) => (t += r[0], [t, r[1]])).filter(([, b]) => (b >>> 12) & 1).map(([tt]) => tt);
    expect(edgeTicks).toEqual(expect.arrayContaining([350, 351, 352]));
  });
});

describe('negative controls: remove a rule, or tamper, and it diverges or refuses', () => {
  const SRC = 'src/scenes/RunScene.js';
  // Mutants live in a private temp dir OUTSIDE the repo (nothing for git, jest-watch or sibling suites to trip over); their
  // relative imports are rewritten to absolute paths so they still resolve to the very same modules as the real scene.
  let dir = null;
  let Mutants = {};

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-mutants-'));
    const src = fs.readFileSync(SRC, 'utf8');
    const abs = src.replace(/from '(\.{1,2}\/[^']+)'/g, (_m, rel) => `from '${path.resolve(path.dirname(SRC), rel)}'`);
    const mutate = (name, from, to) => {
      expect(src).toContain(from);
      const file = path.join(dir, `mutant_${name}.mjs`);
      fs.writeFileSync(file, abs.replace(from, to));
      return import(file);
    };
    Mutants = {
      noR1: (await mutate('R1', 'const daily = rp ? { rule: rp.dailyRule } : seedDayInfo ?', 'const daily = seedDayInfo ?')).RunScene,
      noR2: (await mutate('R2', 'level: rp ? rp.syncLevel : prof.level,', 'level: prof.level,')).RunScene,
      noR3k: (await mutate('R3k', 'this.kodiaksOn = rp ? rp.kodiaksOn', 'this.kodiaksOn = false ? 0')).RunScene,
      noR3m: (await mutate('R3m', 'this.magnetsDrop = rp ? rp.magnetsDrop', 'this.magnetsDrop = false ? 0')).RunScene,
      noR3p: (await mutate('R3p', 'this.kodiakPackMode = rp ? rp.kodiakPackMode', 'this.kodiakPackMode = false ? 0')).RunScene,
      noR4: (await mutate('R4', 'this.dailyOfficial = !replay && reg.get(REG.DAILY_OFFICIAL)', 'this.dailyOfficial = reg.get(REG.DAILY_OFFICIAL)')).RunScene,
    };
  });
  // tolerates a killed worker: a leftover dir is in the OS temp dir, never in the repo
  afterAll(() => { try { if (dir) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

  const env = { day: DAY_OTHER, level: 1, settings: {} };
  const reference = () => rec.recorder.fingerprints.map((f) => ({ tick: f.tick, combined: f.combined, subsystems: f.subsystems }));

  test('control: the unmutated scene matches under the same hostile conditions', async () => {
    const r = await compareRuns(trace(() => liveScene(), { reference: reference() }), trace(() => replayScene(RunScene, rec.tape, env)));
    expect(r.status).toBe('match');
  });

  test('R-1 removed (daily rule from the clock): the replay diverges', async () => {
    const r = await compareRuns(trace(() => liveScene(), { reference: reference() }), trace(() => replayScene(Mutants.noR1, rec.tape, env)));
    expect(r.status).toBe('diverged');
    expect(r.firstDivergentCheckpoint).toBe(120);
  });

  test('R-2 removed (Sync Level from the profile): the replay diverges in the bsod subsystem', async () => {
    const r = await compareRuns(trace(() => liveScene(), { reference: reference() }), trace(() => replayScene(Mutants.noR2, rec.tape, env)));
    expect(r.status).toBe('diverged');
    expect(r.differingSubsystems).toContain('bsod');
  });

  test('R-3 removed (Kodiak flag, magnet flag, pack mode from the live profile/settings): the replay resolves different inputs', () => {
    const real = replayScene(RunScene, rec.tape, env);
    expect([real.kodiaksOn, real.magnetsDrop, real.kodiakPackMode]).toEqual([true, true, 'mixed']);
    expect(replayScene(Mutants.noR3k, rec.tape, env).kodiaksOn).toBe(false);
    expect(replayScene(Mutants.noR3m, rec.tape, env).magnetsDrop).toBe(false);
    expect(replayScene(Mutants.noR3p, rec.tape, env).kodiakPackMode).not.toBe('mixed');
  });

  test('R-4 (official Daily flags): a recorded official Daily replays with stale DAILY_OFFICIAL/DAILY_MODE ignored; the mutant honors them', async () => {
    const dayKey = DAY_REC.toISOString().slice(0, 10);
    setDay(DAY_REC);
    class Official extends RunScene { create() { this.registry.set(REG.DAILY_OFFICIAL, true); super.create(); } }
    const dailyLive = () => {
      setDay(DAY_REC);
      const sc = createRun(Official, REG, { seed: `daily-${dayKey}`, level: 3 });
      sc.registry.set(RULESET_KEY, RULESET);
      sc.inputRouter = { poll: () => padFor(sc.simClock.tick + 1), setEnabled() {} };
      return sc;
    };
    const live = dailyLive();
    expect(live.dailyOfficial).toBe(true);
    while (live.simClock.tick < END) tick(live);
    const tape = live.ghostRecorder.finish({ runId: 'd1', distanceM: 1, score: 1, endedAt: 1 });
    expect(tape.mode).toBe('daily');
    expect(tape.dailyRuleSource).toBe('seed-date');
    const refDaily = live.ghostRecorder.fingerprints.map((f) => ({ tick: f.tick, combined: f.combined, subsystems: f.subsystems }));
    // same UTC day, stale official/draft flags in the registry: the replay is not an official Daily
    const real = replayScene(RunScene, tape, { day: DAY_REC, level: 1, settings: {} });
    expect([real.dailyOfficial, real.dailyMode, real.bsodGym]).toEqual([false, 'classic', false]);
    const mutant = replayScene(Mutants.noR4, tape, { day: DAY_REC, level: 1, settings: {} });
    expect(mutant.dailyOfficial).toBe(true); // without R-4 the replay is gated by the live flag
    expect(mutant.dailyMode).toBe('draft');
    const r = await compareRuns(trace(() => dailyLive(), { reference: refDaily }), trace(() => replayScene(RunScene, tape, { day: DAY_REC, level: 1, settings: {} })));
    expect(r.status).toBe('match');
    const v = validateEvidenceBundle(canonicalBytes(buildRunEvidence({ tape, recorder: live.ghostRecorder, ruleset: RULESET }).bundle), resolveRuleset);
    expect(v).toMatchObject({ ok: true, outcome: 'valid' });
    expect(v.manifest.info.lane).toMatchObject({ mode: 'daily', dailyOfficial: true });
  });

  test('tampered manifest: the bundle is refused, and a re-hashed manifest has another causalDigest so compareRuns refuses', async () => {
    const good = parseCanonical(rec.bytes);
    const tampered = JSON.parse(JSON.stringify(good));
    tampered.manifest.causal.course.dailyRuleId = 'heavyPackets';
    expect(validateEvidenceBundle(canonicalBytes(tampered), null)).toMatchObject({ ok: false, code: 'digest-mismatch', pointer: '/manifestDigest' });
    tampered.manifestDigest = digestOf(tampered.manifest); // an attacker recomputes the digest...
    expect(validateEvidenceBundle(canonicalBytes(tampered), null).ok).toBe(true); // ...so structure alone cannot tell
    const a = { ...trace(() => liveScene(), { reference: reference(), causalDigest: digestOf(good.manifest.causal) }) };
    const b = { ...trace(() => replayScene(RunScene, rec.tape, env), { causalDigest: digestOf(tampered.manifest.causal) }) };
    expect((await compareRuns(a, b))).toMatchObject({ status: 'inconclusive', note: 'causal-mismatch' });
  });

  test('tampered tape (recorded rule changed): the replay diverges from the stored fingerprints', async () => {
    const bad = roundTrip(rec.tape); bad.dailyRuleId = 'heavyPackets';
    const r = await compareRuns(trace(() => liveScene(), { reference: reference() }), trace(() => replayScene(RunScene, bad, env)));
    expect(r.status).toBe('diverged');
    expect(resolveReplaySetup(bad).dailyRuleId).toBe('heavyPackets');
  });

  test('tampered tape inputs change the tape digest the manifest binds', () => {
    const bad = roundTrip(rec.tape); bad.inputs[1][1] ^= 1;
    const good = parseCanonical(rec.bytes);
    const tapeDigest = digestOf({ format: 'bb-input-tape', formatVersion: 1, protocol: { id: 'bb-pad', version: 1 }, tickHz: 120, endTick: bad.endTick, inputs: bad.inputs });
    expect(tapeDigest).not.toBe(good.manifest.causal.input.tapeDigest);
  });
});

describe('S2: a tape from before the magnet gate (magnets always dropped) replays without a desync', () => {
  const PRE_FIELDS = ['magnetsDrop', 'kodiaksOn', 'kodiakPackMode', 'kodiakVersion', 'syncLevel', 'bsod', 'dailyRuleSource', 'edgeRows'];
  /** What the recorder wrote between da8935a (ghost tapes) and 3b6b961 (Sync Level 5 magnet gate + magnetsDrop field). */
  const preGateTape = (tape) => { const t = roundTrip(tape); for (const k of PRE_FIELDS) delete t[k]; return t; };
  let tape;

  beforeAll(() => {
    // Sync Level 5: magnets drop (>= 5), bears do not (< 6) -- the world a pre-gate tape was recorded in
    // seed S5 was found by search: with magnets off its replay desyncs at tick 480 (shards the magnet would have pulled)
    setDay(DAY_REC);
    const scene = createRun(RunScene, REG, { seed: 'S5', level: 5 });
    const pad = (t) => ({ push: t < 300, tilt: 0, variableHop: true, noAutoNudge: true, tuck: t > 500 && t < 540, pressed: {} });
    scene.inputRouter = { poll: () => pad(scene.simClock.tick + 1), setEnabled() {} };
    while (scene.simClock.tick < END) tick(scene);
    expect(scene.magnetsDrop).toBe(true);
    expect(scene.kodiaksOn).toBe(false);
    tape = scene.ghostRecorder.finish({ runId: 's2', distanceM: 1, score: 1, endedAt: 1 });
    jest.useRealTimers();
  });

  const replayDesync = (t, level) => {
    const sc = replayScene(RunScene, t, { day: DAY_OTHER, level, settings: {}, gym: false });
    while (sc.simClock.tick < END) tick(sc);
    return { desync: sc.tapePlayer.desync, checked: sc.tapePlayer.checked, scene: sc };
  };

  test('absent magnetsDrop defaults to ON: no desync at any profile level, and the defaults are reported', () => {
    const t = preGateTape(tape);
    expect(resolveReplaySetup(t).defaulted.sort()).toEqual(['kodiak', 'magnetsDrop', 'syncLevel']);
    for (const level of [1, 8, 40]) {
      const r = replayDesync(t, level);
      expect(r.scene.magnetsDrop).toBe(true);
      expect(r.scene.kodiaksOn).toBe(false);
      expect(r.desync).toBeNull();
      expect(r.checked).toBe(5);
    }
  });

  test('control: the same tape with magnets forced off (the old wrong default) does desync, so the test has teeth', () => {
    const t = { ...preGateTape(tape), magnetsDrop: false };
    const r = replayDesync(t, 8);
    expect(r.desync).not.toBeNull();
    expect(r.desync.tick).toBe(480);
  });
});
