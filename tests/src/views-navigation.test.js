/**
 * Modal views: navigation, focus and teardown (post-sprint audit fixes U1, U2, U3, UI-1, UI-2, U7a,
 * SHOP-3, F3 - the view half).
 *
 * Harness: a small but real fake of the Phaser surface the UI widgets touch. Every object has a working
 * destroy() (so leaked panels are observable), Zones keep their pointer handlers (so the pointer path can
 * be fired exactly as the built-game gate does) and Graphics record their fillRect calls (so painted
 * highlights can be measured). Scenes are stubs built on the real scene prototypes.
 *
 * Harness and the first red tests come from the UI audit branch (audit/ui at e0ae90f).
 */
import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// ------------------------------------------------------------------ fake Phaser

class Emitter {
  constructor() { this._ev = new Map(); }
  on(e, fn, ctx) { if (!this._ev.has(e)) this._ev.set(e, []); this._ev.get(e).push({ fn, ctx, once: false }); return this; }
  once(e, fn, ctx) { if (!this._ev.has(e)) this._ev.set(e, []); this._ev.get(e).push({ fn, ctx, once: true }); return this; }
  off(e, fn) {
    const l = this._ev.get(e);
    if (!l) return this;
    if (!fn) { this._ev.delete(e); return this; }
    this._ev.set(e, l.filter((x) => x.fn !== fn));
    return this;
  }
  emit(e, ...a) {
    const l = this._ev.get(e);
    if (!l || !l.length) return false;
    for (const x of [...l]) {
      if (x.once) this.off(e, x.fn);
      x.fn.apply(x.ctx, a);
    }
    return true;
  }
  listenerCount(e) { return (this._ev.get(e) || []).length; }
  totalListeners() { let n = 0; for (const l of this._ev.values()) n += l.length; return n; }
  removeAllListeners() { this._ev.clear(); return this; }
}

class GO extends Emitter {
  constructor(scene, x = 0, y = 0) {
    super();
    this.scene = scene;
    this.x = x; this.y = y;
    this.visible = true; this.alpha = 1; this.scaleX = 1; this.scaleY = 1; this.depth = 0;
    this.originX = 0; this.originY = 0;
    this.list = [];
    this.destroyed = false;
    this.parentContainer = null;
    this.input = null;
    this.width = 0; this.height = 0;
  }
  add(c) {
    for (const o of [].concat(c)) {
      if (!o) continue;
      if (o.parentContainer && o.parentContainer !== this) o.parentContainer.remove(o);
      this.list.push(o);
      o.parentContainer = this;
      if (this.scene && this.scene.__top) this.scene.__top.delete(o);
    }
    return this;
  }
  remove(c) { for (const o of [].concat(c)) { this.list = this.list.filter((x) => x !== o); if (o) o.parentContainer = null; } return this; }
  setDepth(d) { this.depth = d; return this; }
  setPosition(x, y) { this.x = x; if (y !== undefined) this.y = y; return this; }
  setX(x) { this.x = x; return this; }
  setY(y) { this.y = y; return this; }
  setVisible(v) { this.visible = v; return this; }
  setAlpha(a) { this.alpha = a; return this; }
  setScale(sx, sy) { this.scaleX = sx; this.scaleY = sy === undefined ? sx : sy; return this; }
  setOrigin(ox, oy) { this.originX = ox; this.originY = oy === undefined ? ox : oy; return this; }
  setInteractive() { this.input = { enabled: true }; return this; }
  disableInteractive() { if (this.input) this.input.enabled = false; return this; }
  removeInteractive() { this.input = null; return this; }
  setSize(w, h) { this.width = w; this.height = h; return this; }
  setTint() { return this; }
  clearTint() { return this; }
  setBlendMode() { return this; }
  setScrollFactor() { return this; }
  setMask() { return this; }
  setAngle() { return this; }
  setRotation() { return this; }
  setCenterAlign() { return this; }
  setLeftAlign() { return this; }
  setRightAlign() { return this; }
  setLetterSpacing() { return this; }
  setFontSize() { return this; }
  setDropShadow() { return this; }
  setFillStyle() { return this; }
  setStrokeStyle() { return this; }
  bringToTop() { return this; }
  getBounds() { return { x: this.x, y: this.y, width: this.width, height: this.height }; }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const c of [...this.list]) if (c && c.destroy) c.destroy();
    this.list = [];
    if (this.parentContainer) this.parentContainer.remove(this);
    if (this.scene && this.scene.__top) this.scene.__top.delete(this);
    this.emit('destroy');
    this.scene = undefined;
  }
}

class BitmapText extends GO {
  constructor(scene, x, y, font, text) { super(scene, x, y); this.text = String(text === undefined ? '' : text); }
  setText(t) { this.text = String(t); return this; }
}
class Zone extends GO {
  constructor(scene, x, y, w, h) { super(scene, x, y); this.width = w; this.height = h; }
}
class Rect extends GO {
  constructor(scene, x, y, w, h) { super(scene, x, y); this.width = w; this.height = h; }
}
/** Graphics: records every drawing call; unknown drawing methods are recorded too. */
class Graphics extends GO {
  constructor(scene) {
    super(scene, 0, 0);
    this.ops = [];
    return new Proxy(this, {
      get(t, k, r) {
        if (typeof k !== 'string' || k in t || k === 'then') return Reflect.get(t, k, r);
        return (...a) => { t.ops.push([k, ...a]); return r; };
      },
    });
  }
  clear() { this.ops = []; return this; }
  fillStyle(...a) { this.ops.push(['fillStyle', ...a]); return this; }
  fillRect(...a) { this.ops.push(['fillRect', ...a]); return this; }
  lineStyle(...a) { this.ops.push(['lineStyle', ...a]); return this; }
  strokeRect(...a) { this.ops.push(['strokeRect', ...a]); return this; }
}

const FakePhaser = {
  Scene: class {},
  GameObjects: { Container: GO, Graphics, BitmapText, Zone, Image: GO, Rectangle: Rect, Text: BitmapText },
  Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown', DESTROY: 'destroy' } },
  Math: { Between: (a) => a, Clamp: (v, a, b) => Math.min(b, Math.max(a, v)) },
};

jest.unstable_mockModule('phaser', () => ({ default: FakePhaser }));
jest.unstable_mockModule('../../src/data/index.js', () => ({ content: {}, loadContent: () => ({}) }));

const { REG, GAME_WIDTH, GAME_HEIGHT } = await import('../../src/constants.js');
const { Theme } = await import('../../src/ui/Theme.js');
const Views = await import('../../src/ui/Views.js');
const { ProfileView, AchievementsView, ShopView, LeaderboardView } = Views;
const { MenuList } = await import('../../src/ui/MenuList.js');
const { TitleScene } = await import('../../src/scenes/TitleScene.js');
const { copyText } = await import('../../src/ui/Clipboard.js');
const { measureText } = await import('../../src/ui/PixelFont.js');
const { DailyPatch } = await import('../../src/systems/DailyPatch.js');
const { defaultProfile } = await import('../../src/systems/Progression.js');
const { loadContent } = await import('./_helpers.js');

const LEVELS = JSON.parse(fs.readFileSync(path.resolve('src/data/progression/levels.json'), 'utf8'));
const PALETTES = JSON.parse(fs.readFileSync(path.resolve('src/data/palettes.json'), 'utf8'));
const CONTENT = { ...loadContent(), progression: LEVELS, palettes: PALETTES.palettes || PALETTES };

// ------------------------------------------------------------------ scene stubs

function makeScene(proto, values = {}) {
  const reg = new Map();
  reg.set(REG.CONTENT, CONTENT);
  for (const [k, v] of Object.entries(values)) reg.set(k, v);
  const registry = { get: (k) => reg.get(k), set: (k, v) => { reg.set(k, v); }, values: reg };
  const game = { registry, events: new Emitter(), canvas: null, config: {} };
  const s = proto ? Object.create(proto) : {};
  const timers = [];
  const tweens = [];
  Object.assign(s, {
    game,
    registry,
    __top: new Set(),
    events: new Emitter(),
    input: Object.assign(new Emitter(), { keyboard: new Emitter() }),
    sys: { settings: { data: {} }, game },
    textures: { exists: () => true, createCanvas: () => ({ context: {}, refresh() {} }) },
    cameras: { main: { setBackgroundColor() { return this; }, fadeIn() { return this; }, fadeOut() { return this; }, once() { return this; } } },
    scene: { start: jest.fn(), stop: jest.fn(), resume: jest.fn(), launch: jest.fn(), get: () => null },
    time: {
      delayedCall: (ms, fn) => { const t = { ms, fn, removed: false, paused: false, remove() { this.removed = true; return this; } }; timers.push(t); return t; },
      addEvent: (cfg) => { const t = { cfg, removed: false, remove() { this.removed = true; return this; } }; timers.push(t); return t; },
    },
    tweens: {
      add: (cfg) => { const t = { cfg, removed: false, remove() { this.removed = true; return this; }, stop() { return this; } }; tweens.push(t); return t; },
      addCounter: (cfg) => { const t = { cfg, removed: false, remove() { this.removed = true; return this; }, stop() { return this; } }; tweens.push(t); return t; },
      killTweensOf: () => {},
      pauseAll: () => {},
      resumeAll: () => {},
    },
    add: {
      existing: (o) => { if (!o.parentContainer) s.__top.add(o); return o; },
      graphics: () => { const g = new Graphics(s); s.__top.add(g); return g; },
      rectangle: (x, y, w, h) => { const r = new Rect(s, x, y, w, h); s.__top.add(r); return r; },
      image: (x, y) => { const r = new GO(s, x, y); s.__top.add(r); return r; },
      container: (x, y) => { const r = new GO(s, x, y); s.__top.add(r); return r; },
    },
  });
  s.__timers = timers;
  s.__tweens = tweens;
  return s;
}

/** A Title scene stub with the real menu (so PROFILE / LEADERBOARD open exactly as in the game). */
function titleHost(values = {}) {
  const t = makeScene(TitleScene.prototype, { [REG.PROFILE]: defaultProfile(), ...values });
  t.starting = false;
  t.view = null;
  t.dim = null;
  t.theme = new Theme(t);
  t.daily = DailyPatch.getDailyInfo();
  t._buildMenu();
  return t;
}
const item = (t, label) => t.menu.items.find((i) => String(i.label).toUpperCase() === label);
const openProfile = (t) => { item(t, 'PROFILE').onSelect(); return t.view; };

/** Every BitmapText string under a game object. */
function texts(obj, out = []) {
  if (!obj) return out;
  if (typeof obj.text === 'string' && obj.text) out.push(obj.text);
  for (const c of obj.list || []) texts(c, out);
  return out;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

const richProfile = () => ({ ...defaultProfile(), level: 3, xp: 0, bank: 500 });


test('sanity: game sizes the tests assume', () => {
  expect([GAME_WIDTH, GAME_HEIGHT]).toEqual([480, 270]);
});

// ================================================================== U7a: Clipboard

describe('Clipboard.copyText', () => {
  test('U7a: copyText leaves no hidden textarea in the DOM when execCommand throws', async () => {
    const orig = document.execCommand;
    document.execCommand = () => { throw new Error('denied'); };
    try {
      const before = document.querySelectorAll('textarea').length;
      const ok = await copyText('seed@31');
      expect(ok).toBe(false);
      expect(document.querySelectorAll('textarea').length).toBe(before);
    } finally {
      document.execCommand = orig;
      for (const ta of document.querySelectorAll('textarea')) ta.remove();
    }
  });
});

// ================================================================== UI-2: MenuList columns

describe('UI-2: MenuList highlights the selected row in its own column', () => {
  test('UI-2: with columns:2 the highlight for item 7 is drawn at column 2, row 1', () => {
    const s = makeScene(null);
    const theme = new Theme(s);
    const items = Array.from({ length: 11 }, (_, i) => ({
      kind: 'choice', label: `B${i}`, options: [{ value: false, label: 'OFF' }, { value: true, label: 'ON' }], get: () => false, set: () => {},
    }));
    const m = new MenuList(s, theme, { x: 0, y: 0, w: 388, rowH: 9, items, columns: 2, rowsPerColumn: 6 });
    m.setSelected(7, true);
    // The first fillRect after the highlight colour is the 16% wash over the selected row.
    const rects = m.g.ops.filter((o) => o[0] === 'fillRect');
    const wash = rects[0];
    expect(wash).toBeTruthy();
    const [, x, y, w] = wash;
    expect({ x, y, w }).toEqual({ x: 194, y: 9, w: 194 });
  });
});

describe('MenuList single column stays pixel-identical', () => {
  test('UI-2 control: a one-column list highlights row i at y = i * rowH across the full width', () => {
    const s = makeScene(null);
    const theme = new Theme(s);
    const items = Array.from({ length: 4 }, (_, i) => ({ kind: 'action', label: `A${i}`, onSelect: () => {} }));
    const m = new MenuList(s, theme, { x: 0, y: 0, w: 200, rowH: 16, items });
    m.setSelected(3, true);
    const [, x, y, w] = m.g.ops.filter((o) => o[0] === 'fillRect')[0];
    expect({ x, y, w }).toEqual({ x: 0, y: 48, w: 200 });
  });
});

// ================================================================== U1: Profile -> Achievements -> back

describe('U1: Profile -> ACHIEVEMENTS -> BACK', () => {
  test('harness control: the first Profile view reaches SHARD SHOP by keyboard (control)', () => {
    const t = titleHost();
    expect(openProfile(t)).toBeInstanceOf(ProfileView);
    t._onAction('down'); // lands focus on SHARD SHOP (no unlocked biomes = no toggle rows)
    t._onAction('confirm');
    expect(t.view).toBeInstanceOf(ShopView);
  });

  test('U1: backing out of ACHIEVEMENTS destroys the Achievements panel', () => {
    const t = titleHost();
    const prof = openProfile(t);
    prof.achButton.zone.emit('pointerdown'); // the pointer path, exactly as the gate and the live check did
    const ach = t.view;
    expect(ach).toBeInstanceOf(AchievementsView);
    const achPanel = ach.panel;
    t._onAction('cancel'); // grid -> profile
    expect(t.view).toBeInstanceOf(ProfileView);
    t._onAction('cancel'); // profile -> title
    expect(t.view).toBeNull();
    // Correct: nothing of the grid survives.
    expect(achPanel.destroyed).toBe(true);
    expect(ach.alive).toBe(false);
  });

  test('U1b: the Profile view rebuilt after ACHIEVEMENTS still opens SHARD SHOP', () => {
    const t = titleHost();
    openProfile(t).achButton.zone.emit('pointerdown');
    t._onAction('cancel'); // back to the rebuilt profile
    expect(t.view).toBeInstanceOf(ProfileView);
    t._onAction('down');
    t._onAction('confirm');
    expect(t.view).toBeInstanceOf(ShopView);
  });
});

describe('U2: ACHIEVEMENTS is reachable without a pointer', () => {
  test('U2: some keyboard/pad sequence on PROFILE opens the achievements grid', () => {
    const tried = [];
    let opened = false;
    for (const dir of ['down', 'up', 'left', 'right']) {
      for (let n = 0; n <= 6 && !opened; n += 1) {
        const t = titleHost();
        openProfile(t);
        t._onAction('down'); // land focus
        for (let i = 0; i < n; i += 1) t._onAction(dir);
        // Confirm only while still on the profile: confirm on BACK closes it, which is not a find.
        if (t.view instanceof ProfileView) t._onAction('confirm');
        tried.push(`${dir}x${n}->${t.view ? t.view.constructor.name : 'null'}`);
        if (t.view instanceof AchievementsView) opened = true;
      }
    }
    expect({ opened, tried }).toEqual(expect.objectContaining({ opened: true }));
  });

  test('U2: ACHIEVEMENTS sits before SHARD SHOP in the focus order, gets a focus ring, and confirm opens the grid', () => {
    const t = titleHost();
    const prof = openProfile(t);
    t._onAction('down'); // land: SHARD SHOP (no toggle rows on a fresh profile)
    t._onAction('up'); // ACHIEVEMENTS, which is left of SHARD SHOP on screen
    expect(prof._focusTargets()[prof.focusIdx]).toEqual({ kind: 'ach' });
    const ring = prof.shopFocus.ops.find((o) => o[0] === 'strokeRect');
    expect(ring).toBeTruthy();
    expect(ring[1]).toBeCloseTo(prof.achButton.x - 1.5);
    t._onAction('confirm');
    expect(t.view).toBeInstanceOf(AchievementsView);
  });
});

// ================================================================== U3: leaderboard tabs

describe('U3: leaderboard tabs and empty state', () => {
  const store = () => ({ getLeaderboard: async () => [], getModdedLeaderboard: async () => [] });

  test('U3: a keyboard/pad action switches the leaderboard to the MODDED board', () => {
    const t = titleHost({ [REG.SAVE_STORE]: store() });
    item(t, 'LEADERBOARD').onSelect();
    const view = t.view;
    expect(view).toBeInstanceOf(LeaderboardView);
    const flipped = [];
    for (const a of ['left', 'right', 'up', 'down', 'confirm', 'alt', 'shop']) {
      if (t.view !== view) break;
      t._onAction(a);
      if (view.showingModded) flipped.push(a);
    }
    expect(flipped.length).toBeGreaterThan(0);
  });

  test('U3b: an empty MODDED board says why it is empty', async () => {
    const t = titleHost({ [REG.SAVE_STORE]: store() });
    item(t, 'LEADERBOARD').onSelect();
    const view = t.view;
    view._toggleBoard(); // the gate's own route (gate-playthrough.mjs ~:1203)
    await flush();
    expect(view.emptyText).toBe('NO MODDED RUNS RECORDED YET'); // the view computed it...
    expect(texts(view.panel)).toContain(view.emptyText); // ...and puts it on screen
  });

  test('U3: right shows MODDED, left shows CLEAN, N / pad X (alt) toggles', () => {
    const t = titleHost({ [REG.SAVE_STORE]: store() });
    item(t, 'LEADERBOARD').onSelect();
    const view = t.view;
    t._onAction('right');
    expect(view.showingModded).toBe(true);
    t._onAction('right'); // directional, so a held key does not flicker between boards
    expect(view.showingModded).toBe(true);
    t._onAction('left');
    expect(view.showingModded).toBe(false);
    t._onAction('alt');
    expect(view.showingModded).toBe(true);
    t._onAction('alt');
    expect(view.showingModded).toBe(false);
    expect(t.view).toBe(view);
  });

  test('U3: the tab button is a focus target: it holds focus first, confirm switches, down moves to BACK', () => {
    const t = titleHost({ [REG.SAVE_STORE]: store() });
    item(t, 'LEADERBOARD').onSelect();
    const view = t.view;
    const ring = () => view.focusG.ops.find((o) => o[0] === 'strokeRect');
    expect(ring()[1]).toBeCloseTo(view.tabBtn.x - 1.5); // painted from the start
    t._onAction('confirm');
    expect(view.showingModded).toBe(true);
    expect(view.tabBtn.label.main.text).toBe('CLEAN');
    t._onAction('down');
    expect(ring()[1]).toBeCloseTo(view.back.x - 1.5);
    t._onAction('confirm');
    expect(t.view).toBeNull();
  });

  test('U3: an on-screen hint names the switch keys and stays clear of the buttons', () => {
    const t = titleHost({ [REG.SAVE_STORE]: store() });
    item(t, 'LEADERBOARD').onSelect();
    const view = t.view;
    const hint = view.panel.list.find((o) => o.main && /SWITCH BOARD/.test(o.main.text));
    expect(hint).toBeTruthy();
    expect(hint.main.text).toMatch(/←/);
    expect(hint.main.text).toMatch(/\bN\b/);
    expect(hint.main.text).toMatch(/PAD X/);
    const box = { x: hint.x, y: hint.y, w: measureText(hint.main.text), h: 8 };
    expect(box.x).toBeGreaterThanOrEqual(4);
    expect(box.x + box.w).toBeLessThanOrEqual(view.w - 4);
    for (const b of [view.tabBtn, view.back]) {
      const hit = box.x < b.x + b.w && b.x < box.x + box.w && box.y < b.y + b.h && b.y < box.y + box.h;
      expect(hit).toBe(false);
    }
    // The panel still fits the 480x270 canvas.
    expect(view.panel.y + view.h).toBeLessThanOrEqual(GAME_HEIGHT);
  });

  test('U3b: the empty CLEAN board names its board, and only one empty message is drawn', async () => {
    const t = titleHost({ [REG.SAVE_STORE]: store() });
    item(t, 'LEADERBOARD').onSelect();
    const view = t.view;
    await flush();
    const all = texts(view.panel);
    expect(all).toContain('NO CLEAN RUNS RECORDED YET');
    expect(all).not.toContain('NO ENTRIES YET');
    view._toggleBoard();
    await flush();
    expect(texts(view.panel)).not.toContain('NO CLEAN RUNS RECORDED YET');
  });

  test('U3c: a slow CLEAN result that lands after switching to MODDED does not overwrite the MODDED board', async () => {
    let releaseClean;
    const slow = {
      getLeaderboard: () => new Promise((r) => { releaseClean = () => r([{ id: 'c1', initials: 'CLN', score: 5, distanceM: 1 }]); }),
      getModdedLeaderboard: async () => [{ id: 'm1', initials: 'MOD', score: 9, distanceM: 2 }],
    };
    const t = titleHost({ [REG.SAVE_STORE]: slow });
    item(t, 'LEADERBOARD').onSelect();
    const view = t.view;
    t._onAction('right'); // MODDED requested while CLEAN is still in flight
    await flush();
    releaseClean();
    await flush();
    const all = texts(view.panel);
    expect(all).toContain('MOD');
    expect(all).not.toContain('CLN');
  });
});
