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
