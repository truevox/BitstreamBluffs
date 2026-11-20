/** Ghost favorites (issue #56): pin the run that just ended into Favorite A/B/C of its course,
 * replace or clear a slot, and switch each favorite ghost on or off. Opened from Game Over
 * (GHOST FAV button or G). Everything is local; nothing is uploaded.
 */
import { View } from './Views.js';
import { NeonText } from './Neon.js';
import { Button } from './Button.js';
import { uiSfx } from './Sound.js';
import { fmtInt } from './Format.js';
import { FAVORITE_SLOTS } from '../systems/ghost/GhostLibrary.js';

const SLOT_NAMES = ['A', 'B', 'C'];
const ROW_Y = 40;
const ROW_H = 18;

/** Text for a favorite slot: empty, this run, or the pinned run's distance and date. */
export function favoriteSlotLabel(runId, tape, thisRunId) {
  if (!runId) return 'EMPTY';
  if (runId === thisRunId) return 'THIS RUN';
  if (!tape) return 'SAVED RUN';
  const d = new Date(tape.endedAt || 0);
  return `${fmtInt(tape.distanceM || 0)} M  ${d.getMonth() + 1}/${d.getDate()}`;
}

export class GhostFavoritesView extends View {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{library:import('../systems/ghost/GhostLibrary.js').GhostLibrary, tape:object, onClose:function():void}} o
   */
  constructor(scene, theme, o) {
    super(scene, theme, { w: 300, h: 40 + FAVORITE_SLOTS * ROW_H + 34, title: 'GHOST FAVORITES', color: 'magenta', onClose: o.onClose,
      hints: [{ keys: ['ENTER'], label: 'SAVE' }, { keys: ['←', '→'], label: 'ON/OFF' }] });
    this.library = o.library;
    this.tape = o.tape;
    this.focus = 0;
    this.panel.add(new NeonText(scene, theme, 12, 22, `THIS RUN  ${fmtInt(this.tape.distanceM || 0)} M`, { color: 'text', outline: 'none' }).setAlpha(0.8));
    this.rows = SLOT_NAMES.slice(0, FAVORITE_SLOTS).map((name, i) => {
      const y = ROW_Y + i * ROW_H;
      const mark = new NeonText(scene, theme, 6, y + 3, '>', { color: 'magenta', outline: 'none' });
      const label = new NeonText(scene, theme, 16, y + 3, `FAV ${name}`, { color: 'magenta', outline: 'none' });
      const info = new NeonText(scene, theme, 66, y + 3, '', { color: 'text', outline: 'none' });
      const save = new Button(scene, theme, { x: 170, y, w: 60, h: 14, label: 'SAVE', color: 'lime', onClick: () => { this.focus = i; this._save(i); } });
      const show = new Button(scene, theme, { x: 236, y, w: 52, h: 14, label: 'ON', color: 'cyan', onClick: () => { this.focus = i; this._toggle(i); } });
      for (const o2 of [mark, label, info, save, show]) this.panel.add(o2);
      return { mark, info, save, show };
    });
    this.status = new NeonText(scene, theme, 12, this.h - 18, '', { color: 'lime', outline: 'none' });
    this.panel.add(this.status);
    this._refresh();
  }

  _course() { return this.library.course(this.tape.seed, this.tape.biomeMask); }

  async _refresh() {
    const course = this._course();
    for (let i = 0; i < this.rows.length; i++) {
      const runId = course?.favorites?.[i] || null;
      const tape = runId ? await this.library.getTape(runId) : null;
      if (!this.alive) return;
      const r = this.rows[i];
      r.info.setText(favoriteSlotLabel(runId, tape, this.tape.runId));
      r.save.setLabel(runId === this.tape.runId ? 'CLEAR' : runId ? 'REPLACE' : 'SAVE');
      r.show.setLabel(course?.show?.[`fav${i}`] === false ? 'OFF' : 'ON');
      r.mark.setVisible(i === this.focus);
    }
  }

  async _save(i) {
    const course = this._course();
    const clearing = course?.favorites?.[i] === this.tape.runId;
    const done = await this.library.setFavorite(this.tape.seed, this.tape.biomeMask, i, clearing ? null : this.tape.runId);
    if (!this.alive) return;
    uiSfx(this.scene, done ? 'uiSelect' : 'uiBack');
    this.status.setText(done ? (clearing ? `FAV ${SLOT_NAMES[i]} CLEARED` : `SAVED AS FAV ${SLOT_NAMES[i]}`) : 'COULD NOT SAVE THIS GHOST');
    this._refresh();
  }

  async _toggle(i) {
    const role = `fav${i}`;
    const on = this._course()?.show?.[role] !== false;
    await this.library.setShow(this.tape.seed, this.tape.biomeMask, role, !on);
    if (!this.alive) return;
    uiSfx(this.scene, 'uiMove');
    this._refresh();
  }

  handleAction(action) {
    if (action === 'cancel' || action === 'ghost') { this.close(); return true; }
    if (action === 'up' || action === 'down') {
      this.focus = (this.focus + (action === 'up' ? -1 : 1) + this.rows.length) % this.rows.length;
      uiSfx(this.scene, 'uiMove');
      this._refresh();
    } else if (action === 'confirm') this._save(this.focus);
    else if (action === 'left' || action === 'right') this._toggle(this.focus);
    return true;
  }
}
