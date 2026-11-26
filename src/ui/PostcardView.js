/**
 * #67: the postcard the player just made at the takeover READY screen. Shows the plain-language challenge, the code (read-only,
 * selectable), COPY (navigator.clipboard) and SAVE FILE (a local Blob download, `.bbpostcard`), and the window length (5-10 s).
 * Everything is local: no network, no upload, no storage. Always labelled UNRANKED PRACTICE.
 */
import { View } from './View.js';
import { DomTextBox } from './DomTextBox.js';
import { NeonText } from './Neon.js';
import { Button } from './Button.js';
import { copyText, saveFile, shareFilename, shareLines, WINDOW_RANGE_SEC } from '../systems/replay/PostcardShare.js';

export const POSTCARD_BANNER = 'UNRANKED PRACTICE: NOT LEADERBOARD ELIGIBLE';

export class PostcardView extends View {
  /**
   * @param {Phaser.Scene} scene @param {import('./Theme.js').Theme} theme
   * @param {{share:{postcard:object, code:string}|null, windowSec:number, rebuild:function(number):Promise<object>, onClose:function():void}} o
   */
  constructor(scene, theme, o) {
    super(scene, theme, { w: 420, h: 226, y: 22, title: 'POSTCARD', color: 'amber', onClose: o.onClose,
      hints: [{ keys: ['←', '→'], label: 'WINDOW' }, { keys: ['ESC'], label: 'BACK' }], hintsAt: 'foot' });
    this.rebuild = o.rebuild;
    this.windowSec = o.windowSec;
    this.share = null;
    this.token = 0;
    const text = (x, y, value, color = 'text') => { const t = new NeonText(scene, theme, x, y, value, { color, outline: 'none' }); this.panel.add(t); return t; };
    this.banner = text(12, 22, POSTCARD_BANNER, 'amber');
    this.lines = [0, 1, 2, 3, 4, 5, 6].map((i) => text(12, 34 + i * 10, '', i === 0 ? 'cyan' : 'text'));
    this.status = text(12, 152, 'ENCODING...', 'lime');
    this.box = new DomTextBox(scene, theme, {
      x: this.panel.x + 12, y: this.panel.y + 106, w: 396, h: 42, readOnly: true, multiline: true, maxLength: 400000, value: '', placeholder: 'ENCODING...',
      color: 'amber', onCancel: () => this.close(),
      onShortcut: (e) => { if (e.key === 'ArrowLeft') { this.setWindow(this.windowSec - 1); return true; } if (e.key === 'ArrowRight') { this.setWindow(this.windowSec + 1); return true; } return false; },
    });
    this.copyBtn = new Button(scene, theme, { x: 12, y: 168, w: 92, h: 16, label: 'COPY', color: 'lime', onClick: () => this.copy() });
    this.saveBtn = new Button(scene, theme, { x: 110, y: 168, w: 112, h: 16, label: 'SAVE FILE', color: 'cyan', onClick: () => this.save() });
    this.lessBtn = new Button(scene, theme, { x: 232, y: 168, w: 26, h: 16, label: '<', color: 'amber', onClick: () => this.setWindow(this.windowSec - 1) });
    this.winText = text(264, 172, '', 'amber');
    this.moreBtn = new Button(scene, theme, { x: 340, y: 168, w: 26, h: 16, label: '>', color: 'amber', onClick: () => this.setWindow(this.windowSec + 1) });
    for (const b of [this.copyBtn, this.saveBtn, this.lessBtn, this.moreBtn]) this.panel.add(b);
    text(12, 190, 'SENDS NOTHING ANYWHERE: COPY OR SAVE, THEN SHARE IT YOURSELF', 'text');
    this._paintWindow();
    this.setShare(o.share);
    scene.time.delayedCall(30, () => { if (this.alive && this.box) this.box.focus(); });
  }

  _paintWindow() { this.winText.setText(`WINDOW ${this.windowSec} S`); }

  /** @param {{ok:boolean, postcard?:object, code?:string, message?:string}|null} share */
  setShare(share) {
    if (!this.alive) return;
    this.share = share && share.ok ? share : null;
    if (!this.share) {
      this.lines.forEach((l, i) => l.setText(i === 0 ? 'COULD NOT MAKE A POSTCARD' : ''));
      if (share && share.message) this.lines[1].setText(String(share.message).toUpperCase().slice(0, 64));
      this.box.setValue('');
      this.status.setText('NOTHING TO SHARE');
      this.copyBtn.setDisabled(true); this.saveBtn.setDisabled(true);
      return;
    }
    const rows = shareLines(this.share.postcard);
    this.lines.forEach((l, i) => l.setText(rows[i] || ''));
    this.box.setValue(this.share.code);
    this.status.setText(`CODE READY: ${this.share.code.length} CHARACTERS`);
    this.copyBtn.setDisabled(false); this.saveBtn.setDisabled(false);
  }

  /** Change the window (clamped to 5..10 s) and re-encode. */
  async setWindow(sec) {
    const [lo, hi] = WINDOW_RANGE_SEC;
    const next = Math.max(lo, Math.min(hi, Math.round(sec)));
    if (!this.alive || next === this.windowSec) return;
    this.windowSec = next;
    this._paintWindow();
    const token = ++this.token;
    this.status.setText('ENCODING...');
    this.share = null;
    this.box.setValue('');
    this.copyBtn.setDisabled(true); this.saveBtn.setDisabled(true);
    let share;
    try { share = await this.rebuild(next); }
    catch (e) { share = { ok: false, message: 'could not encode this postcard' }; }
    if (token === this.token) this.setShare(share);
  }

  async copy() {
    if (!this.share) return;
    const r = await copyText(this.share.code, typeof navigator !== 'undefined' ? navigator : undefined);
    if (!this.alive) return;
    if (r.ok) this.status.setText('COPIED TO CLIPBOARD');
    else { this.status.setText(String(r.message || 'COPY FAILED').toUpperCase().slice(0, 64)); this.box.selectAll(); }
  }

  save() {
    if (!this.share) return;
    const r = saveFile(this.share.code, shareFilename(this.share.postcard), { document, URL, Blob });
    this.status.setText(r.ok ? `SAVED ${shareFilename(this.share.postcard)}` : String(r.message || 'SAVE FAILED').toUpperCase().slice(0, 64));
  }

  destroy() {
    this.token++;
    try { if (this.box) this.box.destroy(); } catch (e) { /* already gone */ }
    this.box = null;
    super.destroy();
  }
}
