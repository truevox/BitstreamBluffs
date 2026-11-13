/**
 * Luna W3 audit probe — do the biome screenshots prove a TINT, or only different terrain?
 *
 * Home's own finding was that a screenshot proves a biome is *shown*, never that its colours are
 * *used*: her earlier ten frames differed only because the global palette was switched between shots,
 * and every file contained base-palette colours. Distinct file hashes are not evidence.
 *
 * An exact-hex search is also wrong, which this probe discovered the hard way: scanlines and the
 * backdrop composite over every pixel, so a declared `#5fe8c0` never appears verbatim. What IS
 * decisive is comparing biomes to EACH OTHER at one fixed palette:
 *
 *   - if biome palettes are applied, the five default-palette frames have five different dominant
 *     colours, and each is nearer its OWN declared colours than the base palette's;
 *   - if they are not applied, every frame is the same base terrain and the dominants are identical.
 *
 * The second case is exactly the bug Home shipped and then honestly retracted, so it is the one worth
 * being able to distinguish.
 *
 * Reads PNGs with zlib only, so it needs no image library.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SHOT_DIR = process.argv[2] || 'shots';
const BIOME_DIR = path.resolve(import.meta.dirname, 'src/data/biomes');
const PALETTES = path.resolve(import.meta.dirname, 'src/data/palettes.json');

/** Minimal PNG decoder: 8-bit RGB/RGBA, non-interlaced — what Chromium at deviceScaleFactor 2 writes. */
function readPng(file) {
  const buf = fs.readFileSync(file);
  let off = 8;
  let width = 0; let height = 0; let bitDepth = 0; let colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.from(line);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      if (filter === 1) cur[x] = (cur[x] + a) & 0xff;
      else if (filter === 2) cur[x] = (cur[x] + b) & 0xff;
      else if (filter === 3) cur[x] = (cur[x] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        cur[x] = (cur[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, channels, data: out };
}

const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

/** Nearest declared colour set to a measured pixel, in RGB distance. */
function nearest(rgb, colourMap) {
  let best = { d: Infinity, hex: null, key: null };
  for (const [hex, key] of colourMap) {
    const d = dist(rgb, hexToRgb(hex));
    if (d < best.d) best = { d, hex, key };
  }
  return best;
}

function colourMapFor(id, paletteName) {
  const def = JSON.parse(fs.readFileSync(path.join(BIOME_DIR, `${id}.json`), 'utf8'));
  const map = new Map();
  for (const [k, hex] of Object.entries((def.palettes || {})[paletteName] || {})) {
    if (typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)) map.set(hex.toLowerCase(), `biome.${k}`);
  }
  return map;
}

function baseMap(paletteName) {
  const p = JSON.parse(fs.readFileSync(PALETTES, 'utf8'))[paletteName] || {};
  const map = new Map();
  for (const [k, hex] of Object.entries(p)) {
    if (typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)) map.set(hex.toLowerCase(), `base.${k}`);
  }
  return map;
}

const files = fs.readdirSync(SHOT_DIR).filter((f) => f.startsWith('w3-biome-') && f.endsWith('.png')).sort();
if (!files.length) { console.log(`no biome screenshots in ${SHOT_DIR}`); process.exit(1); }

const dominantsByPalette = { default: new Map(), colorblind: new Map() };

console.log(`Sampling ${files.length} frames in ${SHOT_DIR}\n`);
console.log('biome                       palette      dominant    nearest:biome  nearest:base   verdict');
console.log('-'.repeat(94));

for (const f of files) {
  const m = /^w3-biome-(.+)-(default|colorblind)\.png$/.exec(f);
  if (!m) continue;
  const [, id, palName] = m;
  const img = readPng(path.join(SHOT_DIR, f));
  const counts = new Map();
  for (let i = 0; i < img.data.length; i += img.channels) {
    const hex = `#${img.data[i].toString(16).padStart(2, '0')}${img.data[i + 1].toString(16).padStart(2, '0')}${img.data[i + 2].toString(16).padStart(2, '0')}`;
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  const [domHex, domPx] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const domRgb = hexToRgb(domHex);
  dominantsByPalette[palName].set(id, { hex: domHex, px: domPx, rgb: domRgb });

  const nb = nearest(domRgb, colourMapFor(id, palName));
  const nbase = nearest(domRgb, baseMap(palName));
  const closerToOwn = nb.d < nbase.d;
  console.log(
    `${id.padEnd(27)} ${palName.padEnd(12)} ${domHex}  `
    + `${(nb.key || '-').padEnd(14)} ${(nbase.key || '-').padEnd(13)} `
    + `${closerToOwn ? 'BIOME' : 'base'} (${nb.d.toFixed(0)} vs ${nbase.d.toFixed(0)})`,
  );
}

console.log('\n== The decisive test: are the five frames distinct AT ONE FIXED PALETTE? ==');
let anyCollision = false;
for (const [palName, m] of Object.entries(dominantsByPalette)) {
  const entries = [...m.entries()];
  const hexes = entries.map(([, v]) => v.hex);
  const unique = new Set(hexes);
  console.log(`\n  ${palName}: ${unique.size}/${entries.length} distinct dominant colours`);
  for (const [id, v] of entries) console.log(`    ${id.padEnd(27)} ${v.hex} (${v.px} px)`);
  if (unique.size < entries.length) {
    anyCollision = true;
    const seen = new Map();
    for (const [id, v] of entries) {
      if (seen.has(v.hex)) console.log(`    COLLISION: ${id} and ${seen.get(v.hex)} share ${v.hex}`);
      seen.set(v.hex, id);
    }
  }
}

console.log(`\n${anyCollision
  ? 'FAIL: two biomes render identically at the same palette — the tint is not applied to both'
  : 'PASS: all five biomes render distinct worlds at the same palette, in both palettes'}`);
process.exit(anyCollision ? 1 : 0);
