/**
 * OWNER: gameplay (readable-chaos pass). World-space drawing of the ground-hazard telegraph planned by
 * systems/HazardTelegraph.js (pattern: entities/AirTelegraph.js). One instance per run. For each mark:
 *  - hazard cue would be clipped: a badge at the right screen edge, standing on the terrain line, with the hazard's glyph,
 *    marching chevrons pointing at what is coming, a response cue above it (hop = up-chevrons, brace = bars) and a
 *    proximity bar that fills as the hazard closes in. Several off-screen hazards stack upward (nearest lowest).
 *  - hazard cue fits: a faint vertical light column standing on the box with the same response cue on top.
 * Colour is the response (mark.color): danger = hop, amber = brace, lime = hop NOW. Shape repeats it (colour-blind safe):
 * the hop cue is open up-chevrons, the hop-now cue a filled up-arrow, the brace cue two flat bars.
 * Dim (and silent, see TelegraphTracker): a hazard the sled is flying over (state 'clear') and a Gear Gate that will be
 * open when the sled gets there (state 'open'; its glyph is drawn without the bar across it).
 * All sizes are game px (GAME_WIDTH x GAME_HEIGHT = 480 x 270, shown 2x) divided by the camera zoom, so the marker is the
 * same size on screen at every zoom.
 * Pure drawing: no physics, no score, no state that outlives a frame. Does not import Phaser (uses scene.add.graphics()).
 */
import { hazardDrawKind } from '../systems/BiomeEffects.js';

/** Badge centre this many game px in from the right screen edge. */
export const EDGE_INSET_PX = 26;
/** At most this many badges are stacked at the edge. */
export const EDGE_MAX_STACK = 3;
const BADGE_HALF_PX = 13;
const STACK_STEP_PX = 31;
const COLUMN_PX = 130;
/** The response cue is drawn at this scale of its design size. */
const CUE_SCALE = 0.75;
const GO_CUE_HALF_PX = 14;
const CUE_STROKE_PX = 3;

/** Read the drawn polyline only. A camera-driven heightAt call could stream terrain ahead of the next sim tick. */
function edgeTerrainY(chunks, x) {
  for (const chunk of chunks || []) {
    if (!(x >= chunk.startX && x <= chunk.endX)) continue;
    const points = chunk.points;
    if (!points || points.length < 2 || x < points[0].x || x > points[points.length - 1].x) return NaN;
    let lo = 0, hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (hi + lo) >> 1;
      if (points[mid].x <= x) lo = mid; else hi = mid;
    }
    const a = points[lo], b = points[hi];
    return b.x > a.x ? a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x) : NaN;
  }
  return NaN;
}

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
   * @param {import('../data/schemas.js').TerrainChunk[]} activeChunks already-streamed terrain, read only.
   * @returns {void}
   */
  update(timeMs, marks, view, zoom, activeChunks) {
    const g = this.gfx;
    if (!g) return;
    g.clear();
    if (!marks || !marks.length || !view) return;
    const k = 1 / (zoom || 1);
    const cueK = k * CUE_SCALE;
    // Allow the full largest pulse plus outline so the cue doesn't switch layouts every time it pulses.
    const half = (GO_CUE_HALF_PX + CUE_STROKE_PX / 2) * cueK;
    const height = (1.5 * GO_CUE_HALF_PX + CUE_STROKE_PX / 2) * cueK;
    const badges = [];
    for (const m of marks) {
      const h = m.ref;
      const base = h.cy - h.h / 2 - 3 * k;
      const top = Math.min(base - 30 * k, Math.max(base - COLUMN_PX * k, view.top + 30 * k));
      const cue = top - 4 * k;
      if (h.cx - half >= view.left && h.cx + half <= view.right &&
          cue - height >= view.top && cue + CUE_STROKE_PX / 2 * cueK <= view.bottom) {
        this._column(g, timeMs, m, k, base, top);
      } else badges.push(m);
    }
    // Only the first badge has a response glyph. Don't let an earlier warning hide the nearest clipped hop-now cue.
    const go = badges.findIndex((m) => m.state === 'go');
    if (go > 0) badges.unshift(...badges.splice(go, 1));
    for (let slot = 0; slot < Math.min(badges.length, EDGE_MAX_STACK); slot++) {
      this._edge(g, timeMs, badges[slot], k, view, activeChunks, slot);
    }
  }

  /** Light column on an on-screen hazard. */
  _column(g, t, m, k, y0, y1) {
    const col = this.palette[m.color];
    const go = m.state === 'go';
    const dim = m.clear || m.state === 'open' ? 0.3 : 1;
    const x = m.ref.cx;
    const pulse = 0.5 + 0.5 * Math.sin(t / (go ? 45 : 150 - 70 * m.urgency));
    // fades once the box is close enough to read on its own, unless it is time to hop
    const near = go ? 1 : 1 - 0.55 * Math.max(0, (m.urgency - 0.6) / 0.4);
    g.lineStyle((go ? 16 : 11) * k, col, (go ? 0.24 : 0.13 + 0.08 * pulse) * near * dim);
    g.lineBetween(x, y0, x, y1);
    g.lineStyle(2 * k, col, (go ? 0.95 : 0.5 + 0.25 * pulse) * near * dim);
    g.lineBetween(x, y0, x, y1);
    this._cue(g, t, m, x, y1 - 4 * k, k * CUE_SCALE, col, dim * (go ? 1 : 0.55 + 0.45 * near));
  }

  /** Badge at the right screen edge for an off-screen hazard. */
  _edge(g, t, m, k, view, activeChunks, slot) {
    const col = this.palette[m.color];
    const dim = m.clear || m.state === 'open' ? 0.3 : 1;
    const x = view.right - EDGE_INSET_PX * k;
    let ground = edgeTerrainY(activeChunks, x);
    if (!Number.isFinite(ground)) ground = (view.top + view.bottom) / 2;
    // not under the HUD's bottom row (seed / daily rule, bottom right) when the terrain line is below the view
    ground = Math.min(Math.max(ground, view.top + 100 * k), view.bottom - 30 * k);
    const b = BADGE_HALF_PX * k;
    const y = ground - (24 + slot * STACK_STEP_PX) * k;
    const pulse = 0.5 + 0.5 * Math.sin(t / (150 - 80 * m.urgency));
    // stem to the terrain line (first badge only) and the badge
    if (slot === 0) {
      g.lineStyle(1.5 * k, col, 0.7 * dim);
      g.lineBetween(x, ground, x, y + b);
    }
    g.fillStyle(this.palette.bg, 0.82 * dim);
    g.fillRect(x - b, y - b, 2 * b, 2 * b);
    g.lineStyle((1.5 + 0.8 * pulse) * k, col, (0.75 + 0.25 * pulse) * dim);
    g.strokeRect(x - b, y - b, 2 * b, 2 * b);
    this._glyph(g, m.ref, x, y, 7.5 * k, k, col, dim, m);
    // proximity bar under the glyph: fills as the hazard closes in
    g.fillStyle(col, 0.9 * dim);
    g.fillRect(x - b + 1.5 * k, y + b - 3 * k, (2 * b - 3 * k) * m.urgency, 1.5 * k);
    // marching chevrons toward the screen edge: "it comes from there"
    const step = m.clear || m.state === 'open' ? 0 : Math.floor(t / 110) % 3;
    for (let i = 0; i < 2; i++) {
      const cx = x + b + (3 + i * 4.5) * k;
      const lit = step === i + 1;
      g.lineStyle((lit ? 2 : 1.5) * k, col, (lit ? 1 : 0.55) * dim);
      g.lineBetween(cx, y - 4 * k, cx + 3 * k, y);
      g.lineBetween(cx, y + 4 * k, cx + 3 * k, y);
    }
    if (slot === 0) this._cue(g, t, m, x, y - b - 4 * k, k * CUE_SCALE, col, dim);
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
      const s = (GO_CUE_HALF_PX - 3 + 3 * (Math.floor(t / 60) % 2)) * k;
      g.fillStyle(col, a);
      g.fillTriangle(x - s, y, x + s, y, x, y - 1.5 * s);
      g.lineStyle(CUE_STROKE_PX * k, this.palette.text, 0.9 * a);
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

  /** The hazard's silhouette, simplified, centred at (x, y) with half-size s. m (optional): the mark (gate open/closed). */
  _glyph(g, h, x, y, s, k, col, a, m) {
    const kind = hazardDrawKind(h.def);
    g.lineStyle(1.5 * k, col, a);
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
      g.fillRect(x - s * 0.5, y - s * 0.35, 1.5 * k, 1.5 * k);
      g.fillRect(x + s * 0.2, y - s * 0.7, 1.5 * k, 1.5 * k);
      g.fillRect(x - s * 0.05, y - s * 1.0, 1.5 * k, 1.5 * k);
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
    } else if (kind === 'boulder' || kind === 'dewDrop') {
      // a ball on the ground line, with a motion streak (no direction implied: both sides)
      const r = kind === 'boulder' ? s * 0.7 : s * 0.55;
      g.strokeCircle(x, y + s * 0.7 - r, r);
      g.lineBetween(x - s, y + s * 0.7, x + s, y + s * 0.7);
    } else if (kind === 'gearGate') {
      // two posts; a bar across them while the gate will be closed
      g.lineBetween(x - s * 0.6, y + s * 0.7, x - s * 0.6, y - s * 0.8);
      g.lineBetween(x + s * 0.6, y + s * 0.7, x + s * 0.6, y - s * 0.8);
      g.strokeCircle(x, y - s * 0.8, s * 0.3);
      if (!m || m.state !== 'open') g.lineBetween(x - s * 0.6, y, x + s * 0.6, y);
    } else if (kind === 'shatterWall') {
      // a crystal pane with a crack
      g.strokeRect(x - s * 0.5, y - s, s, s * 1.7);
      g.lineBetween(x - s * 0.2, y - s, x + s * 0.1, y - s * 0.2);
      g.lineBetween(x + s * 0.1, y - s * 0.2, x - s * 0.15, y + s * 0.7);
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
