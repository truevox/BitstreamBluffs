/**
 * W2 mission UI. One place that draws the three active missions, so Title, Pause and Game Over all
 * render from the same published view and the same tested geometry — and so a layout fix lands in
 * one file rather than three.
 *
 * All geometry comes from src/ui/MissionsLayout.js, which is unit-tested for overlap. Nothing here
 * computes a coordinate by hand.
 */
import Phaser from 'phaser';
import { NeonText } from './Neon.js';
import { mixColor } from './MenuArt.js';
import { Panel } from './Panel.js';
import { missionPanelLayout, missionListLayout, ellipsize } from './MissionsLayout.js';
// Two different ellipsize helpers exist: MissionsLayout's takes a row width at a fixed 6 px advance, PixelFont's
// takes real measured font pixels. The toast is measured text on the HUD strip, so it uses PixelFont's.
import { ellipsize as ellipsizePx, measureText } from './PixelFont.js';
import { stripTextMaxPx } from './HudLayout.js';
import { GAME_WIDTH } from '../constants.js';

const fmt = (n) => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Draw the Title screen's mission list: the last section of the cabinet card. No panel of its own (the card
 * is the panel); a container at the list's top-left holding, per mission, an upper-cased title over a
 * full-width progress bar. Titles are fitted with the MEASURED font width, and the row is wide enough for
 * the longest real title (MissionsLayout.MISSION_LIST_TITLE), so nothing is cut in practice.
 * @param {Phaser.Scene} scene
 * @param {Object} theme
 * @param {Array} rows mission view rows from REG.MISSIONS
 * @returns {Phaser.GameObjects.Container|null}
 */
export function buildTitleMissionList(scene, theme, rows) {
  const list = Array.isArray(rows) ? rows.slice(0, 3) : [];
  if (!list.length) return null;
  const L = missionListLayout(list.length);
  const box = new Phaser.GameObjects.Container(scene, L.panel.x, L.panel.y);
  scene.add.existing(box);
  const g = new Phaser.GameObjects.Graphics(scene);
  box.add(g);
  const labels = [];
  list.forEach((row, i) => {
    const r = L.rows[i];
    if (!r) return;
    const title = String(row.title || '').toUpperCase();
    // a done row gets a tick when it fits; the lime colour and the full bar say "done" either way
    const ticked = `✓ ${title}`;
    const text = row.done && measureText(ticked) <= r.w ? ticked : ellipsizePx(title, r.w);
    const label = new NeonText(scene, theme, r.x - L.panel.x, r.y - L.panel.y, text, {
      color: row.done ? 'lime' : 'text', outline: 'none',
    });
    label.setAlpha(row.done ? 1 : 0.9);
    box.add(label);
    labels.push(label);
  });
  const paint = (pal) => {
    g.clear();
    list.forEach((row, i) => {
      const bar = L.bars[i];
      if (!bar) return;
      const bx = bar.x - L.panel.x;
      const by = bar.y - L.panel.y;
      const frac = Math.max(0, Math.min(1, row.fraction || 0));
      const c = row.done ? pal.lime : pal.cyan;
      // track: a dim groove with tick marks every quarter, so an empty bar still reads as a gauge
      g.fillStyle(mixColor(pal.bgAlt, c, 0.28), 1);
      g.fillRect(bx, by, bar.w, bar.h);
      g.fillStyle(c, 0.5);
      for (let q = 1; q < 4; q++) g.fillRect(bx + Math.round((bar.w * q) / 4), by, 1, bar.h);
      if (frac > 0) {
        const fw = Math.max(1, Math.round(bar.w * frac));
        g.fillStyle(c, 0.95);
        g.fillRect(bx, by, fw, bar.h);
        // a bright leading pixel: the "charging" tip
        g.fillStyle(pal.text, 0.9);
        g.fillRect(bx + fw - 1, by, 1, bar.h);
      }
    });
  };
  const unbind = theme.bind(paint);
  box.once('destroy', unbind);
  box.labels = labels;
  return box;
}

/**
 * Draw the in-run / pause mission panel with progress bars.
 * @param {Phaser.Scene} scene
 * @param {Object} theme
 * @param {Array} rows
 * @param {{x?:number,y?:number}} [o]
 */
export function buildMissionPanel(scene, theme, rows, o = {}) {
  const list = Array.isArray(rows) ? rows.slice(0, 3) : [];
  if (!list.length) return null;
  const L = missionPanelLayout(list.length, o);
  const panel = new Panel(scene, theme, {
    x: L.panel.x, y: L.panel.y, w: L.panel.w, h: L.panel.h,
    color: 'cyan', title: 'MISSIONS', fillAlpha: 0.88,
  });
  list.forEach((row, i) => {
    const r = L.rows[i];
    const bar = L.bars[i];
    if (!r) return;
    const local = { x: r.x - L.panel.x, y: r.y - L.panel.y, w: r.w };
    const text = `${ellipsize(row.title, local.w - 76)}  ${row.text || ''}`;
    const label = new NeonText(scene, theme, local.x, local.y, text, {
      color: row.done ? 'lime' : 'text', outline: 'none',
    });
    label.setAlpha(0.92);
    panel.add(label);
    const bx = bar.x - L.panel.x;
    const by = bar.y - L.panel.y;
    const g = scene.add.graphics();
    g.fillStyle(0x1a2b3a, 1);
    g.fillRect(bx, by, bar.w, bar.h);
    const frac = Math.max(0, Math.min(1, row.fraction || 0));
    if (frac > 0) {
      const color = row.done ? 0x9cff57 : (theme.color('cyan'));
      g.fillStyle(color, 1);
      g.fillRect(bx, by, Math.max(1, Math.round(bar.w * frac)), bar.h);
    }
    panel.add(g);
  });
  return panel;
}

/**
 * The lines Game Over shows for missions: what was completed and whether the set cleared.
 * @param {{completed:Array,setCleared:boolean,xp:number,shards:number}|null} m
 * @returns {string[]}
 */
export function gameOverMissionLines(m) {
  if (!m) return [];
  const done = Array.isArray(m.completed) ? m.completed : [];
  if (!done.length && !m.setCleared) return [];
  const lines = [];
  if (done.length) {
    // Names are looked up by the caller when available; ids are a safe fallback that never overruns.
    lines.push(`MISSIONS ${done.length}/3  +${fmt(m.xp)} XP  +${fmt(m.shards)} SHARDS`);
  }
  if (m.setCleared) lines.push('SET CLEARED  BONUS PAID');
  return lines;
}

/**
 * Fit "<NAME> DONE  +<XP> XP" on the HUD strip, cutting only the name (with the font's "..") so the reward
 * always shows. The limit is the strip's real text width (HudLayout.stripTextMaxPx), in measured font px.
 * @param {string} name already upper-cased
 * @param {number} xp
 * @returns {string}
 */
export function stripToastText(name, xp) {
  const suffix = ` DONE  +${fmt(xp)} XP`;
  const maxPx = stripTextMaxPx(GAME_WIDTH);
  const full = `${name}${suffix}`;
  if (measureText(full) <= maxPx) return full;
  return `${ellipsizePx(name, Math.max(0, maxPx - measureText(suffix)))}${suffix}`;
}

/**
 * Completion toast text for one finished mission, sized for the MILESTONE strip.
 *
 * It used to call MissionsLayout.ellipsize(text, 36), whose second argument is a row width in PIXELS at a
 * 6 px advance, so every toast was cut to about five letters ("LAND …", audit MT-1).
 * @param {{id:string,xp:number,shards:number}} c @param {string} [title]
 */
export function missionToastText(c, title) {
  if (!c) return '';
  const name = typeof title === 'string' && title ? title.toUpperCase() : 'MISSION';
  return stripToastText(name, c.xp);
}
