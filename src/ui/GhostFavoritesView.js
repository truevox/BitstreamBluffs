/** Game Over ghost lineup (#56/#81). Switch exact-course ghosts on or off for the next
 * run, and pin or clear Favorite A/B/C. Nothing starts a run or leaves the device.
 */
import { REG } from '../constants.js';
import { View } from './View.js';
import { NeonText } from './Neon.js';
import { Button } from './Button.js';
import { uiSfx } from './Sound.js';
import { fmtInt } from './Format.js';
import { ellipsize } from './PixelFont.js';
import { copyText } from './Clipboard.js';
import { createGhostLink, createGhostFile, GHOST_LINK_RECOMMENDED_URL, GhostLinkError } from '../systems/ghost/GhostLink.js';
import { GHOST_COURSE_ROWS, readGhostCourseRows } from './ghost-course-rows.js';

const ROW_Y = 49;
const ROW_H = 19;
const FAV_GAP = 6;

export class GhostFavoritesView extends View {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{library:import('../systems/ghost/GhostLibrary.js').GhostLibrary, tape:object, onClose:function():void}} o
   */
  constructor(scene, theme, o) {
    super(scene, theme, { w: 352, h: 194, title: 'COURSE GHOSTS', color: 'magenta', onClose: o.onClose,
      hints: [{ keys: ['↑', '↓'], label: 'ROW' }, { keys: ['←', '→'], label: 'SHOW' }, { keys: ['ENTER'], label: 'SELECT' }] });
    this.library = o.library;
    this.onEvidence = o.onEvidence || null;
    this.tape = o.tape;
    // Preserve the existing G, Enter shortcut for pinning Favorite A.
    this.focus = GHOST_COURSE_ROWS.findIndex(({ slot }) => slot === 0);
    this._refreshId = 0;
    this._busy = false;
    this._shareBusy = false;
    this._shareArmed = false;
    this._shareLink = null;
    this._shareFile = null;
    this._shareEpoch = 0;
    const text = (x, y, value, color = 'text') => this.panel.add(
      new NeonText(scene, theme, x, y, value, { color, outline: 'none' }));
    text(12, 22, `THIS RUN  ${fmtInt(this.tape.distanceM || 0)} M`);
    text(12, 34, 'FOR THE NEXT RUN ON THIS COURSE', 'cyan');
    text(314, 34, 'SHOW', 'cyan');
    this.rows = GHOST_COURSE_ROWS.map(({ label, slot }, i) => {
      const y = ROW_Y + i * ROW_H + (slot === undefined ? 0 : FAV_GAP);
      const mark = new NeonText(scene, theme, 6, y + 3, '>', { color: 'magenta', outline: 'none' });
      const name = new NeonText(scene, theme, 16, y + 3, label, { color: 'magenta', outline: 'none' });
      const info = new NeonText(scene, theme, 65, y + 3, 'LOADING', { color: 'text', outline: 'none' });
      const detail = new NeonText(scene, theme, 158, y + 3, '', { color: 'amber', outline: 'none' });
      const save = slot === undefined ? null : new Button(scene, theme, {
        x: 249, y, w: 56, h: 15, label: 'SAVE', color: 'lime', onClick: () => this._select(i, true),
      });
      const show = new Button(scene, theme, {
        x: 311, y, w: 29, h: 15, label: '...', color: 'cyan', onClick: () => this._select(i, false),
      });
      for (const item of [mark, name, info, detail, save, show]) if (item) this.panel.add(item);
      return { mark, info, detail, save, show };
    });
    text(12, 149, 'SHARED: DRAWS ONCE IF ANY ROLE CAN SHOW.');
    // #69 sharing and #244 private evidence coexist without overlapping the
    // fixed-size 352px panel: two distinct selectable footer actions.
    this.archiveButton = null;
    this.archiveArrow = null;
    if (this.onEvidence) {
      this.archiveButton = new Button(scene, theme, {
        x: 12, y: 157, w: 96, h: 15, label: 'LOCAL EVIDENCE', color: 'cyan',
        onClick: () => this._openEvidence(),
      });
      this.panel.add(this.archiveButton);
      text(115, 160, 'PRIVATE — NO UPLOAD', 'cyan');
      this.archiveArrow = new NeonText(scene, theme, 4, 160, '>', { color: 'cyan', outline: 'none' });
      this.panel.add(this.archiveArrow);
    } else text(12, 160, 'LINK SHARES INPUTS + SCORE.');
    this.shareBtn = new Button(scene, theme, {
      x: 249, y: 157, w: 92, h: 15, label: 'SHARE LINK', color: 'cyan',
      onClick: () => { this.focus = this.rows.length; this._markFocus(); this._shareGhost(); },
    });
    this.panel.add(this.shareBtn);
    this.shareArrow = new NeonText(scene, theme, 240, 160, '>', { color: 'cyan', outline: 'none' });
    this.panel.add(this.shareArrow);
    this.status = new NeonText(scene, theme, 12, this.h - 18, '', { color: 'lime', outline: 'none' });
    this.panel.add(this.status);
    this._markFocus();
    this._refresh();
  }

  _course() { return this.library.course(this.tape.seed, this.tape.biomeMask); }

  _markFocus() {
    this.rows.forEach(({ mark }, i) => mark.setVisible(i === this.focus));
    this.shareArrow?.setVisible(this.focus === this.rows.length);
    this.shareBtn?.setHover(this.focus === this.rows.length);
    this.archiveArrow?.setVisible(this.focus === this.rows.length + 1);
    this.archiveButton?.setHover(this.focus === this.rows.length + 1);
  }

  _openEvidence() {
    if (!this.archiveButton || !this.onEvidence || !this.alive) return;
    this._disarmShare(); // A prepared ghost URL must not outlive navigation.
    this.focus = this.rows.length + 1;
    this._markFocus();
    this.onEvidence();
  }

  _select(i, save) {
    this._disarmShare();
    this.focus = i;
    this._markFocus();
    return save ? this._save(i) : this._toggle(i);
  }

  /** An explicit two-press copy action: no auto-uploads, no official credit.
   * First press only PREPARES and discloses the URL data; second press copies.
   * The URL contains the player's input actions, equipment and score.
   */
  _disarmShare() {
    this._shareEpoch++;
    this._shareArmed = false;
    this._shareLink = null;
    this._shareFile = null;
    this.shareBtn?.setLabel('SHARE LINK');
  }

  async _shareGhost() {
    if (this._busy || this._shareBusy || !this.alive) return;
    if (!this._shareArmed) {
      this._shareBusy = true;
      const epoch = ++this._shareEpoch;
      this.shareBtn.setDisabled(true);
      this.status.setText('PREPARING PRIVATE GHOST LINK');
      try {
        // Never propagate current-path route parameters or private path
        // tokens. Sharing must go to the build's public base, not the
        // possibly user-specific address currently in the omnibox.
        const publicBase = new URL(import.meta.env.BASE_URL, location.origin).href;
        const link = await createGhostLink(this.tape, publicBase);
        if (!this.alive || epoch !== this._shareEpoch) return;
        this._shareArmed = true;
        this._shareLink = link;
        this.shareBtn.setLabel('COPY LINK');
        this.status.setText('SHARES INPUTS + SCORE. SELECT AGAIN.');
      } catch (e) {
        if (!this.alive || epoch !== this._shareEpoch) return;
        if (e instanceof GhostLinkError && e.code === 'url-too-long') {
          // Never upload, truncate, or copy a broken 8k+ URL. A separate
          // local download is prepared only after the user's first action.
          // Still requires the SECOND deliberate user activation to download.
          try {
            const file = await createGhostFile(this.tape);
            if (!this.alive || epoch !== this._shareEpoch) return;
            this._shareArmed = true;
            this._shareFile = file;
            this.shareBtn.setLabel('SAVE FILE');
            this.status.setText('FILE SHARES INPUTS + SCORE. SELECT AGAIN.');
          } catch {
            if (!this.alive || epoch !== this._shareEpoch) return;
            this._disarmShare();
            this.status.setText('GHOST TOO LARGE EVEN FOR LOCAL FILE');
          }
        } else {
          this._disarmShare();
          this.status.setText('CANNOT SHARE THIS GHOST');
        }
      } finally {
        this._shareBusy = false;
        if (this.alive) this.shareBtn.setDisabled(false);
      }
      return;
    }
    // Download/clipboard permission is gesture-sensitive. This code starts
    // the browser request directly inside the SECOND user event, with no
    // await, redirect, network call or access to the sender's private path.
    const link = this._shareLink, file = this._shareFile;
    this._disarmShare();
    this._shareBusy = true;
    this.shareBtn.setDisabled(true);
    try {
      if (file) {
        let url = null;
        try {
          url = URL.createObjectURL(new Blob([file.bytes], {type:'application/octet-stream'}));
          const a = document.createElement('a');
          a.href = url;
          a.download = file.filename;
          a.style.display = 'none';
          document.body.appendChild(a);
          try { a.click(); } finally { a.remove(); }
          // A requested browser download is not proof that the user saved
          // the file; do not report a cloud share or durable export.
          this.status.setText('LOCAL FILE DOWNLOAD REQUESTED - NO UPLOAD');
          uiSfx(this.scene, 'uiSelect');
        } catch {
          // Blocked object URLs/CSP/download restrictions must not produce an
          // unhandled rejected Button promise or a false saved-file claim.
          if(this.alive)this.status.setText('LOCAL DOWNLOAD BLOCKED - FILE NOT SAVED');
          uiSfx(this.scene, 'uiBack');
        } finally {if(url)setTimeout(()=>URL.revokeObjectURL(url),15000);}
        return;
      }
      const copied = await copyText(link);
      if (!this.alive) return;
      this.status.setText(!copied ? 'CLIPBOARD BLOCKED: NO LINK COPIED'
        : link.length > GHOST_LINK_RECOMMENDED_URL
          ? 'LONG LINK COPIED: SOME APPS TRUNCATE' : 'UNVERIFIED PRACTICE LINK COPIED');
      uiSfx(this.scene, copied ? 'uiSelect' : 'uiBack');
    } finally {
      this._shareBusy = false;
      if (this.alive) this.shareBtn.setDisabled(false);
    }
  }

  async _refresh() {
    const id = ++this._refreshId;
    const settings = this.scene.registry.get(REG.SETTINGS) || {};
    const models = await readGhostCourseRows(this.library, this.tape, settings);
    if (!this.alive || id !== this._refreshId) return;
    // A full capacity gate blocks only this new course's GHOST save. Do not
    // imply the RunRecord/protected replay evidence were erased or credited.
    if (!this._course() && this.library.archiveStatus?.().lastFailure === 'full')
      this.status.setText('ARCHIVE FULL - SHOP > UPGRADES > COURSE SLOTS');
    for (let i = 0; i < models.length; i++) {
      const row = this.rows[i], model = models[i];
      row.info.setText(ellipsize(model.info, 88));
      row.detail.setText(model.globalOff ? (model.shared ? 'OFF IN SETTINGS / SHARED' : 'OFF IN SETTINGS') : model.shared ? 'SHARED RUN' : '');
      row.save?.setLabel(model.saveLabel);
      row.show.setLabel(model.on ? 'ON' : 'OFF');
    }
  }

  async _save(i) {
    const { slot, label } = GHOST_COURSE_ROWS[i];
    if (this._busy || slot === undefined) return;
    this._busy = true;
    try {
      const clearing = this._course()?.favorites?.[slot] === this.tape.runId;
      const done = await this.library.setFavorite(this.tape.seed, this.tape.biomeMask, slot, clearing ? null : this.tape.runId);
      if (!this.alive) return;
      uiSfx(this.scene, done ? 'uiSelect' : 'uiBack');
      this.status.setText(done ? (clearing ? `${label} CLEARED` : `SAVED AS ${label}`) : 'COULD NOT SAVE THIS GHOST');
      await this._refresh();
    } finally { this._busy = false; }
  }

  async _toggle(i) {
    const { role, label } = GHOST_COURSE_ROWS[i];
    if (this._busy) return;
    this._busy = true;
    try {
      const on = this._course()?.show?.[role] === false;
      const done = await this.library.setShow(this.tape.seed, this.tape.biomeMask, role, on);
      if (!this.alive) return;
      uiSfx(this.scene, done ? 'uiMove' : 'uiBack');
      this.status.setText(done ? `${label} ${on ? 'ON' : 'OFF'} FOR THIS COURSE` : 'NO COURSE TO UPDATE');
      await this._refresh();
    } finally { this._busy = false; }
  }

  handleAction(action) {
    if (action === 'cancel' || action === 'ghost') { this.close(); return true; }
    if (action === 'up' || action === 'down') {
      this._disarmShare();
      const available = this.rows.length + 1 + (this.archiveButton ? 1 : 0);
      this.focus = (this.focus + (action === 'up' ? -1 : 1) + available) % available;
      uiSfx(this.scene, 'uiMove');
      this._markFocus();
    } else if (action === 'confirm') {
      if (this.focus === this.rows.length) this._shareGhost();
      else if (this.archiveButton && this.focus === this.rows.length + 1) this._openEvidence();
      else this._select(this.focus, GHOST_COURSE_ROWS[this.focus].slot !== undefined);
    } else if ((action === 'left' || action === 'right') && this.focus < this.rows.length) this._toggle(this.focus);
    return true;
  }
}
