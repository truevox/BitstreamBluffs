// Issue #68, PR #378/#382 review (Morgan): saving an unrelated preference in a tab that has not yet heard another
// tab's retention change must never write the stale PAST ATTEMPTS TO KEEP / montage style back.
import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/data/index.js', () => ({ content: {}, loadContent: () => ({}) }));
const { updateSetting } = await import('../../src/services.js');
const { protectOwnedSettings } = await import('../../src/systems/ghost/attemptHistoryService.js');
const { SaveStore } = await import('../../src/systems/SaveStore.js');
const { REG, STORAGE } = await import('../../src/constants.js');

const KEY = STORAGE.settingsKey;
const persisted = () => JSON.parse(localStorage.getItem(KEY));

/** A tab: its own SaveStore and live settings object loaded at "boot" from the shared localStorage. */
function tab() {
  const store = new SaveStore();
  const live = store.loadSettings();
  const reg = new Map([[REG.SETTINGS, live], [REG.SAVE_STORE, store]]);
  const emitted = [];
  return { live, emitted, game: { registry: { get: (k) => reg.get(k) }, events: { emit: (e, p) => emitted.push(p.key) } } };
}

beforeEach(() => localStorage.clear());

test('Morgan ordering: A sets 0, B (not yet notified) changes its palette, the saved limit stays 0', () => {
  const a = tab(), b = tab();
  expect([a.live.attemptHistoryKeep, b.live.attemptHistoryKeep]).toEqual([5, 5]);
  updateSetting(a.game, 'attemptHistoryKeep', 0);
  expect(persisted().attemptHistoryKeep).toBe(0);
  expect(b.live.attemptHistoryKeep).toBe(5); // no storage event delivered to B yet
  updateSetting(b.game, 'palette', 'colorblind');
  expect(persisted()).toMatchObject({ attemptHistoryKeep: 0, palette: 'colorblind' });
  expect(b.live.attemptHistoryKeep).toBe(0); // B adopted the persisted choice while saving
});

test('the same holds for the montage style, and for changing the OTHER owned setting', () => {
  const a = tab(), b = tab();
  updateSetting(a.game, 'cemeteryMontage', 'off');
  updateSetting(a.game, 'attemptHistoryKeep', 2);
  updateSetting(b.game, 'screenShake', false);
  expect(persisted()).toMatchObject({ cemeteryMontage: 'off', attemptHistoryKeep: 2, screenShake: false });
  // B now explicitly changes the style: its own choice wins, the keep value it never touched stays A's 2.
  const c = tab();
  c.live.attemptHistoryKeep = 5; // stale
  updateSetting(c.game, 'cemeteryMontage', 'swarm');
  expect(persisted()).toMatchObject({ cemeteryMontage: 'swarm', attemptHistoryKeep: 2 });
});

test('an explicit change to the limit itself is never overridden by the stored value', () => {
  const a = tab(), b = tab();
  updateSetting(a.game, 'attemptHistoryKeep', 0);
  updateSetting(b.game, 'attemptHistoryKeep', 12); // the player's newer choice in B
  expect(persisted().attemptHistoryKeep).toBe(12);
});

test('nothing readable in storage: the live copy is saved as is (never defaults)', () => {
  const live = { attemptHistoryKeep: 0, cemeteryMontage: 'off', palette: 'default' };
  protectOwnedSettings(live, 'palette', { localStorage: { getItem: () => { throw new Error('SecurityError'); } } });
  expect(live).toEqual({ attemptHistoryKeep: 0, cemeteryMontage: 'off', palette: 'default' });
  protectOwnedSettings(live, 'palette', { localStorage: { getItem: () => null } });
  expect(live.attemptHistoryKeep).toBe(0);
  protectOwnedSettings(live, 'palette', { localStorage: { getItem: () => '{not json' } });
  expect(live.attemptHistoryKeep).toBe(0);
});
