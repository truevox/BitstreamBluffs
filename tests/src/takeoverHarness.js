// Shared helpers for the #72 takeover Jest tests: the REAL RunScene under the headless harness (tests/replay/headlessRun.js).
import fs from 'node:fs';
import { jest } from '@jest/globals';

const { installPhaserStub, createRun, inert } = await import('../replay/headlessRun.js');
export const { Phaser } = installPhaserStub(jest);
Phaser.VERSION = '3.90.0';
export const { RunScene } = await import('../../src/scenes/RunScene.js');
export const { REG, SCENES } = await import('../../src/constants.js');
export const { EVT } = await import('../../src/events.js');
export const { RULESET_KEY, BUILD_ID_KEY } = await import('../../src/systems/replay/evidenceCapture.js');
const { composeCurrentBuildIdentity } = await import('../../src/systems/savestate/runtimeIdentity.js');
export const { captureCausalState } = await import('../../src/systems/replay/fingerprintCapture.js');
export const { fingerprintState } = await import('../../src/systems/replay/fingerprint.js');
export { createRun, inert };

const CURRENT = JSON.parse(fs.readFileSync('tools/ruleset/current.json', 'utf8'));
export const RULESET = { rulesetId: CURRENT.rulesetId, doc: JSON.parse(fs.readFileSync(CURRENT.archivePath, 'utf8')) };
export const BUILD_ID = composeCurrentBuildIdentity(RULESET).buildId;

export const fp = (scene) => fingerprintState(captureCausalState(scene)).combined;
export const roundTrip = (v) => JSON.parse(JSON.stringify(v));

/** A scripted live pad (variable by tick) with the shape InputRouter.poll() returns. */
export function livePad(over = {}) {
  return { push: false, tilt: 0, tuck: false, brake: false, hop: false, reset: false, heli: 0, airBrake: false, parachute: false,
    divebomb: false, corkscrew: false, pause: false, pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false },
    lastSource: 'keyboard', ...over, pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false, ...(over.pressed || {}) } };
}

/** Record a real run headless with a scripted input; returns {scene, tape, record, events, ticks}. */
export function recordRun({ seed = 'TKOVR72', level = 1, padFor, maxTicks = 20000, settings = {}, biomeMask = 0, SceneClass = RunScene, loadRuleset = true, fpEvery = 20 } = {}) {
  // The game loads the ruleset into the registry at boot, long before any run starts: do the same, BEFORE create().
  class Booted extends SceneClass {
    create() { if (loadRuleset) { this.registry.set(RULESET_KEY, RULESET); this.registry.set(BUILD_ID_KEY, BUILD_ID); } super.create(); }
  }
  const scene = createRun(Booted, REG, { seed, level, settings, biomeMask });
  const events = [];
  const emit = scene.game.events.emit.bind(scene.game.events);
  scene.game.events.emit = (e, ...a) => { events.push([e, ...a]); return emit(e, ...a); };
  scene.inputRouter = { poll: () => padFor(scene.simClock.tick + 1), setEnabled() {} };
  const tickMs = scene.simClock.tickMs;
  const fps = new Map();
  let n = 0;
  while (!scene.crashed && n < maxTicks) { scene.update(0, tickMs); n++; if (scene.simClock.tick % fpEvery === 0) fps.set(scene.simClock.tick, fp(scene)); }
  const tape = scene.registry.get(REG.LAST_GHOST_TAPE) || null;
  return { scene, tape: tape && roundTrip(tape), record: scene.registry.get(REG.LAST_RECORD) || null, events, ticks: scene.simClock.tick, fps };
}

/** The default scripted input used by the takeover tests: push, then coast (crashes on its own on most seeds). */
export const coastPad = (t) => livePad({ push: t < 400, variableHop: true, noAutoNudge: true });
