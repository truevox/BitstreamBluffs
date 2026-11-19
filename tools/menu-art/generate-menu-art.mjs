#!/usr/bin/env node
/**
 * Generates the authored menu art in public/assets/menu/*.svg.
 *
 *   node tools/menu-art/generate-menu-art.mjs
 *
 * Why a generator instead of hand-edited SVG files: every layer is pixel art at its exact native size on the
 * 480x270 grid (the game runs with pixelArt: true and never scales menu art), so each SVG is emitted as
 * crisp, pixel-aligned runs (`shape-rendering="crispEdges"`). Writing thousands of runs by hand would be
 * unreviewable; writing the *design* here (letter grids, shading ramps, the shared ridge functions) is.
 * The mountains come from src/ui/MenuTerrain.js, the same functions Backdrop uses at runtime, so the rider
 * stands on exactly the pixels drawn here and the procedural fallback matches the art.
 *
 * Palette rule (see src/ui/MenuArt.js): anything that carries accent colour is authored WHITE/GREYSCALE and
 * tinted at runtime from Theme, so colour-blind mode and equipped UI themes recolour it. Only the rider's dark
 * backing bakes a colour, and that is the palette's `bg`, which no palette or theme moves.
 *
 * The output is committed; re-run this only when the design changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MENU_LAYERS, MENU_TERRAIN_PERIOD, ridgeY } from '../../src/ui/MenuTerrain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'public/assets/menu');

// ------------------------------------------------------------------ bitmap helpers

/** A w*h greyscale+alpha bitmap. v = 0..255 luminance, a = 0..255 alpha. */
function bitmap(w, h) {
  return { w, h, v: new Uint8Array(w * h), a: new Uint8Array(w * h) };
}
function put(bm, x, y, v, a = 255) {
  if (x < 0 || y < 0 || x >= bm.w || y >= bm.h) return;
  const i = y * bm.w + x;
  bm.v[i] = Math.max(0, Math.min(255, Math.round(v)));
  bm.a[i] = Math.max(0, Math.min(255, Math.round(a)));
}

/**
 * A bitmap as SVG <path>s: one path per distinct (luminance, alpha) pair, each a list of horizontal runs.
 * Luminance is quantised to `levels` steps so the file stays small and the shading reads as deliberate bands.
 */
function runPaths(bm, levels) {
  const q = (v) => Math.round((Math.round((v / 255) * (levels - 1)) / (levels - 1)) * 255);
  const groups = new Map();
  for (let y = 0; y < bm.h; y++) {
    let x = 0;
    while (x < bm.w) {
      const i = y * bm.w + x;
      if (!bm.a[i]) { x++; continue; }
      const v = q(bm.v[i]);
      const a = bm.a[i];
      let x1 = x + 1;
      while (x1 < bm.w && bm.a[y * bm.w + x1] === a && q(bm.v[y * bm.w + x1]) === v) x1++;
      const key = `${v}|${a}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(`M${x} ${y}h${x1 - x}v1h${x - x1}z`);
      x = x1;
    }
  }
  return [...groups.entries()].map(([key, d]) => {
    const [v, a] = key.split('|').map(Number);
    const op = a === 255 ? '' : ` fill-opacity="${(a / 255).toFixed(3)}"`;
    return `<path fill="${grey(v)}"${op} d="${d.join('')}"/>`;
  });
}

const grey = (v) => {
  const h = Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
};

function svgDoc(w, h, comment, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    (comment ? `<!-- ${comment} -->\n` : '') +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">\n` +
    body.join('\n') + '\n</svg>\n';
}

/** Serialise a bitmap pixel-for-pixel. */
function toSvg(bm, { levels = 32, comment = '' } = {}) {
  return svgDoc(bm.w, bm.h, comment, runPaths(bm, levels));
}

/**
 * A coverage mask filled with a vertical greyscale gradient, plus a pixel-exact detail bitmap drawn on top.
 * The shape edges stay crisp (the mask is emitted as pixel runs), only the fill is a smooth ramp; this keeps
 * large shaded areas (mountain bodies, the sun, the chrome logo) to a few KB instead of thousands of runs.
 * @param {{w:number,h:number,a:Uint8Array}} mask
 * @param {Array<[number, number]>} stops [offset 0..1 of the mask height, luminance]
 * @param {ReturnType<typeof bitmap>|null} detail
 */
function gradSvg(mask, stops, detail, comment) {
  const d = [];
  for (let y = 0; y < mask.h; y++) {
    let x = 0;
    while (x < mask.w) {
      if (!mask.a[y * mask.w + x]) { x++; continue; }
      let x1 = x + 1;
      while (x1 < mask.w && mask.a[y * mask.w + x1]) x1++;
      d.push(`M${x} ${y}h${x1 - x}v1h${x - x1}z`);
      x = x1;
    }
  }
  const stopEls = stops.map(([o, v]) => `<stop offset="${o}" stop-color="${grey(v)}"/>`).join('');
  return svgDoc(mask.w, mask.h, comment, [
    `<defs><linearGradient id="f" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${mask.h}">${stopEls}</linearGradient></defs>`,
    `<path fill="url(#f)" d="${d.join('')}"/>`,
    ...(detail ? runPaths(detail, 32) : []),
  ]);
}

function write(name, svg) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), svg);
  console.log(`wrote ${name} (${(svg.length / 1024).toFixed(1)} KB)`);
}

// ------------------------------------------------------------------ sun

/**
 * Retro sun: a crisp disc, luminance falling gently top to bottom. It is tinted at runtime with a 4-corner
 * tint (amber top, magenta bottom), so the colour gradient is the palette's, not baked. The slice gaps are
 * NOT in the art: Backdrop overdraws them so they can scroll.
 */
function sun(D = 112) {
  const mask = bitmap(D, D);
  const rim = bitmap(D, D);
  const r = D / 2;
  for (let y = 0; y < D; y++) {
    for (let x = 0; x < D; x++) {
      const dx = x + 0.5 - r;
      const dy = y + 0.5 - r;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      put(mask, x, y, 255);
      // a 1px bright limb on the upper half reads as the sun's edge catching the glow
      if (d > r - 1.2 && dy < 0) put(rim, x, y, 255);
    }
  }
  // bright core at the top, slightly dimmer toward the bottom where the slices are
  return gradSvg(mask, [[0, 255], [0.5, 240], [1, 200]], rim,
    'menu sun: white disc, tinted amber->magenta at runtime (Backdrop)');
}

/** Soft halo behind the sun. Smooth (not dithered): it is drawn at low alpha and additive. */
function sunGlow(D = 200) {
  const r = D / 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- menu sun glow: white radial halo, tinted magenta at runtime -->
<svg xmlns="http://www.w3.org/2000/svg" width="${D}" height="${D}" viewBox="0 0 ${D} ${D}">
<defs><radialGradient id="g" cx="50%" cy="50%" r="50%">
<stop offset="0" stop-color="#fff" stop-opacity="0.9"/>
<stop offset="0.45" stop-color="#fff" stop-opacity="0.45"/>
<stop offset="0.75" stop-color="#fff" stop-opacity="0.12"/>
<stop offset="1" stop-color="#fff" stop-opacity="0"/>
</radialGradient></defs>
<circle cx="${r}" cy="${r}" r="${r}" fill="url(#g)"/>
</svg>
`;
}

// ------------------------------------------------------------------ mountains

/**
 * One parallax layer, rasterised column by column from MenuTerrain.ridgeY so it tiles exactly. Greyscale:
 *  - a 1px white rim on the ridge (connected: each column's rim spans down to its neighbours' ridge),
 *  - two faint strata lines following the ridge (the wire-frame feel),
 *  - a body filled with a smooth greyscale ramp (brightest at the peaks, darker toward the base).
 * `body` sets how bright the body is: far ranges are hazier (brighter after tinting) than the near hills.
 */
function mountains(name, { body, strata }) {
  const L = MENU_LAYERS[name];
  const W = MENU_TERRAIN_PERIOD;
  const mask = bitmap(W, L.h);
  const detail = bitmap(W, L.h);
  const ys = [];
  for (let x = 0; x < W; x++) ys.push(ridgeY(name, x));
  const yAt = (x) => ys[((x % W) + W) % W];
  for (let x = 0; x < W; x++) {
    const y0 = yAt(x);
    const rimBottom = Math.max(y0, yAt(x - 1) - 1, yAt(x + 1) - 1);
    for (let y = y0; y < L.h; y++) put(mask, x, y, 255);
    for (let y = y0; y <= rimBottom; y++) put(detail, x, y, 255);
    // strata: copies of the ridge pushed down, fading. They stop where they would pass below the texture.
    strata.forEach(([off, lum]) => {
      const sy = y0 + off;
      const sb = Math.max(sy, yAt(x - 1) + off - 1, yAt(x + 1) + off - 1);
      for (let y = sy; y <= sb && y < L.h; y++) put(detail, x, y, lum);
    });
  }
  // The body ramp is in texture space (top of the texture = highest peaks): peaks catch the most haze.
  return gradSvg(mask, [[0, body[0]], [0.55, (body[0] + body[1]) / 2], [1, body[1]]], detail,
    `menu mountains (${name}): greyscale, tileable over ${W}px, tinted at runtime`);
}

// ------------------------------------------------------------------ logo

/**
 * Chunky block letters on a cell grid. Cell glyphs:
 *   '#' full   '.' empty
 *   'a' lower-right triangle (chamfers a top-left corner)    'b' lower-left (top-right corner)
 *   'c' upper-right triangle (bottom-left corner)            'd' upper-left (bottom-right corner)
 * Strokes are two cells wide; the middle bar is one cell, which keeps counters open at this size.
 */
const GLYPHS = {
  B: ['#####b', '######', '##..##', '##..##', '#####d', '##..##', '##..##', '######', '#####d'],
  I: ['##', '##', '##', '##', '##', '##', '##', '##', '##'],
  T: ['######', '######', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..'],
  S: ['a#####', '######', '##....', '##....', 'c####b', '....##', '....##', '######', '#####d'],
  R: ['#####b', '######', '##..##', '##..##', '#####d', '##.#b.', '##..#b', '##..##', '##..##'],
  E: ['#####', '#####', '##...', '##...', '####.', '##...', '##...', '#####', '#####'],
  A: ['a####b', '######', '##..##', '##..##', '######', '##..##', '##..##', '##..##', '##..##'],
  M: ['##b..a##', '###b.a##', '##.##.##', '##.cd.##', '##....##', '##....##', '##....##', '##....##', '##....##'],
  L: ['##...', '##...', '##...', '##...', '##...', '##...', '##...', '#####', '#####'],
  U: ['##..##', '##..##', '##..##', '##..##', '##..##', '##..##', '##..##', '######', 'c####d'],
  F: ['#####', '#####', '##...', '##...', '####.', '##...', '##...', '##...', '##...'],
};

function cellCovers(ch, px, py, u) {
  // sample at the pixel centre in cell-normalised coordinates
  const fx = (px + 0.5) / u;
  const fy = (py + 0.5) / u;
  switch (ch) {
    case '#': return true;
    case 'a': return fx + fy >= 1;
    case 'b': return fy >= fx;
    case 'c': return fx >= fy;
    case 'd': return fx + fy <= 1;
    default: return false;
  }
}

/**
 * Rasterise a word into a coverage mask, with `pad` empty pixels around it (room for the outline) and a
 * horizontal italic shear (`slant` px per row, applied in whole-pixel steps every few rows so edges stay
 * crisp stair-steps instead of anti-aliased smears).
 */
function wordMask(word, u, pad, slant) {
  const gap = u;
  let wCells = 0;
  for (const ch of word) wCells += GLYPHS[ch][0].length;
  const inkW = wCells * u + gap * (word.length - 1);
  const inkH = 9 * u;
  const shear = Math.ceil(inkH * slant);
  const w = inkW + pad * 2 + shear;
  const h = inkH + pad * 2;
  const m = new Uint8Array(w * h);
  let cx = 0;
  for (const ch of word) {
    const g = GLYPHS[ch];
    const cw = g[0].length;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < cw; c++) {
        const cell = g[r][c];
        if (cell === '.') continue;
        for (let py = 0; py < u; py++) {
          for (let px = 0; px < u; px++) {
            if (!cellCovers(cell, px, py, u)) continue;
            const iy = r * u + py;
            const ix = cx + c * u + px + Math.round((inkH - 1 - iy) * slant);
            m[(iy + pad) * w + ix + pad] = 1;
          }
        }
      }
    }
    cx += cw * u + gap;
  }
  return { m, w, h, pad, inkH };
}

/**
 * Chrome luminance layer: classic synthwave chrome in greyscale. Sky ramp (dark -> bright) down to a hard
 * horizon a little under the middle, then a dark ground band ramping bright again to the base. A 1px
 * highlight on every top edge and a dim bottom edge give the letters thickness. The runtime may tint the
 * whole layer (Phase B uses a cool top / warm bottom corner tint).
 */
function logoFill(word, u, pad, slant) {
  const { m, w, h, inkH } = wordMask(word, u, pad, slant);
  const mask = bitmap(w, h);
  const edges = bitmap(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      put(mask, x, y, 255);
      const above = y > 0 && m[(y - 1) * w + x];
      const below = y < h - 1 && m[(y + 1) * w + x];
      if (!above) put(edges, x, y, 255);
      else if (!below) put(edges, x, y, 120);
    }
  }
  // Offsets are in texture space; the ink spans pad .. pad + inkH.
  const o = (iy) => ((pad + iy) / h).toFixed(4);
  const hz = Math.round(inkH * 0.56);
  const stops = [
    [o(0), 110], [o(hz - 1), 255], // sky: brightens toward the horizon
    [o(hz), 255], [o(hz + 1), 64], // the chrome horizon glint, then a hard cut to the dark ground
    [o(inkH), 225], // ground: bright again at the base
  ];
  return gradSvg(mask, stops, edges, `menu logo "${word}" fill: greyscale chrome luminance`);
}

/**
 * Outline layer: a `thick`-px ring around the letters (square dilation minus the letters), white. Tinted at
 * runtime; two copies offset by +-1px in magenta and cyan give the chromatic split.
 */
function logoLine(word, u, pad, slant, thick) {
  const { m, w, h } = wordMask(word, u, pad, slant);
  const bm = bitmap(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (m[y * w + x]) continue;
      let near = false;
      for (let dy = -thick; dy <= thick && !near; dy++) {
        for (let dx = -thick; dx <= thick; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && m[yy * w + xx]) { near = true; break; }
        }
      }
      if (near) put(bm, x, y, 255);
    }
  }
  return toSvg(bm, { levels: 2, comment: `menu logo "${word}" outline: white ring, tinted at runtime` });
}

// ------------------------------------------------------------------ rider

/**
 * Attract-mode rider: a small version of the in-game sled + neon rider (src/entities/Sled.js) in a crouched
 * carve, split into layers so each part takes its own palette colour at runtime, as the in-game rider does:
 *   rider-base   dark backing silhouette (baked palette bg: never recoloured)
 *   rider-sled   runner, struts and deck, white (tinted cyan; runner lime is folded in at this size)
 *   rider-body   legs, torso and arm, white (tinted magenta)
 *   rider-helmet helmet, white with a dark visor slot (tinted amber)
 * Hand-placed pixels (the map below IS the art). Key: S bright sled, s dim deck, B body, b body shade,
 * H helmet, v visor. The runner's flat underside is row RIDER_FOOT_ROW, centre x 13, so the runtime
 * anchors the image there to stand it on the ridge.
 */
const RIDER_MAP = [
  '..........................',
  '...........HHHH...........',
  '..........HHHHHH..........',
  '..........HHHHvvv.........',
  '..........HHHHHH..........',
  '...........HHHH...........',
  '.........BBBB.............',
  '........BBBBBB............',
  '........BBbBBBBBB.........',
  '.......BBbbB...BBB........',
  '.......BBbbB..............',
  '.......BBBbBBBB...........',
  '........BBBBBBBB..........',
  '.............BBB..........',
  '............BBB...........',
  '...SSSSSSSSSSSSSSSSSSS....',
  '...sssssssssssssssssssSS..',
  '.....S..........S......S..',
  '..SSSSSSSSSSSSSSSSSSSSSS..',
  '..........................',
];
const RIDER_FOOT_ROW = 18;

function riderLayers() {
  const H = RIDER_MAP.length;
  const W = RIDER_MAP[0].length;
  const sled = bitmap(W, H);
  const body = bitmap(W, H);
  const helm = bitmap(W, H);
  RIDER_MAP.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === 'S') put(sled, x, y, 255);
    else if (c === 's') put(sled, x, y, 150);
    else if (c === 'B') put(body, x, y, 255);
    else if (c === 'b') put(body, x, y, 175);
    else if (c === 'H') put(helm, x, y, 255);
    else if (c === 'v') put(helm, x, y, 30); // stays dark through any tint: reads as the visor slot
  }));
  // base: 1px (4-neighbour) dilation of every part in the palette bg, so the rider reads against the bright
  // sun or the dark hills alike, exactly like the dark under-stroke the in-game rider gets.
  const base = bitmap(W, H);
  const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && RIDER_MAP[y][x] !== '.';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (solid(x, y) || solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) put(base, x, y, 0);
    }
  }
  const baseSvg = toSvg(base, { levels: 2, comment: 'menu rider backing: palette bg #05060f (never recoloured)' })
    .replace(/fill="#000000"/g, 'fill="#05060f"');
  return {
    'rider-base.svg': baseSvg,
    'rider-sled.svg': toSvg(sled, { levels: 16, comment: `menu rider sled: white, tinted at runtime. Foot row ${RIDER_FOOT_ROW}` }),
    'rider-body.svg': toSvg(body, { levels: 16, comment: 'menu rider body: white, tinted at runtime' }),
    'rider-helmet.svg': toSvg(helm, { levels: 16, comment: 'menu rider helmet: white, tinted at runtime' }),
  };
}

// ------------------------------------------------------------------ panel corner ornament

/**
 * 9x9 corner ornament for panels (top-left orientation; flip for the other corners): an L bracket with a
 * notched inner step and a single bright pixel at the joint. White, tinted with the panel colour.
 */
function corner() {
  const bm = bitmap(9, 9);
  for (let i = 0; i < 9; i++) { put(bm, i, 0); put(bm, 0, i); }
  for (let i = 2; i < 6; i++) { put(bm, i, 2, 170); put(bm, 2, i, 170); }
  put(bm, 1, 1); put(bm, 2, 2, 255);
  return toSvg(bm, { levels: 8, comment: 'menu panel corner ornament (top-left), white, tinted at runtime' });
}

// ------------------------------------------------------------------ main

write('sun.svg', sun());
write('sun-glow.svg', sunGlow());
write('mountains-far.svg', mountains('far', { body: [92, 34], strata: [[6, 150], [14, 112]] }));
write('mountains-mid.svg', mountains('mid', { body: [66, 22], strata: [[5, 130], [12, 92]] }));
write('mountains-near.svg', mountains('near', { body: [40, 12], strata: [[4, 104]] }));
// BITSTREAM: 4px cells; BLUFFS: 5px cells so the second line carries more weight, as stacked synthwave
// logos do. Both slant 0.18 px/row and keep 3px of padding for the 2px outline (+1 for the split offset).
write('logo-bitstream-fill.svg', logoFill('BITSTREAM', 4, 3, 0.18));
write('logo-bitstream-line.svg', logoLine('BITSTREAM', 4, 3, 0.18, 2));
write('logo-bluffs-fill.svg', logoFill('BLUFFS', 5, 3, 0.18));
write('logo-bluffs-line.svg', logoLine('BLUFFS', 5, 3, 0.18, 2));
for (const [n, svg] of Object.entries(riderLayers())) write(n, svg);
write('corner.svg', corner());
