/**
 * OWNER: input/audio/glitch engineer. DOM only (no Phaser import). Helper of VirtualPad.
 *
 * On-screen touch controls drawn with inline SVG neon shapes. Pointer events are hit-tested manually with
 * document.elementFromPoint so several fingers work at once and a thumb can slide from one button to the next
 * (e.g. tilt back -> tilt forward). Layout: steering cluster bottom-left, action cluster bottom-right, pause/reset
 * top-centre (HUD owns the top corners); the rider sits in the upper-left/middle of the screen so thumbs never cover it.
 */

/** @typedef {{name:string, label:string, icon:string, color:string, grid:string, big?:boolean}} OverlayButton */

const SVG = (body) =>
  `<svg viewBox="0 0 24 24" width="62%" height="62%" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

/** @type {Object<string,string>} */
const ICONS = {
  back: SVG('<polygon points="16,5 6,12 16,19"/>'),
  fwd: SVG('<polygon points="8,5 18,12 8,19"/>'),
  tuck: SVG('<polygon points="4,8 12,17 20,8"/><line x1="6" y1="20" x2="18" y2="20"/>'),
  brake: SVG('<rect x="6" y="6" width="12" height="12"/>'),
  push: SVG('<polyline points="5,6 12,12 5,18"/><polyline points="12,6 19,12 12,18"/>'),
  hop: SVG('<polygon points="12,3 20,13 4,13"/><line x1="4" y1="19" x2="20" y2="19"/>'),
  heliL: SVG('<path d="M5 12a7 7 0 1 0 3-5.7"/><polyline points="4,3 8,7 3,8"/>'),
  heliR: SVG('<path d="M19 12a7 7 0 1 1-3-5.7"/><polyline points="20,3 16,7 21,8"/>'),
  air: SVG('<polyline points="5,15 12,7 19,15"/><line x1="5" y1="19" x2="19" y2="19"/>'),
  chute: SVG('<path d="M4 11a8 7 0 0 1 16 0z"/><line x1="4" y1="11" x2="12" y2="20"/><line x1="20" y1="11" x2="12" y2="20"/>'),
  pause: SVG('<line x1="9" y1="6" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="18"/>'),
  reset: SVG('<path d="M5 12a7 7 0 1 0 2.2-5"/><polyline points="4,4 5,9 10,8"/>'),
};

/** Button layout. grid = "gridColumn / gridRow" within the cluster. */
const LEFT = [
  { name: 'brake', label: 'BRAKE', icon: 'brake', color: 'amber', grid: '1/1' },
  { name: 'tuck', label: 'TUCK', icon: 'tuck', color: 'lime', grid: '2/1' },
  { name: 'tiltBack', label: 'TILT BACK', icon: 'back', color: 'cyan', grid: '1/2', big: true },
  { name: 'tiltForward', label: 'TILT FWD', icon: 'fwd', color: 'cyan', grid: '2/2', big: true },
];
const RIGHT = [
  { name: 'heliLeft', label: 'SPIN CCW', icon: 'heliL', color: 'lime', grid: '1/1' },
  { name: 'airBrake', label: 'AIR BRAKE', icon: 'air', color: 'amber', grid: '2/1' },
  { name: 'heliRight', label: 'SPIN CW', icon: 'heliR', color: 'lime', grid: '3/1' },
  { name: 'push', label: 'PUSH', icon: 'push', color: 'cyan', grid: '1/2' },
  { name: 'hop', label: 'HOP', icon: 'hop', color: 'magenta', grid: '2/2', big: true },
  { name: 'parachute', label: 'CHUTE', icon: 'chute', color: 'amber', grid: '3/2' },
];
const TOP = [
  { name: 'reset', label: 'RESET', icon: 'reset', color: 'amber', grid: '1/1' },
  { name: 'pause', label: 'PAUSE', icon: 'pause', color: 'cyan', grid: '2/1' },
];

const DEFAULT_COLORS = { cyan: '#00f0ff', magenta: '#ff2bd6', lime: '#9dff3a', amber: '#ffb000' };

export class TouchOverlay {
  /**
   * @param {{setButton:(name:string, down:boolean, source:string)=>void}} pad
   */
  constructor(pad) {
    this.pad = pad;
    /** @type {HTMLElement|null} */
    this.root = null;
    this.colors = { ...DEFAULT_COLORS };
    /** pointerId -> button name currently held by that finger. @type {Map<number,string>} */
    this.pointers = new Map();
    /** @type {Map<string,number>} button name -> number of fingers on it */
    this.counts = new Map();
    this.mode = 'auto';
    this.contextVisible = false;
    this.touchSeen = false;
    this._handlers = [];
  }

  /** @returns {boolean} true on devices that look touch-capable. */
  static detectTouch() {
    if (typeof window === 'undefined') return false;
    try {
      if ('ontouchstart' in window) return true;
      if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) return true;
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  /** @param {Object<string,string>} colors css colours keyed cyan/magenta/lime/amber. */
  setColors(colors) {
    this.colors = { ...DEFAULT_COLORS, ...(colors || {}) };
    if (this.root) {
      for (const k of Object.keys(DEFAULT_COLORS)) this.root.style.setProperty(`--bb-${k}`, this.colors[k]);
    }
  }

  /**
   * @param {HTMLElement} parent
   * @param {'auto'|'on'|'off'} mode
   */
  mount(parent, mode) {
    this.mode = mode || 'auto';
    if (typeof document === 'undefined') return;
    if (!this.root) this._build(parent || document.body);
    else if (parent && this.root.parentElement !== parent) parent.appendChild(this.root);
    this._listenFirstTouch();
    this._refresh();
  }

  /** @param {boolean} visible shown only while a run is in progress (set by InputRouter). */
  setContextVisible(visible) {
    this.contextVisible = !!visible;
    this._refresh();
  }

  /** @returns {boolean} */
  isVisible() {
    return !!this.root && this.root.style.display !== 'none';
  }

  _wantVisible() {
    if (this.mode === 'off') return false;
    if (!this.contextVisible) return false;
    if (this.mode === 'on') return true;
    return this.touchSeen || TouchOverlay.detectTouch();
  }

  _refresh() {
    if (!this.root) return;
    const show = this._wantVisible();
    this.root.style.display = show ? 'block' : 'none';
    if (!show) this.releaseAll();
  }

  _listenFirstTouch() {
    if (this._firstTouchBound || typeof window === 'undefined') return;
    this._firstTouchBound = true;
    const onTouch = (e) => {
      if (e.pointerType && e.pointerType !== 'touch') return;
      this.touchSeen = true;
      this._refresh();
    };
    window.addEventListener('pointerdown', onTouch, true);
    this._handlers.push([window, 'pointerdown', onTouch, true]);
  }

  /** @param {HTMLElement} parent */
  _build(parent) {
    const root = document.createElement('div');
    root.className = 'bb-touch-overlay';
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText =
      'position:fixed;inset:0;z-index:20;display:none;pointer-events:none;touch-action:none;' +
      'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;--u:clamp(40px,13vmin,76px);';
    for (const k of Object.keys(DEFAULT_COLORS)) root.style.setProperty(`--bb-${k}`, this.colors[k]);
    const style = document.createElement('style');
    style.textContent = `
      .bb-touch-overlay .bb-cl{position:absolute;display:grid;gap:calc(var(--u)*0.12);pointer-events:none}
      .bb-touch-overlay .bb-btn{pointer-events:auto;touch-action:none;box-sizing:border-box;display:flex;
        align-items:center;justify-content:center;width:calc(var(--u)*1.1);height:calc(var(--u)*1.1);
        border:2px solid currentColor;border-radius:22%;background:rgba(5,6,15,0.28);opacity:0.5;
        filter:drop-shadow(0 0 4px currentColor);font:700 9px monospace;transition:opacity 60ms,background 60ms}
      .bb-touch-overlay .bb-btn.bb-big{width:calc(var(--u)*1.45);height:calc(var(--u)*1.45)}
      .bb-touch-overlay .bb-btn.bb-on{opacity:1;background:rgba(255,255,255,0.22)}
      .bb-touch-overlay .bb-btn svg{pointer-events:none}`;
    root.appendChild(style);
    const mkCluster = (pos, cols, items) => {
      const c = document.createElement('div');
      c.className = 'bb-cl';
      c.style.cssText = `${pos};grid-template-columns:repeat(${cols},auto);align-items:end;justify-items:center`;
      for (const b of items) {
        const el = document.createElement('div');
        el.className = 'bb-btn' + (b.big ? ' bb-big' : '');
        el.dataset.btn = b.name;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', b.label);
        el.style.color = `var(--bb-${b.color})`;
        const [col, row] = b.grid.split('/');
        el.style.gridColumn = col;
        el.style.gridRow = row;
        el.innerHTML = ICONS[b.icon];
        c.appendChild(el);
      }
      root.appendChild(c);
    };
    mkCluster('left:max(2vmin,env(safe-area-inset-left));bottom:max(2vmin,env(safe-area-inset-bottom))', 2, LEFT);
    mkCluster('right:max(2vmin,env(safe-area-inset-right));bottom:max(2vmin,env(safe-area-inset-bottom))', 3, RIGHT);
    mkCluster('left:50%;transform:translateX(-50%);top:max(1.5vmin,env(safe-area-inset-top))', 2, TOP); // centre: HUD owns both top corners

    const on = (type, fn) => {
      root.addEventListener(type, fn, { passive: false });
      this._handlers.push([root, type, fn, { passive: false }]);
    };
    on('pointerdown', (e) => this._onDown(e));
    on('pointermove', (e) => this._onMove(e));
    on('pointerup', (e) => this._onUp(e));
    on('pointercancel', (e) => this._onUp(e));
    on('contextmenu', (e) => e.preventDefault());
    this.root = root;
    parent.appendChild(root);
  }

  /** @param {PointerEvent} e @returns {string|null} */
  _hit(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const b = el && el.closest ? el.closest('[data-btn]') : null;
    return b ? b.dataset.btn : null;
  }

  _press(name) {
    const n = (this.counts.get(name) || 0) + 1;
    this.counts.set(name, n);
    if (n === 1) {
      this.pad.setButton(name, true, 'touch');
      this._paint(name, true);
    }
  }

  _release(name) {
    const n = (this.counts.get(name) || 0) - 1;
    if (n <= 0) {
      this.counts.delete(name);
      this.pad.setButton(name, false, 'touch');
      this._paint(name, false);
    } else this.counts.set(name, n);
  }

  _paint(name, on) {
    if (!this.root) return;
    const el = this.root.querySelector(`[data-btn="${name}"]`);
    if (el) el.classList.toggle('bb-on', on);
  }

  _assign(id, name) {
    const prev = this.pointers.get(id);
    if (prev === name) return;
    if (prev) this._release(prev);
    if (name) {
      this.pointers.set(id, name);
      this._press(name);
    } else this.pointers.delete(id);
  }

  _onDown(e) {
    e.preventDefault();
    try { e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (this.onGesture) this.onGesture(e);
    this._assign(e.pointerId, this._hit(e));
  }

  _onMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    e.preventDefault();
    this._assign(e.pointerId, this._hit(e));
  }

  _onUp(e) {
    e.preventDefault();
    this._assign(e.pointerId, null);
  }

  /** Release every held button (hidden, blur, destroy). */
  releaseAll() {
    for (const id of [...this.pointers.keys()]) this._assign(id, null);
  }

  destroy() {
    this.releaseAll();
    for (const [t, type, fn, opt] of this._handlers) t.removeEventListener(type, fn, opt);
    this._handlers = [];
    this._firstTouchBound = false;
    if (this.root && this.root.parentElement) this.root.parentElement.removeChild(this.root);
    this.root = null;
  }
}
