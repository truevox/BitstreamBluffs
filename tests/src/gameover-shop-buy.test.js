/**
 * Marvin decision 7 (2026-11-14): "Enter purchases the clearly selected item in the Game Over shop."
 *
 * The contract, driven through the scene's real _openShop / _onAction / _closeShop on a stub context (the
 * ShopView is faked, so what is asserted is WHO gets the confirm; ShopView's own buy/equip/unequip and paging
 * rules are the Title -> Profile -> Shop ones and are tested in views-navigation / shop-paging):
 *   - an ARMED shop hands Enter / pad A ('confirm') to the ShopView: buy, equip, unequip or turn the page on
 *     the highlighted row;
 *   - Space / pad RB ('retry') close the shop and retry from anywhere, in one press;
 *   - a shop the player asked for (B / LB) is armed at once;
 *   - an UNREQUESTED autoprompt shop arms after SHOP_ARM_MS, or as soon as the player moves its cursor.
 *     Before that, 'confirm' keeps today's close-and-retry, so an Enter already on its way when the popup
 *     appears restarts the run instead of being swallowed (pillar 3: Game Over accepts retry from frame one);
 *   - the footer says BUY / RETRY only once the shop is armed, above the dim, and is restored on close.
 */
import { jest } from '@jest/globals';

const views = [];
class FakeShopView {
  constructor(scene, theme, o) { this.o = o; this.actions = []; this.destroyed = false; views.push(this); }
  handleAction(a) { this.actions.push(a); return true; }
  destroy() { this.destroyed = true; }
}
jest.unstable_mockModule('phaser', () => ({ default: { Scene: class {}, GameObjects: new Proxy({}, { get: () => class {} }) } }));
jest.unstable_mockModule('../../src/data/index.js', () => ({ content: {}, loadContent: () => ({}) }));
jest.unstable_mockModule('../../src/ui/Views.js', () => ({ ShopView: FakeShopView }));
const { GameOverScene, SHOP_ARM_MS, SHOP_FOOTER } = await import('../../src/scenes/GameOverScene.js');
const { REG, GAME_WIDTH, GAME_HEIGHT } = await import('../../src/constants.js');
const { measureText } = await import('../../src/ui/PixelFont.js');
const { SHOP_PANEL } = await import('../../src/ui/ShopLayout.js');

const proto = GameOverScene.prototype;
const RETRY_FOOTER = 'SPACE / ENTER / A / TAP = RETRY SAME SEED';

const rich = () => ({ v: 1, level: 2, bank: 200, xp: 0, unlocked: { biomes: [], cosmetics: [], boosts: {} }, equipped: {}, boosts: {} });

function scene(o = {}) {
  const values = new Map();
  values.set(REG.PROFILE, rich());
  values.set(REG.LAST_AWARDS, { xp: { total: 10, parts: [] }, shopAutoprompt: Boolean(o.prompt) });
  const timers = [];
  const ctx = {
    alive: true, leaving: false, entry: null, shopOpen: false, shopView: null, shopHint: null, shopTimer: null,
    shopPending: false, shopDim: null,
    theme: { pal: {}, bind: () => () => {} },
    registry: { get: (k) => values.get(k), set: (k, v) => values.set(k, v) },
    time: {
      delayedCall: (ms, fn) => {
        const t = { ms, fn, removed: false, remove() { this.removed = true; return this; } };
        timers.push(t);
        return t;
      },
    },
    add: {
      rectangle: () => {
        const r = { destroyed: false, setOrigin() { return r; }, setDepth(d) { r.depth = d; return r; }, setInteractive() { return r; }, destroy() { r.destroyed = true; } };
        return r;
      },
    },
    footer: { text: RETRY_FOOTER, depth: 0, setText(t) { this.text = t; return this; }, setDepth(d) { this.depth = d; return this; } },
    _buildShopHint() { this.shopHint = { destroy() {} }; },
    retry: jest.fn(function retry() { this.leaving = true; }),
    newSeed: jest.fn(),
    toTitle: jest.fn(),
    skipEntry: jest.fn(),
  };
  for (const k of ['_openShop', '_closeShop', '_onAction', '_cancelShopAutoprompt', '_resumeShopAutoprompt',
    '_buildShopAccess', '_anythingAffordable', '_hideShopHint', '_armShop']) ctx[k] = proto[k];
  ctx.timers = timers;
  return ctx;
}

/** Fire the oldest pending delayed call. */
function fire(ctx, ms) {
  const t = ctx.timers.find((x) => !x.removed && (ms === undefined || x.ms === ms));
  if (!t) return false;
  t.removed = true;
  t.fn();
  return true;
}

/** Game Over with the autoprompt fired (an unrequested shop). */
function autoprompted() {
  const ctx = scene({ prompt: true });
  ctx._buildShopAccess();
  fire(ctx); // SHOP_PROMPT_MS
  expect(ctx.shopOpen).toBe(true);
  return ctx;
}

beforeEach(() => { views.length = 0; });

describe('Enter / pad A buy in a shop the player asked for', () => {
  test('B opens it armed, and confirm reaches the shop instead of retrying', () => {
    const ctx = scene();
    ctx._onAction('shop');
    expect(ctx.shopOpen).toBe(true);
    expect(ctx.shopArmed).toBe(true);
    ctx._onAction('confirm');
    expect(views[0].actions).toEqual(['confirm']);
    expect(ctx.retry).not.toHaveBeenCalled();
    expect(ctx.shopOpen).toBe(true);
  });

  test('cursor movement and paging still belong to the shop', () => {
    const ctx = scene();
    ctx._onAction('shop');
    for (const a of ['down', 'down', 'left', 'right', 'confirm']) ctx._onAction(a);
    expect(views[0].actions).toEqual(['down', 'down', 'left', 'right', 'confirm']);
  });

  test('Space / pad RB (retry) close the shop and retry in one press, and the shop never sees it', () => {
    const ctx = scene();
    ctx._onAction('shop');
    ctx._onAction('retry');
    expect(ctx.retry).toHaveBeenCalledTimes(1);
    expect(ctx.shopOpen).toBe(false);
    expect(views[0].destroyed).toBe(true);
    expect(views[0].actions).toEqual([]);
    // The 'confirm' MenuInput sends right after Space's 'retry' does nothing: the scene is already leaving.
    ctx._onAction('confirm');
    expect(views[0].actions).toEqual([]);
    expect(ctx.retry).toHaveBeenCalledTimes(1);
  });

  test('Esc / pad B close the shop back to Game Over; N / pad X / Y still start a new seed', () => {
    const a = scene();
    a._onAction('shop');
    a._onAction('cancel');
    expect(a.shopOpen).toBe(false);
    expect(a.retry).not.toHaveBeenCalled();
    const b = scene();
    b._onAction('shop');
    b._onAction('alt');
    expect(b.newSeed).toHaveBeenCalledTimes(1);
  });
});

describe('pillar 3: an unrequested autoprompt shop does not swallow an early Enter', () => {
  test('the arm delay is a human reaction time, not zero and not long', () => {
    expect(SHOP_ARM_MS).toBeGreaterThanOrEqual(300);
    expect(SHOP_ARM_MS).toBeLessThanOrEqual(700);
    const ctx = autoprompted();
    expect(ctx.timers.filter((t) => !t.removed).map((t) => t.ms)).toEqual([SHOP_ARM_MS]);
  });

  test('confirm in its first frames closes it and retries; the shop never gets it', () => {
    const ctx = autoprompted();
    expect(ctx.shopArmed).toBe(false);
    ctx._onAction('confirm');
    expect(ctx.retry).toHaveBeenCalledTimes(1);
    expect(ctx.shopOpen).toBe(false);
    expect(views[0].actions).toEqual([]);
  });

  test('once armed, confirm buys the highlighted row', () => {
    const ctx = autoprompted();
    fire(ctx, SHOP_ARM_MS);
    expect(ctx.shopArmed).toBe(true);
    ctx._onAction('confirm');
    expect(views[0].actions).toEqual(['confirm']);
    expect(ctx.retry).not.toHaveBeenCalled();
  });

  test('moving the cursor arms it at once: the player chose that row', () => {
    const ctx = autoprompted();
    ctx._onAction('down');
    expect(ctx.shopArmed).toBe(true);
    ctx._onAction('confirm');
    expect(views[0].actions).toEqual(['down', 'confirm']);
    expect(ctx.retry).not.toHaveBeenCalled();
  });

  test('Space retries even before it is armed', () => {
    const ctx = autoprompted();
    ctx._onAction('retry');
    expect(ctx.retry).toHaveBeenCalledTimes(1);
    expect(views[0].actions).toEqual([]);
  });

  test('the shop that opens after initials entry is unrequested too', () => {
    const ctx = scene({ prompt: true });
    ctx._buildShopAccess();
    ctx.entry = { handleAction: jest.fn() };
    fire(ctx);
    ctx.entry = null;
    ctx._resumeShopAutoprompt();
    fire(ctx);
    expect(ctx.shopOpen).toBe(true);
    expect(ctx.shopArmed).toBe(false);
    ctx._onAction('confirm');
    expect(ctx.retry).toHaveBeenCalledTimes(1);
  });

  test('closing the shop drops the arm timer, and a late arm callback changes nothing', () => {
    const ctx = autoprompted();
    const arm = ctx.timers.find((t) => !t.removed && t.ms === SHOP_ARM_MS);
    ctx._onAction('cancel');
    expect(arm.removed).toBe(true);
    arm.fn();
    expect(ctx.shopArmed).toBe(false);
    expect(ctx.footer.text).toBe(RETRY_FOOTER);
  });
});

describe('with the shop closed, Game Over is unchanged', () => {
  test('confirm and retry both retry, from the first frame', () => {
    const a = scene();
    a._onAction('confirm');
    expect(a.retry).toHaveBeenCalledTimes(1);
    const b = scene();
    b._onAction('retry');
    expect(b.retry).toHaveBeenCalledTimes(1);
  });

  test('pad RB during initials entry saves and retries, like Space', () => {
    const ctx = scene();
    ctx.entry = { handleAction: jest.fn() };
    ctx._onAction('retry');
    expect(ctx.retry).toHaveBeenCalledTimes(1);
    expect(ctx.entry.handleAction).not.toHaveBeenCalled();
  });
});

describe('the on-screen hint', () => {
  test('armed: the footer names BUY and RETRY keys and sits above the dim; close restores it', () => {
    const ctx = scene();
    ctx._onAction('shop');
    expect(ctx.footer.text).toBe(SHOP_FOOTER);
    expect(SHOP_FOOTER).toMatch(/ENTER \/ A = BUY/);
    expect(SHOP_FOOTER).toMatch(/SPACE \/ RB = RETRY/);
    expect(ctx.footer.depth).toBeGreaterThan(400); // the dim is at 400
    expect(ctx.shopHint).toBeNull(); // "SHOP: B / LB" would read as "open the shop" while it is open
    ctx._onAction('cancel');
    expect(ctx.footer.text).toBe(RETRY_FOOTER);
    expect(ctx.footer.depth).toBe(0);
    expect(ctx.shopArmed).toBe(false); // a closed shop is never left armed
  });

  test('unarmed: the footer still promises retry, which is what Enter does then', () => {
    const ctx = autoprompted();
    expect(ctx.footer.text).toBe(RETRY_FOOTER);
    fire(ctx, SHOP_ARM_MS);
    expect(ctx.footer.text).toBe(SHOP_FOOTER);
  });

  test('the shop footer fits 480x270 and clears the shop panel', () => {
    const w = measureText(SHOP_FOOTER);
    const left = Math.round(GAME_WIDTH / 2) - w / 2;
    expect(left).toBeGreaterThanOrEqual(16);
    expect(left + w).toBeLessThanOrEqual(GAME_WIDTH - 16);
    // ShopView sits at y 22 with SHOP_PANEL.h; the footer ink is centred on GAME_HEIGHT - 5, 8 px tall.
    expect(22 + SHOP_PANEL.h).toBeLessThanOrEqual(GAME_HEIGHT - 5 - 4);
  });
});

describe('the retry keys are wired', () => {
  // No suite constructs GameOverScene.create() (it builds the whole screen), so the opt-in is checked at the
  // source, the same way the SHOP key is; the built-game probe presses the real keys.
  test('Game Over opts in to MenuInput\'s retry action, and Title / Pause do not', async () => {
    const fs = await import('node:fs');
    const src = (f) => fs.readFileSync(new URL(`../../src/scenes/${f}`, import.meta.url), 'utf8');
    expect(src('GameOverScene.js')).toMatch(/new MenuInput\(this, \(a\) => this\._onAction\(a\), \{ retryAction: true \}\)/);
    expect(src('TitleScene.js')).not.toMatch(/retryAction/);
    expect(src('PauseScene.js')).not.toMatch(/retryAction/);
  });
});
