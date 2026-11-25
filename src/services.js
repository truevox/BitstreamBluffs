/**
 * FOUNDATION-OWNED glue. Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 * Creates the long-lived services ONCE and shares them through game.registry (keys in constants.REG).
 */
import { REG } from './constants.js';
import { EVT } from './events.js';
import { loadContent } from './data/index.js';
import { SaveStore } from './systems/SaveStore.js';
import { GhostLibrary } from './systems/ghost/GhostLibrary.js';
import { AttemptHistory } from './systems/ghost/AttemptHistory.js';
import { installAttemptHistory, ATTEMPT_HISTORY_KEY } from './systems/ghost/attemptHistoryService.js';
import { InputRouter } from './systems/InputRouter.js';
import { AudioSynth } from './systems/AudioSynth.js';
import { createProgressionService } from './systems/ProgressionService.js';
import { createMissionsService } from './systems/MissionsService.js';
import { RULESET_KEY } from './systems/replay/evidenceCapture.js';

/**
 * Instantiate SaveStore, load settings, create InputRouter + AudioSynth, load content, set a default seed.
 * Called by PreloadScene.create() (UI engineer) before starting TitleScene. Idempotent.
 * @param {Phaser.Game} game
 * @returns {Promise<void>} resolves when SaveStore.init() finished.
 */
export async function createServices(game) {
  if (game.registry.get(REG.SAVE_STORE)) return;
  const saveStore = new SaveStore();
  await saveStore.init();
  // Issue #56: local ghost tapes per course (IndexedDB, memory fallback; never rejects).
  const ghosts = new GhostLibrary();
  await ghosts.init();
  game.registry.set(REG.GHOSTS, ghosts);
  const settings = saveStore.loadSettings();
  // Issue #68: separate, local-only past-attempt traces for the Cemetery Montage. Never touches the ghost library.
  const history = new AttemptHistory();
  await history.init();
  game.registry.set(ATTEMPT_HISTORY_KEY, history);
  installAttemptHistory(game, history);
  game.registry.set(REG.SAVE_STORE, saveStore);
  game.registry.set(REG.SETTINGS, settings);
  game.registry.set(REG.CONTENT, loadContent());
  // Replay evidence (#116): the committed ruleset of this build. Non-blocking; without it runs simply produce no evidence.
  // (dynamic import: runtimeRuleset.js uses Vite's import.meta.glob, like data/index.js, so Jest must not load it statically)
  import('./systems/replay/runtimeRuleset.js').then((m) => m.loadCurrentRuleset()).then((r) => game.registry.set(RULESET_KEY, r)).catch((e) => console.warn(`[replay-evidence] ruleset unavailable: ${e && e.message}`));
  game.registry.set(REG.INPUT, new InputRouter(game));
  game.registry.set(REG.AUDIO, new AudioSynth(game));
  if (!game.registry.get(REG.SEED)) game.registry.set(REG.SEED, String(Date.now()));
  game.registry.get(REG.INPUT).applySettings(settings);
  game.registry.get(REG.AUDIO).applySettings(settings);
  // W1: progression service (profile load + one-time backfill + RUN_END listener). Additive.
  const progression = await createProgressionService(game, { levels: game.registry.get(REG.CONTENT).progression });
  game.registry.set(REG.PROGRESSION, progression);
  // Profile entitlement is not available during initial AudioSynth
  // construction. Reapply once progression has loaded it so saved,
  // purchased vocal enablement is honored on a new browser session.
  game.registry.get(REG.AUDIO).applySettings(settings);
  // W2: missions. The service is created after progression so it can borrow the already-loaded
  // profile store, and it is attached to progression BEFORE RUN_END can fire (both happen during
  // preload, before TitleScene exists). Additive.
  const missions = await createMissionsService(game, {
    templates: game.registry.get(REG.CONTENT).missions.templates,
    // D7 tier thresholds come from the data, not from a constant in the service.
    tierUnlock: game.registry.get(REG.CONTENT).missions.tierUnlock,
    biomeDefs: Object.values(game.registry.get(REG.CONTENT).biomes || {}),
    store: progression.store,
  });
  game.registry.set(REG.MISSIONS_SERVICE, missions);
  progression.missions = missions;
  // Only PWA-enabled builds include the pinned release index digest. Ordinary
  // Netlify/dev builds do not register a worker or install this controller.
  if (typeof __BB_OFFLINE_INDEX_SHA256__ === 'string') {
    try { await (await import('./systems/music/OfflinePreview.js')).installOfflinePreview(game); }
    catch (e) { console.warn('[offline-preview] unavailable: '+(e?.message||e)); }
  }
}

/**
 * The ONLY way to change a setting: updates registry settings, persists, emits EVT.SETTINGS_CHANGED.
 * @param {Phaser.Game} game
 * @param {keyof import('./systems/SaveStore.js').Settings} key
 * @param {*} value
 * @returns {void}
 */
export function updateSetting(game, key, value) {
  const settings = game.registry.get(REG.SETTINGS);
  settings[key] = value;
  game.registry.get(REG.SAVE_STORE).saveSettings(settings);
  game.events.emit(EVT.SETTINGS_CHANGED, { key, value, settings });
}
