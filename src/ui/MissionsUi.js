/**
 * W2 mission UI. One place that draws the three active missions, so Title, Pause and Game Over all
 * render from the same published view and the same tested geometry — and so a layout fix lands in
 * one file rather than three.
 *
 * All geometry comes from src/ui/MissionsLayout.js, which is unit-tested for overlap. Nothing here
 * computes a coordinate by hand.
 */
import { NeonText } from './Neon.js';
import { Panel } from './Panel.js';
import { missionPanelLayout, missionListLayout, ellipsize } from './MissionsLayout.js';
// Two different ellipsize helpers exist: MissionsLayout's takes a row width at a fixed 6 px advance, PixelFont's
// takes real measured font pixels. The toast is measured text on the HUD strip, so it uses PixelFont's.
import { ellipsize as ellipsizePx, measureText } from './PixelFont.js';
import { stripTextMaxPx } from './HudLayout.js';
import { GAME_WIDTH } from '../constants.js';

const fmt = (n) => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Draw the compact mission list used on the Title screen.
 * @param {Phaser.Scene} scene
 * @param {Object} theme
 * @param {Array} rows mission view rows from REG.MISSIONS
 * @returns {Phaser.GameObjects.Container|null}
 */
export function buildTitleMissionList(scene, theme, rows) {
  const list = Array.isArray(rows) ? rows.slice(0, 3) : [];
  if (!list.length) return null;
  const L = missionListLayout(list.length);
  const panel = new Panel(scene, theme, {
    x: L.panel.x, y: L.panel.y, w: L.panel.w, h: L.panel.h,
    color: 'magenta', fillAlpha: 0.82,
  });
  list.forEach((row, i) => {
    const r = L.rows[i];
    const bar = L.bars[i];
    if (!r) return;
    // Local coordinates inside the panel; ellipsized to the measured row width so a long title can
    // never run past its own bar (the defect Luna caught in W1's reward line).
    const local = { x: r.x - L.panel.x, y: r.y - L.panel.y, w: r.w };
    // The bar is INLINE (to the right of the text), so the label keeps its full 8 px glyph box. Only
    // a bar drawn underneath a label at a sub-10 px pitch can slice it — see MISSION_LIST_TITLE.
    const label = new NeonText(scene, theme, local.x, local.y, ellipsize(row.title, local.w), {
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
