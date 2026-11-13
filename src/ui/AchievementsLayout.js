/**
 * OWNER: UI engineer. Phaser-free, like ProfileLayout: this returns boxes and the view only draws them.
 *
 * W5 achievements grid. Its own panel rather than extra rows on PROFILE, for a measured reason: PROFILE is
 * already 240px of the 270px canvas with 11 biome toggles and a BACK button at `h - 22`, so adding 29 rows
 * would either overflow the screen or shrink the font below the readable 5x7 grid. A paged panel keeps both
 * screens honest.
 *
 * Paging is computed here, not in the view, so "does every row fit above the BACK button" is a unit test.
 */
import { measureText } from './PixelFont.js';
import { ACHIEVEMENTS, progressFor, metricsFrom, groupedAchievements } from '../systems/Achievements.js';

export const ACH_PANEL = Object.freeze({ w: 432, h: 244 });

const PAD = 12;
const GLYPH_H = 8;

/** Rows per page. Row pitch 13 with a header row, leaving clear space above BACK at h - 22. */
export const ROWS_PER_PAGE = 13;

export const GROUPS = Object.freeze([
  { id: 'skill', label: 'SKILL' },
  { id: 'distance', label: 'DISTANCE' },
  { id: 'daily', label: 'DAILY' },
  { id: 'collection', label: 'COLLECTION' },
  { id: 'biomes', label: 'BIOMES' },
]);

/**
 * Flatten the catalogue into display rows: a group header row, then its achievements.
 * @returns {Array<{kind:'header'|'row', label?:string, id?:string}>}
 */
export function achievementRows() {
  const out = [];
  for (const g of groupedAchievements()) {
    const meta = GROUPS.find((x) => x.id === g.group);
    out.push({ kind: 'header', label: meta ? meta.label : String(g.group).toUpperCase() });
    for (const a of g.items) out.push({ kind: 'row', id: a.id });
  }
  return out;
}

/** How many pages the grid needs. Always at least one, so an empty catalogue still renders a page. */
export function pageCount(rows = achievementRows()) {
  return Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
}

/** Clamp a page index into range, so a stale page number after an unlock cannot show a blank screen. */
export function clampPage(page, rows = achievementRows()) {
  const n = pageCount(rows);
  const p = Math.floor(Number(page) || 0);
  return Math.min(n - 1, Math.max(0, p));
}

/**
 * One page of rows with their drawn text, plus progress for the player's current state.
 *
 * The bar is a RATIO, not pixels: the view multiplies by its own width, so the layout never needs to know
 * the panel's inner geometry twice.
 *
 * @param {{profile?:Object, biomeCount?:number, streak?:number, dailyRuns?:number, page?:number}} o
 * @returns {{w:number,h:number,page:number,pages:number,items:Object[],rows:Object[],footer:Object}}
 */
export function achievementsLayout(o = {}) {
  const metrics = metricsFrom(o.profile, null, {
    biomeCount: o.biomeCount, streak: o.streak, dailyRuns: o.dailyRuns,
  });
  const unlocked = (o.profile && o.profile.achievements) || {};
  const rows = achievementRows();
  const pages = pageCount(rows);
  const page = clampPage(o.page, rows);
  const start = page * ROWS_PER_PAGE;
  const slice = rows.slice(start, start + ROWS_PER_PAGE);

  const items = [];
  const outRows = [];
  let y = 24;
  for (const r of slice) {
    if (r.kind === 'header') {
      items.push(box(`h-${y}`, r.label, PAD, y, 'amber'));
      outRows.push({ kind: 'header', label: r.label, y });
      y += 13;
      continue;
    }
    const def = ACHIEVEMENTS.find((a) => a.id === r.id);
    if (!def) continue;
    const at = unlocked[def.id];
    const done = Number.isFinite(at);
    const pr = progressFor(def, metrics);
    // Done rows read in lime and full alpha; pending rows are dimmer so a glance shows what is left.
    items.push(box(`n-${def.id}`, def.name, PAD, y, done ? 'lime' : 'text', { alpha: done ? 1 : 0.75 }));
    const pct = `${pr.value}/${pr.target}`;
    items.push(box(`p-${def.id}`, pct, ACH_PANEL.w - PAD, y, done ? 'lime' : 'cyan', { align: 'right', alpha: done ? 1 : 0.8 }));
    outRows.push({ kind: 'row', id: def.id, name: def.name, y, done, ratio: pr.ratio, progress: pct, desc: def.desc });
    y += 13;
  }

  const footer = box('page', `PAGE ${page + 1}/${pages}`, PAD, ACH_PANEL.h - 20, 'magenta', { alpha: 0.9 });
  items.push(footer);

  return { w: ACH_PANEL.w, h: ACH_PANEL.h, page, pages, items, rows: outRows, footer };
}

/**
 * Build one text box, mirroring ProfileLayout's helper so the two screens' geometry tests agree.
 * @returns {Object}
 */
function box(key, text, x, y, color, o = {}) {
  const t = String(text === undefined || text === null ? '' : text);
  const align = o.align || 'left';
  const w = measureText(t);
  return {
    key, text: t,
    x: align === 'right' ? x - w : x,
    y, w, h: GLYPH_H, align, color,
    alpha: o.alpha === undefined ? 1 : o.alpha,
  };
}

/**
 * Rows that overlap any other drawn box. Empty is the pass condition; the same shape ProfileLayout's
 * suite asserts on.
 * @param {Object[]} items
 * @returns {Array<[string,string]>}
 */
export function overlappingPairs(items) {
  const out = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      const sep = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      if (!sep) out.push([a.key || a.text, b.key || b.text]);
    }
  }
  return out;
}

/**
 * The unlock toast on Game Over.
 *
 * Where it goes is constrained, not chosen. The CRASHED header is centred at scale 4, so its ink spans
 * roughly x 156..324, y 8..40; the RUN REPORT panel starts at y 54; the LEDGER panel is the right half.
 * That leaves the top-LEFT corner (x 14..152) as the only band a transient line can occupy without
 * covering something the player is reading. Measured from those three boxes, so the toast can never be
 * placed over the header by a future edit.
 *
 * Two lines: the first achievement, then a count of the rest. A player who unlocks four at once reads
 * "FIRST DESCENT" and "+3 MORE" rather than a truncated run-on.
 */
export const TOAST_BOX = Object.freeze({ x: 14, y: 14, w: 138, maxY: 46 });

/**
 * @param {Array<Object>} added achievement defs newly unlocked, in catalogue order
 * @param {{ellipsize?:function(string,number):string}} [o] injected so this file stays Phaser-free
 * @returns {{lines:Array<Object>}|null} null when there is nothing to announce
 */
export function toastLayout(added, o = {}) {
  const list = Array.isArray(added) ? added.filter((a) => a && typeof a.name === 'string' && a.name) : [];
  if (!list.length) return null;
  const cut = typeof o.ellipsize === 'function' ? o.ellipsize : (s) => s;
  const lines = [];
  lines.push(box('toast-1', cut(`UNLOCKED ${list[0].name.toUpperCase()}`, TOAST_BOX.w), TOAST_BOX.x, TOAST_BOX.y, 'amber'));
  const rest = list.length - 1;
  if (rest > 0) lines.push(box('toast-n', `+${rest} MORE`, TOAST_BOX.x, TOAST_BOX.y + 10, 'magenta', { alpha: 0.9 }));
  else if (list[0].desc) {
    // A single unlock has room for its description, which is the whole point of announcing it.
    lines.push(box('toast-d', cut(String(list[0].desc).toUpperCase(), TOAST_BOX.w), TOAST_BOX.x, TOAST_BOX.y + 10, 'text', { alpha: 0.8 }));
  }
  return { lines };
}
