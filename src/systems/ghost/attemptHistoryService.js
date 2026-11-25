/**
 * OWNER: core-logic engineer. NO Phaser imports. Glue between the game's events and the attempt history (issue #68).
 */
import { REG } from '../../constants.js';
import { EVT } from '../../events.js';
import { sanitizeAttemptKeep } from './montageSettings.js';

/**
 * game.registry key of the AttemptHistory instance. Kept here, not in constants.REG: constants.js is a causal
 * tripwire file (tools/ruleset), and this cosmetic store must not move the build identity.
 */
export const ATTEMPT_HISTORY_KEY = 'attemptHistory';

/**
 * Issue #68: keep each finished run's pose trace in the attempt history (when the player keeps any), and apply a
 * lowered PAST ATTEMPTS TO KEEP at once. Listens to RUN_END, which RunScene emits after it has stored the run's ghost
 * tape in REG.LAST_GHOST_TAPE: the run scene itself is not changed. Gym, replay and guest-practice runs record no tape,
 * so they are never kept. Failures are swallowed: history is cosmetic and must never break the end of a run.
 * @returns {function():void} uninstall
 */
export function installAttemptHistory(game, history) {
  const keep = () => sanitizeAttemptKeep(game.registry.get(REG.SETTINGS)?.attemptHistoryKeep);
  const onRunEnd = (payload) => {
    try {
      const record = payload && payload.record;
      const tape = game.registry.get(REG.LAST_GHOST_TAPE);
      if (!record || !tape || tape.runId !== record.id || keep() === 0) return;
      history.record(tape, keep()).catch(() => {});
    } catch { /* cosmetic */ }
  };
  const onSettings = (e) => {
    if (e && e.key === 'attemptHistoryKeep') history.trim(keep()).catch(() => {});
  };
  game.events.on(EVT.RUN_END, onRunEnd);
  game.events.on(EVT.SETTINGS_CHANGED, onSettings);
  return () => { game.events.off(EVT.RUN_END, onRunEnd); game.events.off(EVT.SETTINGS_CHANGED, onSettings); };
}
