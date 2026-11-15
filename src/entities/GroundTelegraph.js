/**
 * OWNER: gameplay (readable-chaos pass). World-space drawing of the ground-hazard telegraph planned by
 * systems/HazardTelegraph.js (pattern: entities/AirTelegraph.js). One instance per run. For each mark:
 *  - hazard still off screen: a badge at the right screen edge, standing on the terrain line, with the hazard's glyph,
 *    marching chevrons pointing at what is coming, a response cue above it (hop = up-chevrons, brace = bars) and a
 *    proximity bar that fills as the hazard closes in. Several off-screen hazards stack upward (nearest lowest).
 *  - hazard on screen: a faint vertical light column standing on the box with the same response cue on top, so the eye
 *    finds a 20 px sprite the moment it enters the view.
 * Colour is the response (mark.color): danger = hop, amber = brace, lime = hop NOW. Shape repeats it (colour-blind safe):
 * the hop cue is open up-chevrons, the hop-now cue a filled up-arrow, the brace cue two flat bars.
 * All sizes are screen px divided by the camera zoom, so the marker is the same size on screen at every zoom.
 * Pure drawing: no physics, no score, no state that outlives a frame. Does not import Phaser (uses scene.add.graphics()).
 */
import { hazardDrawKind } from '../systems/BiomeEffects.js';

/** Badge centre this many screen px in from the right screen edge. */
export const EDGE_INSET_PX = 34;
/** At most this many badges are stacked at the edge. */
export const EDGE_MAX_STACK = 3;
const BADGE_HALF_PX = 15;
const STACK_STEP_PX = 44;
const COLUMN_PX = 210;

export class GroundTelegraph {
  /**
   * @param {{add:{graphics:Function}}} scene
   * @param {Object<string,number>} palette
   */
  constructor(scene, palette) {
    this.scene = scene;
    this.palette = palette;
    this.gfx = scene.add.graphics().setDepth(9);
  }

  /**
   * @param {number} timeMs run time (drives the pulse).
   * @param {import('../systems/HazardTelegraph.js').TelegraphMark[]} marks nearest first.
   * @param {{left:number,right:number,top:number,bottom:number}} view visible world rect.
   * @param {number} zoom camera zoom.
   * @param {(x:number)=>number} heightAt terrain height.
   * @returns {void}
   */
  update(timeMs, marks, view, zoom, heightAt) {
    const g = this.gfx;
    if (!g) return;
    g.clear();
    if (!marks || !marks.length || !view) return;
    const k = 1 / (zoom || 1);
    let slot = 0;
    for (const m of marks) {
      if (m.onScreen) this._column(g, timeMs, m, k, view);
      else if (slot < EDGE_MAX_STACK) this._edge(g, timeMs, m, k, view, heightAt, slot++);
    }
  }

  /** Light column on an on-screen hazard. */
  _column(g, t, m, k, view) {
    const h = m.ref;
    const col = this.palette[m.color];
    const go = m.state === 'go';
    const dim = m.clear ? 0.3 : 1;
    const x = h.cx;
    const y0 = h.cy - h.h / 2 - 3 * k;
    // the cue on top must stay on screen when the hazard stands high in the view
    const y1 = Math.min(y0 - 40 * k, Math.max(y0 - COLUMN_PX * k, view.top + 40 * k));
    const pulse = 0.5 + 0.5 * Math.sin(t / (go ? 45 : 150 - 70 * m.urgency));
    // fades once the box is close enough to read on its own, unless it is time to hop
    const near = go ? 1 : 1 - 0.55 * Math.max(0, (m.urgency - 0.6) / 0.4);
    g.lineStyle((go ? 22 : 14) * k, col, (go ? 0.2 : 0.08 + 0.06 * pulse) * near * dim);
    g.lineBetween(x, y0, x, y1);
    g.lineStyle(2 * k, col, (go ? 0.95 : 0.4 + 0.2 * pulse) * near * dim);
    g.lineBetween(x, y0, x, y1);
    this._cue(g, t, m, x, y1 - 6 * k, k, col, dim * (go ? 1 : 0.55 + 0.45 * near));
  }

  /** Badge at the right screen edge for an off-screen hazard. */
  _edge(g, t, m, k, view, heightAt, slot) {
    const col = this.palette[m.color];
    const dim = m.clear ? 0.3 : 1;
    const x = view.right - EDGE_INSET_PX * k;
    let ground = heightAt(x);
    if (!Number.isFinite(ground)) ground = (view.top + view.bottom) / 2;
    ground = Math.min(Math.max(ground, view.top + 150 * k), view.bottom - 12 * k);
    const b = BADGE_HALF_PX * k;
    const y = ground - (30 + slot * STACK_STEP_PX) * k;
    const pulse = 0.5 + 0.5 * Math.sin(t / (150 - 80 * m.urgency));
    // stem to the terrain line (first badge only) and the badge
    if (slot === 0) {
      g.lineStyle(2 * k, col, 0.7 * dim);
      g.lineBetween(x, ground, x, y + b);
    }
    g.fillStyle(this.palette.bg, 0.82 * dim);
    g.fillRect(x - b, y - b, 2 * b, 2 * b);
    g.lineStyle((2 + pulse) * k, col, (0.75 + 0.25 * pulse) * dim);
    g.strokeRect(x - b, y - b, 2 * b, 2 * b);
    this._glyph(g, m.ref, x, y + 1 * k, 9 * k, k, col, dim);
    // proximity bar under the glyph: fills as the hazard closes in
    g.fillStyle(col, 0.9 * dim);
    g.fillRect(x - b + 2 * k, y + b - 4 * k, (2 * b - 4 * k) * m.urgency, 2 * k);
    // marching chevrons toward the screen edge: "it comes from there"
    const step = m.clear ? 0 : Math.floor(t / 110) % 3;
    for (let i = 0; i < 2; i++) {
      const cx = x + b + (4 + i * 6) * k;
      const lit = step === i + 1;
      g.lineStyle((lit ? 3 : 2) * k, col, (lit ? 1 : 0.55) * dim);
      g.lineBetween(cx, y - 5 * k, cx + 4 * k, y);
      g.lineBetween(cx, y + 5 * k, cx + 4 * k, y);
    }
    if (slot === 0) this._cue(g, t, m, x, y - b - 5 * k, k, col, dim);
  }

  /** Response cue with its tip at (x, y): hop = two open up-chevrons, hop now = filled up-arrow, brace = two bars. */
  _cue(g, t, m, x, y, k, col, a) {
    if (m.kind === 'brace') {
      g.lineStyle(3 * k, col, 0.9 * a);
      g.lineBetween(x - 8 * k, y - 4 * k, x + 8 * k, y - 4 * k);
      g.lineBetween(x - 8 * k, y - 11 * k, x + 8 * k, y - 11 * k);
      return;
    }
    if (m.state === 'go') {
      const s = (11 + 3 * (Math.floor(t / 60) % 2)) * k;
      g.fillStyle(col, a);
      g.fillTriangle(x - s, y, x + s, y, x, y - 1.5 * s);
      g.lineStyle(3 * k, this.palette.text, 0.9 * a);
      g.lineBetween(x - s, y, x, y - 1.5 * s);
      g.lineBetween(x + s, y, x, y - 1.5 * s);
      return;
    }
    const bob = m.clear ? 0 : (Math.floor(t / 130) % 2) * 2 * k;
    for (let i = 0; i < 2; i++) {
      const cy = y - i * 8 * k - bob;
      g.lineStyle(3 * k, col, (i === 0 ? 1 : 0.7) * a);
      g.lineBetween(x - 9 * k, cy, x, cy - 8 * k);
      g.lineBetween(x + 9 * k, cy, x, cy - 8 * k);
    }
  }

  /** The hazard's silhouette, simplified, centred at (x, y) with half-size s. */
  _glyph(g, h, x, y, s, k, col, a) {
    const kind = hazardDrawKind(h.def);
    g.lineStyle(2 * k, col, a);
    if (kind === 'spike') {
      for (let i = -1; i <= 1; i++) {
        const x0 = x + i * s * 0.66;
        const top = y - (i === 0 ? s : s * 0.6);
        g.lineBetween(x0 - s * 0.33, y + s * 0.7, x0, top);
        g.lineBetween(x0 + s * 0.33, y + s * 0.7, x0, top);
      }
      g.lineBetween(x - s, y + s * 0.7, x + s, y + s * 0.7);
    } else if (kind === 'chasm') {
      // ground line torn open by a jagged rift
      g.lineBetween(x - s, y - s * 0.5, x - s * 0.55, y - s * 0.5);
      g.lineBetween(x + s * 0.55, y - s * 0.5, x + s, y - s * 0.5);
      g.lineBetween(x - s * 0.55, y - s * 0.5, x - s * 0.2, y);
      g.lineBetween(x - s * 0.2, y, x - s * 0.45, y + s * 0.3);
      g.lineBetween(x - s * 0.45, y + s * 0.3, x, y + s * 0.8);
      g.lineBetween(x, y + s * 0.8, x + s * 0.45, y + s * 0.3);
      g.lineBetween(x + s * 0.45, y + s * 0.3, x + s * 0.2, y);
      g.lineBetween(x + s * 0.2, y, x + s * 0.55, y - s * 0.5);
    } else if (kind === 'firewall') {
      g.lineBetween(x - s * 0.4, y + s * 0.7, x - s * 0.4, y - s * 0.5);
      g.lineBetween(x + s * 0.4, y + s * 0.7, x + s * 0.4, y - s * 0.5);
      g.lineBetween(x - s * 0.4, y - s * 0.5, x, y - s);
      g.lineBetween(x + s * 0.4, y - s * 0.5, x, y - s);
      g.lineBetween(x - s * 0.4, y + s * 0.1, x + s * 0.4, y + s * 0.1);
    } else if (kind === 'vent') {
      g.lineBetween(x - s, y + s * 0.7, x + s, y + s * 0.7);
      g.lineBetween(x - s, y + s * 0.7, x - s * 0.7, y + s * 0.2);
      g.lineBetween(x + s, y + s * 0.7, x + s * 0.7, y + s * 0.2);
      g.lineBetween(x - s * 0.7, y + s * 0.2, x + s * 0.7, y + s * 0.2);
      g.fillStyle(col, a);
      g.fillRect(x - s * 0.5, y - s * 0.35, 2 * k, 2 * k);
      g.fillRect(x + s * 0.2, y - s * 0.7, 2 * k, 2 * k);
      g.fillRect(x - s * 0.05, y - s * 1.0, 2 * k, 2 * k);
    } else if (kind === 'seaweed') {
      for (let i = -1; i <= 1; i++) {
        g.lineBetween(x + i * s * 0.6, y + s * 0.7, x + i * s * 0.6 + s * 0.25, y);
        g.lineBetween(x + i * s * 0.6 + s * 0.25, y, x + i * s * 0.6, y - s * (i === 0 ? 1 : 0.7));
      }
    } else if (kind === 'chocoRiver') {
      g.lineBetween(x - s, y + s * 0.5, x + s, y + s * 0.5);
      g.lineBetween(x - s, y, x - s * 0.3, y - s * 0.3);
      g.lineBetween(x - s * 0.3, y - s * 0.3, x + s * 0.3, y);
      g.lineBetween(x + s * 0.3, y, x + s, y - s * 0.3);
    } else if (kind === 'groomer') {
      g.lineBetween(x - s, y + s * 0.7, x + s, y + s * 0.7);
      g.lineBetween(x - s * 0.7, y + s * 0.7, x - s * 0.7, y - s * 0.1);
      g.lineBetween(x - s * 0.7, y - s * 0.1, x + s * 0.8, y - s * 0.1);
      g.lineBetween(x + s * 0.8, y - s * 0.1, x + s * 0.8, y + s * 0.7);
      g.lineBetween(x, y - s * 0.1, x, y - s * 0.8);
      g.lineBetween(x, y - s * 0.8, x + s * 0.8, y - s * 0.8);
      g.lineBetween(x + s * 0.8, y - s * 0.8, x + s * 0.8, y - s * 0.1);
    } else {
      g.fillStyle(col, 0.5 * a);
      g.fillRect(x - s * 0.7, y - s * 0.7, s * 1.4, s * 1.4);
    }
  }

  /** @param {Object<string,number>} palette @returns {void} */
  setPalette(palette) {
    this.palette = palette;
  }

  /** @returns {void} */
  destroy() {
    if (this.gfx) this.gfx.destroy();
    this.gfx = null;
  }
}
