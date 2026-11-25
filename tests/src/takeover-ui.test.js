/** #72 UI wiring on the real RunScene: Pause restart/quit in a takeover, the end screen's retry, notices, the picker's scrub logic. */
import { jest } from '@jest/globals';
const H = await import('./takeoverHarness.js');
const { buildTakeoverDescriptor, retryDescriptor, fmtTickTime, takeoverEligible } = await import('../../src/systems/replay/Takeover.js');
const { pauseRestartTakeover, pauseQuitTakeover, primeTakeover } = await import('../../src/ui/TakeoverLauncher.js');
const { CURRENT_RULESET_ID } = await import('../../src/systems/replay/currentRulesetId.js');
const { takeTakeoverNotice } = await import('../../src/ui/TakeoverNotice.js');
const { TakeoverPicker, PICKER_BANNER } = await import('../../src/ui/TakeoverPicker.js');
const { TakeoverEndScene } = await import('../../src/scenes/TakeoverEndScene.js');

jest.spyOn(Date, 'now').mockReturnValue(1_767_000_000_000);
const scripted = (t) => H.livePad({ push: t < 400, variableHop: true, noAutoNudge: true, hop: t >= 300 && t <= 303, pressed: { hop: t === 300 } });
const REC = H.recordRun({ seed: 'A', padFor: scripted, fpEvery: 1000 });
const TAPE = REC.tape;
const TICK_MS = 1000 / 120;

function liveTakeover(tick = 640) {
  const d = buildTakeoverDescriptor({ tape: TAPE, tick, source: 't' });
  class T extends H.RunScene {
    create() {
      this.__events = []; const emit = this.game.events.emit.bind(this.game.events);
      this.game.events.emit = (e, ...a) => { this.__events.push([e, ...a]); return emit(e, ...a); };
      this.__starts = []; this.scene.start = (...a) => this.__starts.push(['start', ...a]);
      this.registry.set(H.RULESET_KEY, H.RULESET); this.registry.set(H.REG.TAKEOVER, d); super.create();
    }
  }
  const s = H.createRun(T, H.REG, { seed: 'x' });
  s.inputRouter = { poll: () => H.livePad(), setEnabled() {} };
  for (let i = 0; i < 300 && s.takeover.phase === 'seeking'; i++) s.update(0, TICK_MS);
  return { s, d };
}
/** A PauseScene stand-in: what TakeoverLauncher touches (scene manager, registry, game events). */
function fakePause(run) {
  const log = [];
  const p = {
    registry: run.registry, game: run.game, manualPauseToken: 'tok',
    scene: { get: (k) => (k === 'RunScene' ? run : null), stop: (k) => log.push(['stop', k]), start: (k, d) => log.push(['start', k, d]) },
  };
  return { p, log };
}

describe('Pause during a takeover', () => {
  test('RESTART = retry from the SAME tick via a fresh, re-validated descriptor; it never starts a bare (ranked) RunScene', () => {
    const { s, d } = liveTakeover(640);
    const { p, log } = fakePause(s);
    expect(pauseRestartTakeover(p)).toBe(true);
    const next = s.registry.get(H.REG.TAKEOVER);
    expect(next).toBeTruthy();
    expect(next).not.toBe(d); // a fresh, independent attempt
    expect(next.tick).toBe(640);
    expect(next.parentDigest).toBe(d.parentDigest);
    expect(next.source).toBe('retry');
    expect(s.registry.get(H.REG.DAILY_OFFICIAL)).toBe(false);
    expect(log.map((l) => l[0] + ':' + l[1])).toEqual(['stop:RunScene', 'stop:UIScene', 'start:RunScene']);
    const abort = s.__events.find((e) => e[0] === H.EVT.RUN_ABORT)[1];
    expect(abort).toMatchObject({ reason: 'takeover-restart', practice: true, takeover: true });
  });
  test('negative control: with an incompatible descriptor it QUITS with a visible reason instead of restarting', () => {
    const { s } = liveTakeover(640);
    s.takeover = { ...s.takeover, descriptor: { ...s.takeover.descriptor, tape: { ...s.takeover.descriptor.tape, rulesetId: 'sha256:' + 'e'.repeat(64) } } };
    const { p, log } = fakePause(s);
    expect(pauseRestartTakeover(p)).toBe(true);
    expect(s.registry.get(H.REG.TAKEOVER)).toBeUndefined();
    expect(log.some((l) => l[0] === 'start' && l[1] === 'RunScene')).toBe(false);
    expect(s.registry.get(H.REG.TAKEOVER_NOTICE)).toMatchObject({ reason: 'ruleset-mismatch' });
  });
  test('control: an ordinary (non-takeover) RunScene is not handled, so PauseScene keeps its own restart', () => {
    const ord = H.createRun(H.RunScene, H.REG, { seed: 'A' });
    const { p } = fakePause(ord);
    expect(pauseRestartTakeover(p)).toBe(false);
    expect(pauseQuitTakeover(p)).toBe(false);
  });
  test('QUIT in a LIVE takeover keeps the tape in memory, emits RUN_ABORT takeover-ended and goes to the end screen (never Title / GameOver)', () => {
    const { s } = liveTakeover(640);
    s.inputRouter = { poll: () => H.livePad({ hop: true, pressed: { hop: true, confirm: true } }), setEnabled() {} };
    s.update(0, TICK_MS); // READY -> live
    expect(s.takeover.phase).toBe('live');
    s.inputRouter = { poll: () => H.livePad({ push: true }), setEnabled() {} };
    for (let i = 0; i < 40; i++) s.update(0, TICK_MS);
    const { p, log } = fakePause(s);
    expect(pauseQuitTakeover(p)).toBe(true);
    expect(s.__starts.map((a) => a[1])).toEqual(['TakeoverEndScene']);
    expect(s.__starts[0][2]).toMatchObject({ cause: 'quit', descriptor: expect.any(Object) });
    expect(log).toContainEqual(['stop', 'PauseScene']);
    const tape = s.registry.get(H.REG.LAST_TAKEOVER_TAPE);
    expect(tape.mode).toBe('takeover');
    expect(tape.endTick).toBeGreaterThan(640);
    expect(s.__events.find((e) => e[0] === H.EVT.RUN_ABORT)[1]).toMatchObject({ reason: 'takeover-ended', practice: true, takeover: true, cause: 'quit' });
    expect(s.__events.some((e) => e[0] === H.EVT.RUN_END)).toBe(false);
  });
  test('QUIT while READY (nothing recorded yet) still ends cleanly', () => {
    const { s } = liveTakeover(640);
    const { p } = fakePause(s);
    expect(s.takeover.phase).toBe('ready');
    expect(pauseQuitTakeover(p)).toBe(true);
    expect(s.__starts.map((a) => a[1])).toEqual(['TakeoverEndScene']);
    expect(s.registry.get(H.REG.LAST_TAKEOVER_TAPE)).toBeUndefined();
  });
  test('the manual-pause payload marks a takeover (so PauseScene shows the unranked labels) and a guest pause keeps practice only', () => {
    const { s } = liveTakeover(640);
    const seen = [];
    s.game.events.on(H.EVT.GAME_PAUSE, (p) => seen.push(p));
    s.scene.pause = () => {}; s.scene.launch = () => {}; s.scene.isPaused = () => false;
    s.pauseRun();
    expect(seen[0]).toMatchObject({ takeover: true, practice: false });
    const ord = H.createRun(H.RunScene, H.REG, { seed: 'A' });
    const seen2 = []; ord.game.events.on(H.EVT.GAME_PAUSE, (p) => seen2.push(p));
    ord.scene.pause = () => {}; ord.scene.launch = () => {}; ord.scene.isPaused = () => false;
    ord.pauseRun();
    expect(seen2[0]).not.toHaveProperty('takeover');
  });
});

describe('TakeoverEndScene retry', () => {
  const sceneFor = (descriptor, cause = 'crash') => {
    const calls = [];
    const sc = Object.create(TakeoverEndScene.prototype);
    sc.registry = { _m: new Map(), set(k, v) { this._m.set(k, v); }, get(k) { return this._m.get(k); }, remove(k) { this._m.delete(k); } };
    sc.scene = { start: (...a) => calls.push(['start', ...a]), stop: (...a) => calls.push(['stop', ...a]) };
    sc.init({ descriptor, cause });
    sc.leaving = false;
    sc.cameras = { main: {} };
    return { sc, calls };
  };
  test('RETRY rebuilds the descriptor from the parent tape, re-validates, and starts RUN with it', () => {
    const d = buildTakeoverDescriptor({ tape: TAPE, tick: 640 });
    const { sc, calls } = sceneFor(d);
    sc.retry();
    expect(calls.map((c) => c[1])).toEqual(['UIScene', 'RunScene']);
    const next = sc.registry.get(H.REG.TAKEOVER);
    expect(next).not.toBe(d);
    expect(next.tick).toBe(640);
    expect(next.parentDigest).toBe(d.parentDigest);
    expect(sc.registry.get(H.REG.SEED)).toBe(TAPE.seed);
  });
  test('negative control: a tape that stopped being compatible refuses, posts the reason and goes to TITLE', () => {
    const d = buildTakeoverDescriptor({ tape: TAPE, tick: 640 });
    const bad = { ...d, tape: { ...d.tape, simRevision: 1 } };
    const { sc, calls } = sceneFor(bad);
    sc.retry();
    expect(sc.registry.get(H.REG.TAKEOVER)).toBeUndefined();
    expect(calls.map((c) => c[1])).toEqual(['TitleScene']);
    expect(sc.registry.get(H.REG.TAKEOVER_NOTICE)).toMatchObject({ reason: 'sim-revision' });
  });
  test('two retries are independent attempts of the same parent', () => {
    const a = retryDescriptor(buildTakeoverDescriptor({ tape: TAPE, tick: 640 }), { rulesetId: CURRENT_RULESET_ID });
    const b = retryDescriptor(a.descriptor, { rulesetId: CURRENT_RULESET_ID });
    expect(a.ok && b.ok).toBe(true);
    expect(a.descriptor).not.toBe(b.descriptor);
    expect(a.descriptor.tape).not.toBe(b.descriptor.tape);
    expect(a.descriptor.parentDigest).toBe(b.descriptor.parentDigest);
  });
  test('BACK goes to the title; it never starts a run', () => {
    const { sc, calls } = sceneFor(buildTakeoverDescriptor({ tape: TAPE, tick: 640 }));
    sc.back();
    expect(calls.map((c) => c[1])).toEqual(['TitleScene']);
  });
});

describe('Title notice', () => {
  test('the one-shot notice is read once and cleared (control: nothing without a notice)', () => {
    const reg = new Map([[H.REG.TAKEOVER_NOTICE, { reason: 'older-build', message: 'recorded on an older build; not takeover-compatible' }]]);
    const registry = { get: (k) => reg.get(k), remove: (k) => reg.delete(k) };
    expect(takeTakeoverNotice(registry)).toMatchObject({ reason: 'older-build' });
    expect(reg.has(H.REG.TAKEOVER_NOTICE)).toBe(false);
    expect(takeTakeoverNotice(registry)).toBeNull();
  });
  test('a refused RunScene start posts exactly the reason the Title will show', () => {
    const t = JSON.parse(JSON.stringify(TAPE)); delete t.rulesetId;
    class T extends H.RunScene {
      create() { this.registry.set(H.REG.TAKEOVER, { ...buildTakeoverDescriptor({ tape: TAPE, tick: 300 }), tape: t }); super.create(); }
    }
    const s = H.createRun(T, H.REG, { seed: 'x' });
    expect(takeTakeoverNotice(s.registry)).toEqual({ reason: 'older-build', message: 'recorded on an older build; not takeover-compatible', at: expect.any(Number) });
  });
});

describe('TakeoverPicker scrub logic', () => {
  const make = (tape = TAPE, rulesetId = CURRENT_RULESET_ID) => {
    const pk = Object.create(TakeoverPicker.prototype);
    Object.assign(pk, { tape, ctx: { rulesetId }, max: tape.endTick - 1, tick: 600, _shift: false, alive: true, timeText: { setText() {} }, tickText: { setText() {} }, map: null });
    pk._paint = () => {};
    pk.elig = require_takeoverEligible(tape, rulesetId);
    pk.launched = [];
    pk.onLaunch = (t) => pk.launched.push(t);
    pk.close = () => { pk.closed = true; };
    return pk;
  };
  function require_takeoverEligible(t, id) { return takeoverEligible(t, 1, { rulesetId: id }); }

  test('arrows are 1 s, Shift is 5 s, up/down are 5 s, single ticks via step(), always clamped to [1, endTick-1]', () => {
    const pk = make();
    pk.handleAction('right'); expect(pk.tick).toBe(720);
    pk.handleAction('left'); pk.handleAction('left'); expect(pk.tick).toBe(480);
    pk._shift = true; pk.handleAction('right'); expect(pk.tick).toBe(1080);
    pk._shift = false; pk.handleAction('up'); expect(pk.tick).toBe(1680 > pk.max ? pk.max : 1680);
    pk.step(+1); expect(pk.tick).toBeLessThanOrEqual(pk.max);
    pk.setTick(5); pk.step(-1); expect(pk.tick).toBe(4); pk.step(-10); expect(pk.tick).toBe(1);
    pk.handleAction('down'); expect(pk.tick).toBe(1);
    pk.setTick(pk.max - 2); pk.handleAction('right'); expect(pk.tick).toBe(pk.max);
  });
  test('confirm launches at the chosen tick; cancel closes', () => {
    const pk = make();
    pk.setTick(777); pk.handleAction('confirm');
    expect(pk.launched).toEqual([777]);
    pk.handleAction('cancel'); expect(pk.closed).toBe(true);
  });
  test('an ineligible tape shows its reason, ignores scrubbing and can never launch', () => {
    const old = { ...JSON.parse(JSON.stringify(TAPE)) }; delete old.rulesetId;
    const pk = make(old);
    expect(pk.elig).toMatchObject({ ok: false, reason: 'older-build' });
    pk.handleAction('confirm'); pk.launch();
    expect(pk.launched).toEqual([]);
    pk.handleAction('cancel'); expect(pk.closed).toBe(true);
  });
  test('banner text and time format', () => {
    expect(PICKER_BANNER).toBe('UNRANKED PRACTICE / TAS: NO SCORE, XP, SHARDS OR ACHIEVEMENTS');
    expect(fmtTickTime(0)).toBe('0:00.0');
    expect(fmtTickTime(120 * 65 + 60)).toBe('1:05.5');
  });
});

describe('primeTakeover clears every ranked/other-mode one-shot', () => {
  test('stale Daily, Gym, guest and replay flags are reset', () => {
    const m = new Map([[H.REG.DAILY_OFFICIAL, true], [H.REG.BSOD_GYM, true], [H.REG.GUEST_PRACTICE, {}], [H.REG.GHOST_REPLAY, {}], [H.REG.DAILY_MODE, 'draft']]);
    const reg = { set: (k, v) => m.set(k, v), remove: (k) => m.delete(k), get: (k) => m.get(k) };
    primeTakeover(reg, buildTakeoverDescriptor({ tape: TAPE, tick: 300 }));
    expect(m.get(H.REG.DAILY_OFFICIAL)).toBe(false);
    expect(m.get(H.REG.BSOD_GYM)).toBe(false);
    expect(m.get(H.REG.DAILY_MODE)).toBe('classic');
    expect(m.has(H.REG.GUEST_PRACTICE)).toBe(false);
    expect(m.has(H.REG.GHOST_REPLAY)).toBe(false);
    expect(m.get(H.REG.TAKEOVER).kind).toBe('bb-takeover');
  });
});
