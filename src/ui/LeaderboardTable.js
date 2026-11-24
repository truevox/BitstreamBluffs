/**
 * OWNER: UI engineer.
 * Top-10 table (per device): rank, initials, score, distance, and (wide layout) seed + daily-rule flag.
 * Defensive about stub / partial records. Highlights the entry whose id === highlightId.
 */
import Phaser from 'phaser';
import { NeonText } from './Neon.js';
import { ellipsize } from './PixelFont.js';
import { fmtInt, idToLabel } from './Format.js';
import { DailyPatch } from '../systems/DailyPatch.js';
import { podiumKey, paintRule, staggerAlpha } from './ViewChrome.js';

export const ROW_H = 11;

/** @param {string} id @returns {string} display label of a daily rule id. */
export function ruleLabel(id) {
  if (!id || id === 'none') return '-';
  const r = DailyPatch.getRuleById(id);
  return (r ? r.name.toUpperCase() : idToLabel(id));
}

export class LeaderboardTable extends Phaser.GameObjects.Container {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{x:number,y:number,w:number,entries:object[]|null,highlightId?:string,rows?:number,wide?:boolean,
   *          rowH?:number,parent?:Phaser.GameObjects.Container}} o entries === null shows a loading message
   *   `animate` (default true) fades the rows in one after another when entries arrive (skipped under
   *   reduce motion). Rows 1-3 wear the podium colours (amber / text / magenta) on a numbered chip.
   *   `rowH` lets a caller tighten the pitch to fit the same row count in less space (Game Over uses 9
   *   to keep all ten entries visible alongside the mission block). Defaults to ROW_H.
   */
  constructor(scene, theme, o) {
    super(scene, o.x, o.y);
    this.theme = theme;
    this.w = o.w;
    this.rows = o.rows || 10;
    // Per-caller pitch. The pitch is a rendering detail; the row COUNT is the contract the panel title
    // advertises, so tightening the pitch must never be used to show fewer entries than promised.
    this.rowH = o.rowH || ROW_H;
    this.wide = o.wide !== undefined ? o.wide : o.w >= 330;
    this.g = new Phaser.GameObjects.Graphics(scene);
    this.add(this.g);
    this.animate = o.animate !== false;
    this._curRow = null;
    this.highlightId = o.highlightId;
    this.highlightRow = -1;
    this.pulse = 0;
    scene.add.existing(this);
    if (o.parent) o.parent.add(this);
    this._unbind = theme.bind(() => this._paintBars());
    this.setEntries(o.entries);
  }

  _cell(x, y, text, color, anchor = 'left') {
    const t = new NeonText(this.scene, this.theme, x, y, text, { color, anchor, outline: 'none' });
    this.add(t);
    this.cells.push(t);
    if (this._curRow) this._curRow.push(t);
    return t;
  }

  /**
   * @param {object[]|null} entries
   * @param {string} [highlightId]
   * @param {{title:string, sub?:string}} [empty] what an empty board says instead of the generic
   *   "NO ENTRIES YET" (the leaderboard view names WHICH board is empty). Omitted = the generic text.
   * @returns {void}
   */
  setEntries(entries, highlightId, empty) {
    if (highlightId !== undefined) this.highlightId = highlightId;
    for (const c of this.cells || []) c.destroy();
    this.cells = [];
    this.rowCount = 0;
    this.highlightRow = -1;
    const w = this.w;
    if (entries === null) {
      this._cell(w / 2, 50, 'READING LEDGER...', 'cyan', 'center');
      this._paintBars();
      return;
    }
    const col = this.wide
      ? { rank: 6, ini: 24, score: 108, dist: 160, seed: 172, rule: w - 6 }
      : { rank: 4, ini: 20, score: 100, dist: w - 6 };
    const hy = 0;
    this._cell(col.rank, hy, '#', 'text').setAlpha(0.5);
    this._cell(col.ini, hy, 'NAME', 'text').setAlpha(0.5);
    this._cell(col.score, hy, 'SCORE', 'text', 'right').setAlpha(0.5);
    this._cell(col.dist, hy, 'DIST', 'text', 'right').setAlpha(0.5);
    if (this.wide) {
      this._cell(col.seed, hy, 'SEED', 'text').setAlpha(0.5);
      this._cell(col.rule, hy, 'RULE', 'text', 'right').setAlpha(0.5);
    }
    const list = entries.slice(0, this.rows);
    if (list.length === 0) {
      const e = empty && empty.title ? empty : { title: 'NO ENTRIES YET', sub: 'FINISH A TOP-10 RUN TO CLAIM A SPOT' };
      this._cell(w / 2, 52, e.title, 'amber', 'center');
      if (e.sub) this._cell(w / 2, 66, e.sub, 'text', 'center').setAlpha(0.6);
    }
    this.rowCount = list.length;
    const groups = [];
    list.forEach((e, i) => {
      const y = 14 + i * this.rowH;
      const hi = this.highlightId && e.id === this.highlightId;
      if (hi) this.highlightRow = i;
      const pk = podiumKey(i);
      const color = hi ? 'lime' : i === 0 ? 'amber' : 'text';
      this._curRow = [];
      // rank: podium rows sit on a filled chip (painted in _paintBars) with the digit knocked out in bg
      this._cell(col.rank, y, String(i + 1), hi ? 'lime' : pk ? 'bg' : 'cyan');
      this._cell(col.ini, y, String(e.initials || '---').toUpperCase(), hi ? 'lime' : pk || 'text');
      this._cell(col.score, y, fmtInt(e.score), hi ? 'lime' : 'amber', 'right');
      this._cell(col.dist, y, `${fmtInt(e.distanceM)}m`, color, 'right');
      if (this.wide) {
        this._cell(col.seed, y, ellipsize(String(e.seed || '-'), 96), color);
        this._cell(col.rule, y, ellipsize(ruleLabel(e.dailyRuleId), 84), e.dailyRuleId && e.dailyRuleId !== 'none' ? 'magenta' : 'text', 'right')
          .setAlpha(e.dailyRuleId && e.dailyRuleId !== 'none' ? 1 : 0.4);
      }
      groups.push(this._curRow);
      this._curRow = null;
    });
    this._paintBars();
    if (this.animate && groups.length) staggerAlpha(this.scene, groups, { start: 60, step: 28 });
  }

  _paintBars() {
    if (!this.g) return;
    const pal = this.theme.pal;
    const g = this.g;
    g.clear();
    paintRule(g, 0, this.w, 10, pal.cyan, 0.7);
    const n = this.rowCount || 0;
    const ch = Math.min(9, this.rowH - 1);
    for (let i = 0; i < n; i++) {
      const y = 14 + i * this.rowH - 2;
      const pk = podiumKey(i);
      // zebra: every other row catches a hair more light
      if (i % 2 === 1) {
        g.fillStyle(pal.text, 0.035);
        g.fillRect(0, y, this.w, this.rowH);
      }
      if (pk && i !== this.highlightRow) {
        g.fillStyle(pal[pk], 0.08 - i * 0.015);
        g.fillRect(0, y, this.w, this.rowH);
        g.fillStyle(pal[pk], 0.9);
        g.fillRect(0, y, 2, this.rowH);
      }
      if (pk && i !== this.highlightRow) {
        // the numbered chip behind the rank digit
        const col = this.wide ? 6 : 4;
        g.fillStyle(pal[pk], 1);
        g.fillRect(col - 2, y + Math.floor((this.rowH - ch) / 2), 9, ch);
      }
    }
    if (this.highlightRow >= 0) {
      const y = 14 + this.highlightRow * this.rowH - 2;
      const k = 0.12 + 0.1 * Math.sin(this.pulse);
      g.fillStyle(pal.lime, k);
      g.fillRect(0, y, this.w, this.rowH);
      g.fillStyle(pal.lime, 0.55);
      g.fillRect(0, y, this.w, 1);
      g.fillRect(0, y + this.rowH - 1, this.w, 1);
      g.fillStyle(pal.lime, 1);
      g.fillRect(0, y, 2, this.rowH);
      g.fillRect(this.w - 2, y, 2, this.rowH);
    }
  }

  /** @param {number} delta ms @returns {void} */
  tick(delta) {
    if (this.highlightRow < 0) return;
    this.pulse += delta * 0.006;
    this._paintBars();
  }

  destroy(fromScene) {
    if (this._unbind) this._unbind();
    this._unbind = null;
    this.g = null;
    super.destroy(fromScene);
  }
}
