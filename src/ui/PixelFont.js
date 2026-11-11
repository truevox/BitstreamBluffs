/**
 * OWNER: UI engineer.
 * Runtime-generated 5x7 bitmap font (no image assets). Two Phaser bitmap fonts are registered:
 *  - 'bb'  : crisp white glyphs (tint them with palette colours)
 *  - 'bbo' : same layout, glyphs dilated by 1px (use behind 'bb' as a dark outline or a coloured glow)
 * Glyphs are proportional (empty columns are trimmed) with 1px letter spacing. Scale text with integer
 * scales only (1, 2, 3...) so pixels stay square.
 */

export const FONT_KEY = 'bb';
export const FONT_OUTLINE_KEY = 'bbo';
/** Line height in font pixels (7 rows + 1 descender row + 1 gap). */
export const FONT_LINE_H = 9;

/** Column data for ASCII 0x20..0x7E, 5 columns each, bit 0 = top row (classic 5x7 table, rows 0-6, descender row 7). */
const ASCII_COLS = (
  '0000000000 00005F0000 0007000700 147F147F14 242A7F2A12 2313086462 3649562050 0000070000 ' +
  '001C224100 0041221C00 2A1C7F1C2A 08083E0808 0080703000 0808080808 0000606000 2010080402 ' +
  '3E5149453E 00427F4000 7249494946 2141494D33 1814127F10 2745454539 3C4A494931 4121110907 ' +
  '3649494936 464949291E 0000240000 0040340000 0008142241 1414141414 0041221408 0201590906 ' +
  '3E415D594E 7C1211127C 7F49494936 3E41414122 7F4141413E 7F49494941 7F09090901 3E41415173 ' +
  '7F0808087F 00417F4100 2040413F01 7F08142241 7F40404040 7F021C027F 7F0408107F 3E4141413E ' +
  '7F09090906 3E4151215E 7F09192946 2649494932 03017F0103 3F4040403F 1F2040201F 3F4038403F ' +
  '6314081463 0304780403 6151494543 00007F4141 0204081020 41417F0000 0402010204 4040404040 ' +
  '0003070800 2054547840 7F28444438 3844444428 384444287F 3854545418 00087E0902 18A4A49C78 ' +
  '7F08040478 00447D4000 2040403D00 7F10284400 00417F4000 7C04780478 7C08040478 3844444438 ' +
  'FC18242418 18242418FC 7C08040408 4854545424 04043F4424 3C4040207C 1C2040201C 3C4030403C ' +
  '4428102844 4C9090907C 4464544C44 0008364100 00007F0000 0041360800 0201020402'
).split(' ');

/** Extra glyphs drawn from row strings (5 wide). Keys are the characters used in game text. */
const EXTRA_GLYPHS = {
  '←': ['00100', '01000', '11111', '01000', '00100'], // left arrow
  '→': ['00100', '00010', '11111', '00010', '00100'], // right arrow
  '↑': ['00100', '01110', '10101', '00100', '00100', '00100', '00100'], // up arrow
  '↓': ['00100', '00100', '00100', '00100', '10101', '01110', '00100'], // down arrow
  '▶': ['10000', '11000', '11100', '11110', '11100', '11000', '10000'], // cursor triangle
  '▲': ['00000', '00000', '00100', '01110', '11111', '00000', '00000'], // up triangle
  '▼': ['00000', '00000', '11111', '01110', '00100', '00000', '00000'], // down triangle
  '■': ['00000', '01110', '01110', '01110', '01110', '01110', '00000'], // square bullet
  '✓': ['00000', '00001', '00010', '10100', '01000', '00000', '00000'], // check mark
};

/** @type {Map<string, number[]>} char -> 5 column bytes */
const GLYPHS = new Map();
ASCII_COLS.forEach((hex, i) => {
  const cols = [];
  for (let c = 0; c < 5; c++) cols.push(parseInt(hex.substr(c * 2, 2), 16));
  GLYPHS.set(String.fromCharCode(32 + i), cols);
});
for (const [ch, rows] of Object.entries(EXTRA_GLYPHS)) {
  const cols = [0, 0, 0, 0, 0];
  rows.forEach((row, r) => {
    for (let c = 0; c < 5; c++) if (row[c] === '1') cols[c] |= 1 << r;
  });
  GLYPHS.set(ch, cols);
}

/** @param {string} ch @returns {{cols:number[], first:number, width:number}} trimmed glyph metrics. */
function metrics(ch) {
  const cols = GLYPHS.get(ch) || GLYPHS.get('?');
  let first = 0;
  let last = 4;
  while (first < 5 && cols[first] === 0) first++;
  while (last >= 0 && cols[last] === 0) last--;
  if (first > last) return { cols, first: 0, width: 0 };
  return { cols, first, width: last - first + 1 };
}

/**
 * Width in font pixels of a single line of text (multiply by the integer scale).
 * @param {string} str
 * @returns {number}
 */
export function measureText(str) {
  let w = 0;
  for (const ch of String(str)) {
    const m = metrics(ch);
    w += (m.width === 0 ? 2 : m.width) + 1;
  }
  return Math.max(0, w - 1);
}

/**
 * Shorten `str` with '..' so it fits `maxPx` (unscaled font px).
 * @param {string} str @param {number} maxPx @returns {string}
 */
export function ellipsize(str, maxPx) {
  str = String(str);
  if (measureText(str) <= maxPx) return str;
  while (str.length > 1 && measureText(str + '..') > maxPx) str = str.slice(0, -1);
  return str + '..';
}

/**
 * Greedy word wrap.
 * @param {string} str @param {number} maxPx unscaled font px @param {number} [maxLines=3]
 * @returns {string} lines joined by newline (last line ellipsized if text did not fit)
 */
export function wrapText(str, maxPx, maxLines = 3) {
  const words = String(str).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (measureText(next) <= maxPx || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = ellipsize(`${lines[maxLines - 1]} ..`, maxPx);
  }
  return lines.join('\n');
}

/** @returns {string} the characters this font can draw (for upper-casing / filtering). */
export function hasGlyph(ch) {
  return GLYPHS.has(ch);
}

function buildTexture(scene, key, cellW, cellH, pad, dilate) {
  const chars = [...GLYPHS.keys()];
  const perRow = 16;
  const rows = Math.ceil(chars.length / perRow);
  const tex = scene.textures.createCanvas(key, perRow * cellW, rows * cellH);
  const ctx = tex.context;
  ctx.fillStyle = '#ffffff';
  const data = { retroFont: true, font: key, size: 8, lineHeight: FONT_LINE_H, chars: {} };
  const W = perRow * cellW;
  const H = rows * cellH;
  chars.forEach((ch, i) => {
    const cx = (i % perRow) * cellW;
    const cy = Math.floor(i / perRow) * cellH;
    const m = metrics(ch);
    for (let c = 0; c < 5; c++) {
      for (let r = 0; r < 8; r++) {
        if (!(m.cols[c] & (1 << r))) continue;
        const px = cx + pad + (c - m.first);
        const py = cy + pad + r;
        if (dilate) ctx.fillRect(px - 1, py - 1, 3, 3);
        else ctx.fillRect(px, py, 1, 1);
      }
    }
    const gw = m.width;
    const fw = gw + pad * 2 || 1;
    const fh = 8 + pad * 2;
    data.chars[ch.charCodeAt(0)] = {
      x: cx, y: cy, width: fw, height: fh,
      centerX: fw >> 1, centerY: fh >> 1,
      xOffset: -pad, yOffset: -pad,
      xAdvance: (gw === 0 ? 2 : gw) + 1,
      data: {}, kerning: {},
      u0: cx / W, v0: cy / H, u1: (cx + fw) / W, v1: (cy + fh) / H,
    };
  });
  tex.refresh();
  tex.setFilter(1); // NEAREST
  scene.cache.bitmapFont.add(key, { data, texture: key, frame: null });
}

/**
 * Generate the bitmap fonts once per game (idempotent). Call from PreloadScene.
 * @param {Phaser.Scene} scene
 * @returns {void}
 */
export function installFonts(scene) {
  if (scene.textures.exists(FONT_KEY)) return;
  buildTexture(scene, FONT_KEY, 7, 9, 0, false);
  buildTexture(scene, FONT_OUTLINE_KEY, 9, 11, 1, true);
}
