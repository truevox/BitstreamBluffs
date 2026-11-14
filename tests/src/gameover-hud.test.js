/**
 * Game Over and HUD fixes from the post-sprint audit (MT-1, GO-1/U6a, UI-A, U6b, U4b, U5a/b/c, UI-3).
 *
 * Harness (ported from the audit/ui reviewer's file): a small but real fake of the Phaser surface the UI
 * widgets touch. Every object has a working destroy(), Zones keep their pointer handlers and Graphics record
 * their drawing calls. Scenes are stubs built on the real scene prototypes, so the scene methods under test
 * are the shipped ones. There is no Proxy setter here, so nothing written on one stub leaks into the next.
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

const { REG, GAME_WIDTH, GAME_HEIGHT, TIMING } = await import('../../src/constants.js');
const { Theme } = await import('../../src/ui/Theme.js');
const { GameOverScene } = await import('../../src/scenes/GameOverScene.js');
const { UIScene } = await import('../../src/scenes/UIScene.js');
const { measureText } = await import('../../src/ui/PixelFont.js');
const { defaultProfile } = await import('../../src/systems/Progression.js');
const { loadContent } = await import('./_helpers.js');
const { missionToastText } = await import('../../src/ui/MissionsUi.js');
const { xpForTemplate } = await import('../../src/systems/Missions.js');

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

const richProfile = () => ({ ...defaultProfile(), level: 3, xp: 0, bank: 500 });

/** Game Over stub with the real buttons and the real shop popup. */
function gameOverHost(profile = richProfile()) {
  const g = makeScene(GameOverScene.prototype, { [REG.PROFILE]: profile, [REG.LAST_AWARDS]: { xp: { total: 10, parts: [] }, shopAutoprompt: false } });
  g.theme = new Theme(g);
  g.alive = true;
  g.leaving = false;
  g.entry = null;
  g.rec = { id: 'r1', seed: 'alpha', score: 100, biomeMask: 0 };
  g.footer = { setText() { return this; } };
  g._buildButtons();
  g.shopOpen = false; g.shopView = null; g.shopHint = null; g.shopTimer = null; g.shopPending = false;
  g.retry = jest.fn(); g.newSeed = jest.fn(); g.toTitle = jest.fn();
  return g;
}

/** World rect of a game object (containers only translate in this UI). */
function worldRect(o) {
  let x = o.x - (o.width || 0) * (o.originX || 0);
  let y = o.y - (o.height || 0) * (o.originY || 0);
  let p = o.parentContainer;
  while (p) { x += p.x; y += p.y; p = p.parentContainer; }
  return { x, y, w: o.width || 0, h: o.height || 0 };
}
/** Emulates Phaser's topOnly hit test: highest top-level depth, then latest added, then latest child. */
function topHit(scene, px, py) {
  const tops = [...scene.__top];
  let best = null;
  const visit = (o, top, path) => {
    if (o.destroyed || !o.visible) return;
    if (o.input && o.input.enabled) {
      const r = worldRect(o);
      if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) {
        const key = [top.depth, tops.indexOf(top), ...path];
        if (!best || cmp(key, best.key) > 0) best = { o, key };
      }
    }
    (o.list || []).forEach((c, i) => visit(c, top, [...path, i]));
  };
  const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? -1) - (b[i] ?? -1); if (d) return d; } return 0; };
  for (const top of tops) visit(top, top, []);
  return best && best.o;
}

// ================================================================== GO-1 / U6a: biome unlock line

describe('GO-1 / U6a: a level-up that unlocks a biome names it', () => {
  // All 11 biomes ship, so "SIGNATURE LOCKED - COMING ONLINE" is false. Both reward paths are covered.
  test('the rewardsEarned path says the biome is online, by name', () => {
    const line = GameOverScene.prototype._rewardsLine.call({}, { leveledTo: 2, rewardsEarned: [{ level: 2, biome: 'debumont' }] });
    expect(line).not.toMatch(/LOCKED|COMING ONLINE/);
    expect(line).toBe('SIGNATURE ONLINE: DEBUMONT');
  });

  test('the legacy rewards path says it too', () => {
    const line = GameOverScene.prototype._rewardsLine.call({}, { leveledTo: 2, rewards: { title: 'X', biome: 'debumont' } });
    expect(line).not.toMatch(/LOCKED|COMING ONLINE/);
    expect(line).toContain('SIGNATURE ONLINE: DEBUMONT');
  });

  test('with content loaded, the biome display name is used, not its id', () => {
    const g = makeScene(GameOverScene.prototype);
    const line = g._rewardsLine({ leveledTo: 5, rewardsEarned: [{ level: 5, biome: 'garbage-dump-glacier' }] });
    expect(line).toBe(`SIGNATURE ONLINE: ${CONTENT.biomes['garbage-dump-glacier'].name.toUpperCase()}`);
    expect(measureText(line)).toBeLessThanOrEqual(280);
  });
});

// ================================================================== MT-1: mission toast width

describe('MT-1: the in-run mission toast fits the 480 px strip, not 36 px', () => {
  const MISSIONS = JSON.parse(fs.readFileSync(path.resolve('src/data/missions/missions.json'), 'utf8'));
  // The strip text is drawn at scale 2 across the full-width band; 8 px clear at each edge.
  const STRIP_TEXT_PX = GAME_WIDTH - 2 * 8;
  const toastFor = (t) => missionToastText({ id: t.id, xp: xpForTemplate(t), shards: 0 }, t.title);

  test('the longest mission title in missions.json is shown whole', () => {
    const full = (t) => `${t.title.toUpperCase()} DONE  +${xpForTemplate(t)} XP`;
    const longest = [...MISSIONS.templates].sort((a, b) => measureText(full(b)) - measureText(full(a)))[0];
    const text = toastFor(longest);
    expect(text).toBe(full(longest));
    expect(measureText(text) * 2).toBeLessThanOrEqual(STRIP_TEXT_PX);
  });

  test('every mission title fits whole', () => {
    for (const t of MISSIONS.templates) {
      const text = toastFor(t);
      expect(text).toContain(t.title.toUpperCase());
      expect(measureText(text) * 2).toBeLessThanOrEqual(STRIP_TEXT_PX);
    }
  });

  test('a title that truly cannot fit is cut with the font\'s ".." and keeps its XP', () => {
    const text = missionToastText({ id: 'x', xp: 60 }, 'Land a quadruple backflip into a heli into a parachute without touching the ground');
    expect(text).toMatch(/\.\. DONE {2}\+60 XP$/);
    expect(measureText(text) * 2).toBeLessThanOrEqual(STRIP_TEXT_PX);
    expect(text).not.toContain('\u2026'); // the pixel font has no ellipsis glyph
  });

  test('the strip text object is drawn at the scale the limit assumes', async () => {
    const { STRIP_BAND } = await import('../../src/ui/HudLayout.js');
    expect(STRIP_BAND.textScale).toBe(2);
    const src = fs.readFileSync(path.resolve('src/scenes/UIScene.js'), 'utf8');
    expect(src).toMatch(/this\.stripT = new NeonText\([^)]*scale: STRIP_BAND\.textScale/);
  });
});

// ================================================================== U6b: the shop hint names the pad key

describe('U6b: the Game Over shop hint names the pad key', () => {
  const FOOTERS = [
    'SPACE / ENTER / A / TAP = RETRY SAME SEED',
    'TYPE INITIALS - ENTER SAVE - SPACE SAVE + RETRY',
    'SPACE = SAVE + RETRY   ESC = SKIP',
  ];
  const builtHint = () => {
    const g = makeScene(GameOverScene.prototype);
    g.theme = new Theme(g);
    g.shopHint = null;
    g.entry = null;
    g._buildShopHint();
    return g.shopHint;
  };

  test('the hint names LB as well as keyboard B (pad B is cancel = Title)', () => {
    // ARCHITECTURE: the footer hint is "SHOP: B (pad LB)".
    const text = builtHint().main.text;
    expect(text).toMatch(/\bB\b/);
    expect(text).toMatch(/\bLB\b/);
  });

  test('the real hint string clears every footer variant at 480x270 with daylight', () => {
    const hint = builtHint();
    const hintLeft = GAME_WIDTH - 4 - measureText(hint.main.text);
    for (const f of FOOTERS) {
      const right = Math.round(GAME_WIDTH / 2) + measureText(f) / 2;
      expect(hintLeft - right).toBeGreaterThan(8);
    }
  });
});

// ================================================================== UI-A: no SHOP hint while typing initials

describe('UI-A: the SHOP hint is not shown while initials entry is active', () => {
  /** Game Over with the real entry widget, a stand-in board and LEDGER panel, and the shop hint built. */
  const entryHost = () => {
    const g = gameOverHost();
    g.right = Object.assign(new GO(g), { setColorKey() { return this; }, setTitle() { return this; } });
    g.board = { visible: true, setVisible(v) { this.visible = v; return this; }, setEntries() { return this; } };
    g.input_ = { rawKeyHandler: null };
    g.rows = [];
    g._buildShopAccess();
    expect(g.shopHint).toBeTruthy(); // control: a rich profile gets the hint
    return g;
  };
  const hintUp = (g) => Boolean(g.shopHint && !g.shopHint.destroyed);

  test('opening the entry hides the hint; skipping it brings the hint back', () => {
    const g = entryHost();
    g._showEntry();
    expect(g.entry).toBeTruthy();
    expect(hintUp(g)).toBe(false);
    g.skipEntry();
    expect(g.entry).toBe(null);
    expect(hintUp(g)).toBe(true);
  });

  test('saving the entry brings the hint back too', () => {
    const g = entryHost();
    g._showEntry();
    g._leaveEntry(); // the synchronous part of saveEntry
    expect(hintUp(g)).toBe(true);
  });

  test('nothing re-adds the hint while the entry is up', () => {
    const g = entryHost();
    g._showEntry();
    g._buildShopHint();
    expect(hintUp(g)).toBe(false);
  });

  test('keyboard B types a letter and pad LB does nothing: neither opens the shop during entry', () => {
    const g = entryHost();
    g._showEntry();
    const before = g.entry.getValue();
    g._rawKey({ key: 'b' });
    expect(g.entry.getValue()).not.toBe(before);
    expect(g.entry.getValue()).toContain('B');
    g._onAction('shop'); // pad LB / LT
    expect(g.shopOpen).toBe(false);
    expect(g.shopView).toBe(null);
  });
});

// ================================================================== U4b: the Game Over shop swallows stray clicks

describe('U4b: clicks inside the open Game Over shop never reach the buttons underneath', () => {
  test('a click on empty shop-panel space never reaches RETRY / NEW SEED / TITLE (emulated topOnly hit test)', () => {
    const g = gameOverHost();
    g._openShop();
    const panel = g.shopView.panel;
    const pr = { x: panel.x, y: panel.y, w: panel.w, h: panel.h };
    const leaks = [];
    for (const b of g.buttons) {
      for (let x = b.x + 2; x < b.x + b.w - 2; x += 8) {
        for (let y = b.y + 2; y < b.y + b.h - 2; y += 4) {
          if (x < pr.x || x >= pr.x + pr.w || y < pr.y || y >= pr.y + pr.h) continue; // outside the panel
          const hit = topHit(g, x, y);
          if (hit && hit === b.zone) leaks.push(`${b.label.main.text}@${x},${y}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  test('a click anywhere outside the panel does not reach the buttons either', () => {
    const g = gameOverHost();
    g._openShop();
    for (const b of g.buttons) {
      const hit = topHit(g, b.x + Math.round(b.w / 2), b.y + Math.round(b.h / 2));
      expect(hit === b.zone).toBe(false);
    }
  });

  test('the shop rows still take clicks: the dim is under the panel', () => {
    const g = gameOverHost();
    g._openShop();
    const zones = [];
    const walk = (o) => { if (o.input && o.input.enabled && o !== g.shopDim) zones.push(o); (o.list || []).forEach(walk); };
    walk(g.shopView.panel);
    expect(zones.length).toBeGreaterThan(0);
    const z = zones[0];
    const r = worldRect(z);
    expect(topHit(g, r.x + 1, r.y + 1) === z).toBe(true);
  });

  test('ESC closes the shop and removes the dim, so the buttons take clicks again', () => {
    const g = gameOverHost();
    g._openShop();
    g._onAction('cancel');
    expect(g.shopOpen).toBe(false);
    expect(g.toTitle).not.toHaveBeenCalled();
    const b = g.buttons[0];
    expect(topHit(g, b.x + Math.round(b.w / 2), b.y + Math.round(b.h / 2)) === b.zone).toBe(true);
    expect(g.shopDim).toBe(null);
  });

  test('RETRY still wins from inside the open shop', () => {
    const g = gameOverHost();
    g._openShop();
    g._onAction('confirm');
    expect(g.retry).toHaveBeenCalledTimes(1);
    expect(g.shopOpen).toBe(false);
  });
});

// ================================================================== U5: HUD strip band vs centre stack


// ================================================================== U5: HUD strip vs centre stack

/** A NeonText-shaped stub that UIScene._layout reads. */
const nt = (text, scale = 1, vAnchor = 0.5) => ({ visible: true, alpha: 1, scaleX: scale, x: 240, y: 0, __snap: true, main: { text, originX: 0.5, originY: vAnchor } });

function hud({ keep = [], flash, bank, banner }) {
  const s = Object.create(UIScene.prototype);
  Object.assign(s, {
    nowMs: 0, touchAt: 0, touchRects: [], zoneChip: { w: 0 }, zoneY: 3, effects: new Map(),
    boostText: { ...nt(''), visible: false }, boostScale: 2,
    flash: flash ? nt(flash) : { ...nt(''), visible: false },
    bankLine: bank ? nt(bank) : { ...nt(''), visible: false },
    banner: banner ? nt(banner, 3) : { ...nt(''), visible: false }, bannerScale: 3,
    stripC: { visible: true, y: 0, __snap: true }, stripT: { main: { text: 'MISSION DONE +60 XP' } },
    popups: [], powerups: new Map(), powerX: 8, chainText: { visible: false }, hintChip: { w: 0 }, seedText: null,
    _fixedRects: () => keep.slice(),
  });
  s._layout(16);
  const band = { x: 0, y: s.stripC.y + 59, w: 480, h: 17 };
  const box = (o, h) => ({ x: 240 - (measureText(o.main.text) * o.scaleX) / 2, y: o.y - h / 2, w: measureText(o.main.text) * o.scaleX, h });
  const items = [];
  if (flash) items.push(['PERFECT LANDING flash', box(s.flash, 16)]);
  if (bank) items.push(['bank line', box(s.bankLine, 16)]);
  if (banner) items.push(['CRASH banner', box(s.banner, 24)]);
  return { band, items };
}
const overlapsY = (a, b) => a.y < b.y + b.h && b.y < a.y + a.h;
const hits = ({ band, items }) => items.filter(([, r]) => overlapsY(band, r)).map(([n, r]) => `${n} y${r.y}..${r.y + r.h} vs strip y${band.y}..${band.y + band.h}`);

describe('U5: the full-width strip band and the centre stack are one layout', () => {
  // FLOW readout (right-anchored text at FLOW_Y 62) and its bar (y 71..76), as _fixedRects reports them.
  const FLOW = [{ x: 472 - measureText('FLOW x1.50'), y: 62, w: measureText('FLOW x1.50'), h: 8 }, { x: 407, y: 71, w: 66, h: 5 }];

  test('U5a: a mission/sector strip never overlaps the PERFECT LANDING flash (quiet HUD)', () => {
    const LEFT = [{ x: 8, y: 13, w: measureText('9,999,999') * 2, h: 16 }, { x: 8, y: 31, w: measureText('99,999 M'), h: 8 }, { x: 8, y: 41, w: measureText('432 KM/H'), h: 8 }];
    expect(hits(hud({ keep: LEFT, flash: 'PERFECT LANDING +20' }))).toEqual([]);
  });

  test('U5b: with FLOW showing, the pushed-down strip never overlaps the bank line', () => {
    expect(hits(hud({ keep: FLOW, bank: 'KICKFLIP COMBO x2 +500' }))).toEqual([]);
  });

  test('U5c: the run-end mission toast never overlaps the CRASH banner', () => {
    expect(hits(hud({ keep: FLOW, banner: 'CRASH' }))).toEqual([]);
  });
});

// ================================================================== mission toasts at run end

describe('U5: the band still keeps its classic place and clears the fixed rows', () => {
  test('on a quiet HUD with nothing else up, the band stays at y 59', () => {
    const { band } = hud({ keep: [] });
    expect(band.y).toBe(59);
  });

  test('with FLOW showing, the band is pushed clear of the FLOW text and bar', () => {
    const FLOW = [{ x: 472 - measureText('FLOW x1.50'), y: 62, w: measureText('FLOW x1.50'), h: 8 }, { x: 407, y: 71, w: 66, h: 5 }];
    const { band } = hud({ keep: FLOW });
    for (const k of FLOW) expect(overlapsY(band, k)).toBe(false);
  });

  test('the flash, the band, the bank line and the banner all stack without touching', () => {
    const FLOW = [{ x: 472 - measureText('FLOW x1.50'), y: 62, w: measureText('FLOW x1.50'), h: 8 }, { x: 407, y: 71, w: 66, h: 5 }];
    const r = hud({ keep: FLOW, flash: 'PERFECT LANDING +20', bank: 'KICKFLIP COMBO x2 +500', banner: 'CRASH' });
    const all = [['strip', r.band], ...r.items];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) expect([all[i][0], all[j][0], overlapsY(all[i][1], all[j][1])]).toEqual([all[i][0], all[j][0], false]);
    }
    expect(r.items[r.items.length - 1][1].y + 24).toBeLessThanOrEqual(GAME_HEIGHT);
  });
});

describe('U5: HudLayout.stackY full-width items', () => {
  test('a full item is tested across the whole row; the same item without `full` slips past an edge row', async () => {
    const { stackY } = await import('../../src/ui/HudLayout.js');
    const edge = [{ x: 400, y: 60, w: 72, h: 10 }]; // a right-anchored row, nowhere near the centred text
    expect(stackY([{ w: 200, h: 17, pref: 59 }], { cx: 240, keepOuts: edge })).toEqual([59]);
    expect(stackY([{ w: 200, h: 17, pref: 59, full: true }], { cx: 240, keepOuts: edge })).toEqual([73]);
  });
});
