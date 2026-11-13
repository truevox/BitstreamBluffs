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
import { achievementsLayout, clampPage } from './AchievementsLayout.js';
import { ACHIEVEMENTS } from '../systems/Achievements.js';
import { shopLayout, shopMenuItems } from './ShopLayout.js';
import { toggleBiome, biomeToggleRows, purchase, equip, isOwned } from '../systems/ProfileStore.js';

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
    // W4: two boards. The clean board is what the game has always shown; the modded board is where a
    // boosted run goes instead of vanishing. Both come from SaveStore, both decide through Ranking.js, so
    // this view never tests `modded` itself.
    this.store = scene.registry.get(REG.SAVE_STORE);
    this.showingModded = false;
    this.emptyText = null;
    this.tabBtn = new Button(scene, theme, {
      x: this.w - 148, y: this.h - 24, w: 68, h: 16, label: 'MODDED', color: 'amber',
      onClick: () => this._toggleBoard(),
    });
    this.panel.add(this.tabBtn);
    this._loadBoard();
  }

  _loadBoard() {
    const store = this.store;
    if (!store) { this.table.setEntries([]); return; }
    const p = this.showingModded
      ? Promise.resolve(store.getModdedLeaderboard(10))
      : Promise.resolve(store.getLeaderboard(10));
    p.then((rows) => {
      if (!this.alive) return;
      this.table.setEntries(rows || []);
      // An empty modded board must say WHY it is empty, or it reads as a bug rather than as "no boosted
      // runs yet".
      if (!rows || rows.length === 0) {
        this.emptyText = `NO ${this.showingModded ? 'MODDED' : 'CLEAN'} RUNS RECORDED YET`;
      }
    }).catch(() => {
      if (this.alive) this.table.setEntries([]);
    });
    this.tabBtn.setLabel(this.showingModded ? 'CLEAN' : 'MODDED');
  }

  _toggleBoard() {
    this.showingModded = !this.showingModded;
    uiSfx(this.scene, 'uiSelect');
    this._loadBoard();
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
    const content = scene.registry.get(REG.CONTENT) || {};
    const biomeDefs = Object.values(content.biomes || {});
    const layout = profileLayout({
      profile: scene.registry.get(REG.PROFILE),
      levels: content.progression,
      playableBiomeIds: biomeDefs.map((d) => d.id),
      achievementTotal: ACHIEVEMENTS.length,
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

    // W3: signature toggles. Only unlocked biomes get a row, and toggling one persists the profile so a
    // player's choice survives a reload. Toggling is cosmetic-adjacent but real: it changes which biome
    // sectors their next run can contain, which is why mask-scoped stats exist.
    // SHARD SHOP moved here from the Title menu: Title's band physically fits six 2x rows and the shop
    // was the seventh (it overran the DAILY PATCH strip). It sits on this screen because Profile is where
    // you already look at what you own and what it looks like.
    if (layout.shopButton) {
      const sb = layout.shopButton;
      this.shopButton = new Button(scene, theme, {
        x: sb.x, y: sb.y, w: sb.w, h: sb.h, label: 'SHARD SHOP', color: 'amber',
        onClick: () => { this.close(); o.onShop && o.onShop(); },
      });
      this.panel.add(this.shopButton);
    }

    this.biomeDefs = biomeDefs;
    const service = scene.registry.get(REG.PROGRESSION);
    this.profileStore = (service && service.store) || null;
    this.toggleRows = this._toggleRows();
    if (this.toggleRows.length) {
      const items = this.toggleRows.map((r) => ({
        kind: 'choice',
        label: `${r.name.toUpperCase()} ${r.unlockLevel}`,
        options: [{ value: false, label: 'OFF' }, { value: true, label: 'ON' }],
        get: () => {
          const p = scene.registry.get(REG.PROFILE) || {};
          const row = biomeToggleRows(p, this.biomeDefs).find((x) => x.id === r.id);
          return Boolean(row && row.enabled);
        },
        set: (v) => this._setBiome(r.id, Boolean(v)),
      }));
      // Geometry from the layout, so the menu can never be drawn on top of the biome names again.
      const band = layout.toggleMenu;
      this.sigMenu = new MenuList(scene, theme, {
        x: band.x, y: band.y, w: band.w, rowH: band.rowH, items, color: 'magenta', parent: this.panel,
      });
    }

    // W5: the achievements grid opens from here, as the spec places it in the Profile view. The button
    // sits bottom-left because BACK owns bottom-right; the layout module owns both boxes so the two can
    // never be drawn on top of each other.
    if (layout.achButton) {
      const bb = layout.achButton;
      this.achButton = new Button(scene, theme, {
        x: bb.x, y: bb.y, w: bb.w, h: bb.h, label: 'ACHIEVEMENTS', color: 'amber',
        onClick: () => this._openAchievements(),
      });
      this.panel.add(this.achButton);
    }
  }

  /** Open the achievements grid from inside the profile, replacing this view. */
  _openAchievements() {
    uiSfx(this.scene, 'uiSelect');
    const next = new AchievementsView(this.scene, this.theme, {
      onClose: () => {
        // Backing out of the grid returns to the PROFILE view the player came from, not to the Title
        // screen: ejecting them a screen further than they went in is a navigation bug the player feels.
        const back = new ProfileView(this.scene, this.theme, { onClose: this.onClose });
        this.destroy();
        this.scene.view = back;
      },
      biomeDefs: this.biomeDefs,
    });
    this.destroy();
    this.scene.view = next;
  }

  /** Unlocked biomes as toggle rows (empty before any unlock). */
  _toggleRows() {
    try {
      return biomeToggleRows(this.scene.registry.get(REG.PROFILE) || {}, this.biomeDefs).filter((r) => r.unlocked);
    } catch (e) {
      return [];
    }
  }

  /**
   * Apply one toggle and persist it. `toggleBiome` flips, so it is called only when the desired state
   * differs from the current one - calling it unconditionally would invert an already-correct row.
   */
  _setBiome(id, on) {
    const prof = this.scene.registry.get(REG.PROFILE);
    if (!prof) return;
    const row = biomeToggleRows(prof, this.biomeDefs).find((x) => x.id === id);
    if (!row || row.enabled === on) return;
    const next = toggleBiome(prof, id, this.biomeDefs);
    const service = this.scene.registry.get(REG.PROGRESSION);
    const store = this.profileStore || (service && service.store) || null;
    try {
      if (store) {
        this.scene.registry.set(REG.PROFILE, store.save(next));
      } else {
        this.scene.registry.set(REG.PROFILE, next);
      }
    } catch (e) { /* a denied storage write must not break the menu */ }
  }

  handleAction(action) {
    // Focus the signature menu on confirm when it exists, so it is reachable with the same keys as
    // every other menu; back still closes the view.
    if (action === 'cancel') {
      this.close();
      return true;
    }
    if (this.sigMenu) return this.sigMenu.handleAction(action);
    if (action === 'confirm') this.close();
    return true;
  }

  destroy() {
    if (this.unbindBar) this.unbindBar();
    this.unbindBar = null;
    super.destroy();
  }
}

/**
 * W5: ACHIEVEMENTS grid. Read-only; nothing here writes the profile.
 *
 * Paged because 29 rows will not fit above a BACK button, and paging is done by swapping this view's own
 * text objects rather than rebuilding the panel: rebuilding would re-run the constructor and lose the
 * player's page when the palette changes.
 *
 * LEFT/RIGHT (or 'prev'/'next') page; cancel closes, which the base class already does.
 */
export class AchievementsView extends View {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{onClose:function():void, page?:number, biomeCount?:number, biomeDefs?:Object[]}} o
   */
  constructor(scene, theme, o) {
    const profile = scene.registry.get(REG.PROFILE);
    const biomeDefs = o.biomeDefs || Object.values((scene.registry.get(REG.CONTENT) || {}).biomes || {});
    const layout = achievementsLayout({
      profile,
      page: o.page || 0,
      biomeCount: o.biomeCount !== undefined ? o.biomeCount : biomeDefs.length,
    });
    super(scene, theme, { w: layout.w, h: layout.h, title: 'ACHIEVEMENTS', color: 'amber', onClose: o.onClose, y: 13, backLabel: 'BACK' });
    this.profile = profile;
    this.biomeDefs = biomeDefs;
    this.page = layout.page;
    this.rows = [];
    this._paint();
  }

  /** Draw the current page, replacing whatever was drawn for the previous one. */
  _paint() {
    for (const t of this.rows) t.destroy();
    this.rows = [];
    const layout = achievementsLayout({
      profile: this.scene.registry.get(REG.PROFILE) || this.profile,
      page: this.page,
      biomeCount: this.biomeDefs.length,
    });
    this.page = layout.page;
    this.pages = layout.pages;
    for (const it of layout.items) {
      // Same rule as ProfileView: layout boxes are top-left, so never re-apply an origin.
      const t = new NeonText(this.scene, this.theme, it.x, it.y, it.text, {
        color: it.color, outline: it.outline, alpha: it.alpha,
      });
      this.panel.add(t);
      this.rows.push(t);
    }
  }

  /** Move by `delta` pages, clamped, and repaint only when the page actually changes. */
  _turn(delta) {
    const next = clampPage(this.page + delta);
    if (next === this.page) return false;
    this.page = next;
    this._paint();
    uiSfx(this.scene, 'uiMove');
    return true;
  }

  handleAction(action) {
    if (action === 'cancel') {
      this.close();
      return true;
    }
    if (action === 'left') return this._turn(-1);
    if (action === 'right') return this._turn(1);
    // Confirm is a no-op on a read-only grid rather than closing it: a player paging with confirm would
    // otherwise be ejected from the screen they were reading.
    if (action === 'confirm') return true;
    return true;
  }
}

/**
 * W4: SHARD SHOP — buy cosmetics and equip them, and set the pre-run boost loadout.
 *
 * One action per row ("get me this") rather than a BUY then EQUIP dance: if the player owns it, selecting
 * equips it; if they can afford it, selecting buys and equips in one atomic save. Both paths go through
 * ProfileStore's pure functions, so the cannot-go-negative / cannot-double-buy rules are enforced in the
 * tested layer and this view only chooses which rule to invoke.
 *
 * Boosts live here too because they are the same shape of decision (a spend, then a persistent choice) and
 * because the spec makes them "chosen on a pre-run loadout" — this is that loadout screen.
 */
export class ShopView extends View {
  /** @param {Phaser.Scene} scene @param {import('./Theme.js').Theme} theme @param {{onClose:function():void}} o */
  constructor(scene, theme, o) {
    const layout = shopLayout({ profile: scene.registry.get(REG.PROFILE) });
    super(scene, theme, {
      w: layout.w, h: layout.h, title: 'SHARD SHOP', color: 'amber', onClose: o.onClose, y: 22, backLabel: 'BACK',
    });

    this.service = scene.registry.get(REG.PROGRESSION);
    this.store = (this.service && this.service.store) || null;

    // ONE MenuList for the whole panel: headers, item rows, boosts and the loadout line are items in the
    // same list, so they all share one row pitch and cannot be drawn over each other. Nothing else is
    // drawn into this panel except the frame and BACK.
    this.menu = null;
    this._build();
  }

  _profile() {
    return this.scene.registry.get(REG.PROFILE) || {};
  }

  /** The panel's single source of truth: layout rows + menu items, rebuilt together every time. */
  _menuItems(layout) {
    const prof = this._profile();
    const boosts = (prof.boosts && typeof prof.boosts === 'object') ? prof.boosts : {};
    return shopMenuItems(layout).map((m) => {
      if (m.rowKind === 'item') {
        return { kind: 'action', label: m.label, sub: m.sub, disabled: m.disabled, onSelect: () => this._choose(m.id) };
      }
      if (m.rowKind === 'boost') {
        return {
          kind: 'choice',
          label: m.label,
          options: [{ value: false, label: 'OFF' }, { value: true, label: 'ON' }],
          get: () => boosts[m.boostId] === true,
          set: (v) => this._setBoost(m.boostId, Boolean(v)),
        };
      }
      // Headings and the BANK/loadout lines: real rows in the list for geometry, never selectable.
      return { kind: 'static', label: m.label, disabled: true };
    });
  }

  _build() {
    const layout = shopLayout({ profile: this._profile() });
    if (this.menu) { this.menu.destroy(); this.menu = null; }
    // The bank value is drawn outside the list (the list right-aligns only row state), so it has to be
    // torn down with it or every rebuild would stack another "BANK n" on the same pixel.
    for (const t of (this.bankTexts || [])) t.destroy();
    this.bankTexts = [];
    const band = layout.band;
    this.menu = new MenuList(this.scene, this.theme, {
      x: band.x, y: band.y, w: band.w, rowH: layout.rowH,
      items: this._menuItems(layout), color: 'lime', parent: this.panel,
    });
    // The BANK line is a right-aligned value in the list, not a separate static string, so it refreshes
    // with everything else. MenuList would draw it as a label, so it is rendered beside the list at the
    // head row's own y.
    const head = layout.rows.find((r) => r.kind === 'head');
    if (head && head.texts) {
      for (const t of head.texts) {
        const txt = new NeonText(this.scene, this.theme, t.x, t.y, t.text, { color: t.color });
        this.panel.add(txt);
        this.bankTexts.push(txt);
      }
    }
  }

  /**
   * Buy-or-equip, atomically. A refused purchase leaves the profile untouched: `purchase` returns the same
   * object by identity when it declines, which is how that is detected without duplicating its rules here.
   */
  _choose(id) {
    const prof = this._profile();
    let next = prof;
    try {
      if (!isOwned(prof, id)) {
        const bought = purchase(prof, id);
        if (bought === prof) { uiSfx(this.scene, 'uiBack'); return; }
        next = bought;
        uiSfx(this.scene, 'uiSelect', { pitch: 1.4 });
      } else {
        uiSfx(this.scene, 'uiSelect');
      }
      next = equip(next, id);
      this.scene.registry.set(REG.PROFILE, this.store ? this.store.save(next) : next);
    } catch (e) {
      // A denied storage write must not break the shop; the in-memory choice still shows this session.
      this.scene.registry.set(REG.PROFILE, next);
    }
    this._refresh();
  }

  _setBoost(id, on) {
    const prof = this._profile();
    const next = { ...prof, boosts: { ...(prof.boosts || {}), [id]: on } };
    try {
      this.scene.registry.set(REG.PROFILE, this.store ? this.store.save(next) : next);
    } catch (e) {
      this.scene.registry.set(REG.PROFILE, next);
    }
  }

  /**
   * Rebuild the whole list after a purchase or a boost toggle.
   *
   * This used to patch only the menu's rows, which is why the bank line, the owned/equipped states and the
   * loadout summary went stale (CC Friday's defect 2). Rebuilding from the layout means every visible
   * string comes from the same profile read, so nothing can lag behind.
   */
  _refresh() {
    const keep = this.menu ? this.menu.selected : 0;
    this._build();
    if (this.menu) this.menu.setSelected(Math.min(keep, this.menu.items.length - 1), true);
  }

  handleAction(action) {
    if (action === 'cancel') { this.close(); return true; }
    return this.menu.handleAction(action);
  }
}

