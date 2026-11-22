/**
 * Issue #115: deterministic input-timing harness. DIAGNOSTIC, NON-AUTHORITATIVE.
 *
 * Feeds a fixed sequence of timestamped DOM keyboard events through the REAL InputRouter ->
 * VirtualPad -> SimClock.advance/padsFor path at a given display cadence (30/60/120/144 Hz) and
 * returns the per-tick pad "tape", encoded with the real GhostTape.encodePad bits. Nothing here
 * defines a replay format or a canonical hash; that is #152's job (Team A).
 *
 * Time model: frame k (k >= 1) runs at rAF time T_k = k * 1000 / hz on the same clock as
 * KeyboardEvent.timeStamp (performance.now() in browsers). Every event with T_{k-1} < t <= T_k is
 * dispatched before frame k's update, exactly as the browser delivers queued input before rAF.
 * Simulation tick g (1-based) represents the real-time window ((g-1) * tickMs, g * tickMs].
 */
import { EventEmitter } from 'events';
import { InputRouter } from '../../src/systems/InputRouter.js';
import { SimClock, SIM_TICK_MS, SIM_MAX_TICKS_PER_FRAME } from '../../src/systems/SimClock.js';
import { VirtualPad } from '../../src/systems/VirtualPad.js';
import { encodePad, quantizeTilt } from '../../src/systems/ghost/GhostTape.js';

/** Keyboard code -> raw VirtualPad buttons it holds (default 'tricksRight'-independent KEYMAP subset). */
export const ORACLE_KEYS = {
  KeyW: ['push'], KeyA: ['tiltBack'], KeyD: ['tiltForward'], KeyS: ['brake'],
  Space: ['hop', 'confirm'], ArrowUp: ['airBrake'], ArrowDown: ['parachute'],
  ArrowLeft: ['heliLeft'], ArrowRight: ['heliRight'], ShiftLeft: ['reset'],
};

/**
 * The subset of RunScene.normalizePad that reaches the tape (brakeHeld = S held; `brake` is
 * re-derived per tick by RunScene). Kept tiny on purpose: the harness tests scheduling, not mapping.
 */
export function toTickPad(raw) {
  const p = raw || {};
  const pr = p.pressed || {};
  return {
    push: !!p.push, tilt: quantizeTilt(p.tilt), tuck: !!p.tuck, brakeHeld: !!p.brake, hop: !!p.hop,
    reset: !!p.reset, heli: p.heli > 0 ? 1 : p.heli < 0 ? -1 : 0, airBrake: !!p.airBrake,
    parachute: !!p.parachute, pause: !!p.pause, divebomb: false, corkscrew: false,
    pressed: { hop: !!pr.hop, reset: !!pr.reset, pause: !!pr.pause, airBrake: !!pr.airBrake, parachute: !!pr.parachute, confirm: !!pr.confirm },
  };
}

export const encodeTick = (pad) => encodePad(pad).join(':');

/** Touch event types the harness understands -> DOM pointer event type. */
const TOUCH_TYPES = { touchdown: 'pointerdown', touchmove: 'pointermove', touchup: 'pointerup', touchcancel: 'pointercancel', lostcapture: 'lostpointercapture' };
export const isTouch = (ev) => Object.prototype.hasOwnProperty.call(TOUCH_TYPES, ev.type);

/**
 * Dispatch a pointer event at the overlay button `button` (null = off every button) for finger `pointerId`,
 * through the real TouchOverlay listeners. jsdom has no layout, so document.elementFromPoint is pointed at
 * the button for the duration of the dispatch.
 */
function dispatchTouch(root, ev) {
  const el = ev.button ? root.querySelector(`[data-btn="${ev.button}"]`) : null;
  const target = el || root;
  const e = new Event(TOUCH_TYPES[ev.type], { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'timeStamp', { value: ev.stamp ?? ev.t }); // `stamp` lets a test fake an off-clock stamp
  Object.defineProperty(e, 'pointerId', { value: ev.pointerId ?? 1 });
  Object.defineProperty(e, 'pointerType', { value: 'touch' });
  Object.defineProperty(e, 'clientX', { value: 0 });
  Object.defineProperty(e, 'clientY', { value: 0 });
  const prev = document.elementFromPoint;
  document.elementFromPoint = () => el;
  try { target.dispatchEvent(e); } finally { document.elementFromPoint = prev; }
}

function dispatchKey(type, code, timeStamp) {
  const e = new KeyboardEvent(type, { code, bubbles: true, cancelable: true });
  // jsdom stamps events with Date.now(); real browsers use the performance.now() clock. Pin it.
  Object.defineProperty(e, 'timeStamp', { value: timeStamp });
  window.dispatchEvent(e);
}

/**
 * Run one cadence.
 * @param {object} o
 * @param {number} o.hz display refresh rate
 * @param {{t:number,type:'keydown'|'keyup'|'blur',code?:string}[]} o.events sorted by t
 * @param {number} o.durationMs simulated wall time
 * @param {'legacy'|'timed'} [o.mode] legacy = padsFor(pad, ticks) exactly as main@b51ab36 calls it;
 *        timed = padsFor(pad, ticks, { frameTime, timeline, normalize }) (issue #115)
 * @param {(k:number, T:number) => number} [o.frameDelta] override a frame's delta (suspension tests)
 * @param {(router: InputRouter) => void} [o.beforeFrame] hook run right before each poll (gamepad tests)
 * @returns {{tape:string[], pads:object[], frameOfTick:number[], frames:number, router:InputRouter}}
 */
export function runCadence({ hz, events, durationMs, mode = 'timed', frameDelta, beforeFrame }) {
  const game = { events: new EventEmitter(), canvas: null, registry: { get: () => undefined } };
  const router = new InputRouter(game);
  let now = 0;
  router.now = () => now;
  let touchRoot = null;
  if (events.some(isTouch)) {
    // classic layout keeps the PUSH/HOP/... touch buttons; overlay 'on' so it mounts without a touch device
    router.applySettings({ touchOverlay: 'on', controlLayout: 'classic', touchRotate90: false });
    router.pad.setOverlayContext(true); // shown during a run (InputRouter does it on RUN_START)
    router.pad.overlay.now = () => now;
    touchRoot = router.pad.overlay.root;
  }
  const clock = new SimClock();
  const frameMs = 1000 / hz;
  const tape = [];
  const pads = [];
  const frameOfTick = [];
  let ei = 0;
  let T = 0;
  let k = 0;
  try {
    while (T < durationMs - 1e-9) {
      k++;
      const dt = frameDelta ? frameDelta(k, T) : frameMs;
      const Tk = T + dt;
      while (ei < events.length && events[ei].t <= Tk + 1e-9) {
        const ev = events[ei++];
        now = ev.t;
        if (ev.type === 'blur') window.dispatchEvent(new Event('blur'));
        else if (isTouch(ev)) dispatchTouch(touchRoot, ev);
        else dispatchKey(ev.type, ev.code, ev.t);
      }
      now = Tk;
      if (beforeFrame) beforeFrame(router, k, Tk);
      const raw = router.poll();
      const polled = toTickPad(raw);
      const ticks = clock.advance(Math.max(0, Math.min(dt, 50))); // RunScene: dt = clamp(delta, 0, 50)
      const out = mode === 'legacy'
        ? clock.padsFor(polled, ticks)
        : clock.padsFor(polled, ticks, { frameTime: Tk, timeline: raw.timeline, normalize: toTickPad });
      for (const p of out) {
        tape.push(encodeTick(p));
        pads.push(p);
        frameOfTick.push(k);
      }
      T = Tk;
    }
  } finally {
    router.destroy();
  }
  return { tape, pads, frameOfTick, frames: k, router };
}

/**
 * Reference tape, independent of frames: tick g sees every event with t <= g * tickMs; a button
 * that went down inside tick g's window is held on tick g even if released before its end (a tap
 * is at least one tick); an edge belongs to the tick whose window contains its keydown.
 */
export function oracleTape(events, ticks, tickMs = SIM_TICK_MS) {
  const vp = new VirtualPad();
  const tape = [];
  const fingers = new Map(); // pointerId -> button (the overlay counts fingers per button; VirtualPad does per source)
  const fingerCount = new Map();
  const touch = (name, down) => {
    const n = (fingerCount.get(name) || 0) + (down ? 1 : -1);
    fingerCount.set(name, Math.max(0, n));
    if (down && n === 1) vp.setButton(name, true, 'touch');
    if (!down && n <= 0) vp.setButton(name, false, 'touch');
  };
  let ei = 0;
  for (let g = 1; g <= ticks; g++) {
    const end = g * tickMs;
    const rose = new Set();
    while (ei < events.length && events[ei].t <= end + 1e-9) {
      const ev = events[ei++];
      if (ev.type === 'blur') { vp.releaseSource('keyboard'); continue; }
      if (isTouch(ev)) {
        const id = ev.pointerId ?? 1;
        const prev = fingers.get(id);
        const next = ev.type === 'touchdown' || ev.type === 'touchmove' ? (ev.button || null) : null;
        if (prev === next) continue;
        if (prev) touch(prev, false);
        if (next) { fingers.set(id, next); rose.add(next); touch(next, true); } else fingers.delete(id);
        continue;
      }
      for (const name of ORACLE_KEYS[ev.code] || []) {
        if (ev.type === 'keydown') rose.add(name);
        vp.setButton(name, ev.type === 'keydown', 'keyboard');
      }
    }
    const endState = vp.poll(); // consumes edges for this tick
    if (rose.size) {
      // replay the tick's rises on a scratch pad to OR in sub-tick taps
      const scratch = new VirtualPad();
      for (const n of Object.keys(vp.held)) if (vp.held[n].size || rose.has(n)) scratch.setButton(n, true, 'keyboard');
      const s = scratch.poll();
      s.pressed = endState.pressed;
      tape.push(encodeTick(toTickPad(s)));
    } else tape.push(encodeTick(toTickPad(endState)));
  }
  return tape;
}

/** Ideal (oracle) tick of an event time. */
export const idealTick = (t, tickMs = SIM_TICK_MS) => Math.max(1, Math.ceil(t / tickMs - 1e-9));

/** Index of the first tick (1-based) whose encoded pad satisfies `pred`, at or after `from`. */
export function firstTick(pads, from, pred) {
  for (let i = Math.max(0, from - 1); i < pads.length; i++) if (pred(pads[i])) return i + 1;
  return -1;
}

/**
 * Latency sweep: `n` W presses (held `holdMs`), 100 ms apart, whose phase inside a frame sweeps
 * evenly, so every press/frame/tick alignment is sampled. Per press:
 *  - tickLag: tick that first holds push minus the tick whose window contains the keydown
 *    (negative = applied to simulated time BEFORE the key was pressed);
 *  - frameLag: render frame that first shows it minus the first frame that could poll it.
 * @returns {{tickLag:number[], frameLag:number[], releaseTickLag:number[], lost:number}}
 */
export function measureLatency({ hz, mode, n = 240, holdMs = 20, code = 'KeyW', field = 'push' }) {
  const frameMs = 1000 / hz;
  const events = [];
  for (let j = 0; j < n; j++) {
    const t = 50 + 100 * j + ((j * 0.613) % 33.333) + 0.0137; // phase sweep; never exactly on a boundary
    events.push({ t, type: 'keydown', code }, { t: t + holdMs, type: 'keyup', code });
  }
  const r = runCadence({ hz, events, durationMs: 100 * n + 200, mode });
  const tickLag = [];
  const frameLag = [];
  const releaseTickLag = [];
  const perPressFrameLag = []; // null where the press never reached a tick
  let lost = 0;
  for (let j = 0; j < n; j++) {
    const t = events[2 * j].t;
    const ideal = idealTick(t);
    const from = Math.max(1, ideal - SIM_MAX_TICKS_PER_FRAME); // previous press released >= 9 ticks earlier
    const g = firstTick(r.pads, from, (p) => !!p[field]);
    if (g < 0 || g > idealTick(t + holdMs) + SIM_MAX_TICKS_PER_FRAME) { lost++; perPressFrameLag.push(null); continue; }
    tickLag.push(g - ideal);
    const fl = r.frameOfTick[g - 1] - Math.ceil(t / frameMs - 1e-9);
    frameLag.push(fl);
    perPressFrameLag.push(fl);
    const gr = firstTick(r.pads, g, (p) => !p[field]);
    releaseTickLag.push(gr - idealTick(t + holdMs));
  }
  return { tickLag, frameLag, releaseTickLag, perPressFrameLag, lost };
}

/** min / mean / max summary. */
export function stats(xs) {
  if (!xs.length) return { min: NaN, mean: NaN, max: NaN };
  return { min: Math.min(...xs), mean: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000, max: Math.max(...xs) };
}
