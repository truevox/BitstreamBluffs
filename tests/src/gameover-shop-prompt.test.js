/**
 * W4.1 — the shop autoprompt on Game Over.
 *
 * CC Friday's four required scene cases (notes/cc-friday-shop-popup-2.txt, item 5 of the original note):
 *   (a) pops when affordable, (b) does not pop when broke, (c) retry works while it is open, (d) no errors
 *   on shutdown mid-popup.
 *
 * These call the scene's own methods on a stub context, the way the existing Game Over tests do, rather than
 * re-implementing the decision. The economy rules themselves live in shop-prompt.test.js; this file is only
 * about when the panel appears and who wins the input race.
 */
import { jest } from '@jest/globals';
jest.unstable_mockModule('phaser', () => ({ default: { Scene: class {}, GameObjects: new Proxy({}, { get: () => class {} }) } }));
jest.unstable_mockModule('../../src/data/index.js', () => ({ content: {}, loadContent: () => ({}) }));
const { GameOverScene } = await import('../../src/scenes/GameOverScene.js');
const { REG, SCENES } = await import('../../src/constants.js');
const { SHOP_ITEMS } = await import('../../src/systems/ProfileStore.js');

const proto = GameOverScene.prototype;

/** A profile with enough bank to buy the cheapest paid item. */
const rich = () => ({
  v: 1, level: 2, bank: 200, xp: 0,
  unlocked: { biomes: [], cosmetics: [], boosts: {} },
  equipped: {}, boosts: {},
});

/** A profile with nothing to spend. */
const broke = () => ({
  v: 1, level: 1, bank: 0, xp: 0,
  unlocked: { biomes: [], cosmetics: [], boosts: {} },
  equipped: {}, boosts: {},
});

/**
 * Minimal Game Over scene: registry, a timer fake that records and can fire the delayed call, and spies for
 * the two actions that leave the screen.
 */
function scene(o = {}) {
  const values = new Map();
  values.set(REG.PROFILE, o.profile || broke());
  if (o.awards !== undefined) values.set(REG.LAST_AWARDS, o.awards);
  else values.set(REG.LAST_AWARDS, { xp: { total: 10, parts: [] }, shopAutoprompt: Boolean(o.prompt) });

  const timers = [];
  let nextId = 1;
  const ctx = {
    alive: true,
    leaving: false,
    entry: null,
    shopOpen: false,
    shopView: null,
    shopHint: null,
    shopTimer: null,
    theme: { pal: {}, bind: () => () => {} },
    registry: { get: (k) => values.get(k), set: (k, v) => values.set(k, v) },
    time: {
      delayedCall: (ms, fn) => {
        const t = { id: nextId++, ms, fn, removed: false, remove() { this.removed = true; return this; } };
        timers.push(t);
        return t;
      },
    },
    add: { existing: () => {} },
    _anythingAffordable: proto._anythingAffordable,
    _cancelShopAutoprompt: proto._cancelShopAutoprompt,
    _resumeShopAutoprompt: proto._resumeShopAutoprompt,
    shopPending: false,
    _closeShop: proto._closeShop,
    _hideShopHint: proto._hideShopHint,
    _buildShopHint() { this.shopHint = { destroy() {} }; },
    _openShop() { this.shopOpen = true; this.shopView = { destroy: jest.fn(), handleAction: jest.fn() }; },
    retry: jest.fn(function retry() { this.retried = true; }),
    newSeed: jest.fn(),
    toTitle: jest.fn(),
  };
  ctx.values = values;
  ctx.timers = timers;
  return ctx;
}

/** Run the auto-open timer if it is still pending. */
function fireTimer(ctx) {
  const t = ctx.timers.find((x) => !x.removed);
  if (!t) return false;
  t.removed = true; // a delayedCall runs once
  t.fn();
  return true;
}

describe('(a) pops when the run made something affordable', () => {
  test('the service decision reaches the scene and opens the shop after the delay', () => {
    const ctx = scene({ profile: rich(), prompt: true });
    const shopSpy = jest.spyOn(ctx, '_openShop');
    proto._buildShopAccess.call(ctx);
    expect(ctx.timers.length).toBe(1);
    expect(shopSpy).not.toHaveBeenCalled(); // not before the delay: it must not interrupt the count-up
    fireTimer(ctx);
    expect(shopSpy).toHaveBeenCalledTimes(1);
    shopSpy.mockRestore();
  });

  test('the delay is the settled-count-up value, not zero', () => {
    const ctx = scene({ profile: rich(), prompt: true });
    proto._buildShopAccess.call(ctx);
    expect(ctx.timers[0].ms).toBeGreaterThanOrEqual(1000);
    expect(ctx.timers[0].ms).toBeLessThanOrEqual(2000);
  });

  test('the footer hint is shown when anything is affordable', () => {
    const ctx = scene({ profile: rich(), prompt: false });
    proto._buildShopAccess.call(ctx);
    expect(ctx.shopHint).not.toBeNull();
  });

  test('the hint appears even when the popup does not fire (stockpile player)', () => {
    // This is the amendment's item 3: no interruption, but the shop is still discoverable.
    const ctx = scene({ profile: rich(), prompt: false });
    const shopSpy = jest.spyOn(ctx, '_openShop');
    proto._buildShopAccess.call(ctx);
    expect(ctx.shopHint).not.toBeNull();
    expect(ctx.timers.length).toBe(0);
    expect(shopSpy).not.toHaveBeenCalled();
    shopSpy.mockRestore();
  });
});

describe('(b) does not pop when broke', () => {
  test('no timer and no hint when nothing is affordable', () => {
    const ctx = scene({ profile: broke(), prompt: false });
    proto._buildShopAccess.call(ctx);
    expect(ctx.timers.length).toBe(0);
    expect(ctx.shopHint).toBeNull();
  });

  test('a service flag of false never opens the shop, however rich the player', () => {
    // Belt and braces: the scene obeys the published decision rather than re-deriving it.
    const ctx = scene({ profile: rich(), prompt: false });
    const shopSpy = jest.spyOn(ctx, '_openShop');
    proto._buildShopAccess.call(ctx);
    expect(fireTimer(ctx)).toBe(false);
    expect(shopSpy).not.toHaveBeenCalled();
    shopSpy.mockRestore();
  });

  test('no awards at all (a quit/non-credited run) means no popup', () => {
    const ctx = scene({ profile: rich() });
    ctx.values.set(REG.LAST_AWARDS, null);
    const shopSpy = jest.spyOn(ctx, '_openShop');
    proto._buildShopAccess.call(ctx);
    expect(ctx.timers.length).toBe(0);
    expect(shopSpy).not.toHaveBeenCalled();
    shopSpy.mockRestore();
  });
});

describe('(c) retry wins while the shop is open', () => {
  test('confirm closes the shop and retries immediately', () => {
    const ctx = scene({ profile: rich(), prompt: true });
    proto._buildShopAccess.call(ctx);
    fireTimer(ctx);
    expect(ctx.shopOpen).toBe(true);
    proto._onAction.call(ctx, 'confirm');
    expect(ctx.shopOpen).toBe(false);
    expect(ctx.retry).toHaveBeenCalledTimes(1);
  });

  test('the shop does not get the confirm that retries', () => {
    const ctx = scene({ profile: rich(), prompt: true });
    ctx._onAction = proto._onAction;
    proto._buildShopAccess.call(ctx);
    fireTimer(ctx);
    const handle = ctx.shopView.handleAction;
    proto._onAction.call(ctx, 'confirm');
    expect(handle).not.toHaveBeenCalled();
  });

  test('cancel closes the shop and stays on Game Over', () => {
    const ctx = scene({ profile: rich(), prompt: true });
    proto._buildShopAccess.call(ctx);
    fireTimer(ctx);
    proto._onAction.call(ctx, 'cancel');
    expect(ctx.shopOpen).toBe(false);
    expect(ctx.retry).not.toHaveBeenCalled();
    expect(ctx.toTitle).not.toHaveBeenCalled();
  });

  test('new seed closes the shop and starts a new run', () => {
    const ctx = scene({ profile: rich(), prompt: true });
    proto._buildShopAccess.call(ctx);
    fireTimer(ctx);
    proto._onAction.call(ctx, 'alt');
    expect(ctx.shopOpen).toBe(false);
    expect(ctx.newSeed).toHaveBeenCalledTimes(1);
  });

  test('cursor keys still belong to the shop', () => {
    const ctx = scene({ profile: rich(), prompt: true });
    proto._buildShopAccess.call(ctx);
    fireTimer(ctx);
    const handle = ctx.shopView.handleAction;
    proto._onAction.call(ctx, 'down');
    expect(handle).toHaveBeenCalledWith('down');
    expect(ctx.shopOpen).toBe(true);
  });

  test('any input before the timer fires cancels the auto-open', () => {
    const ctx = scene({ profile: rich(), prompt: true });
    proto._buildShopAccess.call(ctx);
    proto._onAction.call(ctx, 'down');
    expect(ctx.shopTimer).toBeNull();
    expect(fireTimer(ctx)).toBe(false);
    expect(ctx.shopOpen).toBe(false);
  });

  test('retry before the timer fires leaves no popup behind', () => {
    const ctx = scene({ profile: rich(), prompt: true });
    proto._buildShopAccess.call(ctx);
    proto._onAction.call(ctx, 'confirm');
    expect(ctx.retried).toBe(true);
    expect(fireTimer(ctx)).toBe(false);
  });

  test('B opens the shop on demand when something is affordable', () => {
    const ctx = scene({ profile: rich(), prompt: false });
    proto._buildShopAccess.call(ctx);
    proto._onAction.call(ctx, 'shop');
    expect(ctx.shopOpen).toBe(true);
  });

  test('B does nothing when nothing is affordable', () => {
    const ctx = scene({ profile: broke(), prompt: false });
    proto._buildShopAccess.call(ctx);
    proto._onAction.call(ctx, 'shop');
    expect(ctx.shopOpen).toBe(false);
  });
});

describe('(d) shutdown mid-popup is clean', () => {
  test('a pending timer is removed on shutdown', () => {
    const ctx = scene({ profile: rich(), prompt: true });
    proto._buildShopAccess.call(ctx);
    const t = ctx.shopTimer;
    proto._cancelShopAutoprompt.call(ctx);
    expect(t.removed).toBe(true);
    expect(ctx.shopTimer).toBeNull();
  });

  test('an open shop is torn down on shutdown without throwing', () => {
    const ctx = scene({ profile: rich(), prompt: true });
    proto._buildShopAccess.call(ctx);
    fireTimer(ctx);
    const view = ctx.shopView;
    expect(() => proto._closeShop.call(ctx)).not.toThrow();
    expect(view.destroy).toHaveBeenCalled();
    expect(ctx.shopOpen).toBe(false);
  });

  test('a shop whose destroy throws does not wedge the screen', () => {
    const ctx = scene({ profile: rich(), prompt: true });
    proto._buildShopAccess.call(ctx);
    fireTimer(ctx);
    ctx.shopView.destroy = jest.fn(() => { throw new Error('already destroyed'); });
    expect(() => proto._closeShop.call(ctx)).not.toThrow();
    expect(ctx.shopOpen).toBe(false);
  });

  test('the timer callback is inert once the scene is gone', () => {
    const ctx = scene({ profile: rich(), prompt: true });
    proto._buildShopAccess.call(ctx);
    const t = ctx.shopTimer;
    ctx.alive = false;
    expect(() => t.fn()).not.toThrow();
    expect(ctx.shopOpen).toBe(false);
  });

  test('the timer callback never opens the shop during initials entry, but remembers it', () => {
    const ctx = scene({ profile: rich(), prompt: true });
    proto._buildShopAccess.call(ctx);
    ctx.entry = { handleAction: jest.fn() };
    fireTimer(ctx);
    expect(ctx.shopOpen).toBe(false);
    expect(ctx.shopPending).toBe(true);
  });

  // CC Friday, shop-popup rejection 1: a run that also makes the Top-10 opens initials entry, which used to
  // swallow the popup for good. Early runs on a thin board are exactly when prices get crossed.
  test('the popup that fired under initials entry opens once the entry closes', () => {
    const ctx = scene({ profile: rich(), prompt: true });
    proto._buildShopAccess.call(ctx);
    ctx.entry = { handleAction: jest.fn() };
    fireTimer(ctx);
    ctx.entry = null; // SAVE or SKIP
    proto._resumeShopAutoprompt.call(ctx);
    expect(ctx.shopOpen).toBe(false); // after a beat, not on the same frame as the board appearing
    expect(fireTimer(ctx)).toBe(true);
    expect(ctx.shopOpen).toBe(true);
    expect(ctx.shopPending).toBe(false);
  });

  test('typing in the entry does not drop the pending popup', () => {
    const ctx = scene({ profile: rich(), prompt: true });
    proto._buildShopAccess.call(ctx);
    ctx.entry = { handleAction: jest.fn() };
    fireTimer(ctx);
    proto._onAction.call(ctx, 'up');
    expect(ctx.shopPending).toBe(true);
  });

  test('closing the entry with nothing pending opens nothing', () => {
    const ctx = scene({ profile: rich(), prompt: false });
    proto._buildShopAccess.call(ctx);
    proto._resumeShopAutoprompt.call(ctx);
    expect(fireTimer(ctx)).toBe(false);
    expect(ctx.shopOpen).toBe(false);
  });

  test('retry after the entry closes cancels the resumed popup', () => {
    const ctx = scene({ profile: rich(), prompt: true });
    proto._buildShopAccess.call(ctx);
    ctx.entry = { handleAction: jest.fn() };
    fireTimer(ctx);
    ctx.entry = null;
    proto._resumeShopAutoprompt.call(ctx);
    proto._onAction.call(ctx, 'confirm');
    expect(ctx.retried).toBe(true);
    expect(fireTimer(ctx)).toBe(false);
    expect(ctx.shopOpen).toBe(false);
  });

  test('a resumed popup is inert once the scene is gone', () => {
    const ctx = scene({ profile: rich(), prompt: true });
    proto._buildShopAccess.call(ctx);
    ctx.entry = { handleAction: jest.fn() };
    fireTimer(ctx);
    ctx.entry = null;
    proto._resumeShopAutoprompt.call(ctx);
    ctx.alive = false;
    expect(() => fireTimer(ctx)).not.toThrow();
    expect(ctx.shopOpen).toBe(false);
  });

  test('the TITLE button does not promise B, which belongs to the shop', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../src/scenes/GameOverScene.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/label: 'TITLE', hint: 'ESC \/ B'/);
  });
});

describe('the hint advertises a key that exists', () => {
  test('the shop key is mapped in MenuInput, so the footer is not lying', async () => {
    const src = await import('node:fs/promises').then((fs) => fs.readFile(
      new URL('../../src/ui/MenuInput.js', import.meta.url), 'utf8',
    ));
    expect(src).toMatch(/b:\s*'shop'/);
    expect(src).toMatch(/B:\s*'shop'/);
  });
});

describe('the hint does not overlap the footer at 480x270', () => {
  // Geometry, not eyeballing: the footer's three strings are the widest things on that row, and the hint is
  // right-anchored 4px from the edge. If a future edit widens the hint or lengthens a footer string, this
  // fails instead of shipping overlapping text.
  test('every footer variant clears the hint', async () => {
    const { measureText } = await import('../../src/ui/PixelFont.js');
    const { GAME_WIDTH } = await import('../../src/constants.js');
    const hintW = measureText(`SHOP: ${'B'}`);
    const hintLeft = GAME_WIDTH - 4 - hintW;
    const footers = [
      'SPACE / ENTER / A / TAP = RETRY SAME SEED',
      'TYPE INITIALS - ENTER SAVE - SPACE SAVE + RETRY',
      'SPACE = SAVE + RETRY   ESC = SKIP',
    ];
    for (const f of footers) {
      const w = measureText(f);
      const right = Math.round(GAME_WIDTH / 2) - w / 2 + w;
      expect(right).toBeLessThanOrEqual(hintLeft);
    }
  });

  test('a short hint leaves real daylight, not a hairline', async () => {
    const { measureText } = await import('../../src/ui/PixelFont.js');
    const { GAME_WIDTH } = await import('../../src/constants.js');
    const hintLeft = GAME_WIDTH - 4 - measureText('SHOP: B');
    const widestFooterRight = Math.round(GAME_WIDTH / 2) + measureText('TYPE INITIALS - ENTER SAVE - SPACE SAVE + RETRY') / 2;
    expect(hintLeft - widestFooterRight).toBeGreaterThan(8);
  });
});

describe('the catalogue still has something to buy', () => {
  test('at least one paid item exists, or this feature is dead code', () => {
    expect(SHOP_ITEMS.some((i) => i.price > 0)).toBe(true);
  });
});
