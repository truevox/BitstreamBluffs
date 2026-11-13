/**
 * FOUNDATION-OWNED glue. Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 * Creates the long-lived services ONCE and shares them through game.registry (keys in constants.REG).
 */
import { REG } from './constants.js';
import { EVT } from './events.js';
import { loadContent } from './data/index.js';
import { SaveStore } from './systems/SaveStore.js';
import { InputRouter } from './systems/InputRouter.js';
import { AudioSynth } from './systems/AudioSynth.js';
import { createProgressionService } from './systems/ProgressionService.js';
import { createMissionsService } from './systems/MissionsService.js';

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
  const settings = saveStore.loadSettings();
  game.registry.set(REG.SAVE_STORE, saveStore);
  game.registry.set(REG.SETTINGS, settings);
  game.registry.set(REG.CONTENT, loadContent());
  game.registry.set(REG.INPUT, new InputRouter(game));
  game.registry.set(REG.AUDIO, new AudioSynth(game));
  if (!game.registry.get(REG.SEED)) game.registry.set(REG.SEED, String(Date.now()));
  game.registry.get(REG.INPUT).applySettings(settings);
  game.registry.get(REG.AUDIO).applySettings(settings);
  // W1: progression service (profile load + one-time backfill + RUN_END listener). Additive.
  const progression = await createProgressionService(game, { levels: game.registry.get(REG.CONTENT).progression });
  game.registry.set(REG.PROGRESSION, progression);
  // W2: missions. The service is created after progression so it can borrow the already-loaded
  // profile store, and it is attached to progression BEFORE RUN_END can fire (both happen during
  // preload, before TitleScene exists). Additive.
  const missions = await createMissionsService(game, {
    templates: game.registry.get(REG.CONTENT).missions.templates,
    store: progression.store,
  });
  game.registry.set(REG.MISSIONS_SERVICE, missions);
  progression.missions = missions;
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
