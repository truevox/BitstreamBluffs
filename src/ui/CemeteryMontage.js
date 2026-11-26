/**
 * OWNER: UI engineer. Presentation only.
 *
 * Cemetery Montage / Graveyard Swarm renderer (issue #68). Paints a MontagePlan (systems/ghost/MontagePlan.js): past
 * attempts ride beside the run just finished, each failed self leaves a grave where its trace ends.
 *
 * Nothing here is a GhostRider or a physics object: no Matter body, no collision, no event, no RNG, no score. A rider
 * is a few vector strokes drawn from its recorded pose trace with the shared tracePose() interpolation.
 *
 * Rendering budget (low-end Chromebook first):
 *  - the overview's full trajectories are painted ONCE into a RenderTexture; per frame only riders move;
 *  - one Graphics object for every moving thing, rebuilt each frame with no per-rider allocation;
 *  - at most `budget.riders` riders and `budget.tail` tail samples, lowered at run time by DensityGovernor when the
 *    smoothed frame time stays long (hero first, then newest past attempts survive);
 *  - labels only in 'montage' style (at most MONTAGE_INDIVIDUAL_MAX + 1 bitmap texts, created once).
 *
 * Reduced motion (Motion.isReducedMotion: the player's setting, or the OS preference under AUTO): no autoplay, no
 * follow camera, no blinking. It opens on the still overview at the final frame; the player may step time manually.
 */
import { FONT_KEY } from './PixelFont.js';
import { tracePose, TRACE_EVERY } from '../systems/ghost/GhostTape.js';
import {
  overviewTransform, followTransform, decimate, DensityGovernor, ridersWithinBudget,
} from '../systems/ghost/MontagePlan.js';
import { SIM_TICK_HZ } from '../systems/SimClock.js';

/** Steps of a manual scrub across the whole playback. */
export const SCRUB_STEPS = 24;
let rtSerial = 0;

export class CemeteryMontage {
  /**
   * @param {Phaser.Scene} scene
   * @param {{parent?:Phaser.GameObjects.Container, view:{x:number,y:number,w:number,h:number}, plan:object,
   *          colors:{hero:number, past:number[], swarm:number, grave:number, trail:number}, reduced:boolean,
   *          budget:{riders:number, tail:number}}} o
   */
  constructor(scene, o) {
    this.scene = scene;
    this.parent = o.parent || null;
    this.view = o.view;
    this.plan = o.plan;
    this.colors = o.colors;
    this.reduced = o.reduced === true;
    this.gov = new DensityGovernor(o.budget.riders, { tail: o.budget.tail });
    this.swarm = this.plan.style === 'swarm';
    this.mode = 'overview';
    this.tick = this.reduced ? this.plan.playEndTick : 0;
    this.playing = false;
    this.finished = this.reduced;
    this.frames = 0;
    this.drawn = 0;
    this._cam = null;
    this.overview = overviewTransform(this.plan.bounds, this.view);
    this._staticLayer = this._paintOverview();
    this.g = scene.add.graphics();
    this._add(this.g);
    this.labels = new Map();
    for (const r of this.plan.riders) {
      if (!r.label) continue;
      const t = scene.add.bitmapText(0, 0, FONT_KEY, r.label, 8).setOrigin(0.5, 1).setTint(this._color(r)).setAlpha(r.hero ? 1 : 0.85);
      this._add(t);
      this.labels.set(r.id, t);
    }
    if (!this.reduced) { this.mode = 'follow'; this.playing = true; }
    this._syncStatic();
    this.redraw();
  }

  _add(obj) { if (this.parent && obj) this.parent.add(obj); }

  _color(r) {
    if (r.hero) return this.colors.hero;
    if (this.swarm) return this.colors.swarm;
    return this.colors.past[r.order % this.colors.past.length];
  }

  /** The whole field of trajectories and graves, once, into a texture (or a plain Graphics when RT is unavailable). */
  _paintOverview() {
    const s = this.scene, t = this.overview, v = this.view;
    const g = s.add.graphics();
    const alpha = this.swarm ? 0.22 : 0.45;
    for (const r of this.plan.riders) {
      if (r.hero) continue;
      this._polyline(g, decimate(r.poses, t), this._color(r), 1, alpha);
    }
    const hero = this.plan.riders.find((r) => r.hero);
    if (hero) this._polyline(g, decimate(hero.poses, t), this.colors.hero, 2, 0.9);
    for (const r of this.plan.riders) {
      if (r.hero) continue;
      const p = tracePose(r.poses, r.endTick);
      if (p) this._grave(g, p.x * t.sx + t.ox, p.y * t.sy + t.oy, this.swarm ? 0.6 : 1, this.swarm ? 0.55 : 0.9);
    }
    if (typeof s.add.renderTexture === 'function') {
      try {
        const rt = s.add.renderTexture(v.x, v.y, v.w, v.h).setOrigin(0, 0);
        rt.draw(g, -v.x, -v.y);
        g.destroy();
        rt.__key = `cemetery-${++rtSerial}`;
        this._add(rt);
        return rt;
      } catch { /* fall through: keep the Graphics */ }
    }
    this._add(g);
    return g;
  }

  _polyline(g, pts, color, width, alpha) {
    if (pts.length < 4) return;
    g.lineStyle(width, color, alpha);
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.strokePath();
  }

  /** A small headstone standing on the point where an attempt ended. */
  _grave(g, x, y, scale, alpha) {
    const w = 5 * scale, h = 6 * scale;
    g.fillStyle(this.colors.grave, alpha);
    g.fillRect(x - w / 2, y - h, w, h);
    g.fillCircle(x, y - h, w / 2);
    g.lineStyle(1, this.colors.trail, alpha);
    g.lineBetween(x, y - h - 1.5 * scale, x, y - 2 * scale);
    g.lineBetween(x - 1.5 * scale, y - h + 0.5 * scale, x + 1.5 * scale, y - h + 0.5 * scale);
  }

  _syncStatic() { this._staticLayer?.setVisible?.(this.mode === 'overview'); }

  /** 'follow' (animated camera) or 'overview' (whole course). Follow is unavailable under reduced motion. */
  setMode(mode) {
    const next = mode === 'follow' && !this.reduced ? 'follow' : 'overview';
    if (next === this.mode) return;
    this.mode = next;
    this._cam = null;
    this._syncStatic();
    this.redraw();
  }

  toggleMode() { this.setMode(this.mode === 'follow' ? 'overview' : 'follow'); }

  /** Play/pause. Never autoplays under reduced motion. At the end, play starts again from the top. */
  togglePlay() {
    if (this.reduced) return false;
    if (!this.playing && this.tick >= this.plan.playEndTick) { this.tick = 0; this.finished = false; this.setMode('follow'); }
    this.playing = !this.playing;
    return this.playing;
  }

  /** Manual scrub: one of SCRUB_STEPS jumps through the playback, pausing it. No tween: instant. */
  step(dir) {
    this.playing = false;
    const d = Math.max(1, Math.round(this.plan.playEndTick / SCRUB_STEPS));
    this.tick = Math.max(0, Math.min(this.plan.playEndTick, this.tick + Math.sign(dir) * d));
    this.redraw();
  }

  /** Advance playback by a frame's delta and redraw. Returns false once finished (nothing more to animate). */
  update(dtMs) {
    this.frames++;
    this.gov.frame(dtMs);
    if (this.playing) {
      this.tick += (Math.max(0, Math.min(100, dtMs)) / 1000) * SIM_TICK_HZ * this.plan.speed;
      if (this.tick >= this.plan.playEndTick) {
        this.tick = this.plan.playEndTick;
        this.playing = false;
        this.finished = true;
        this.setMode('overview'); // the final, readable picture of every attempt
      }
    }
    this.redraw();
    return this.playing;
  }

  _transform() {
    if (this.mode === 'overview') return this.overview;
    this._cam = followTransform(this.plan, this.tick, this.view, tracePose, this._cam);
    return this._cam;
  }

  _inside(x, y) {
    const v = this.view;
    return x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h;
  }

  redraw() {
    const g = this.g;
    if (!g) return;
    g.clear();
    const t = this._transform();
    const tick = this.tick;
    const follow = this.mode === 'follow';
    const riders = ridersWithinBudget(this.plan, this.gov.riders);
    const drawnIds = this._drawnIds || (this._drawnIds = new Set());
    drawnIds.clear();
    if (follow) this._followBackdrop(g, t, tick);
    let drawn = 0;
    for (const r of riders) {
      const alive = tick <= r.endTick;
      const color = this._color(r);
      if (!alive) {
        // A past attempt that ended: its grave (the overview texture already holds them all).
        if (follow && !r.hero) {
          const p = tracePose(r.poses, r.endTick);
          if (p) {
            const x = p.x * t.sx + t.ox, y = p.y * t.sy + t.oy;
            if (this._inside(x, y)) this._grave(g, x, y, this.swarm ? 0.8 : 1.2, 0.9);
            this._placeLabel(r, x, y - 9, this._inside(x, y));
            drawnIds.add(r.id);
          }
        } else if (!follow && !r.hero) {
          const p = tracePose(r.poses, r.endTick);
          if (p) { this._placeLabel(r, p.x * t.sx + t.ox, p.y * t.sy + t.oy - 7, true); drawnIds.add(r.id); }
        } else if (r.hero) {
          const p = tracePose(r.poses, r.endTick);
          if (p) { this._rider(g, r, p, t, color, follow); drawnIds.add(r.id); drawn++; }
        }
        continue;
      }
      const p = tracePose(r.poses, tick);
      if (!p) continue;
      if (follow && this.gov.tail > 0) this._tail(g, r, tick, t, color);
      this._rider(g, r, p, t, color, follow);
      drawnIds.add(r.id);
      drawn++;
    }
    for (const [id, label] of this.labels) if (!drawnIds.has(id)) label.setVisible(false);
    this.drawn = drawn;
  }

  /** Follow view: the hero's own line as a faint ridge, so the course shape reads without terrain. */
  _followBackdrop(g, t, tick) {
    const hero = this.plan.riders.find((r) => r.hero) || this.plan.riders[this.plan.riders.length - 1];
    const p = hero.poses, n = Math.floor(p.length / 3);
    const centre = Math.max(0, Math.floor(tick / TRACE_EVERY));
    const from = Math.max(0, centre - 220), to = Math.min(n - 1, centre + 220);
    g.lineStyle(1, this.colors.trail, 0.35);
    g.beginPath();
    let open = false;
    for (let i = from; i <= to; i += 2) {
      const x = p[i * 3] * t.sx + t.ox, y = p[i * 3 + 1] * t.sy + t.oy;
      if (!this._inside(x, y)) { open = false; continue; }
      if (open) g.lineTo(x, y); else { g.moveTo(x, y); open = true; }
    }
    g.strokePath();
  }

  _tail(g, r, tick, t, color) {
    const p = r.poses;
    const head = Math.min(Math.floor(p.length / 3) - 1, Math.max(0, Math.floor(tick / TRACE_EVERY) - 1));
    const from = Math.max(0, head - this.gov.tail);
    if (head - from < 1) return;
    g.lineStyle(this.swarm ? 1 : 1.5, color, this.swarm ? 0.3 : 0.45);
    g.beginPath();
    let open = false;
    for (let i = from; i <= head; i++) {
      const x = p[i * 3] * t.sx + t.ox, y = p[i * 3 + 1] * t.sy + t.oy;
      if (!this._inside(x, y)) { open = false; continue; }
      if (open) g.lineTo(x, y); else { g.moveTo(x, y); open = true; }
    }
    g.strokePath();
  }

  /** A sled-and-rider silhouette in the montage's scale (cf. GhostRider), or a dot in the overview. */
  _rider(g, r, p, t, color, follow) {
    const x = p.x * t.sx + t.ox, y = p.y * t.sy + t.oy;
    if (!this._inside(x, y)) { this._placeLabel(r, x, y, false); return; }
    const alpha = r.hero ? 1 : this.swarm ? 0.55 : 0.8;
    if (!follow) {
      g.fillStyle(color, alpha);
      g.fillCircle(x, y, r.hero ? 2.5 : this.swarm ? 1.2 : 1.8);
      this._placeLabel(r, x, y - 4, true);
      return;
    }
    const k = t.sx * (r.hero ? 1.5 : 1.2); // world scale, slightly enlarged so a 15 px sled still reads
    const c = Math.cos(p.angle) * k, s = Math.sin(p.angle) * k;
    const P = (lx, ly, i) => { this._pt[i] = x + lx * c - ly * s; this._pt[i + 1] = y + lx * s + ly * c; };
    if (!this._pt) this._pt = new Float32Array(8);
    g.lineStyle(r.hero ? 2 : 1, color, alpha);
    P(-24, 11, 0); P(26, 9, 2);
    g.lineBetween(this._pt[0], this._pt[1], this._pt[2], this._pt[3]);
    P(-4, 2, 0); P(0, -16, 2);
    g.lineBetween(this._pt[0], this._pt[1], this._pt[2], this._pt[3]);
    P(0, -21, 4);
    g.fillStyle(color, alpha);
    g.fillCircle(this._pt[4], this._pt[5], Math.max(1.2, 4.5 * k));
    this._placeLabel(r, this._pt[4], this._pt[5] - 4, true);
  }

  _placeLabel(r, x, y, visible) {
    const label = this.labels.get(r.id);
    if (!label) return;
    const v = this.view, half = (Number(label.width) || 0) / 2 + 1;
    // Keep the whole tag inside the frame (a hero that ends at the right edge still shows NEW BEST in full).
    const lx = Math.max(v.x + half, Math.min(v.x + v.w - half, x));
    const ly = Math.max(v.y + 10, y);
    label.setVisible(visible && this._inside(x, y)).setPosition(Math.round(lx), Math.round(ly));
  }

  /** Numbers for the browser benchmark and tests. */
  stats() {
    return { frames: this.frames, drawn: this.drawn, budget: this.gov.riders, tail: this.gov.tail,
      degraded: this.gov.degraded, emaMs: this.gov.ema, tick: this.tick, mode: this.mode, playing: this.playing };
  }

  destroy() {
    try { this.g?.destroy(); } catch { /* scene already gone */ }
    try { this._staticLayer?.destroy(); } catch { /* scene already gone */ }
    for (const l of this.labels.values()) { try { l.destroy(); } catch { /* gone */ } }
    this.labels.clear();
    this.g = null;
    this._staticLayer = null;
  }
}
