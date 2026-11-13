/**
 * OWNER: UI engineer.
 * Phaser-free layout for the profile UI: the TitleScene level badge and the whole contents of the
 * PROFILE view. `Views.js` and `TitleScene.js` only draw what this returns, so positions, text,
 * palette keys and alphas can be unit-tested (overlap + contrast) in Jest without booting Phaser.
 *
 * Every box is in panel-local / screen-local game pixels (480x270 virtual canvas, 5x7 font: 7 cap
 * rows + 1 descender row). `x`/`y` are the TOP-LEFT corner, `w`/`h` the measured extent, so a
 * renderer can draw with `anchor: 'left'` at (x, y) and a test can intersect the boxes directly.
 */
import { measureText } from './PixelFont.js';
import { loadLevelTable, levelForXp } from '../systems/Progression.js';
import { fmtInt, fmtSec, fmtClock, idToLabel } from './Format.js';

/** PROFILE view panel size. Taller than the leaderboard because it carries 10 stats and 11 signatures. */
export const PROFILE_PANEL = Object.freeze({ w: 416, h: 224 });

/** Screen x of the Title badge: left of the 4x logo (BITSTREAM starts at 138), so the two never touch. */
export const TITLE_BADGE = Object.freeze({ x: 8, y: 6, lineH: 10 });

const GLYPH_H = 8; // 7 cap rows + the descender row: a conservative box for overlap tests
const PAD = 12;
const RIGHT = PROFILE_PANEL.w - PAD;

/** @returns {string} 'H:MM:SS' over an hour, else 'M:SS'. Lifetime totals get large, so plain m:ss is not enough. */
export function fmtPlaytime(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  if (total < 3600) return fmtClock(total * 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** 'garbage-dump-glacier' -> 'GARBAGE DUMP GLACIER'. Biome ids are kebab-case, ids elsewhere are camelCase. */
function label(id) {
  return idToLabel(String(id || '').replace(/[-_]+/g, ' '));
}

/**
 * Build one text box. Right-aligned text still records its true left edge so overlap tests are exact.
 * @param {string} key
 * @param {string} text
 * @param {number} x left edge (left/center) or right edge (right-aligned)
 * @param {number} y top edge
 * @param {string} color palette key
 * @param {{align?:'left'|'right', alpha?:number, outline?:'dark'|'glow'|'none'}} [o]
 */
function box(key, text, x, y, color, o = {}) {
  const t = String(text === undefined || text === null ? '' : text);
  const align = o.align || 'left';
  const w = measureText(t);
  return {
    key,
    text: t,
    x: align === 'right' ? x - w : x,
    y,
    w,
    h: GLYPH_H,
    align,
    color,
    alpha: o.alpha === undefined ? 1 : o.alpha,
    outline: o.outline || 'none',
  };
}

/**
 * Lifetime stat rows, in reading order. Device-best values come straight from the profile the
 * progression service publishes — this file never re-derives a best from the stored run list.
 * @param {Object} life profile.lifetime
 * @returns {[string,string][]}
 */
export function statRows(life) {
  const l = life && typeof life === 'object' ? life : {};
  const tricks = l.tricks && typeof l.tricks === 'object' ? l.tricks : {};
  const trickTotal = Object.values(tricks).reduce((a, b) => a + (Number(b) || 0), 0);
  return [
    ['RUNS', fmtInt(l.runs)],
    ['TOTAL DISTANCE', `${fmtInt(l.distanceM)} M`],
    ['PLAY TIME', fmtPlaytime(l.playMs)],
    ['BEST SCORE', fmtInt(l.bestScore)],
    ['BEST DISTANCE', `${fmtInt(l.bestDistanceM)} M`],
    ['BEST COMBO', `x${(Number(l.bestCombo) || 0).toFixed(2)}`],
    ['BEST AIR', `${fmtSec(l.maxAirtimeMs)} S`],
    ['DATA SHARDS', fmtInt(l.shards)],
    ['NEAR MISSES', fmtInt(l.nearMisses)],
    ['TRICKS', fmtInt(trickTotal)],
  ];
}

/**
 * Layout of the PROFILE view. Defensive: a missing/partial profile renders as a level 1 pilot with
 * zeroes rather than throwing, because a view can be opened before the first run ever credits.
 * @param {{profile?:Object, levels?:*}} o `levels` is the parsed levels.json (content.progression)
 * @returns {{w:number,h:number,items:Object[],bar:{x:number,y:number,w:number,h:number,ratio:number,color:string}}}
 */
export function profileLayout(o = {}) {
  const table = loadLevelTable(o.levels);
  const p = o.profile && typeof o.profile === 'object' ? o.profile : {};
  const life = p.lifetime && typeof p.lifetime === 'object' ? p.lifetime : {};
  const xp = Number(p.xp) || 0;
  // Derive the level from XP (the same rule ProfileStore applies on every load), so a stale or
  // hand-edited `level` field can never make the badge disagree with the XP figure beside it.
  const level = levelForXp(xp, table);
  const entry = table.levels.find((e) => e.level === level) || { xpMin: 0, title: '' };
  const next = table.levels.find((e) => e.level === level + 1) || null;
  const span = next ? next.xpMin - entry.xpMin : 0;
  const ratio = next && span > 0 ? Math.min(1, Math.max(0, (xp - entry.xpMin) / span)) : 1;

  const items = [];
  // Sync Level row: level + the title earned at that level.
  items.push(box('level', `SYNC LEVEL ${level}`, PAD, 24, 'lime'));
  items.push(box('title', String(entry.title || '').toUpperCase(), RIGHT, 24, 'text', { align: 'right', alpha: 0.85 }));
  // XP row: figure, Resonance bar, and what is left to the next level.
  items.push(box('xp', `XP ${fmtInt(xp)}`, PAD, 36, 'amber'));
  const bar = { x: 96, y: 36, w: 190, h: 7, ratio, color: ratio >= 1 ? 'amber' : 'lime' };
  if (next) items.push(box('tonext', `${fmtInt(Math.max(0, next.xpMin - xp))} TO L${level + 1}`, RIGHT, 36, 'text', { align: 'right', alpha: 0.85 }));
  else items.push(box('tonext', 'MAX SYNC', RIGHT, 36, 'amber', { align: 'right' }));

  // Lifetime block: two columns of five, so ten numbers fit without shrinking the font.
  items.push(box('lifetime-head', 'LIFETIME', PAD, 54, 'amber'));
  const rows = statRows(life);
  rows.forEach(([k, v], i) => {
    const col = i < 5 ? 0 : 1;
    const labelX = col === 0 ? PAD : 208;
    const valueRight = col === 0 ? 186 : RIGHT;
    const y = 66 + (i % 5) * 12;
    items.push(box(`stat-k${i}`, k, labelX, y, 'text', { alpha: 0.7 }));
    items.push(box(`stat-v${i}`, v, valueRight, y, 'cyan', { align: 'right' }));
  });

  // Biomes: reached ones are unlocked as biomes, but W1 does not ship their mechanics yet, so the
  // signature status is a single uniform note (SPEC: "SIGNATURE LOCKED — COMING ONLINE" until W3/W6).
  // Hyphen, not the spec's em dash: the 5x7 font has no U+2014 and would draw '?'.
  const order = Array.isArray(table.biomeOrder) ? table.biomeOrder : [];
  const reached = new Set(Array.isArray(p.pendingBiomes) ? p.pendingBiomes : []);
  const reachedCount = order.filter((id) => reached.has(id)).length;
  items.push(box('sig-head', `BIOMES REACHED ${reachedCount}/${order.length}`, PAD, 132, 'magenta'));
  items.push(box('sig-note', 'SIGNATURE LOCKED - COMING ONLINE', RIGHT, 132, 'text', { align: 'right', alpha: 0.7 }));
  order.forEach((id, i) => {
    const col = i % 3;
    const y = 146 + Math.floor(i / 3) * 13;
    const has = reached.has(id);
    // 0.55 alpha keeps even the unreached names above the 4.5:1 contrast floor in both palettes.
    items.push(box(`sig-${id}`, label(id), PAD + col * 134, y, has ? 'amber' : 'text', { alpha: has ? 1 : 0.55 }));
  });

  return { w: PROFILE_PANEL.w, h: PROFILE_PANEL.h, items, bar };
}

/**
 * Title-screen level badge. Two short lines in the top-left corner, left of the logo: the subtitle
 * sits at y 76-83 and the menu panel starts at y 92, so a centred badge there would collide with both.
 * `outline: 'dark'` because the badge sits on the animated backdrop, not on a flat panel.
 * @param {{profile?:Object, levels?:*}} o
 * @returns {{level:number, items:Object[]}|null} null = nothing to draw (no profile yet)
 */
export function titleBadgeLayout(o = {}) {
  const p = o.profile;
  if (!p || typeof p !== 'object') return null;
  const table = loadLevelTable(o.levels);
  const level = levelForXp(Number(p.xp) || 0, table);
  const entry = table.levels.find((e) => e.level === level) || { title: '' };
  const items = [
    box('badge-level', `SYNC LEVEL ${level}`, TITLE_BADGE.x, TITLE_BADGE.y, 'lime', { outline: 'dark' }),
    box('badge-title', String(entry.title || '').toUpperCase(), TITLE_BADGE.x, TITLE_BADGE.y + TITLE_BADGE.lineH, 'text', { outline: 'dark', alpha: 0.85 }),
  ];
  return { level, items };
}

/** @param {Object[]} items @returns {Object[]} every overlapping pair, for tests and HUD probes. */
export function overlappingPairs(items) {
  const hits = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const p = items[i];
      const q = items[j];
      const ix = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
      const iy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
      if (ix > 1 && iy > 1) hits.push([p.key, q.key]);
    }
  }
  return hits;
}
