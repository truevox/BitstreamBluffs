/**
 * OWNER: progression engineer. NO Phaser imports.
 *
 * W2 mission UI geometry, extracted so overlap is asserted in Jest rather than eyeballed in a
 * screenshot. W1's audit found three separate layout collisions that a pixel probe missed, so every
 * rectangle the mission UI draws is computed here and checked by tests/src/missionslayout.test.js.
 *
 * Virtual screen is 480x270 (see UIScene / the sim harness).
 */

export const SCREEN = Object.freeze({ w: 480, h: 270 });

/** One panel's fixed geometry, in virtual pixels. */
export const MISSION_PANEL = Object.freeze({
  x: 10,
  y: 96,
  w: 300,
  rows: 3,
  // 18 keeps a full three-slot panel inside the band above the Title menu: 14 + 8 + 3*18 + 6 = 82,
  // so y 96..178. At 22 the panel ran to y=190 and collided with the band below (caught by
  // tests/src/missionslayout.test.js).
  rowH: 18,
  padX: 6,
  padTop: 14,
  labelH: 8,
});

/**
 * Title-screen mission list. The Title screen is already full: menu + CONTROLS panels occupy
 * y 92..196 and the DAILY PATCH strip y 202..228, so the only free band is y 228..270. This is
 * deliberately compact (10 px rows) — asserted against the real bands in tests, not assumed.
 */
export const MISSION_LIST_TITLE = Object.freeze({
  x: 24,
  y: 229,
  w: 432,
  rows: 3,
  rowH: 9,
  padTop: 6,
});

/** The Title screen's existing occupied bands, for overlap assertions. */
export const TITLE_BANDS = Object.freeze({
  menu: Object.freeze({ x: 24, y: 92, w: 432, h: 104 }),
  daily: Object.freeze({ x: 24, y: 202, w: 432, h: 26 }),
});

/**
 * A rect as {x, y, w, h} — the one shape every consumer (Jest tests, Phaser Graphics) understands.
 * @param {number} x @param {number} y @param {number} w @param {number} h
 */
export const rect = (x, y, w, h) => ({ x, y, w, h });

/** Do two rects overlap, with an optional required gap between them? */
export function overlaps(a, b, gap = 0) {
  if (!a || !b) return false;
  return !(a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x
    || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y);
}

/** Every rect fully inside the virtual screen? */
export function insideScreen(r, screen = SCREEN) {
  if (!r) return false;
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= screen.w && r.y + r.h <= screen.h;
}

/**
 * Geometry for the in-run / pause mission panel: one row per active mission.
 * @param {number} count how many missions are active (<= rows)
 * @param {{x?:number,y?:number}} [o]
 * @returns {{panel:Object, header:Object, rows:Array<Object>, bars:Array<Object>}}
 */
export function missionPanelLayout(count, o = {}) {
  const P = { ...MISSION_PANEL, ...o };
  const n = Math.max(0, Math.min(P.rows, Math.round(count || 0)));
  const panel = rect(P.x, P.y, P.w, P.padTop + P.labelH + n * P.rowH + 6);
  const header = rect(P.x + P.padX, P.y + 4, P.w - P.padX * 2, P.labelH);
  const rows = [];
  const bars = [];
  const top = P.y + P.padTop + P.labelH;
  for (let i = 0; i < n; i++) {
    const y = top + i * P.rowH;
    // Text occupies the left ~70%; the bar sits at the row's bottom edge, full width.
    rows.push(rect(P.x + P.padX, y, P.w - P.padX * 2, 9));
    bars.push(rect(P.x + P.padX, y + 10, P.w - P.padX * 2, 4));
  }
  return { panel, header, rows, bars };
}

/**
 * Geometry for the Title-screen mission list. Deliberately a separate, shorter layout: the Title
 * menu occupies its own band and the list must not collide with it or with the footer.
 * @param {number} count
 * @param {{x?:number,y?:number}} [o]
 */
export function missionListLayout(count, o = {}) {
  const L = { ...MISSION_LIST_TITLE, ...o };
  const n = Math.max(0, Math.min(L.rows, Math.round(count || 0)));
  const panel = rect(L.x, L.y, L.w, L.padTop + n * L.rowH + 2);
  const rows = [];
  const bars = [];
  const top = L.y + L.padTop;
  for (let i = 0; i < n; i++) {
    const y = top + i * L.rowH;
    rows.push(rect(L.x + 4, y, L.w - 8, 7));
    bars.push(rect(L.x + 4, y + 8, L.w - 8, 2));
  }
  return { panel, header: null, rows, bars };
}

/**
 * Which HUD slots the mission toast may use. The existing MILESTONE strip owns its slot; the toast
 * must not land on top of it, nor on the hint rows.
 * @param {{hudStrips:Array<Object>}} o
 */
export function toastSlot(o = {}) {
  const strips = Array.isArray(o.hudStrips) ? o.hudStrips : [];
  const w = 240;
  const h = 12;
  // Preferred: just under the score block on the left, above the pause band.
  const candidates = [
    rect(8, 60, w, h),
    rect(8, 74, w, h),
    rect(8, 88, w, h),
  ];
  for (const c of candidates) {
    if (!strips.some((s) => overlaps(c, s, 2)) && insideScreen(c)) return c;
  }
  return null;
}

/**
 * How many characters of a mission title fit a row, given the pixel font's advance width.
 * The pixel font is monospace-ish at `advance` px per char (default 6 at scale 1).
 * @param {number} rowW @param {number} [advance]
 */
export function charsThatFit(rowW, advance = 6) {
  const a = advance > 0 ? advance : 6;
  return Math.max(1, Math.floor(rowW / a));
}

/**
 * Truncate a title to fit a row, with an ellipsis. Truncation is tested so a long template can never
 * silently overrun its bar the way W1's reward string overran a level label.
 * @param {string} text @param {number} rowW @param {number} [advance]
 */
export function ellipsize(text, rowW, advance = 6) {
  const s = typeof text === 'string' ? text : '';
  const max = charsThatFit(rowW, advance);
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  return `${s.slice(0, max - 1)}…`;
}

/**
 * Rows for drawing the three missions inside an existing panel column (Pause, Game Over), where the
 * panel already owns its geometry. Kept here — not in the scenes — so the "does it fit?" question is
 * answered by a unit test rather than by eye.
 *
 * @param {{x:number, y:number, w:number, count:number, rowH?:number, barH?:number}} o
 * @returns {{rows:Array<{x:number,y:number,w:number}>, bars:Array<{x:number,y:number,w:number,h:number}>, h:number}}
 */
export function columnRows(o) {
  const count = Math.max(0, Math.min(3, o.count || 0));
  const rowH = o.rowH || 9;
  const barH = o.barH || 2;
  const rows = [];
  const bars = [];
  for (let i = 0; i < count; i += 1) {
    const y = o.y + i * rowH;
    rows.push(rect(o.x, y, o.w, rowH - 1));
    bars.push(rect(o.x, y + rowH - barH - 1, o.w, barH));
  }
  return { rows, bars, h: count * rowH };
}
