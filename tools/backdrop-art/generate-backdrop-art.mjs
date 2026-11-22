#!/usr/bin/env node
/**
 * Generates the in-run backdrop art in public/assets/backdrop/*.svg (#65).
 *
 *   node tools/backdrop-art/generate-backdrop-art.mjs
 *
 * Debutmont: pixel-stepped ridgelines and an ordered-dither sky. Arcade bridge: a dithered sky, a stepped sun and a
 * blocky skyline. Everything is hard pixels in a handful of grey levels, so it can never read as a smooth
 * gradient-and-silhouette landscape.
 *
 * Why a generator: like the menu art (tools/menu-art), every file is pixel-aligned (`shape-rendering="crispEdges"`,
 * authored on an integer grid and rasterised once at its exact size, 1:1 or an integer multiple), and writing the
 * design (the ridge function, the shading rules, the dither levels) is reviewable where thousands of runs are not.
 *
 * Palette rule (src/ui/BackdropArt.js): the art is WHITE / GREYSCALE and the game tints it from the live palette, so
 * colour-blind mode and each biome's tint recolour it. Grey levels are chosen so `tint * grey` is a dark opaque body
 * (multiplied) and a bright crest; a dither is white on transparent and is tinted + alpha'd to taste.
 *
 * The output is committed; re-run this only when the design changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'public/assets/backdrop');

// ------------------------------------------------------------------ helpers

const grey = (v) => {
  const h = Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
};
/** 4x4 Bayer matrix, 0..15. */
const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

/** A grid of w*h unit cells, each a grey level (0..255) or -1 for transparent. */
function grid(w, h) {
  return { w, h, v: new Int16Array(w * h).fill(-1) };
}
const put = (g, x, y, v) => { if (x >= 0 && y >= 0 && x < g.w && y < g.h) g.v[y * g.w + x] = v; };
const getV = (g, x, y) => (x < 0 || y < 0 || x >= g.w || y >= g.h ? -1 : g.v[y * g.w + x]);

/** The grid as SVG <path>s: one per grey level, each a list of horizontal unit runs. `unit` px per cell. */
function gridPaths(g, unit) {
  const groups = new Map();
  for (let y = 0; y < g.h; y++) {
    let x = 0;
    while (x < g.w) {
      const v = g.v[y * g.w + x];
      if (v < 0) { x++; continue; }
      let x1 = x + 1;
      while (x1 < g.w && g.v[y * g.w + x1] === v) x1++;
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v).push(`M${x} ${y}h${x1 - x}v1h${x - x1}z`);
      x = x1;
    }
  }
  return [...groups.entries()].map(([v, d]) => `<path fill="${grey(v)}" d="${d.join('')}"/>`);
}

function svgDoc(wPx, hPx, vbW, vbH, comment, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${comment} -->\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${vbW} ${vbH}" shape-rendering="crispEdges">\n` +
    body.join('\n') + '\n</svg>\n';
}

function write(name, svg) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), svg);
  console.log(`wrote ${name} (${(svg.length / 1024).toFixed(1)} KB)`);
}

// ------------------------------------------------------------------ ridgelines

const TILE_W = 960;
const PX = 4; // one ridge cell = 4x4 px

/**
 * A ridged profile 0..1 (1 = peak) periodic over TILE_W: three sines with whole cycle counts, folded with abs() so the
 * peaks are sharp and the valleys round (the opposite of a rolling hill).
 */
function ridgeHeight(x, cycles, phases, weights) {
  let h = 0;
  for (let i = 0; i < cycles.length; i++) h += weights[i] * Math.sin((2 * Math.PI * cycles[i] * x) / TILE_W + phases[i]);
  return 1 - Math.abs(h);
}

/**
 * One tileable ridge layer as a unit grid. Rows: the crest is one unit of white, the two rows under it carry the
 * sun-facing shading as an ordered dither (lit faces only), a snow line near the top of tall peaks, then a flat dark
 * body to the bottom. Grey levels: body 0x1c, shade 0x48, snow 0xb8, crest 0xff.
 */
function ridgeLayer({ rows, topRow, amp, cycles, phases, weights, snowAbove }) {
  const cols = TILE_W / PX;
  const g = grid(cols, rows);
  const tops = [];
  for (let c = 0; c < cols; c++) {
    const h = ridgeHeight((c + 0.5) * PX, cycles, phases, weights);
    tops.push(Math.round(topRow + (1 - h) * amp));
  }
  for (let c = 0; c < cols; c++) {
    const top = tops[c];
    const rise = tops[(c + 1) % cols] < top; // the ridge climbs to the right here: a lit face
    for (let r = top; r < rows; r++) {
      const d = r - top;
      let v = 0x1c;
      if (d === 0) v = 0xff;
      else if (d <= 2 && rise && (BAYER4[r & 3][c & 3] + 0.5) / 16 < (d === 1 ? 0.75 : 0.35)) v = 0x48;
      else if (top < snowAbove && d <= 3 && (BAYER4[r & 3][c & 3] + 0.5) / 16 < (4 - d) / 5) v = 0xb8;
      put(g, c, r, v);
    }
  }
  return g;
}

// ------------------------------------------------------------------ dithered sky

/**
 * An ordered-dither vertical gradient: `levels` strips, strip i filled with the Bayer-4x4 pattern of density
 * `densities[i]` (0..16 of 16 cells lit), cells `cell` px. White on transparent. Written as <pattern> fills so the
 * file stays a few KB; each pattern tile is one Bayer period (4 cells), pixel-aligned to the strip origin.
 */
function ditherSky({ w, h, stripH, densities, cell, comment }) {
  const defs = [];
  const body = [];
  const tile = 4 * cell;
  densities.forEach((d, i) => {
    if (d <= 0) return;
    const rects = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (BAYER4[y][x] < d) rects.push(`<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`);
    defs.push(`<pattern id="d${i}" width="${tile}" height="${tile}" patternUnits="userSpaceOnUse"><g fill="#fff">${rects.join('')}</g></pattern>`);
    body.push(`<rect x="0" y="${i * stripH}" width="${w}" height="${stripH}" fill="url(#d${i})"/>`);
  });
  return svgDoc(w, h, w, h, comment, [`<defs>${defs.join('')}</defs>`, ...body]);
}

// ------------------------------------------------------------------ arcade pieces

/** A half sun (a stepped disc cut by the horizon) with horizontal slice gaps that widen toward the bottom. 4 px cells. */
function arcadeSun() {
  const cell = 4;
  const R = 14; // cells
  const g = grid(2 * R, R + 1);
  for (let y = 0; y <= R; y++) {
    // row y from the top: distance from the disc centre (centre row = R, the horizon)
    const dy = R - y;
    const half = Math.floor(Math.sqrt(R * R - dy * dy) + 0.5);
    // slice gaps: rows 8, 10, 12 and 13 are cut (wider the lower, like the classic retro sun)
    if (y === 8 || y === 10 || y === 12) continue;
    const v = y < 5 ? 0xff : y < 9 ? 0xe0 : 0xb8;
    for (let x = R - half; x < R + half; x++) put(g, x, y, v);
  }
  return svgDoc(g.w * cell, g.h * cell, g.w, g.h, 'arcade sun: stepped half disc, greyscale, tinted at runtime', gridPaths(g, cell));
}

/** A blocky skyline tileable over 480 px: towers of whole 8 px columns, window dots on a 2-cell lattice. 4 px cells. */
function arcadeSkyline() {
  const cell = 4;
  const cols = 480 / cell;
  const rows = 12;
  const g = grid(cols, rows);
  let c = 0;
  let seed = 7;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  while (c < cols) {
    const w = Math.min(cols - c, 3 + Math.floor(rnd() * 5)); // 3..7 cells wide: 12..28 px
    const hgt = 3 + Math.floor(rnd() * 8); // 3..10 rows tall
    for (let x = c; x < c + w; x++) {
      for (let y = rows - hgt; y < rows; y++) {
        const edge = x === c || x === c + w - 1 || y === rows - hgt;
        const win = !edge && (x - c) % 2 === 1 && (y - (rows - hgt)) % 2 === 0 && y < rows - 1;
        put(g, x, y, edge ? 0xe8 : win ? 0xff : 0x30);
      }
    }
    // an antenna on some towers
    if (hgt >= 7 && rnd() < 0.6) put(g, c + Math.floor(w / 2), rows - hgt - 1, 0xe8);
    c += w + (rnd() < 0.5 ? 0 : 1);
  }
  return svgDoc(cols * cell, rows * cell, cols, rows, 'arcade skyline: blocky towers, tileable over 480 px, greyscale', gridPaths(g, cell));
}

// ------------------------------------------------------------------ write

{
  // far ridge: lower and calmer; near ridge: taller and sharper. Both 960 px wide, bottom-anchored on the screen.
  const far = ridgeLayer({ rows: 52, topRow: 0, amp: 24, cycles: [2, 4, 9], phases: [1.3, 2.9, 0.4], weights: [0.55, 0.3, 0.15], snowAbove: 9 });
  write('debutmont-ridge-far.svg', svgDoc(TILE_W, far.h * PX, TILE_W / PX, far.h,
    'Debutmont far ridge: pixel-stepped, tileable over 960 px, greyscale (tint it)', gridPaths(far, PX)));
  const near = ridgeLayer({ rows: 40, topRow: 0, amp: 24, cycles: [3, 5, 11], phases: [4.2, 0.7, 2.1], weights: [0.5, 0.3, 0.2], snowAbove: 7 });
  write('debutmont-ridge-near.svg', svgDoc(TILE_W, near.h * PX, TILE_W / PX, near.h,
    'Debutmont near ridge: pixel-stepped, tileable over 960 px, greyscale (tint it)', gridPaths(near, PX)));
}
// Debutmont sky: 480x160, eight 20 px strips from sparse (top) to dense (towards the horizon).
write('debutmont-sky.svg', ditherSky({
  w: 480, h: 160, stripH: 20, cell: 2, densities: [0, 1, 2, 3, 5, 6, 8, 10],
  comment: 'Debutmont sky: ordered-dither gradient (Bayer 4x4, 2 px cells), white on transparent, tinted at runtime',
}));
// Arcade sky: 480x120, eight 15 px strips, denser overall (a hotter horizon).
write('arcade-sky.svg', ditherSky({
  w: 480, h: 120, stripH: 15, cell: 2, densities: [0, 2, 4, 6, 8, 10, 12, 14],
  comment: 'arcade sky: ordered-dither gradient (Bayer 4x4, 2 px cells), white on transparent, tinted at runtime',
}));
write('arcade-sun.svg', arcadeSun());
write('arcade-skyline.svg', arcadeSkyline());
