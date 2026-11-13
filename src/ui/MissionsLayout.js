/**
 * OWNER: progression engineer. NO Phaser imports.
 *
 * W2 mission UI geometry, extracted so overlap is asserted in Jest rather than eyeballed in a
 * screenshot. W1's audit found three separate layout collisions that a pixel probe missed, so every
 * rectangle the mission UI draws is computed here and checked by tests/src/missionslayout.test.js.
 *
 * Virtual screen is 480x270 (see UIScene / the sim harness).
 */

// PixelFont has no Phaser import, so this stays a pure module dependency (the file's stated rule).
import { FONT_LINE_H } from './PixelFont.js';

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
  // also has to hold BEST and the control hint. Three things follow, all asserted in
  // tests/src/missionslayout.test.js rather than eyeballed:
  //   * the list is a LEFT COLUMN (x 24..240), because BEST needs the right half;
  //   * it carries no "MISSIONS" header, because 26 px of vertical space only fits three rows;
  //   * the progress bar sits BESIDE its label, not under it. A glyph is 8 rows tall (FONT_LINE_H 9),
  //     so label + bar stacked needs 10 px and three rows would need 30 of the 26 px available. At an
  //     8 px pitch the bar landed 5 px down, straight through the label's lower glyph rows — the
  //     "text sliced in half" CC Friday saw at native resolution on a real Chrome pane. Beside the
  //     text the bar cannot cover a single glyph row, and a 9 px pitch (8 px glyph + 1 px gap) fits
  //     three fully legible rows in 27 px.
  w: 216,
  rows: 3,
  /** 8 px glyph + 1 px gap: the minimum pitch that never clips a descender. */
  rowH: 9,
  /** Full glyph box. Must equal the font's 8 rows or descenders are cut. */
  labelH: 8,
  barH: 2,
  /** Width of the inline progress bar at the right end of each row. */
  barW: 40,
  padX: 4,
  padTop: 0,
});

/**
 * Game Over mission block. It goes in the LEDGER panel (right), because the left RUN REPORT panel has
 * no room at all: its 8 report rows reach local 128, then the ledger hash 132, seed 144, COPY button
 * to 154, against a floor at 160.
 *
 * The panel interior is local 0..160. Two earlier layouts were wrong and both were caught in audit:
 *
 *  1. Keeping the board at its 11 px pitch and trimming it to 8 rows bought the band, but it silently
 *     broke the "top 10" contract the panel title advertises (Luna, round 3).
 *  2. Packing three mission rows at an 8 px pitch put each progress bar 2 px up into its own label,
 *     because an 8 px label plus a 2 px bar needs 10 px, not 8 (Luna, round 3).
 *
 * What actually fits was solved numerically, not by eye: the board keeps ALL TEN rows at a 9 px pitch
 * (8 px glyph + 1 px gap), ending at local 125; a 1 px separator rule sits at 126; three mission rows
 * at a 10 px pitch (8 px label with its 2 px bar flush underneath) run 127..157, leaving 3 px above
 * the panel floor at 160. Ten truthful entries beat a heading that would have to lie about the count.
 */
export const GAMEOVER_BOARD_ROWS = 10;
/** Board pitch on Game Over only: 9 px fits ten rows in the space where 11 px fits eight. */
export const GAMEOVER_BOARD_ROW_H = 9;
/** Mission rows start here. Budget derived numerically, not by eye (see the solver in the tests). */
export const GAMEOVER_MISSIONS_Y = 128;
/**
 * Mission row pitch. A glyph box is 8 rows (GLYPH_H) and font row 7 is a descender, so a pitch of 10
 * leaves a 2 px nominal gap that measures 1.25 px once the descender is drawn — the rows visually
 * merge, which is half of what CC Friday read as "text sliced in half". 11 gives a real 3 px gap.
 * The block still fits: 128 + 2*11 + 8 = 158 against a panel floor at 160.
 */
export const GAMEOVER_ROW_H = 11;
/**
 * Separator rule above the mission block. This replaces the separate "MISSIONS" heading: with ten
 * truthful leaderboard rows the panel has no vertical room for a heading line, and dropping the
 * heading beats either lying about the board size or covering a mission label. The rule plus the
 * progress bars identify the group.
 */
export const GAMEOVER_MISSIONS_RULE_Y = 127;
/**
 * Rows a glyph can occupy, taken from the font rather than declared here: `buildTexture` writes font
 * rows 0..7 (a 5x7 face plus one descender row) into a cell of FONT_LINE_H = 9, so real ink spans
 * GLYPH_H = 8 rows. A text box shorter than this clips ink; a row pitch below GLYPH_H + 1 makes
 * consecutive rows touch — the descender row alone is what turned a nominal 2 px gap into 1.25 px.
 *
 * This is deliberately derived, not restated: a layout that asserts "this label is one glyph tall"
 * against its own local constant proves only that the constant equals itself, so the test could never
 * catch a wrong constant. Importing the font's own line height makes the assertion bite.
 */
export const GLYPH_H = FONT_LINE_H - 1;
/** Height of one pixel-font line at scale 1; the bar must start at or below this. */
export const LABEL_H = GLYPH_H;

/** The Title screen's existing occupied bands, for overlap assertions. */
export const TITLE_BANDS = Object.freeze({
  menu: Object.freeze({ x: 24, y: 92, w: 432, h: 104 }),
  daily: Object.freeze({ x: 24, y: 202, w: 432, h: 26 }),
  // Where TitleScene draws BEST: the right column, sharing the band with the list.
  best: Object.freeze({ x: 248, y: 234, w: 208, h: 14 }),
  // The control hint, now at GAME_HEIGHT - 8 (glyphs 258..266). It sat at 254..262 and the mission
  // list needed 228..255 to give each of three rows its full 8 px glyph box at a 9 px pitch, so the
  // hint moved down 4 px to buy a real gap instead of a zero-margin join.
  hint: Object.freeze({ x: 0, y: 258, w: 480, h: 9 }),
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
  const panel = rect(L.x, L.y, L.w, L.padTop + n * L.rowH + 1);
  const rows = [];
  const bars = [];
  const top = L.y + L.padTop;
  // The bar is inline: same 8 px line as the label, at the right end, so the label keeps its full
  // glyph height. The text box is narrowed by the bar's width plus a gap, which is what makes the two
  // rects disjoint rather than merely on the same row.
  const barX = L.x + L.w - L.padX - L.barW;
  const textW = Math.max(24, barX - 4 - (L.x + L.padX));
  for (let i = 0; i < n; i++) {
    const y = top + i * L.rowH;
    rows.push(rect(L.x + L.padX, y, textW, L.labelH));
    // Vertically centred in the glyph box, where a 2 px bar reads as a progress line and covers
    // nothing: the text is to its left, never underneath it.
    bars.push(rect(barX, y + Math.floor((L.labelH - L.barH) / 2), L.barW, L.barH));
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
  const x = o.x;
  const y = o.y;
  const w = o.w;
  const count = Math.max(0, Math.round(o.count || 0));
  const rowH = o.rowH || 10;
  const barH = o.barH || 2;
  const barW = o.barW || 30;
  const rows = [];
  const bars = [];
  // The bar is INLINE — at the right end of the row's own line — rather than underneath the label.
  // Stacking them needs labelH + barH = 10 px per row and leaves a zero-pixel gap between one row's
  // bar and the next row's glyphs, which reads as a slab of ink pasted over the text. A glyph is 8
  // rows tall (GLYPH_H), so the label box keeps that full height and the bar sits beside it.
  const textW = Math.max(24, w - barW - 4);
  for (let i = 0; i < count; i += 1) {
    const ry = y + i * rowH;
    rows.push(rect(x, ry, textW, GLYPH_H));
    bars.push(rect(x + w - barW, ry + Math.floor((GLYPH_H - barH) / 2), barW, barH));
  }
  return { rows, bars, h: count * rowH, textW };
}
