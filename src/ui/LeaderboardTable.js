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
   *          parent?:Phaser.GameObjects.Container}} o entries === null shows a loading message
   */
  constructor(scene, theme, o) {
    super(scene, o.x, o.y);
    this.theme = theme;
    this.w = o.w;
    this.rows = o.rows || 10;
    this.wide = o.wide !== undefined ? o.wide : o.w >= 330;
    this.g = new Phaser.GameObjects.Graphics(scene);
    this.add(this.g);
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
    return t;
  }

  /** @param {object[]|null} entries @param {string} [highlightId] @returns {void} */
  setEntries(entries, highlightId) {
    if (highlightId !== undefined) this.highlightId = highlightId;
    for (const c of this.cells || []) c.destroy();
    this.cells = [];
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
      this._cell(w / 2, 52, 'NO ENTRIES YET', 'amber', 'center');
      this._cell(w / 2, 66, 'FINISH A TOP-10 RUN TO CLAIM A SPOT', 'text', 'center').setAlpha(0.6);
    }
    list.forEach((e, i) => {
      const y = 14 + i * ROW_H;
      const hi = this.highlightId && e.id === this.highlightId;
      if (hi) this.highlightRow = i;
      const color = hi ? 'lime' : i === 0 ? 'amber' : 'text';
      this._cell(col.rank, y, String(i + 1), hi ? 'lime' : 'cyan');
      this._cell(col.ini, y, String(e.initials || '---').toUpperCase(), color);
      this._cell(col.score, y, fmtInt(e.score), hi ? 'lime' : 'amber', 'right');
      this._cell(col.dist, y, `${fmtInt(e.distanceM)}m`, color, 'right');
      if (this.wide) {
        this._cell(col.seed, y, ellipsize(String(e.seed || '-'), 96), color);
        this._cell(col.rule, y, ellipsize(ruleLabel(e.dailyRuleId), 84), e.dailyRuleId && e.dailyRuleId !== 'none' ? 'magenta' : 'text', 'right')
          .setAlpha(e.dailyRuleId && e.dailyRuleId !== 'none' ? 1 : 0.4);
      }
    });
    this._paintBars();
  }

  _paintBars() {
    if (!this.g) return;
    const pal = this.theme.pal;
    const g = this.g;
    g.clear();
    g.fillStyle(pal.cyan, 0.3);
    g.fillRect(0, 10, this.w, 1);
    if (this.highlightRow >= 0) {
      const y = 14 + this.highlightRow * ROW_H - 2;
      g.fillStyle(pal.lime, 0.12 + 0.1 * Math.sin(this.pulse));
      g.fillRect(0, y, this.w, ROW_H);
      g.fillStyle(pal.lime, 1);
      g.fillRect(0, y, 2, ROW_H);
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
