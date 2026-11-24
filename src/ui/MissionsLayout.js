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
import { FONT_LINE_H, measureText } from './PixelFont.js';

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
 * Title-screen mission list: the last section of the right-hand "cabinet card" (TITLE_CARD below).
 *
 * The synthwave Title reorganisation moved the list out of the old y 228..254 strip and into the card, where
 * it has the card's full inner width. That changed the row shape:
 *   * the progress bar sits UNDER its label again, but at a 12 px pitch: 8 px glyph box + 1 px gap + 2 px
 *     bar + 1 px gap. The old "bar under the label" defect was a 9 px pitch, where the bar landed inside
 *     the glyph box (CC Friday's "text sliced in half"); at 12 the bar is clear of its own label and of the
 *     next row, and both are asserted in tests/src/missionslayout.test.js.
 *   * the row is 140 px wide, which fits the widest real mission title upper-cased (138 measured font px),
 *     so a title is never ellipsized at all.
 *   * still headerless as a panel: the card draws a MISSIONS rule above it (TITLE_CARD.sections.missionsHead).
 */
export const MISSION_LIST_TITLE = Object.freeze({
  x: 324,
  y: 216,
  w: 140,
  rows: 3,
  /** 8 px glyph + 1 gap + 2 px bar + 1 gap. */
  rowH: 12,
  /** Full glyph box. Must equal the font's 8 rows or descenders are cut. */
  labelH: 8,
  barH: 2,
  /** Gap between the glyph box and the bar under it. */
  barGap: 1,
  /** The bar spans the row (it sits under the label, not beside it). */
  barW: 140,
  padX: 0,
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

/**
 * Game Over initials-entry geometry, in LEDGER-panel-local coordinates.
 *
 * This exists because moving the two hint lines to 84/96 to clear the mission separator put them
 * straight THROUGH the SAVE button (local 88..104, drawn by `InitialsEntry`), so the button box
 * covered the middle of both hint lines — a regression from the legibility fix, caught by CC Friday at
 * native resolution. The stack is fixed and order-sensitive, so it is encoded here and asserted:
 *
 *   22..30   ENTER YOUR INITIALS
 *   28..84   entry widget: up-arrow zone, 28 px letter slots, down-arrow zone
 *   88..104  SAVE button
 *  106..124  the two hint lines
 *  127      mission separator rule (the mission rows start at 128)
 *
 * The hints cannot go below ~124 because the rule is at 127 and three mission rows need 128..158.
 */
export const ENTRY_LAYOUT = Object.freeze({
  panelW: 216,
  titleY: 22,
  entryY: 28,
  /** Entry-widget internals, mirrored from InitialsEntry's constructor (slotY 14, slotH 28). */
  entrySlotY: 14,
  entrySlotH: 28,
  saveY: 88,
  saveH: 16,
  saveW: 84,
  hint1Y: 106,
  hint2Y: 116,
});

/**
 * Rects for the initials-entry stack, in panel-local coordinates. The SAVE rect and the hint rects are
 * returned separately so a test can assert they are disjoint — the assertion whose absence let the
 * button be drawn over the hints.
 * @returns {{title:Object, slots:Object, save:Object, hints:Object[], contentBottom:number}}
 */
export function entryLayout(o = {}) {
  const L = { ...ENTRY_LAYOUT, ...o };
  const slotsTop = L.entryY + L.entrySlotY;
  return {
    title: rect(8, L.titleY, L.panelW - 16, GLYPH_H),
    // The entry WIDGET spans the full panel width (it centres its slots inside that), so this rect is
    // 0-based: it is the widget's box, not a slot. Anchoring it at entryY offset it 28 px right and off
    // the panel — the panel-bounds assertion below is what caught that.
    slots: rect(0, slotsTop, L.panelW, L.entrySlotH),
    save: rect(Math.round((L.panelW - L.saveW) / 2), L.saveY, L.saveW, L.saveH),
    hints: [
      rect(0, L.hint1Y, L.panelW, GLYPH_H),
      rect(0, L.hint2Y, L.panelW, GLYPH_H),
    ],
    contentBottom: L.hint2Y + GLYPH_H,
    // The constants used, echoed so a test can re-derive the SAVE offset from the widget's own layout
    // instead of taking the resulting rect on faith.
    entryY: L.entryY,
    entrySlotY: L.entrySlotY,
    entrySlotH: L.entrySlotH,
    panelW: L.panelW,
  };
}

/**
 * Title screen geometry (synthwave arcade-cabinet layout). Virtual screen 480x270.
 *
 *   y   4..94   logo (centre, over the retro sun) + tagline; jukebox top-right; stars elsewhere
 *   y  94..150  sun + mountains, left and centre left OPEN (nothing drawn over the backdrop)
 *   y 150       horizon (TITLE_HORIZON)
 *   y 154..254  menu panel (left, over the grid floor) | open centre (rider, help chip) | cabinet card (right,
 *               y 94..254)
 *   y 258..266  control hint
 *
 * The centre column between the menu and the card (x 216..316) is kept free from the logo down to the hint so
 * the sun, the ranges, the rider and the grid's vanishing point always read. Every band is asserted
 * pairwise-disjoint in tests/src/missionslayout.test.js.
 */
export const TITLE_HORIZON = 192;

/** The right-hand "cabinet card": level badge, BEST, Daily Patch and missions. Section ys are card-local. */
export const TITLE_CARD = Object.freeze({
  x: 316,
  y: 94,
  w: 156,
  h: 160,
  pad: 8,
  /** Local y of every line, top edge of its 8 px glyph box (the rule name is 2x: 16 px). */
  sections: Object.freeze({
    level: 5,
    title: 15,
    best: 26,
    rule1: 37,
    dailyHead: 41,
    ruleName: 52,
    desc1: 71,
    desc2: 80,
    next: 91,
    chase: 101,
    missionsHead: 111,
    missions: 122,
  }),
});

/** Inner text width of the card. */
export const TITLE_CARD_INNER_W = TITLE_CARD.w - TITLE_CARD.pad * 2;

/** The Title screen's occupied bands, for overlap assertions. Screen coordinates. */
export const TITLE_BANDS = Object.freeze({
  // Both chrome words, plus 3 px either side for the wave and the glitch slices' sideways kick.
  logo: Object.freeze({ x: 110, y: 2, w: 260, h: 92 }),
  version: Object.freeze({ x: 8, y: 6, w: 96, h: 9 }),
  tagline: Object.freeze({ x: 160, y: 96, w: 150, h: 8 }),
  jukebox: Object.freeze({ x: 372, y: 6, w: 102, h: 30 }),
  menu: Object.freeze({ x: 8, y: 154, w: 208, h: 100 }),
  card: Object.freeze({ x: TITLE_CARD.x, y: TITLE_CARD.y, w: TITLE_CARD.w, h: TITLE_CARD.h }),
  // The Daily Patch section of the card: DAILY PATCH header down to the streak line.
  daily: Object.freeze({
    x: TITLE_CARD.x,
    y: TITLE_CARD.y + TITLE_CARD.sections.dailyHead,
    w: TITLE_CARD.w,
    h: TITLE_CARD.sections.chase + 8 - TITLE_CARD.sections.dailyHead,
  }),
  // BEST: one line in the card's player section, above the Daily Patch.
  best: Object.freeze({ x: TITLE_CARD.x + TITLE_CARD.pad, y: TITLE_CARD.y + TITLE_CARD.sections.best, w: TITLE_CARD_INNER_W, h: 8 }),
  // The tappable HOW TO PLAY chip, in the open centre column above the hint.
  help: Object.freeze({ x: 226, y: 240, w: 80, h: 14 }),
  // The attract-mode PRESS START prompt (2x) and its sub line, over the sun between the tagline and the horizon.
  attract: Object.freeze({ x: 170, y: 110, w: 140, h: 30 }),
  // The control hint at GAME_HEIGHT - 8 (glyphs 258..266).
  hint: Object.freeze({ x: 0, y: 258, w: 480, h: 9 }),
});

/**
 * Title menu geometry, computed from the row count so a seventh entry cannot be added silently.
 *
 * This exists because W4 added SHARD SHOP as a seventh row and the SETTINGS row ended up drawn over the
 * DAILY PATCH strip (CC Friday's W4 defect 3). The scene's panel height had multiplied the row pitch by the
 * text scale, so it reported a 228px panel for 112px of rows and nothing noticed it was lying.
 *
 * The menu sits on the grid floor under the horizon, in the band y 154..254 (the hint is at 258). MenuList
 * uses rowH as the pitch and scales only the glyphs, so six 2x rows at a 16 px pitch need 96 px plus a 2 px
 * inset top and bottom: exactly the band. Six is the ceiling: a seventh row reaches 268, through the hint.
 *
 * @param {number} count number of menu rows
 * @returns {{x:number,y:number,w:number,h:number,rowH:number,scale:number,rows:number,inset:number,lastRowBottom:number,fits:boolean}}
 */
export function titleMenuLayout(count) {
  const ROW_H = 16;
  const SCALE = 2;
  const INSET = 2;
  const band = TITLE_BANDS.menu;
  const rows = Math.max(0, Math.floor(count) || 0);
  // Panel height is rows * pitch plus the inset top and bottom. NOT multiplied by scale: MenuList treats rowH
  // as the pitch and scales only the glyphs, so scaling here double-counted it.
  const h = INSET * 2 + rows * ROW_H;
  const lastRowBottom = band.y + INSET + rows * ROW_H;
  return {
    x: band.x, y: band.y, w: band.w, h, rowH: ROW_H, scale: SCALE, rows, inset: INSET, lastRowBottom,
    fits: lastRowBottom <= band.y + band.h && h <= band.h,
  };
}

/** Left x of the Title BEST line: the card's text column. */
export const TITLE_BEST_X = TITLE_BANDS.best.x;
/** Top y of the Title BEST line. */
export const TITLE_BEST_Y = TITLE_BANDS.best.y;

/**
 * The card's BEST line: the full `BEST <m> M   <score> PTS` when it fits the card's text column, else the
 * same numbers without the PTS label and with tighter spacing. Fitting is measured in the real font.
 * @param {string} m formatted distance @param {string} sc formatted score
 * @returns {string}
 */
export function titleBestText(m, sc) {
  const full = `BEST ${m} M   ${sc} PTS`;
  return measureText(full) <= TITLE_CARD_INNER_W ? full : `BEST ${m} M  ${sc}`;
}

/**
 * The card's Daily chase line: streak and today's best (or NOT PLAYED TODAY), shortened the same way.
 * @param {number} streak 0 = no streak shown @param {string|null} todayBest formatted, null = not played today
 * @returns {string}
 */
export function titleChaseText(streak, todayBest) {
  const tail = todayBest === null ? 'NOT PLAYED TODAY' : `TODAY ${todayBest}`;
  const parts = streak > 0 ? [`STREAK ${streak}`, tail] : [tail];
  const full = parts.join('  ');
  if (measureText(full) <= TITLE_CARD_INNER_W || streak <= 0) return full;
  return `STREAK ${streak}  ${todayBest === null ? 'NOT PLAYED' : todayBest}`;
}

/**
 * Every rect the cabinet card draws text into, in SCREEN coordinates, for overlap tests (the scene reads
 * TITLE_CARD.sections for the same numbers). The rule name band is 16 px: 2x when it fits the inner width,
 * else 1x centred in the band.
 * @returns {Object<string, {x:number,y:number,w:number,h:number}>}
 */
export function titleCardLayout() {
  const C = TITLE_CARD;
  const S = C.sections;
  const x = C.x + C.pad;
  const w = TITLE_CARD_INNER_W;
  const line = (y, h = GLYPH_H) => rect(x, C.y + y, w, h);
  return {
    card: rect(C.x, C.y, C.w, C.h),
    level: line(S.level),
    title: line(S.title),
    best: line(S.best),
    rule1: line(S.rule1, 1),
    dailyHead: line(S.dailyHead),
    ruleName: line(S.ruleName, 16),
    desc1: line(S.desc1),
    desc2: line(S.desc2),
    next: line(S.next),
    chase: line(S.chase),
    missionsHead: line(S.missionsHead),
    missions: missionListLayout(3).panel,
  };
}

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
 * Geometry for the Title-screen mission list (the cabinet card's last section).
 * @param {number} count
 * @param {{x?:number,y?:number}} [o]
 */
export function missionListLayout(count, o = {}) {
  const L = { ...MISSION_LIST_TITLE, ...o };
  const n = Math.max(0, Math.min(L.rows, Math.round(count || 0)));
  const panel = rect(L.x, L.y, L.w, L.padTop + n * L.rowH);
  const rows = [];
  const bars = [];
  const top = L.y + L.padTop;
  // The bar sits under the label, separated from its full 8 px glyph box by barGap, and the pitch leaves a
  // gap under the bar too, so a bar can touch neither its own label nor the next row's glyphs.
  const textW = L.w - L.padX * 2;
  const barW = Math.min(L.barW, textW);
  for (let i = 0; i < n; i++) {
    const y = top + i * L.rowH;
    rows.push(rect(L.x + L.padX, y, textW, L.labelH));
    bars.push(rect(L.x + L.padX, y + L.labelH + L.barGap, barW, L.barH));
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
  // '..' rather than '…': the pixel font has no ellipsis glyph and would draw '?' (PixelFont.ellipsize
  // uses the same mark).
  if (max <= 2) return s.slice(0, max);
  return `${s.slice(0, max - 2)}..`;
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
