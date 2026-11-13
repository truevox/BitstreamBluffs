/**
 * W4 — Game Over initials-entry save/skip keeps a boosted run on the MODDED board.
 *
 * saveEntry() previously queried getLeaderboard(10) and called _showBoard(id) without passing
 * `modded`, so a boosted run that qualified for NEW MODDED TOP 10! flipped the panel to
 * "LEDGER // YOU ARE ON THE BOARD" and queried the clean board as soon as initials were saved.
 * skipEntry() likewise omitted `modded`, flipping the panel title to "LEDGER // TOP 10".
 */
import { jest } from '@jest/globals';

jest.unstable_mockModule('phaser', () => ({ default: { Scene: class {}, GameObjects: new Proxy({}, { get: () => class {} }) } }));
jest.unstable_mockModule('../../src/data/index.js', () => ({ content: {}, loadContent: () => ({}) }));
const { GameOverScene } = await import('../../src/scenes/GameOverScene.js');
const { REG } = await import('../../src/constants.js');

function makeOver(rec, store) {
  let title = '';
  const over = Object.create(GameOverScene.prototype);
  Object.assign(over, {
    rec,
    alive: true,
    leaving: false,
    saved: false,
    entry: { destroy: () => {} },
    rows: [],
    board: { setVisible: jest.fn(), setEntries: jest.fn() },
    right: {
      setColorKey: jest.fn(() => over.right),
      setTitle: jest.fn((t) => { title = t; return over.right; }),
    },
    registry: { get: (k) => (k === REG.SAVE_STORE ? store : undefined) },
    _leaveEntry: jest.fn(() => { over.entry = null; }),
    _persist: jest.fn(async () => true),
  });
  return { over, getTitle: () => title };
}

describe('GameOverScene saveEntry / skipEntry preserve modded board identity', () => {
  test('saveEntry on a modded run queries the modded board and titles MODDED', async () => {
    const store = {
      getLeaderboard: jest.fn(async () => []),
      getModdedLeaderboard: jest.fn(async () => [{ id: 'm1', score: 900, modded: true, initials: 'MRV' }]),
    };
    const { over, getTitle } = makeOver({ id: 'm1', score: 900, modded: true }, store);
    await over.saveEntry('MRV');
    expect(store.getModdedLeaderboard).toHaveBeenCalledWith(10);
    expect(store.getLeaderboard).not.toHaveBeenCalled();
    expect(getTitle()).toBe('MODDED // YOU ARE ON THE BOARD');
    expect(over.modded).toBe(true);
  });

  test('skipEntry on a modded run keeps the MODDED board title', () => {
    const { over, getTitle } = makeOver({ id: 'm2', score: 900, modded: true }, {});
    over.skipEntry();
    expect(getTitle()).toBe('MODDED // TOP 10');
    expect(over.modded).toBe(true);
  });

  test('saveEntry on a clean run still queries the clean board and titles LEDGER', async () => {
    const store = {
      getLeaderboard: jest.fn(async () => [{ id: 'c1', score: 900, modded: false, initials: 'MRV' }]),
      getModdedLeaderboard: jest.fn(async () => []),
    };
    const { over, getTitle } = makeOver({ id: 'c1', score: 900, modded: false }, store);
    await over.saveEntry('MRV');
    expect(store.getLeaderboard).toHaveBeenCalledWith(10);
    expect(store.getModdedLeaderboard).not.toHaveBeenCalled();
    expect(getTitle()).toBe('LEDGER // YOU ARE ON THE BOARD');
    expect(over.modded).toBe(false);
  });
});
