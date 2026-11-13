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
 * y 92..196 and the DAILY PATCH strip y 202..228, so the only free band is y 228..254. The list is
 * deliberately compact and headerless — justified by the band arithmetic, not by eye.
 */
export const MISSION_LIST_TITLE = Object.freeze({
  x: 24,
  y: 228,
  // The only free band on Title is y 228..270 (menu+CONTROLS end at 196, DAILY PATCH at 228), and it
  // also has to hold BEST and the control hint. Two things follow, and both are asserted in
  // tests/src/missionslayout.test.js rather than eyeballed:
  //   * the list is a LEFT COLUMN (x 24..240), because BEST needs the right half;
  //   * it carries no "MISSIONS" header, because 26 px of vertical space only fits three rows.
  // A full-width, headed list is what collided with BEST and the hint (Luna's W2 finding 3).
  w: 216,
  rows: 3,
  rowH: 8,
  labelH: 5,
  barH: 2,
  padTop: 0,
});

/**
 * Game Over mission block. It goes in the LEDGER panel (right), because the left RUN REPORT panel has
 * no room at all: its 8 report rows reach local 128, then the ledger hash 132, seed 144, COPY button
 * to 154, against a floor at 160.
 *
 * Neither panel had a free band, so this needed a decision rather than a nudge: the board's 10 rows
 * reached local 146 and left 14 px. The Game Over board is trimmed to 8 rows (GAMEOVER_BOARD_ROWS),
 * ending at local 124, which frees 124..160. The heading sits at 126 and three 8 px rows run 136..159,
 * leaving a 1 px margin above the panel floor.
 */
export const GAMEOVER_BOARD_ROWS = 8;
export const GAMEOVER_MISSIONS_Y = 136;
/** Row pitch for the Game Over block: tighter than the in-run panel to fit the 36 px band. */
export const GAMEOVER_ROW_H = 8;

/** The Title screen's existing occupied bands, for overlap assertions. */
export const TITLE_BANDS = Object.freeze({
  menu: Object.freeze({ x: 24, y: 92, w: 432, h: 104 }),
  daily: Object.freeze({ x: 24, y: 202, w: 432, h: 26 }),
  // Where TitleScene draws BEST: the right column, sharing the band with the list.
  best: Object.freeze({ x: 248, y: 234, w: 208, h: 14 }),
  // The control hint, at its original baseline (GAME_HEIGHT - 12), below the list.
  hint: Object.freeze({ x: 0, y: 254, w: 480, h: 9 }),
});

/** Centre x for the Title BEST line: right column, clear of the mission list. */
export const TITLE_BEST_X = 440;
/** Baseline y for the Title BEST line. */
export const TITLE_BEST_Y = 240;

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
    // Label on the row's first line, its bar directly under it — both inside rowH, so a row can never
    // bleed into the next one (the old +8 bar offset overran a 9 px row).
    rows.push(rect(L.x + 4, y, L.w - 8, L.labelH));
    bars.push(rect(L.x + 4, y + L.labelH, L.w - 8, L.barH));
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
