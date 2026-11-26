/**
 * OWNER: core-logic engineer. NO Phaser imports. Glue between the game's events and the attempt history (issue #68).
 */
import { REG, STORAGE } from '../../constants.js';
import { EVT } from '../../events.js';
import { sanitizeAttemptKeep, sanitizeMontageStyle } from './montageSettings.js';

/**
 * game.registry key of the AttemptHistory instance. Kept here, not in constants.REG: constants.js is a causal
 * tripwire file (tools/ruleset), and this cosmetic store must not move the build identity.
 */
export const ATTEMPT_HISTORY_KEY = 'attemptHistory';

/** The settings this feature owns. Other tabs may change them; this tab must follow (PR #378 review P1). */
const OWNED = Object.freeze({ attemptHistoryKeep: sanitizeAttemptKeep, cemeteryMontage: sanitizeMontageStyle });

/**
 * Owned settings exactly as persisted in localStorage now, or null when that cannot be read (no storage, a throwing
 * accessor, nothing saved yet, unparsable). Null never means "defaults": the caller's live copy then stands, so a
 * storage hiccup can never turn a player's 0 back into 5.
 * @param {any} [win]
 * @returns {object|null}
 */
export function persistedSettings(win = typeof window !== 'undefined' ? window : undefined) {
  try {
    const raw = (win && win.localStorage ? win.localStorage : globalThis.localStorage)?.getItem(STORAGE.settingsKey);
    if (typeof raw !== 'string') return null;
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' && 'attemptHistoryKeep' in obj ? obj : null;
  } catch { return null; }
}

/**
 * Called by services.updateSetting BEFORE it saves the whole settings object (PR #378/#382 review, Morgan): every
 * owned setting EXCEPT the one being changed is refreshed from what is persisted, so saving an unrelated preference
 * (or the other owned setting) in a tab that has not yet heard another tab's change can never write a stale
 * retention choice back. The key being changed is the player's explicit choice and is left alone. Mutates in place.
 * @param {object} settings the live settings object about to be saved
 * @param {string} key the setting being changed
 * @param {any} [win]
 */
export function protectOwnedSettings(settings, key, win) {
  if (!settings || typeof settings !== 'object') return;
  const p = persistedSettings(win);
  if (!p) return;
  for (const [k, clean] of Object.entries(OWNED)) if (k !== key && k in p) settings[k] = clean(p[k]);
}

/**
 * Issue #68: keep each finished run's pose trace in the attempt history (when the player keeps any), and apply a
 * lowered PAST ATTEMPTS TO KEEP at once. Listens to RUN_END, which RunScene emits after it has stored the run's ghost
 * tape in REG.LAST_GHOST_TAPE: the run scene itself is not changed. Gym, replay and guest-practice runs record no tape,
 * so they are never kept. Failures are swallowed: history is cosmetic and must never break the end of a run.
 *
 * Several tabs: the PERSISTED setting (localStorage `bb.settings`, written by SaveStore.saveSettings) is the source of truth, not this
 * tab's startup copy in the registry. It is read again inside the history's own write transaction, so a 0 saved by
 * another tab is honoured even at the last moment. A same-origin `storage` event copies the owned settings into this
 * tab's live settings object (so a later unrelated save here cannot write a stale value back) and trims when lowered.
 * @param {Phaser.Game} game
 * @param {import('./AttemptHistory.js').AttemptHistory} history
 * @param {{win?:any}} [o] window override (tests)
 * @returns {function():void} uninstall
 */
export function installAttemptHistory(game, history, { win = typeof window !== 'undefined' ? window : undefined } = {}) {
  const live = () => game.registry.get(REG.SETTINGS) || null;
  const persisted = () => persistedSettings(win);
  /** Copy persisted owned settings into the live object (no save, no event). @returns {{before:number, after:number}} */
  const sync = () => {
    const st = live();
    const before = sanitizeAttemptKeep(st?.attemptHistoryKeep);
    const p = persisted();
    if (st && p) for (const [k, clean] of Object.entries(OWNED)) if (k in p) st[k] = clean(p[k]);
    return { before, after: sanitizeAttemptKeep(st ? st.attemptHistoryKeep : p?.attemptHistoryKeep) };
  };
  /** The keep value at this instant: persisted when readable, else this tab's live copy. */
  const keepNow = () => {
    const p = persisted();
    return sanitizeAttemptKeep(p ? p.attemptHistoryKeep : live()?.attemptHistoryKeep);
  };
  const onRunEnd = (payload) => {
    try {
      const record = payload && payload.record;
      const tape = game.registry.get(REG.LAST_GHOST_TAPE);
      if (!record || !tape || tape.runId !== record.id) return;
      if (sync().after === 0) return;
      // keepNow is evaluated again inside the write transaction (see AttemptHistory.record).
      history.record(tape, keepNow).catch(() => {});
    } catch { /* cosmetic */ }
  };
  const onSettings = (e) => {
    if (e && e.key === 'attemptHistoryKeep') history.trim(keepNow).catch(() => {});
  };
  const onStorage = (e) => {
    try {
      if (e && e.key !== null && e.key !== STORAGE.settingsKey) return; // null = storage cleared
      const { before, after } = sync();
      if (after < before || after === 0) history.trim(keepNow).catch(() => {});
    } catch { /* cosmetic */ }
  };
  game.events.on(EVT.RUN_END, onRunEnd);
  game.events.on(EVT.SETTINGS_CHANGED, onSettings);
  try { win?.addEventListener?.('storage', onStorage); } catch { /* no window */ }
  return () => {
    game.events.off(EVT.RUN_END, onRunEnd);
    game.events.off(EVT.SETTINGS_CHANGED, onSettings);
    try { win?.removeEventListener?.('storage', onStorage); } catch { /* no window */ }
  };
}
