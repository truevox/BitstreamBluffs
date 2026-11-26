/**
 * #72: the ways a scene hands a validated takeover descriptor to RunScene, plus the PauseScene decisions. No Phaser import;
 * a scene is used through its public `scene` / `registry` / `game` members only, so it is unit-testable. NO persistence:
 * only the in-memory registry.
 */
import { REG, SCENES } from '../constants.js';
import { EVT } from '../events.js';
import { retryDescriptor } from '../systems/replay/Takeover.js';
import { CURRENT_RULESET_ID } from '../systems/replay/currentRulesetId.js';

/** Set every one-shot the ordinary start paths set, so a stale Daily / Gym / guest flag can never ride along. */
export function primeTakeover(registry, descriptor) {
  registry.set(REG.TAKEOVER, descriptor);
  registry.set(REG.SEED, descriptor.tape.seed);
  registry.set(REG.BIOME_MASK, Number(descriptor.tape.biomeMask) || 0);
  registry.set(REG.DAILY_OFFICIAL, false);
  registry.set(REG.DAILY_MODE, 'classic');
  registry.set(REG.DAILY_DRAFT_RANKS, {});
  registry.set(REG.BSOD_GYM, false);
  registry.remove(REG.GUEST_PRACTICE);
  registry.remove(REG.GHOST_REPLAY);
}

/** @param {Phaser.Scene} scene any scene @param {object} descriptor Takeover.buildTakeoverDescriptor / retryDescriptor */
export function launchTakeover(scene, descriptor) {
  primeTakeover(scene.registry, descriptor);
  try { scene.scene.stop(SCENES.UI); } catch (e) { /* not running */ }
  scene.scene.start(SCENES.RUN);
}

/**
 * PauseScene RESTART during a takeover = RETRY FROM THE SAME TICK of the same parent tape (re-validated), never a new run.
 * If the descriptor no longer validates it QUITS (visible reason); it never falls through to an ordinary restart.
 * @returns {boolean} true when the pause scene belongs to a takeover (handled), false when it does not
 */
export function pauseRestartTakeover(pause) {
  const run = pause.scene.get(SCENES.RUN);
  if (!run || !run.takeover) return false;
  const r = retryDescriptor(run.takeover.descriptor, { rulesetId: CURRENT_RULESET_ID });
  if (!r.ok) {
    pause.registry.set(REG.TAKEOVER_NOTICE, { reason: r.reason, message: r.message, at: Date.now() });
    return pauseQuitTakeover(pause);
  }
  try {
    pause.game.events.emit(EVT.RUN_ABORT, { runId: run.runId, reason: 'takeover-restart', practice: true, takeover: true, pauseToken: pause.manualPauseToken });
  } catch (e) { console.warn('Takeover restart observer failed; continuing', e); }
  primeTakeover(pause.registry, r.descriptor);
  pause.scene.stop(SCENES.RUN);
  pause.scene.stop(SCENES.UI);
  pause.scene.start(SCENES.RUN);
  return true;
}

/** PauseScene QUIT during a takeover: keep the live tape in memory, RUN_ABORT {takeover-ended}, then the end screen (not the title). */
export function pauseQuitTakeover(pause) {
  const run = pause.scene.get(SCENES.RUN);
  if (!run || !run.takeover) return false;
  if (run.endTakeover('quit')) { pause.scene.stop(SCENES.PAUSE); return true; }
  // already leaving (a crash raced the quit): just close the pause scene
  pause.scene.stop(SCENES.PAUSE);
  return true;
}
