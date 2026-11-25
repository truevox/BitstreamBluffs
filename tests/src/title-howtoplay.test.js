/**
 * HOW TO PLAY (the controls reference that replaced the Title's CONTROLS panel) and the Title's idle /
 * attract and launch behaviour.
 *
 *  - HowToPlayLayout is pure: every keycap, pad glyph and label is a rect, asserted inside the panel and
 *    pairwise disjoint for every control layout, and the keyboard rows are checked against the real trick
 *    bindings in ControlLayouts, so the reference can never teach a key the run does not use.
 *  - HowToPlayView is built on the real View base (through a small fake of the Phaser surface), with
 *    Views.js imported FIRST: Views.js imports HowToPlayView for its Settings row, so the cycle must be safe
 *    in that order.
 *  - TitleScene's wake gate, attract entry and launch are driven through the real prototype methods.
 *
 * The fake Phaser harness is adapted from views-navigation.test.js.
 */
import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';


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

const { REG, GAME_WIDTH, GAME_HEIGHT, SCENES } = await import('../../src/constants.js');
// Views FIRST, then HowToPlayView: the import order a Settings-first load produces.
const { View } = await import('../../src/ui/Views.js');
const { HowToPlayView } = await import('../../src/ui/HowToPlayView.js');
const { HOW_TO_PLAY, howToPlayLayout, howToPlayRects, keyboardRows, GAMEPAD_ROWS, touchGroups, LAYOUT_NAMES } = await import('../../src/ui/HowToPlayLayout.js');
const { TRICK_KEYS_RIGHT, TRICK_KEYS_LEFT } = await import('../../src/systems/ControlLayouts.js');
const { Theme } = await import('../../src/ui/Theme.js');
const { TitleScene, ATTRACT_MS } = await import('../../src/scenes/TitleScene.js');
const { measureText, hasGlyph } = await import('../../src/ui/PixelFont.js');

const PALETTES = JSON.parse(fs.readFileSync(path.resolve('src/data/palettes.json'), 'utf8'));

function makeScene(proto, values = {}) {
  const reg = new Map();
  reg.set(REG.CONTENT, { palettes: PALETTES.palettes || PALETTES });
  for (const [k, v] of Object.entries(values)) reg.set(k, v);
  const registry = { get: (k) => reg.get(k), set: (k, v) => { reg.set(k, v); }, values: reg };
  const game = { registry, events: new Emitter(), canvas: null, config: {} };
  const s = proto ? Object.create(proto) : {};
  const timers = [];
  Object.assign(s, {
    game,
    registry,
    __top: new Set(),
    events: new Emitter(),
    input: Object.assign(new Emitter(), { keyboard: new Emitter() }),
    sys: { settings: { data: {} }, game },
    textures: { exists: () => false },
    cameras: { main: { setBackgroundColor() { return this; }, fadeIn() { return this; }, fadeOut() { return this; }, once() { return this; } } },
    scene: { start: jest.fn(), stop: jest.fn(), get: () => null },
    time: {
      now: 0,
      delayedCall: (ms, fn) => { const t = { ms, fn }; timers.push(t); return t; },
      addEvent: (cfg) => ({ cfg, remove() {} }),
    },
    add: {
      existing: (o) => { if (!o.parentContainer) s.__top.add(o); return o; },
      graphics: () => { const g = new Graphics(s); s.__top.add(g); return g; },
      rectangle: (x, y, w, h) => { const r = new Rect(s, x, y, w, h); s.__top.add(r); return r; },
      zone: (x, y, w, h) => { const r = new Zone(s, x, y, w, h); s.__top.add(r); return r; },
    },
  });
  s.__timers = timers;
  return s;
}

/** Every BitmapText string under a game object. */
function texts(obj, out = []) {
  if (!obj) return out;
  if (typeof obj.text === 'string' && obj.text) out.push(obj.text);
  for (const c of obj.list || []) texts(c, out);
  return out;
}

const overlaps = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
const LAYOUTS = Object.keys(LAYOUT_NAMES);

// ================================================================== layout

describe('HowToPlayLayout', () => {
  test('the panel fits the 480x270 screen', () => {
    expect(HOW_TO_PLAY.w).toBeLessThanOrEqual(GAME_WIDTH - 16);
    expect(HOW_TO_PLAY.y).toBeGreaterThanOrEqual(4);
    expect(HOW_TO_PLAY.y + HOW_TO_PLAY.h).toBeLessThanOrEqual(GAME_HEIGHT - 4);
  });

  test.each(LAYOUTS)('%s: every rect is inside the panel and below the title tab', (layout) => {
    const L = howToPlayLayout(layout);
    for (const r of howToPlayRects(L)) {
      expect([r.key, r.x >= 6, r.x + r.w <= HOW_TO_PLAY.w - 6, r.y + r.h <= HOW_TO_PLAY.h - 4]).toEqual([r.key, true, true, true]);
      // only the layout chip shares the tab row; everything else starts under the tab rule (y 15)
      if (r.key !== 'layout-chip') expect([r.key, r.y >= 18]).toEqual([r.key, true]);
    }
    // the chip sits right of the title tab (title + 16 padding + 10 slant + ~26 of data ticks)
    expect(L.layoutChip.x).toBeGreaterThan(measureText('HOW TO PLAY') + 16 + 10 + 26);
  });

  test.each(LAYOUTS)('%s: nothing overlaps anything else', (layout) => {
    const rects = howToPlayRects(howToPlayLayout(layout));
    const hits = [];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) if (overlaps(rects[i], rects[j])) hits.push([rects[i].key, rects[j].key]);
    }
    expect(hits).toEqual([]);
  });

  test('the BACK rect is where the View base draws its button', () => {
    const L = howToPlayLayout('classic');
    expect(L.back).toEqual({ x: HOW_TO_PLAY.w - 76, y: HOW_TO_PLAY.h - 22, w: 68, h: 16 });
  });

  test('every string is drawable in the pixel font', () => {
    for (const layout of LAYOUTS) {
      for (const r of keyboardRows(layout)) for (const s of [...r.keys, r.label, r.join || '']) for (const ch of s) expect([s, ch === ' ' || hasGlyph(ch)]).toEqual([s, true]);
    }
    for (const r of GAMEPAD_ROWS) for (const s of [r.label, ...r.glyphs.map((g) => g.text)]) for (const ch of s) expect([s, ch === ' ' || hasGlyph(ch)]).toEqual([s, true]);
    for (const layout of LAYOUTS) for (const g of touchGroups(layout)) for (const s of [g.title, ...g.items]) for (const ch of s) expect([s, ch === ' ' || hasGlyph(ch)]).toEqual([s, true]);
  });

  test('the touch legend lists the buttons the overlay really shows for each layout', async () => {
    const { TOUCH_CLUSTERS, touchButtonFor } = await import('../../src/systems/TouchOverlay.js');
    const short = (l) => (l === 'SPIN CCW' || l === 'SPIN CW' ? 'SPIN' : l);
    for (const layout of LAYOUTS) {
      const mode = layout === 'classic' ? 'classic' : 'trickDeck';
      const groups = touchGroups(layout);
      const legend = Object.fromEntries(groups.map((g) => [g.title, [...g.items].sort()]));
      const real = (cluster) => [...new Set(TOUCH_CLUSTERS[cluster].map((b) => short(touchButtonFor(b, mode).label)))].sort();
      expect(legend['LEFT THUMB']).toEqual(real('LEFT'));
      expect(legend['RIGHT THUMB']).toEqual(real('RIGHT'));
      expect(legend['TOP BAR']).toEqual(real('TOP'));
      const right = groups.find((g) => g.title === 'RIGHT THUMB').items;
      if (layout === 'classic') {
        expect(right).toContain('PUSH');
        expect(right).not.toContain('DIVEBOMB');
      } else {
        // TouchOverlay.setControlLayout swaps PUSH -> DIVEBOMB and SPIN CCW -> CORKSCREW in trick layouts.
        expect(right).toEqual(expect.arrayContaining(['DIVEBOMB', 'CORKSCREW', 'SPIN']));
        expect(right).not.toContain('PUSH');
      }
      // the (longer) trick legend line still fits inside the panel
      for (const g of howToPlayLayout(layout).touch.groups) expect(g.items.x + g.items.w).toBeLessThanOrEqual(HOW_TO_PLAY.w - 8);
    }
  });

  test('the trick layouts teach exactly the keys ControlLayouts binds in a run', () => {
    const glyph = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D' };
    const label = { tiltForward: 'TILT FWD', tiltBack: 'TILT BACK', heliRight: 'HELI SPIN', corkscrew: 'CORKSCREW', parachute: 'CHUTE', airBrake: 'AIR/GND BRAKE', divebomb: 'DIVEBOMB', tuck: 'TUCK' };
    for (const [layout, table] of [['tricksRight', TRICK_KEYS_RIGHT], ['tricksLeft', TRICK_KEYS_LEFT]]) {
      const rows = keyboardRows(layout);
      for (const [code, pad] of Object.entries(table)) {
        const row = rows.find((r) => r.label === label[pad]);
        expect([layout, pad, row && row.keys]).toEqual([layout, pad, [glyph[code]]]);
      }
    }
  });

  test('every keyboard map explicitly teaches owner-approved ground brake on its AirBrake key', () => {
    expect(keyboardRows('tricksRight').find(r=>r.label==='AIR/GND BRAKE')?.keys).toEqual(['A']);
    expect(keyboardRows('tricksLeft').find(r=>r.label==='AIR/GND BRAKE')?.keys).toEqual(['←']);
    expect(keyboardRows('classic').find(r=>r.label==='AIR/GND BRAKE')?.keys).toEqual(['↑']);
    expect(GAMEPAD_ROWS.find(r=>r.label==='AIR/GND BRAKE')?.glyphs.map(g=>g.text)).toEqual(['X']);
  });

  test('every layout keeps HOP, RESET and PAUSE, and an unknown layout falls back to the default', () => {
    for (const layout of LAYOUTS) {
      const labels = keyboardRows(layout).map((r) => r.label);
      for (const l of ['HOP', 'RESET', 'PAUSE']) expect(labels).toContain(l);
    }
    expect(keyboardRows('bogus')).toEqual(keyboardRows('tricksRight'));
  });
});

// ================================================================== view

describe('HowToPlayView', () => {
  test('is a real View subclass, safe to import after Views.js, and closes on cancel and confirm', () => {
    const s = makeScene(null, { [REG.SETTINGS]: { controlLayout: 'classic' } });
    const theme = new Theme(s);
    for (const action of ['cancel', 'confirm']) {
      const onClose = jest.fn();
      const v = new HowToPlayView(s, theme, { onClose });
      expect(v).toBeInstanceOf(View);
      expect(v).toBeInstanceOf(HowToPlayView);
      const all = texts(v.panel);
      expect(all).toContain('HOW TO PLAY');
      expect(all).toContain('KEYS: CLASSIC');
      for (const t of ['KEYBOARD', 'GAMEPAD', 'TOUCH', 'PUSH', 'BACK']) expect(all).toContain(t);
      v.handleAction('down'); // swallowed, does not close
      expect(onClose).not.toHaveBeenCalled();
      v.handleAction(action);
      expect(onClose).toHaveBeenCalledTimes(1);
      v.destroy();
      expect(v.panel).toBe(null);
    }
    expect({}).not.toBeInstanceOf(HowToPlayView);
  });
});

// ================================================================== title idle / attract / launch

/** Just enough of a Title for the idle and launch paths, on the real prototype. */
function title(over = {}) {
  const t = makeScene(TitleScene.prototype);
  Object.assign(t, {
    starting: false, view: null, dim: null, attract: false, attractExitAt: -Infinity, lastInputAt: 0,
    theme: new Theme(t),
    menu: { handleAction: jest.fn() },
    _enterAttract: jest.fn(function enter() { this.attract = true; }),
    _exitAttract: jest.fn(function exit() { this.attract = false; this.attractExitAt = this.time.now; }),
    ...over,
  });
  return t;
}

describe('Title attract mode', () => {
  test('enters only after ATTRACT_MS without input, and never over an open view', () => {
    expect(ATTRACT_MS).toBe(20000);
    const t = title();
    t._updateAttract(ATTRACT_MS - 1, true);
    expect(t._enterAttract).not.toHaveBeenCalled();
    t._updateAttract(ATTRACT_MS + 1, true);
    expect(t._enterAttract).toHaveBeenCalledTimes(1);
    const v = title({ view: {} });
    v._updateAttract(ATTRACT_MS * 3, true);
    expect(v._enterAttract).not.toHaveBeenCalled();
  });

  test('the input that wakes the cabinet never reaches the menu, and neither does its echo', () => {
    const t = title({ attract: true });
    t.time.now = 50000;
    t._onAction('confirm');
    expect(t._exitAttract).toHaveBeenCalledTimes(1);
    expect(t.attract).toBe(false);
    expect(t.menu.handleAction).not.toHaveBeenCalled();
    // the same key arriving from the second input source a few ms later is still the wake press
    t.time.now = 50040;
    t._onAction('confirm');
    expect(t.menu.handleAction).not.toHaveBeenCalled();
    // a deliberate press afterwards works, and counts as activity
    t.time.now = 51000;
    t._onAction('down');
    expect(t.menu.handleAction).toHaveBeenCalledWith('down');
    expect(t.lastInputAt).toBe(51000);
  });

  test('pad X / Y (alt) opens HOW TO PLAY from the menu', () => {
    const t = title({ _openHelp: jest.fn() });
    t.time.now = 1000;
    t._onAction('alt');
    expect(t._openHelp).toHaveBeenCalledTimes(1);
    expect(t.menu.handleAction).not.toHaveBeenCalled();
  });
});

describe('Title launch', () => {
  test('warps the backdrop, then wipes into the run once', () => {
    const t = title({ backdrop: { warp: jest.fn(() => 700) } });
    t._launch();
    expect(t.backdrop.warp).toHaveBeenCalledTimes(1);
    expect(t.scene.start).not.toHaveBeenCalled();
    expect(t.__timers).toHaveLength(1);
    t.__timers[0].fn(); // the wipe; this harness has no tween manager, so it fires straight away
    expect(t.scene.start).toHaveBeenCalledWith(SCENES.RUN);
    expect(t.scene.start).toHaveBeenCalledTimes(1);
  });

  test('reduced motion (warp returns 0) goes straight to the transition', () => {
    const t = title({ backdrop: { warp: jest.fn(() => 0) } });
    t._launch();
    expect(t.__timers).toHaveLength(0);
    expect(t.scene.start).toHaveBeenCalledWith(SCENES.RUN);
  });
});
