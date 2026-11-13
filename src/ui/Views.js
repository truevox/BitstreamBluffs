/**
 * OWNER: UI engineer.
 * Modal sub-screens shared by TitleScene and PauseScene: leaderboard, settings, seed entry, sharecode export/import.
 * A view is a Panel plus content; the host scene feeds it MenuInput actions via handleAction(). Each view calls
 * `onClose()` when the player backs out. destroy() removes everything it created (DOM boxes included).
 */
import Phaser from 'phaser';
import { REG, GAME_WIDTH, GAME_HEIGHT } from '../constants.js';
import { updateSetting } from '../services.js';
import { Panel } from './Panel.js';
import { NeonText } from './Neon.js';
import { Button } from './Button.js';
import { MenuList } from './MenuList.js';
import { LeaderboardTable } from './LeaderboardTable.js';
import { DomTextBox } from './DomTextBox.js';
import { copyText } from './Clipboard.js';
import { uiSfx } from './Sound.js';
import { ellipsize } from './PixelFont.js';
import { profileLayout } from './ProfileLayout.js';

/** Base: centred panel with a BACK button. */
class View {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{w:number,h:number,title:string,color?:string,onClose:function():void,y?:number,backLabel?:string}} o
   */
  constructor(scene, theme, o) {
    this.scene = scene;
    this.theme = theme;
    this.onClose = o.onClose;
    this.alive = true;
    const x = Math.round((GAME_WIDTH - o.w) / 2);
    const y = o.y !== undefined ? o.y : Math.round((GAME_HEIGHT - o.h) / 2);
    this.panel = new Panel(scene, theme, { x, y, w: o.w, h: o.h, title: o.title, color: o.color || 'cyan', fillAlpha: 1 });
    this.panel.setDepth(500);
    this.w = o.w;
    this.h = o.h;
    this.back = new Button(scene, theme, {
      x: o.w - 76, y: o.h - 22, w: 68, h: 16, label: o.backLabel || 'BACK', color: 'magenta', onClick: () => this.close(),
    });
    this.panel.add(this.back);
  }

  close() {
    uiSfx(this.scene, 'uiBack');
    if (this.alive) this.onClose();
  }

  handleAction(action) {
    if (action === 'cancel') this.close();
    return true;
  }

  destroy() {
    this.alive = false;
    if (this.panel) this.panel.destroy();
    this.panel = null;
  }
}

/** Top-10 leaderboard from SaveStore. */
export class LeaderboardView extends View {
  /** @param {Phaser.Scene} scene @param {import('./Theme.js').Theme} theme @param {{onClose:function():void}} o */
  constructor(scene, theme, o) {
    super(scene, theme, { w: 440, h: 178, title: 'LEDGER // TOP 10 ON THIS DEVICE', color: 'cyan', onClose: o.onClose, y: 40 });
    this.table = new LeaderboardTable(scene, theme, { x: 12, y: 24, w: 416, entries: null, parent: this.panel });
    this.panel.add(new NeonText(scene, theme, 12, this.h - 18, 'ONE LEDGER PER DEVICE. MAGENTA RULE FLAG = DAILY PATCH ACTIVE.', {
      color: 'text', outline: 'none',
    }).setAlpha(0.55));
    const store = scene.registry.get(REG.SAVE_STORE);
    Promise.resolve(store.getLeaderboard(10)).then((rows) => {
      if (this.alive) this.table.setEntries(rows || []);
    }).catch(() => {
      if (this.alive) this.table.setEntries([]);
    });
  }
}

/** Settings: palette, screen shake, volumes, tilt controls (persisted via updateSetting). */
export class SettingsView extends View {
  /** @param {Phaser.Scene} scene @param {import('./Theme.js').Theme} theme @param {{onClose:function():void}} o */
  constructor(scene, theme, o) {
    super(scene, theme, { w: 320, h: 186, title: 'SETTINGS', color: 'amber', onClose: o.onClose, y: 40, backLabel: 'DONE' });
    const game = scene.game;
    const s = () => game.registry.get(REG.SETTINGS) || {};
    const items = [
      { kind: 'choice', label: 'PALETTE', options: [{ value: 'default', label: 'NEON' }, { value: 'colorblind', label: 'COLOR-BLIND' }],
        get: () => s().palette, set: (v) => updateSetting(game, 'palette', v) },
      { kind: 'choice', label: 'SCREEN SHAKE', options: [{ value: true, label: 'ON' }, { value: false, label: 'OFF' }],
        get: () => s().screenShake !== false, set: (v) => updateSetting(game, 'screenShake', v) },
      { kind: 'slider', label: 'MASTER VOLUME', get: () => s().masterVolume, set: (v) => updateSetting(game, 'masterVolume', v) },
      { kind: 'slider', label: 'MUSIC VOLUME', get: () => s().musicVolume, set: (v) => updateSetting(game, 'musicVolume', v) },
      { kind: 'slider', label: 'SFX VOLUME', get: () => s().sfxVolume, set: (v) => updateSetting(game, 'sfxVolume', v) },
      { kind: 'choice', label: 'TILT CONTROLS (90)', options: [{ value: false, label: 'OFF' }, { value: true, label: 'ON' }],
        get: () => !!s().touchRotate90, set: (v) => updateSetting(game, 'touchRotate90', v) },
      { kind: 'choice', label: 'TOUCH BUTTONS', options: [{ value: 'auto', label: 'AUTO' }, { value: 'on', label: 'ON' }, { value: 'off', label: 'OFF' }],
        get: () => s().touchOverlay || 'auto', set: (v) => updateSetting(game, 'touchOverlay', v) },
    ];
    this.menu = new MenuList(scene, theme, { x: 10, y: 22, w: 300, rowH: 16, items, color: 'amber', parent: this.panel });
    this.panel.add(new NeonText(scene, theme, 104, this.h - 17, 'PALETTE PREVIEW', { color: 'text', outline: 'none' }).setAlpha(0.5));
    this.swatch = scene.add.graphics();
    this.panel.add(this.swatch);
    this.unbindSwatch = theme.bind((pal) => {
      const g = this.swatch;
      g.clear();
      ['cyan', 'magenta', 'lime', 'amber'].forEach((k, i) => {
        g.fillStyle(pal[k], 1);
        g.fillRect(10 + i * 22, this.h - 20, 18, 12);
        g.fillStyle(pal.bg, 1);
        g.fillRect(12 + i * 22, this.h - 18, 14, 8);
        g.fillStyle(pal[k], 1);
        g.fillRect(14 + i * 22, this.h - 16, 10, 4);
      });
    });
  }

  handleAction(action) {
    if (action === 'cancel') {
      this.close();
      return true;
    }
    return this.menu.handleAction(action);
  }

  destroy() {
    if (this.unbindSwatch) this.unbindSwatch();
    super.destroy();
  }
}

/** Free-text seed entry (DOM input so touch keyboards work). */
export class SeedView extends View {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{onClose:function():void, onSubmit:function(string):void, initial?:string}} o
   */
  constructor(scene, theme, o) {
    super(scene, theme, { w: 340, h: 118, title: 'ENTER SEED', color: 'lime', onClose: o.onClose, y: 70 });
    this.onSubmit = o.onSubmit;
    const px = this.panel.x;
    const py = this.panel.y;
    this.panel.add(new NeonText(scene, theme, 12, 24, 'SAME SEED = SAME TRACK. SHARE IT WITH FRIENDS.', { color: 'text', outline: 'none' }).setAlpha(0.7));
    this.box = new DomTextBox(scene, theme, {
      x: px + 12, y: py + 40, w: 316, h: 20, value: o.initial || '', maxLength: 32, placeholder: 'TYPE A SEED (EMPTY = RANDOM)',
      color: 'lime', onSubmit: () => this.submit(), onCancel: () => this.close(),
    });
    this.panel.add(new NeonText(scene, theme, 12, 68, 'ENTER = GO     ESC = BACK', { color: 'text', outline: 'none' }).setAlpha(0.55));
    this.go = new Button(scene, theme, { x: 12, y: this.h - 22, w: 96, h: 16, label: 'GO!', color: 'lime', onClick: () => this.submit() });
    this.panel.add(this.go);
    scene.time.delayedCall(30, () => this.alive && this.box.focus());
  }

  submit() {
    if (this.alive) this.onSubmit(this.box.getValue().trim());
  }

  handleAction(action) {
    if (action === 'cancel') this.close();
    else if (action === 'confirm') this.submit();
    return true;
  }

  destroy() {
    if (this.box) this.box.destroy();
    this.box = null;
    super.destroy();
  }
}

/** Export (copy + visible fallback) or import (paste) of the leaderboard sharecode. */
export class SharecodeView extends View {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{mode:'export'|'import', onClose:function():void}} o
   */
  constructor(scene, theme, o) {
    const exp = o.mode === 'export';
    super(scene, theme, { w: 400, h: 168, title: exp ? 'EXPORT SHARECODE' : 'IMPORT SHARECODE', color: exp ? 'cyan' : 'lime', onClose: o.onClose, y: 50 });
    this.exp = exp;
    this.store = scene.registry.get(REG.SAVE_STORE);
    const px = this.panel.x;
    const py = this.panel.y;
    this.hint = new NeonText(scene, theme, 12, 22, exp ? 'YOUR LEDGER AS TEXT. COPY IT, SEND IT, IMPORT IT ELSEWHERE.' : 'PASTE A SHARECODE BELOW (CTRL+V), THEN PRESS IMPORT.', {
      color: 'text', outline: 'none',
    });
    this.hint.setAlpha(0.7);
    this.panel.add(this.hint);
    this.status = new NeonText(scene, theme, 12, this.h - 38, exp ? 'PREPARING...' : 'WAITING FOR PASTE', { color: 'amber', outline: 'none' });
    this.panel.add(this.status);
    this.box = new DomTextBox(scene, theme, {
      x: px + 12, y: py + 36, w: 376, h: 76, multiline: true, readOnly: exp, value: '',
      placeholder: exp ? '' : 'PASTE SHARECODE HERE', color: exp ? 'cyan' : 'lime',
      onSubmit: () => this.act(), onCancel: () => this.close(),
    });
    this.actBtn = new Button(scene, theme, {
      x: 12, y: this.h - 22, w: 110, h: 16, label: exp ? 'COPY AGAIN' : 'IMPORT', color: exp ? 'cyan' : 'lime', onClick: () => this.act(),
    });
    this.panel.add(this.actBtn);
    scene.time.delayedCall(30, () => this.alive && this.box && this.box.focus());
    if (exp) this._load();
  }

  async _load() {
    let code = '';
    try {
      code = await this.store.exportSharecode();
    } catch (e) {
      code = '';
    }
    if (!this.alive) return;
    this.code = code || '';
    if (!this.code) {
      this.box.setValue('(LEDGER IS EMPTY - NOTHING TO EXPORT YET)');
      this.setStatus('NO ENTRIES TO EXPORT', 'amber');
      return;
    }
    this.box.setValue(this.code);
    this.box.selectAll();
    this.act();
  }

  setStatus(text, color) {
    if (!this.alive) return;
    this.status.setText(ellipsize(text, 380));
    this.status.setColorKey(color);
  }

  async act() {
    if (!this.alive) return;
    if (this.exp) {
      if (!this.code) return;
      const ok = await copyText(this.code);
      if (!this.alive) return;
      if (ok) this.setStatus('COPIED TO CLIPBOARD', 'lime');
      else {
        this.setStatus('CLIPBOARD BLOCKED - TEXT SELECTED: PRESS CTRL+C', 'amber');
        this.box.selectAll();
      }
    } else {
      const text = this.box.getValue().trim();
      if (!text) {
        this.setStatus('NOTHING TO IMPORT - PASTE A SHARECODE FIRST', 'amber');
        return;
      }
      let res = { imported: 0, skipped: 0 };
      try {
        res = (await this.store.importSharecode(text)) || res;
      } catch (e) {
        res = { imported: 0, skipped: 1 };
      }
      if (!this.alive) return;
      if (res.imported > 0) this.setStatus(`IMPORTED ${res.imported} RUN(S), SKIPPED ${res.skipped}`, 'lime');
      else this.setStatus(`NOTHING IMPORTED (SKIPPED ${res.skipped}) - NOT A VALID SHARECODE?`, 'danger');
    }
  }

  handleAction(action) {
    if (action === 'cancel') this.close();
    else if (action === 'confirm') this.act();
    return true;
  }

  destroy() {
    if (this.box) this.box.destroy();
    this.box = null;
    super.destroy();
  }
}

/**
 * W1: PROFILE view — lifetime stats, Sync Level, Resonance progress, and the list of biome
 * signatures the player has reached (locked ones read "SIGNATURE LOCKED - COMING ONLINE" until
 * W3/W6 ship the biomes themselves). Read-only; nothing here writes the profile.
 *
 * All geometry and text come from `ProfileLayout.profileLayout()` so the layout is unit-tested for
 * overlap and contrast without Phaser; this class only draws it and repaints on palette change.
 */
export class ProfileView extends View {
  /** @param {Phaser.Scene} scene @param {import('./Theme.js').Theme} theme @param {{onClose:function():void}} o */
  constructor(scene, theme, o) {
    const layout = profileLayout({
      profile: scene.registry.get(REG.PROFILE),
      levels: (scene.registry.get(REG.CONTENT) || {}).progression,
    });
    super(scene, theme, { w: layout.w, h: layout.h, title: 'PILOT PROFILE', color: 'lime', onClose: o.onClose, y: 22, backLabel: 'BACK' });

    for (const it of layout.items) {
      // Layout boxes are always top-left, so draw left-anchored and never let Phaser re-apply an
      // origin: passing anchor:'right' with a left edge shifted right-aligned text a second time.
      const t = new NeonText(scene, theme, it.x, it.y, it.text, {
        color: it.color, outline: it.outline, alpha: it.alpha,
      });
      this.panel.add(t);
    }

    // Resonance bar: XP progress inside the current level. Same paint as Game Over, so a player who
    // just levelled sees the same fill they saw there.
    const b = layout.bar;
    const bar = scene.add.graphics();
    this.panel.add(bar);
    this.unbindBar = theme.bind((pal) => {
      bar.clear();
      bar.fillStyle(pal.bg, 1);
      bar.fillRect(b.x, b.y, b.w, b.h);
      bar.fillStyle(pal[b.color], 1);
      bar.fillRect(b.x + 1, b.y + 1, Math.round((b.w - 2) * b.ratio), b.h - 2);
      bar.lineStyle(1, pal[b.color], 0.9);
      bar.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    });
  }

  handleAction(action) {
    if (action === 'cancel' || action === 'confirm') this.close();
    return true;
  }

  destroy() {
    if (this.unbindBar) this.unbindBar();
    this.unbindBar = null;
    super.destroy();
  }
}
