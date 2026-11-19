/**
 * OWNER: UI engineer.
 * Menu motion: the reduce-motion decision, easing, and the shared open/close/scene transitions.
 *
 * Reduce motion. Settings `reduceMotion` is 'auto' | 'on' | 'off'. 'auto' follows the OS
 * `prefers-reduced-motion: reduce` media query, read live (the MediaQueryList is cached and its `matches`
 * re-read on every call, so flipping the OS switch takes effect without a reload). When reduced, every helper
 * here collapses to a short fade (REDUCED_MS) and callers skip shake, glitch, warp and parallax. The decision
 * is a pure function (resolveReduceMotion) so it is unit-tested without a browser.
 *
 * Why no Phaser import: the pure half is tested under Jest, and the scene half only needs what a scene
 * already carries (scene.tweens, scene.add, scene.cameras). Every scene helper degrades when those are absent
 * (Jest stubs, a scene mid-shutdown): it jumps to the end state, so a transition can never strand a view
 * half-open or a scene change un-fired.
 */
import { REG, GAME_WIDTH, GAME_HEIGHT } from '../constants.js';

/** The OS media query 'auto' follows. */
export const REDUCE_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
/** The settings values, in the order SettingsView cycles them. */
export const REDUCE_MOTION_VALUES = Object.freeze(['auto', 'on', 'off']);
/** Every transition collapses to a fade this long when motion is reduced. */
export const REDUCED_MS = 120;

// ------------------------------------------------------------------ reduce-motion decision (pure)

/**
 * Coerce anything to a valid setting value ('auto' for unknown), as SaveStore.sanitizeSettings does.
 * @param {any} v @returns {'auto'|'on'|'off'}
 */
export function sanitizeReduceMotion(v) {
  return REDUCE_MOTION_VALUES.includes(v) ? v : 'auto';
}

/**
 * The decision itself. 'on' and 'off' are the player's explicit choice and always win; anything else is
 * 'auto' and follows the OS.
 * @param {any} setting settings.reduceMotion
 * @param {boolean} osPrefersReduced
 * @returns {boolean} true = reduce motion
 */
export function resolveReduceMotion(setting, osPrefersReduced) {
  const s = sanitizeReduceMotion(setting);
  if (s === 'on') return true;
  if (s === 'off') return false;
  return osPrefersReduced === true;
}

/** @type {WeakMap<object, MediaQueryList|null>} per-window cached query (null = unsupported). */
const MQ = new WeakMap();

/**
 * Does the OS ask for reduced motion? Guarded for jsdom/SSR/old browsers: no window, no matchMedia, or a
 * matchMedia that throws or returns nothing all mean "no preference".
 * @param {any} [win] defaults to the global window
 * @returns {boolean}
 */
export function osPrefersReducedMotion(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win || typeof win !== 'object') return false;
  let mq = MQ.get(win);
  if (mq === undefined) {
    mq = null;
    try {
      if (typeof win.matchMedia === 'function') mq = win.matchMedia(REDUCE_MOTION_QUERY) || null;
    } catch (e) {
      mq = null;
    }
    MQ.set(win, mq);
  }
  return !!(mq && mq.matches === true);
}

/**
 * Should this scene's (or game's) menus reduce motion right now? Reads the live settings in the registry.
 * @param {{registry?:any, game?:any}|null|undefined} sceneOrGame a Phaser.Scene or Phaser.Game
 * @param {any} [win] window override (tests)
 * @returns {boolean}
 */
export function isReducedMotion(sceneOrGame, win) {
  let settings = null;
  try {
    const reg = sceneOrGame && (sceneOrGame.registry || (sceneOrGame.game && sceneOrGame.game.registry));
    settings = reg && typeof reg.get === 'function' ? reg.get(REG.SETTINGS) : null;
  } catch (e) {
    settings = null;
  }
  return resolveReduceMotion(settings && settings.reduceMotion, osPrefersReducedMotion(win));
}

/**
 * A duration under the current motion preference: unchanged, or capped to REDUCED_MS.
 * @param {number} ms @param {boolean} reduced @returns {number}
 */
export function motionMs(ms, reduced) {
  return reduced ? Math.min(ms, REDUCED_MS) : ms;
}

// ------------------------------------------------------------------ easing (pure)

/** @param {number} t @returns {number} t clamped to 0..1 */
export const clamp01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t);
/** @param {number} a @param {number} b @param {number} t @returns {number} */
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Easing curves over 0..1 (input clamped; every curve maps 0 -> 0 and 1 -> 1). Plain functions rather than
 * Phaser ease names so callers can ease values they compute themselves (cursor glides, warp ramps).
 */
export const Ease = Object.freeze({
  linear: (t) => clamp01(t),
  inQuad: (t) => clamp01(t) ** 2,
  outQuad: (t) => { const u = clamp01(t); return 1 - (1 - u) * (1 - u); },
  inCubic: (t) => clamp01(t) ** 3,
  outCubic: (t) => 1 - (1 - clamp01(t)) ** 3,
  inOutCubic: (t) => { const u = clamp01(t); return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2; },
  inOutSine: (t) => (1 - Math.cos(Math.PI * clamp01(t))) / 2,
  /** Overshoots ~10% then settles: the "snap" of a panel landing. */
  outBack: (t) => { const u = clamp01(t); if (u === 0 || u === 1) return u; const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2; },
});

/**
 * Frame-rate independent exponential approach: the fraction of the remaining distance to cover this frame
 * for a follower that closes `rate` of the gap per second at 60 fps feel. Used by the menu cursor glide.
 * @param {number} dtMs @param {number} [halfLifeMs=45] time to close half the gap
 * @returns {number} 0..1
 */
export function approach(dtMs, halfLifeMs = 45) {
  if (!(dtMs > 0)) return 0;
  return 1 - Math.pow(0.5, dtMs / Math.max(1, halfLifeMs));
}

/**
 * Progress 0..1 of the CRT open transition, split into its two phases: the zip line drawing across
 * (`line`, 0..1 during the first ZIP_SPLIT of the time) and the panel unfolding (`open`, 0..1 after it).
 * Pure so the shape of the transition is testable.
 * @param {number} p overall progress 0..1
 * @returns {{line:number, open:number}}
 */
export function crtOpenPhases(p) {
  const u = clamp01(p);
  if (u < ZIP_SPLIT) return { line: Ease.outCubic(u / ZIP_SPLIT), open: 0 };
  return { line: 1, open: Ease.outBack((u - ZIP_SPLIT) / (1 - ZIP_SPLIT)) };
}
const ZIP_SPLIT = 0.35;

// ------------------------------------------------------------------ scene helpers

/** True when the scene can run tweens (real Phaser, and the Jest harness stubs). */
function canTween(scene) {
  return !!(scene && scene.tweens && typeof scene.tweens.addCounter === 'function');
}

/**
 * Is the scene still running (not shutting down or destroyed)? Phaser sets the status to SHUTDOWN (8) before
 * it emits 'shutdown', so a view destroyed from a shutdown listener sees this as false; adding a ghost then
 * would leak it into the display list of the scene's next start. Stubs without a status count as live.
 */
function sceneLive(scene) {
  const st = scene && scene.sys && scene.sys.settings && scene.sys.settings.status;
  return typeof st !== 'number' || st < 8;
}

/** Is a game object still alive (not destroyed)? Phaser clears `scene` on destroy. */
const alive = (o) => !!(o && o.scene);

/**
 * Drive `onUpdate(easedProgress)` from 0 to 1 over `duration` ms. Without a tween manager it jumps straight
 * to the end (onUpdate(1), then onComplete), so callers can always rely on the end state.
 * @param {Phaser.Scene} scene
 * @param {{duration:number, delay?:number, ease?:function(number):number,
 *          onUpdate:function(number, number):void, onComplete?:function():void}} o
 *   onUpdate receives (eased, raw) progress.
 * @returns {Phaser.Tweens.Tween|null}
 */
export function tweenProgress(scene, o) {
  const ease = o.ease || Ease.linear;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    o.onUpdate(ease(1), 1);
    if (o.onComplete) o.onComplete();
  };
  if (!canTween(scene) || !(o.duration > 0)) {
    finish();
    return null;
  }
  return scene.tweens.addCounter({
    from: 0,
    to: 1,
    duration: o.duration,
    delay: o.delay || 0,
    onUpdate: (tw) => {
      if (done) return;
      const raw = clamp01(typeof tw.getValue === 'function' ? tw.getValue() : 1);
      o.onUpdate(ease(raw), raw);
    },
    onComplete: finish,
    onStop: finish,
  });
}

/**
 * Fade a game object's alpha from its current value to `to`.
 * @param {Phaser.Scene} scene
 * @param {Phaser.GameObjects.GameObject & {alpha:number, setAlpha:function(number):any}} obj
 * @param {number} to
 * @param {number} ms
 * @param {function():void} [onComplete]
 * @returns {Phaser.Tweens.Tween|null}
 */
export function fadeTo(scene, obj, to, ms, onComplete) {
  const from = obj.alpha;
  return tweenProgress(scene, {
    duration: ms,
    ease: Ease.outQuad,
    onUpdate: (p) => { if (alive(obj)) obj.setAlpha(lerp(from, to, p)); },
    onComplete,
  });
}

/**
 * Modal dim layer for a host scene (Title, Pause): reuse the previous dim when one view replaces another, so
 * navigating Profile -> Shop does not flash the dim off and on; otherwise create it and fade it in.
 * @param {Phaser.Scene} scene
 * @param {Phaser.GameObjects.Rectangle|null} prevDim the host's current dim, or null
 * @param {number} alpha target opacity
 * @returns {Phaser.GameObjects.Rectangle}
 */
export function openDim(scene, prevDim, alpha) {
  if (alive(prevDim)) return prevDim;
  const dim = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, alpha).setOrigin(0, 0).setDepth(400).setInteractive();
  dim.setAlpha(0);
  fadeTo(scene, dim, 1, motionMs(160, isReducedMotion(scene)));
  return dim;
}

/**
 * Remove a dim layer with a fade. It stops catching input at once (the view it covered is already gone,
 * so the menu beneath must be clickable immediately) and is destroyed when the fade ends.
 * @param {Phaser.Scene} scene @param {Phaser.GameObjects.Rectangle|null} dim @returns {void}
 */
export function closeDim(scene, dim) {
  if (!alive(dim)) return;
  if (!sceneLive(scene)) { dim.destroy(); return; }
  if (typeof dim.disableInteractive === 'function') dim.disableInteractive();
  fadeTo(scene, dim, 0, motionMs(140, isReducedMotion(scene)), () => { if (alive(dim)) dim.destroy(); });
}

/**
 * Open a panel container with a CRT "zip": a bright line draws across the panel's centre, then the panel
 * unfolds vertically from that line with a small overshoot. Reduced motion: a REDUCED_MS fade.
 *
 * Only alpha is set synchronously (to 0, so the frame before the first tween tick never shows the panel at
 * full size). Position and scale change only inside the tween and always end exactly at the container's
 * original x/y and scale 1, so layout read right after construction (tests, hit zones) is the real layout.
 * @param {Phaser.Scene} scene
 * @param {Phaser.GameObjects.Container} container top-left anchored panel container
 * @param {{w:number, h:number, color?:number, duration?:number}} o
 * @returns {Phaser.Tweens.Tween|null}
 */
export function transitionIn(scene, container, o) {
  if (!container) return null;
  const reduced = isReducedMotion(scene);
  const baseX = container.x;
  const baseY = container.y;
  const { w, h } = o;
  container.setAlpha(0);
  if (reduced) return fadeTo(scene, container, 1, REDUCED_MS);
  const line = scene.add && typeof scene.add.graphics === 'function' ? scene.add.graphics() : null;
  if (line) line.setDepth((container.depth || 0) + 1);
  const color = o.color === undefined ? 0xffffff : o.color;
  const end = () => {
    if (line && alive(line)) line.destroy();
    if (!alive(container)) return;
    container.setAlpha(1).setScale(1, 1).setPosition(baseX, baseY);
  };
  return tweenProgress(scene, {
    duration: o.duration || 260,
    onUpdate: (p) => {
      if (!alive(container)) { end(); return; }
      const ph = crtOpenPhases(p);
      if (line && alive(line)) {
        line.clear();
        const lw = Math.max(2, Math.round(w * ph.line));
        const cx = baseX + w / 2;
        const cy = Math.round(baseY + h / 2);
        const fade = 1 - ph.open;
        line.fillStyle(color, 0.25 * fade);
        line.fillRect(Math.round(cx - lw / 2), cy - 2, lw, 5);
        line.fillStyle(0xffffff, 0.9 * fade);
        line.fillRect(Math.round(cx - lw / 2), cy, lw, 1);
      }
      if (ph.open <= 0) {
        container.setAlpha(0);
        return;
      }
      const sy = Math.max(0.02, ph.open);
      container.setAlpha(Math.min(1, ph.open * 1.6)).setScale(1, sy).setPosition(baseX, Math.round(baseY + (h * (1 - sy)) / 2));
    },
    onComplete: end,
  });
}

/**
 * Close: the panel object is destroyed by its owner straight away (view semantics stay synchronous), and a
 * short-lived ghost plays a CRT switch-off where it was: the frame collapses to a horizontal line, the line
 * shrinks to a dot and fades. Reduced motion: the frame just fades.
 * @param {Phaser.Scene} scene
 * @param {{x:number, y:number, w:number, h:number, color?:number, depth?:number}} r
 * @returns {Phaser.GameObjects.Graphics|null} the ghost (destroys itself)
 */
export function transitionOut(scene, r) {
  if (!scene || !scene.add || typeof scene.add.graphics !== 'function' || !sceneLive(scene)) return null;
  const reduced = isReducedMotion(scene);
  const g = scene.add.graphics();
  g.setDepth(r.depth === undefined ? 501 : r.depth);
  const color = r.color === undefined ? 0xffffff : r.color;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  tweenProgress(scene, {
    duration: reduced ? REDUCED_MS : 220,
    onUpdate: (p) => {
      if (!alive(g)) return;
      g.clear();
      if (p >= 1) return;
      if (reduced) {
        g.lineStyle(1, color, 0.6 * (1 - p));
        g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        return;
      }
      // 0..0.55: height collapses to 1px; 0.55..1: width collapses to a dot
      const a = Ease.inCubic(clamp01(p / 0.55));
      const b = Ease.inCubic(clamp01((p - 0.55) / 0.45));
      const hh = Math.max(1, Math.round(r.h * (1 - a)));
      const ww = Math.max(1, Math.round(r.w * (1 - b)));
      const x = Math.round(cx - ww / 2);
      const y = Math.round(cy - hh / 2);
      g.fillStyle(color, 0.12 * (1 - b));
      g.fillRect(x, y, ww, hh);
      g.lineStyle(1, color, 0.8 * (1 - b));
      g.strokeRect(x + 0.5, y + 0.5, Math.max(1, ww - 1), Math.max(1, hh - 1));
      g.fillStyle(0xffffff, 0.9 * (1 - b * 0.6));
      g.fillRect(x, Math.round(cy), ww, 1);
    },
    onComplete: () => { if (alive(g)) g.destroy(); },
  });
  return g;
}

/**
 * Leave a scene with a scanline wipe: horizontal bands close top-to-bottom in a stagger, the last frame
 * flashes a thin white CRT line, then `go()` runs (typically scene.start). Reduced motion: a REDUCED_MS
 * camera fade. `go` runs exactly once, even if the tween manager is missing or the scene is shutting down.
 * @param {Phaser.Scene} scene
 * @param {function():void} go
 * @param {{duration?:number, color?:number, accent?:number, depth?:number}} [o]
 * @returns {void}
 */
export function sceneTransition(scene, go, o = {}) {
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    go();
  };
  const reduced = isReducedMotion(scene);
  if (reduced) {
    const cam = scene && scene.cameras && scene.cameras.main;
    if (cam && typeof cam.fadeOut === 'function' && typeof cam.once === 'function') {
      cam.once('camerafadeoutcomplete', fire);
      cam.fadeOut(REDUCED_MS, 0, 0, 0);
      // belt and braces: a camera that never reports completion must not strand the player
      if (scene.time && typeof scene.time.delayedCall === 'function') scene.time.delayedCall(REDUCED_MS + 80, fire);
      else fire();
    } else fire();
    return;
  }
  if (!canTween(scene) || !scene.add || typeof scene.add.graphics !== 'function') { fire(); return; }
  const g = scene.add.graphics().setDepth(o.depth === undefined ? 20000 : o.depth);
  const color = o.color === undefined ? 0x000000 : o.color;
  const accent = o.accent === undefined ? 0xffffff : o.accent;
  const BAND = 6;
  const bands = Math.ceil(GAME_HEIGHT / BAND);
  tweenProgress(scene, {
    duration: o.duration || 340,
    onUpdate: (p) => {
      if (!alive(g)) return;
      g.clear();
      for (let i = 0; i < bands; i++) {
        // each band starts a little after the one above it: a wipe that reads as a raster sweep
        const local = Ease.outQuad(clamp01(p * 1.6 - (i / bands) * 0.6));
        if (local <= 0) continue;
        const hh = Math.ceil(BAND * local);
        g.fillStyle(color, 1);
        g.fillRect(0, i * BAND, GAME_WIDTH, hh);
        if (local < 1) {
          g.fillStyle(accent, 0.35 * (1 - local));
          g.fillRect(0, i * BAND + hh, GAME_WIDTH, 1);
        }
      }
      if (p > 0.85) {
        g.fillStyle(accent, (p - 0.85) / 0.15 * 0.8);
        g.fillRect(0, Math.round(GAME_HEIGHT / 2), GAME_WIDTH, 1);
      }
    },
    onComplete: fire,
  });
}

/**
 * Run `fn(timeMs, deltaMs)` every frame of a scene until the returned function is called (or the scene shuts
 * down). For the small per-frame flourishes of menu widgets (cursor glide, bracket breathing) where a tween
 * per widget would be harder to keep in sync with repaints. A no-op on scenes without an event emitter.
 * @param {Phaser.Scene} scene
 * @param {function(number, number):void} fn
 * @returns {function():void} stop
 */
export function onTick(scene, fn) {
  const ev = scene && scene.events;
  if (!ev || typeof ev.on !== 'function' || typeof ev.off !== 'function') return () => {};
  const tick = (time, delta) => fn(time, delta);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    ev.off('update', tick);
    ev.off('shutdown', stop);
  };
  ev.on('update', tick);
  ev.once('shutdown', stop);
  return stop;
}
