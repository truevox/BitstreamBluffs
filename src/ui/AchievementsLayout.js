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
import { ACHIEVEMENTS, visibleAchievements, progressFor, metricsFrom, groupedAchievements, GROUP_ORDER } from '../systems/Achievements.js';

export const ACH_PANEL = Object.freeze({ w: 432, h: 244 });

const PAD = 12;
const GLYPH_H = 8;

/** Rows per page. Row pitch 13 with a header row, leaving clear space above BACK at h - 22. */
export const ROWS_PER_PAGE = 13;

const GROUP_LABELS = Object.freeze({
  skill: 'SKILL', distance: 'DISTANCE', daily: 'DAILY', collection: 'COLLECTION', biomes: 'BIOMES',
});

/**
 * Section labels, in Achievements.GROUP_ORDER (decision 9). Derived rather than listed a second time: this
 * array used to say SKILL first while the grid actually drew DISTANCE first.
 */
export const GROUPS = Object.freeze(GROUP_ORDER.map((id) => Object.freeze({ id, label: GROUP_LABELS[id] || String(id).toUpperCase() })));

/**
 * Flatten the catalogue into display rows: a group header row, then its achievements.
 * @returns {Array<{kind:'header'|'row', label?:string, id?:string}>}
 */
export function achievementRows(profile) {
  // Catalogue introspection (no profile) retains all defs for source audits.
  // Actual player views always pass a profile and hide secret rows until earned.
  const defs = profile === undefined ? ACHIEVEMENTS : visibleAchievements(profile);
  const out = [];
  for (const g of groupedAchievements(defs)) {
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
  const rows = achievementRows(o.profile);
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
 * Up to three lines at a 10 px pitch (y 14, 24, 34; the last ends at 42, inside maxY 46). Decision 9: the
 * names are listed in the order they were unlocked (the canonical catalogue order), so a run that reaches
 * x1.75 reads COMBO STARTER, CHAIN REACTION, UNBROKEN. More than three: two names and "+N MORE", rather
 * than a truncated run-on. One: its name and its description.
 */
export const TOAST_BOX = Object.freeze({ x: 14, y: 14, w: 138, maxY: 46 });

/** Lines the toast band holds (TOAST_BOX.y .. maxY at a 10 px pitch). */
export const TOAST_LINES = 3;

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
  if (list.length > 1) {
    // Every name fits: list them all. Otherwise keep the last line for the count of the rest.
    const named = list.length <= TOAST_LINES ? list.length : TOAST_LINES - 1;
    for (let i = 1; i < named; i += 1) {
      lines.push(box(`toast-${i + 1}`, cut(list[i].name.toUpperCase(), TOAST_BOX.w), TOAST_BOX.x, TOAST_BOX.y + 10 * i, 'amber'));
    }
    const rest = list.length - named;
    if (rest > 0) lines.push(box('toast-n', `+${rest} MORE`, TOAST_BOX.x, TOAST_BOX.y + 10 * named, 'magenta', { alpha: 0.9 }));
  } else if (list[0].desc) {
    // A single unlock has room for its description, which is the whole point of announcing it.
    lines.push(box('toast-d', cut(String(list[0].desc).toUpperCase(), TOAST_BOX.w), TOAST_BOX.x, TOAST_BOX.y + 10, 'text', { alpha: 0.8 }));
  }
  return { lines };
}
