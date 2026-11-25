/**
 * OWNER: UI engineer. NO Phaser imports.
 *
 * HOW TO PLAY content and geometry. HowToPlayView only draws what this returns, so every keycap, pad glyph and
 * label is a rect a Jest test can check for overlap and containment (tests/src/title-howtoplay.test.js).
 *
 * The keyboard section follows the player's Settings > CONTROL LAYOUT, because the trick layouts really do
 * rebind W/A/S/D and the arrows in a run (systems/ControlLayouts.js, InputRouter._binding). The old Title
 * CONTROLS panel always showed the classic map, which was wrong for the default TRICKS RIGHT layout.
 * Gamepad and touch bindings do not change with the layout (InputRouter GAMEPAD, TouchOverlay).
 *
 * Coordinates are panel-local (the View's panel is HOW_TO_PLAY.w x HOW_TO_PLAY.h, title tab 0..15).
 */
import { measureText } from './PixelFont.js';
import { normalizeControlLayout } from '../systems/ControlLayouts.js';
import { TOUCH_CLUSTERS, touchButtonFor } from '../systems/TouchOverlay.js';

/** Panel size and screen y. 452 x 236 leaves 14 px either side of the 480 px screen and ends at y 253. */
export const HOW_TO_PLAY = Object.freeze({ w: 452, h: 236, y: 17 });

/** Display names of the control layouts (Settings uses the same words). */
export const LAYOUT_NAMES = Object.freeze({ tricksRight: 'TRICKS RIGHT', tricksLeft: 'TRICKS LEFT', classic: 'CLASSIC' });

/**
 * Keyboard rows for a control layout: keys (each drawn as a keycap) and what they do. `join` is drawn between
 * the caps ('+' = together, '/' = either).
 * @param {string} layout settings.controlLayout
 * @returns {{keys:string[], join?:string, label:string}[]}
 */
export function keyboardRows(layout) {
  const l = normalizeControlLayout(layout);
  const common = [
    { keys: ['SPACE'], label: 'HOP' },
  ];
  const tail = [
    { keys: ['SHIFT'], label: 'RESET' },
    { keys: ['ESC'], label: 'PAUSE' },
  ];
  if (l === 'classic') {
    return [
      { keys: ['W'], label: 'PUSH' },
      { keys: ['A', 'D'], join: '/', label: 'TILT' },
      { keys: ['A', 'D'], join: '+', label: 'TUCK' },
      { keys: ['S'], label: 'BRAKE' },
      ...common,
      { keys: ['←', '→'], join: '/', label: 'HELI SPIN' },
      { keys: ['↑'], label: 'AIR/GND BRAKE' },
      { keys: ['↓'], label: 'CHUTE' },
      ...tail,
    ];
  }
  // TRICKS RIGHT: tricks on the arrows, aerodynamics on W/A/S/D. TRICKS LEFT swaps the two clusters.
  const right = l === 'tricksRight';
  const tricks = right ? ['↑', '↓', '→', '←'] : ['W', 'S', 'D', 'A'];
  const aero = right ? ['W', 'A', 'S', 'D'] : ['↑', '←', '↓', '→'];
  return [
    ...common,
    { keys: [tricks[0]], label: 'TILT FWD' },
    { keys: [tricks[1]], label: 'TILT BACK' },
    { keys: [tricks[2]], label: 'HELI SPIN' },
    { keys: [tricks[3]], label: 'CORKSCREW' },
    { keys: [aero[0]], label: 'CHUTE' },
    { keys: [aero[1]], label: 'AIR/GND BRAKE' },
    { keys: [aero[2]], label: 'DIVEBOMB' },
    { keys: [aero[3]], label: 'TUCK' },
    ...tail,
  ];
}

/**
 * Gamepad rows (W3C standard mapping, InputRouter GAMEPAD). `shape`: face = round button, pill = shoulder /
 * trigger / system button, stick = analog stick, dpad = cross.
 * @type {ReadonlyArray<{glyphs:{text:string, shape:'face'|'pill'|'stick'|'dpad', color:string}[], label:string}>}
 */
export const GAMEPAD_ROWS = Object.freeze([
  { glyphs: [{ text: 'L', shape: 'stick', color: 'cyan' }, { text: '', shape: 'dpad', color: 'cyan' }], label: 'TILT' },
  { glyphs: [{ text: 'A', shape: 'face', color: 'lime' }], label: 'HOP' },
  { glyphs: [{ text: 'RT', shape: 'pill', color: 'cyan' }], label: 'PUSH' },
  { glyphs: [{ text: 'LT', shape: 'pill', color: 'cyan' }], label: 'TUCK' },
  { glyphs: [{ text: 'B', shape: 'face', color: 'magenta' }], label: 'BRAKE' },
  { glyphs: [{ text: 'X', shape: 'face', color: 'cyan' }], label: 'AIR/GND BRAKE' },
  { glyphs: [{ text: 'Y', shape: 'face', color: 'amber' }], label: 'CHUTE' },
  { glyphs: [{ text: 'LB', shape: 'pill', color: 'lime' }, { text: 'RB', shape: 'pill', color: 'lime' }], label: 'SPIN' },
  { glyphs: [{ text: 'BACK', shape: 'pill', color: 'amber' }], label: 'RESET' },
  { glyphs: [{ text: 'START', shape: 'pill', color: 'amber' }], label: 'PAUSE' },
]);

/**
 * Touch overlay legend (TouchOverlay BUTTONS), grouped by thumb, with the colours the overlay itself uses so
 * the diagram and the real buttons match.
 */
/** Legend order inside each cluster (most-used first), by base button name. */
const TOUCH_ORDER = Object.freeze({
  LEFT: ['tiltBack', 'tiltForward', 'brake', 'tuck'],
  RIGHT: ['hop', 'push', 'parachute', 'heliLeft', 'heliRight', 'airBrake'],
  TOP: ['reset', 'pause'],
});

/** Short legend names: the two classic spin buttons collapse into one SPIN entry. */
const LEGEND_NAME = Object.freeze({ 'SPIN CCW': 'SPIN', 'SPIN CW': 'SPIN' });

/**
 * Touch overlay legend for a control layout, derived from the overlay's own buttons through
 * TouchOverlay.touchButtonFor, so Trick Deck layouts list DIVEBOMB and CORKSCREW (not PUSH) exactly as the
 * on-screen buttons do. Colours match the overlay so the diagram and the real buttons agree.
 * @param {string} layout settings.controlLayout
 * @returns {{title:string,color:string,items:string[]}[]}
 */
export function touchGroups(layout) {
  const mode = normalizeControlLayout(layout) === 'classic' ? 'classic' : 'trickDeck';
  const names = (cluster) => {
    const out = [];
    for (const base of TOUCH_ORDER[cluster]) {
      const b = TOUCH_CLUSTERS[cluster].find((x) => x.name === base);
      if (!b) continue;
      const label = touchButtonFor(b, mode).label;
      const shown = LEGEND_NAME[label] || label;
      if (!out.includes(shown)) out.push(shown);
    }
    return out;
  };
  return [
    { title: 'LEFT THUMB', color: 'cyan', items: names('LEFT') },
    { title: 'RIGHT THUMB', color: 'magenta', items: names('RIGHT') },
    { title: 'TOP BAR', color: 'amber', items: names('TOP') },
  ];
}

/** One line of advice under the sections. */
export const HOW_TO_PLAY_TIP = 'AIR BRAKE SLOWS GROUND RUNS; IN AIR IT TRADES SPEED FOR LIFT.';

const GLYPH_H = 8;
const CAP_H = 11;
const ROW_PITCH = 15;
const KEY_COL_W = 104;
const PAD_COL_W = 102;

const r = (x, y, w, h) => ({ x, y, w, h });

/** Width of a keycap for a label: text + 3 px either side, never narrower than a square cap. */
export function keycapWidth(text) {
  return Math.max(CAP_H + 1, measureText(text) + 7);
}

/** Width of a pad glyph. */
export function padGlyphWidth(g) {
  if (g.shape === 'face') return CAP_H;
  if (g.shape === 'stick' || g.shape === 'dpad') return CAP_H;
  return measureText(g.text) + 8;
}

/**
 * Lay out a column-major list of rows into `cols` columns starting at (x, y).
 * @returns {{caps:Object[], joins:Object[], label:Object}[]}
 */
function layoutRows(rows, x, y, colW, perCol, glyphsOf, widthOf) {
  return rows.map((row, i) => {
    const col = Math.floor(i / perCol);
    const ry = y + (i % perCol) * ROW_PITCH;
    let cx = x + col * colW;
    const caps = [];
    const joins = [];
    const gl = glyphsOf(row);
    gl.forEach((g, k) => {
      if (k > 0) {
        if (row.join) {
          joins.push({ ...r(cx + 1, ry + 2, measureText(row.join), GLYPH_H), text: row.join });
          cx += measureText(row.join) + 3;
        } else cx += 2;
      }
      const w = widthOf(g);
      caps.push({ ...r(cx, ry, w, CAP_H), glyph: g });
      cx += w;
    });
    const lx = cx + 5;
    const label = { ...r(lx, ry + 2, measureText(row.label), GLYPH_H), text: row.label };
    return { caps, joins, label, col, colRight: x + (col + 1) * colW };
  });
}

/**
 * Every rect HOW TO PLAY draws, panel-local.
 * @param {string} layout settings.controlLayout
 */
export function howToPlayLayout(layout) {
  const P = HOW_TO_PLAY;
  const kRows = keyboardRows(layout);
  const kPerCol = Math.ceil(kRows.length / 2);
  const keyboard = {
    header: r(10, 22, 214, GLYPH_H),
    rows: layoutRows(kRows, 10, 36, KEY_COL_W + 4, kPerCol, (row) => row.keys.map((k) => ({ text: k, shape: 'key' })), (g) => keycapWidth(g.text)),
  };
  const pPerCol = Math.ceil(GAMEPAD_ROWS.length / 2);
  const gamepad = {
    header: r(236, 22, 206, GLYPH_H),
    rows: layoutRows(GAMEPAD_ROWS, 236, 36, PAD_COL_W + 4, pPerCol, (row) => row.glyphs, padGlyphWidth),
  };
  const bottomOfRows = (rows) => Math.max(...rows.map((x) => x.caps[0].y + CAP_H));
  const touchY = Math.max(bottomOfRows(keyboard.rows), bottomOfRows(gamepad.rows)) + 10;
  // the touch strip: a phone silhouette with the two thumb clusters, then a legend line per group
  const phone = r(10, touchY + 12, 92, 46);
  const touch = {
    header: r(10, touchY, 432, GLYPH_H),
    phone,
    groups: touchGroups(layout).map((gr, i) => {
      const y = touchY + 14 + i * 13;
      const title = { ...r(114, y, measureText(gr.title), GLYPH_H), text: gr.title };
      // ', ' rather than ' / ': the Trick Deck right thumb has six buttons (DIVEBOMB and CORKSCREW replace
      // PUSH and SPIN CCW), and the wider separator pushed that line past the panel edge.
      const text = gr.items.join(', ');
      return { ...gr, title, items: { ...r(182, y, measureText(text), GLYPH_H), text } };
    }),
  };
  const tip = { ...r(10, phone.y + phone.h + 8, measureText(HOW_TO_PLAY_TIP), GLYPH_H), text: HOW_TO_PLAY_TIP };
  // the BACK button the View base adds at (w - 76, h - 22), 68 x 16, and the key hint left of it
  const back = r(P.w - 76, P.h - 22, 68, 16);
  const backHint = { ...r(10, P.h - 18, measureText('ESC / B / ENTER: BACK'), GLYPH_H), text: 'ESC / B / ENTER: BACK' };
  const layoutChip = { ...r(0, 4, 0, GLYPH_H), text: `KEYS: ${LAYOUT_NAMES[normalizeControlLayout(layout)]}` };
  layoutChip.w = measureText(layoutChip.text);
  layoutChip.x = P.w - 10 - layoutChip.w;
  return { panel: r(0, 0, P.w, P.h), keyboard, gamepad, touch, tip, back, backHint, layoutChip };
}

/**
 * Every drawn rect, flattened, with a key, for overlap tests.
 * @param {ReturnType<typeof howToPlayLayout>} L
 * @returns {{key:string, x:number, y:number, w:number, h:number}[]}
 */
export function howToPlayRects(L) {
  const out = [];
  const push = (key, b) => out.push({ key, x: b.x, y: b.y, w: b.w, h: b.h });
  push('kb-header', L.keyboard.header);
  push('pad-header', L.gamepad.header);
  for (const [name, sec] of [['kb', L.keyboard], ['pad', L.gamepad]]) {
    sec.rows.forEach((row, i) => {
      row.caps.forEach((c, k) => push(`${name}${i}-cap${k}`, c));
      row.joins.forEach((j, k) => push(`${name}${i}-join${k}`, j));
      push(`${name}${i}-label`, row.label);
    });
  }
  push('touch-header', L.touch.header);
  push('phone', L.touch.phone);
  L.touch.groups.forEach((g, i) => { push(`touch${i}-title`, g.title); push(`touch${i}-items`, g.items); });
  push('tip', L.tip);
  push('back', L.back);
  push('back-hint', L.backHint);
  push('layout-chip', L.layoutChip);
  return out;
}
