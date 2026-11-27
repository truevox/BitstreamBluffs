/**
 * OWNER: UI engineer.
 * Title / main menu, laid out as a synthwave arcade cabinet:
 *
 *   - the chrome SVG wordmark top-centre, over the retro sun (chromatic-split outline layers, a gentle wave,
 *     a passing glint and periodic glitch slices; all motion off under reduce motion);
 *   - the six-item menu on a glass panel on the grid floor, left (START RUN, DAILY RUN with today's rule as
 *     its sub label, ENTER SEED, PROFILE, LEADERBOARD, SETTINGS);
 *   - a "cabinet card" on the right: level badge and title, BEST, the Daily Patch (rule, countdown, streak /
 *     today's best) and the three active missions;
 *   - the compact jukebox top-right, the HOW TO PLAY chip and the control hint at the foot;
 *   - the sun, ranges, rider and grid left open in the centre column.
 *
 * Every rectangle comes from MissionsLayout (TITLE_BANDS, TITLE_CARD, titleMenuLayout) and ProfileLayout
 * (titleBadgeLayout), which are overlap-tested in Jest.
 *
 * Operable by keyboard, gamepad and touch/mouse. HOW TO PLAY: H, pad X/Y or SELECT, or the chip. After
 * ATTRACT_MS without input the cabinet goes into attract mode (panels dim, PRESS START blinks, the rider
 * throws tricks); any input restores it and is swallowed, so waking the cabinet never also fires a menu item.
 *
 * A start (START RUN, DAILY, seed) writes the seed and mask to the registry exactly as before, then warps the
 * backdrop and leaves through Motion.sceneTransition (a quick fade under reduce motion) into SCENES.RUN.
 */
import Phaser from 'phaser';
import packageInfo from '../../package.json';
import { SCENES, REG, GAME_WIDTH, GAME_HEIGHT } from '../constants.js';
import { EVT } from '../events.js';
import { DailyPatch } from '../systems/DailyPatch.js';
import { parseSeedMask } from '../systems/SaveStore.js';
import { rankableOnly } from '../systems/Ranking.js';
import { enabledBiomeMask } from '../systems/ProfileStore.js';
import { Theme } from '../ui/Theme.js';
import { NeonText } from '../ui/Neon.js';
import { measureText, ellipsize, wrapText } from '../ui/PixelFont.js';
import { Panel } from '../ui/Panel.js';
import { Button } from '../ui/Button.js';
import { MenuList } from '../ui/MenuList.js';
import { MenuInput } from '../ui/MenuInput.js';
import { Backdrop } from '../ui/Backdrop.js';
import { buildTitleMissionList } from '../ui/MissionsUi.js';
import { TITLE_BEST_X, TITLE_BEST_Y, TITLE_BANDS, TITLE_CARD, TITLE_CARD_INNER_W, TITLE_HORIZON, titleMenuLayout, titleBestText, titleChaseText } from '../ui/MissionsLayout.js';
import { addScanlines, playCrtPowerOn } from '../ui/Scanlines.js';
import { openDim, closeDim, sceneTransition, isReducedMotion, tweenProgress, Ease } from '../ui/Motion.js';
import { artImage, hasArt, mixColor } from '../ui/MenuArt.js';
// HowToPlayView before Views: it extends Views' View lazily, so either order works, but keep the natural one.
import { HowToPlayView } from '../ui/HowToPlayView.js';
import { LeaderboardView, SettingsView, SeedView, ProfileView, ShopView, DailyModesView, DailyDraftEditorView, DailyDraftLeaderboardView, GhostLinkView } from '../ui/Views.js';
import { titleBadgeLayout } from '../ui/ProfileLayout.js';
import { randomSeed, idToLabel, fmtInt } from '../ui/Format.js';
import { uiSfx } from '../ui/Sound.js';
import { JukeboxHUD } from '../ui/JukeboxHUD.js';
import { cosmeticRandom } from '../systems/CosmeticRandom.js';
import { guestPracticeLaunch } from '../systems/ghost/GuestPractice.js';
import { showTakeoverNotice } from '../ui/TakeoverNotice.js';
import { PostcardOpenView, POSTCARD_CHIP } from '../ui/PostcardOpenView.js';
import { launchTakeover } from '../ui/TakeoverLauncher.js';
import {peekPlayerSuspend,claimPlayerSuspend,discardPlayerSuspend,suspendMessage} from '../systems/savestate/playerSuspendFlow.js';

/** Idle time before attract mode. */
export const ATTRACT_MS = 20000;
/** Input arriving this soon after attract mode ends is the same press that woke it: swallowed. */
const WAKE_SWALLOW_MS = 220;
/** Phaser.BlendModes.ADD. */
const BLEND_ADD = 1;
/** Logo depth: above the backdrop and the panels' glow, below views and the dim. */
const LOGO_DEPTH = 5;

// The startup version belongs to the game instance, not every return to Title.
const versionShown = new WeakSet();
const VERSION_LABEL_ALPHA = 0.65;

const HINT_TEXT = '↑↓ SELECT   ENTER / A CONFIRM   H / X HOW TO PLAY';
// #85 limited Museum preview: no saved-data reads or physics execution.
export const MUSEUM_CHIP = Object.freeze({x:226,y:204,w:80,h:14});
export const MUSEUM_GALLERY_PATH = 'tools/museum-of-bad-physics.html';
// #424: fourth compact chip above Museum, outside both menu and missions panel.
export const RESUME_CHIP = Object.freeze({x:226,y:186,w:80,h:14});

export class TitleScene extends Phaser.Scene {
  constructor() {
    super(SCENES.TITLE);
  }

  create() {
    this.starting = false;
    this.view = null;
    this.dim = null;
    this.attract = false;
    this.attractExitAt = -Infinity;
    this.lastInputAt = this.time.now;
    this.glitchUntil = 0;
    this.nextGlitch = 2600;
    this.nextGlint = 1800;
    this.padSelectPrev = false;
    const theme = (this.theme = new Theme(this));
    theme.bind((pal) => this.cameras.main.setBackgroundColor(pal.bg));
    // Horizon at 150: the sun sits behind the logo and the ranges fill the band between the logo and the
    // menu. The rider carves through the open centre column, between the menu and the card.
    this.backdrop = new Backdrop(this, theme, { horizon: TITLE_HORIZON, alpha: 1, riderX: 266, riderRange: 30 });
    this.daily = DailyPatch.getDailyInfo();

    this._buildLogo();
    this._buildMenu();
    this._buildCard();
    this._buildFooter();
    // the rolling band is a menu-only flourish; the power-on plays once per page load (Scanlines.js)
    addScanlines(this, 1, { roll: true });
    playCrtPowerOn(this);

    this.input_ = new MenuInput(this, (a) => this._onAction(a));
    this._bindIdleInputs();
    // Compact song/transport keys top-right, beside the logo; the queue opens under it, over the card.
    const jb = TITLE_BANDS.jukebox;
    this.jukebox = new JukeboxHUD(this, theme, { x: jb.x, y: jb.y, variant: 'compact', queueAt: { x: GAME_WIDTH - 236, y: jb.y + jb.h + 4 } });
    // One soundtrack across Title, Run and Game Over. Browser policy may
    // defer sound until the first gesture, but it is requested immediately.
    this.game.registry.get(REG.AUDIO)?.startMenuMusic?.();
    this.events.once('shutdown', () => {
      this.jukebox?.destroy();
      this.jukebox = null;
      this._unbindIdleInputs();
      this._closeView();
    });
    this.cameras.main.fadeIn(180, 5, 6, 15);
    showTakeoverNotice(this, theme); // #72: why a takeover was refused or aborted, shown once
  }

  // ------------------------------------------------------------------ logo

  _buildLogo() {
    const theme = this.theme;
    const words = [
      { fill: 'logoBitstreamFill', line: 'logoBitstreamLine', y: TITLE_BANDS.logo.y + 2, w: 249, h: 42, phase: 0 },
      { fill: 'logoBluffsFill', line: 'logoBluffsLine', y: TITLE_BANDS.logo.y + 39, w: 205, h: 51, phase: 1.4 },
    ];
    this.logoWords = null;
    this.logo = null;
    if (words.every((w) => hasArt(this, w.fill) && hasArt(this, w.line))) {
      this.logoWords = words.map((w) => this._buildLogoWord(w));
    } else {
      this._buildLogoFallback();
    }
    this.sub = new NeonText(this, theme, GAME_WIDTH / 2, TITLE_BANDS.tagline.y, 'A DOWNHILL NEON TRICK RACE', {
      color: 'cyan', anchor: 'center', outline: 'dark',
    }).setDepth(LOGO_DEPTH);
  }

  /**
   * One chrome word: a deep extrusion shadow, magenta and cyan outline copies offset either side (the
   * chromatic split), the greyscale chrome fill tinted cool-top / warm-bottom, an additive glint that sweeps
   * across now and then, and three hidden slices the glitch borrows.
   */
  _buildLogoWord(w) {
    const x = GAME_WIDTH / 2;
    const o = { theme: this.theme, originX: 0.5, originY: 0, depth: LOGO_DEPTH };
    const shadow = artImage(this, w.line, x, w.y + 3, { ...o, tint: (pal) => mixColor(pal.bg, pal.magenta, 0.45) });
    const lineM = artImage(this, w.line, x - 1, w.y, { ...o, tint: 'magenta', alpha: 0.95 });
    const lineC = artImage(this, w.line, x + 1, w.y, { ...o, tint: 'cyan', alpha: 0.95 });
    const fill = artImage(this, w.fill, x, w.y, {
      ...o,
      tint: (pal) => {
        const top = mixColor(pal.text, pal.cyan, 0.42);
        const bottom = mixColor(pal.text, pal.magenta, 0.62);
        return [top, top, bottom, bottom];
      },
    });
    const glint = artImage(this, w.fill, x, w.y, { ...o, tint: 0xffffff, alpha: 0.7, blend: BLEND_ADD });
    glint.setVisible(false);
    const slices = [0, 1, 2].map((i) => {
      const s = artImage(this, w.fill, x, w.y, { ...o, depth: LOGO_DEPTH + 0.1, tint: i % 2 ? 'magenta' : 'cyan', alpha: 0.95 });
      s.setVisible(false);
      return s;
    });
    return { ...w, x, shadow, lineM, lineC, fill, glint, slices, layers: [shadow, lineM, lineC, fill, glint] };
  }

  /** No SVGs (a failed load): the v1 per-letter neon wordmark, so the Title is never blank. */
  _buildLogoFallback() {
    const theme = this.theme;
    this.logo = [];
    const lines = [
      { text: 'BITSTREAM', y: 10, scale: 4, color: 'cyan' },
      { text: 'BLUFFS', y: 46, scale: 4, color: 'magenta' },
    ];
    for (const ln of lines) {
      const total = measureText(ln.text) * ln.scale;
      let x = Math.round(GAME_WIDTH / 2 - total / 2);
      [...ln.text].forEach((ch, i) => {
        const t = new NeonText(this, theme, x, ln.y, ch, { color: ln.color, scale: ln.scale, outline: 'dark' }).setDepth(LOGO_DEPTH);
        this.logo.push({ t, baseY: ln.y, baseX: x, i, base: ln.color, line: ln.text });
        x += (measureText(ch) + 1) * ln.scale;
      });
    }
  }

  _updateLogo(t, reduced) {
    if (this.logo) {
      // fallback: the v1 per-letter wave and colour sweep
      for (const L of this.logo) {
        const wave = reduced ? 0 : Math.round(Math.sin(t * 0.004 + L.i * 0.55 + (L.line === 'BLUFFS' ? 1.5 : 0)) * 2);
        L.t.setPosition(L.baseX, L.baseY + wave);
      }
      return;
    }
    if (!this.logoWords) return;
    // glitch: every 2.6-6 s a 140 ms burst of displaced, tinted slices and a wider RGB split
    let glitching = false;
    if (!reduced) {
      if (t >= this.nextGlitch && t >= this.glitchUntil) {
        this.glitchUntil = t + 140;
        this.nextGlitch = t + 2600 + cosmeticRandom('title/fx').next() * 3400;
        for (const w of this.logoWords) {
          for (const s of w.slices) {
            const sy = Math.floor(cosmeticRandom('title/fx').next() * (w.h - 6));
            s.glitch = { y: sy, h: 2 + Math.floor(cosmeticRandom('title/fx').next() * 5), dx: (cosmeticRandom('title/fx').next() < 0.5 ? -1 : 1) * (3 + Math.floor(cosmeticRandom('title/fx').next() * 5)) };
          }
        }
      }
      glitching = t < this.glitchUntil;
      if (t >= this.nextGlint) this.nextGlint = t + 4200 + cosmeticRandom('title/fx').next() * 2000;
    }
    // the glint sweeps for 700 ms after each schedule point (nextGlint - its period)
    for (const w of this.logoWords) {
      const dy = reduced ? 0 : Math.round(Math.sin(t * 0.0022 + w.phase) * 1.5);
      const split = glitching ? 3 : 1;
      const jit = glitching ? (cosmeticRandom('title/fx').next() < 0.5 ? -1 : 1) : 0;
      w.shadow.setPosition(w.x, w.y + 3 + dy);
      w.lineM.setPosition(w.x - split, w.y + dy + (glitching ? jit : 0));
      w.lineC.setPosition(w.x + split, w.y + dy - (glitching ? jit : 0));
      w.fill.setPosition(w.x, w.y + dy);
      for (const s of w.slices) {
        if (!glitching || !s.glitch) { s.setVisible(false); continue; }
        s.setVisible(true);
        s.setCrop(0, s.glitch.y, w.w, s.glitch.h);
        s.setPosition(w.x + s.glitch.dx, w.y + dy);
      }
      // glint: a 10 px vertical band crossing the word, a little later on the second word
      const since = reduced ? -1 : t - (this.nextGlint - 4200) - w.phase * 90;
      if (since >= 0 && since < 700) {
        const gx = Math.round(-14 + (since / 700) * (w.w + 28));
        w.glint.setVisible(true);
        w.glint.setCrop(Math.max(0, gx), 0, 10, w.h);
        w.glint.setPosition(w.x, w.y + dy);
      } else w.glint.setVisible(false);
    }
  }

  // ------------------------------------------------------------------ menu

  _buildMenu() {
    const theme = this.theme;
    // Panel height is DERIVED from the row count (MissionsLayout.titleMenuLayout), not hard-coded, so a future
    // row cannot be silently clipped. Six rows fill the band on the grid floor exactly; a seventh would run
    // through the control hint. ACHIEVEMENTS and the SHARD SHOP therefore live in PROFILE, and the controls
    // reference is HOW TO PLAY (hotkey / chip / Settings), not a row.
    const items = [
      { kind: 'action', label: 'START RUN', color: 'lime', onSelect: () => this.startRun(randomSeed()) },
      { kind: 'action', label: 'DAILY RUN', color: 'magenta', sub: ellipsize(this.daily.rule ? this.daily.rule.name.toUpperCase() : '', 76), onSelect: () => this._openDailyModes() },
      { kind: 'action', label: 'ENTER SEED', color: 'cyan', sub: 'SEED / GHOST LINK', onSelect: () => this._openSeed() },
      {
        kind: 'action',
        label: 'PROFILE',
        color: 'lime',
        onSelect: () => {
          // The shop is opened FROM the profile and returns TO it. Closing the shop straight to Title
          // would make Escape a two-screen jump — the player pressed back once and lost their place,
          // and a keys-only player had no way to tell what had happened.
          const openProfile = () => this._openView(new ProfileView(this, theme, {
            // SHOP-2: a title equipped inside Profile -> TITLES changes the badge, so redraw it on the way out.
            onClose: () => { this._closeView(); this._refreshLevelBadge(); },
            onShop: () => this._openView(new ShopView(this, theme, { onClose: () => { openProfile(); } })),
          }));
          openProfile();
        },
      },
      { kind: 'action', label: 'LEADERBOARD', color: 'amber', onSelect: () => this._openView(new LeaderboardView(this, theme, { onClose: () => this._closeView() })) },
      { kind: 'action', label: 'SETTINGS', color: 'cyan', onSelect: () => this._openView(new SettingsView(this, theme, { onClose: () => this._closeView() })) },
    ];
    // Declared AFTER `items`: reading it first was a temporal-dead-zone ReferenceError that blanked the
    // whole Title screen at boot.
    const geo = titleMenuLayout(items.length);
    if (!geo.fits) {
      // Fail visibly in development rather than shipping a row under the hint: the menu is full.
      console.warn(`Title menu does not fit: ${items.length} rows reach y${geo.lastRowBottom}, band ends at ${TITLE_BANDS.menu.y + TITLE_BANDS.menu.h}`);
    }
    // Translucent glass: the grid floor shows through, so the panel reads as a cabinet bezel, not a wall.
    this.menuPanel = new Panel(this, theme, {
      x: geo.x, y: geo.y, w: geo.w, h: geo.h, color: 'cyan', fillAlpha: 0.62,
    });
    this.menu = new MenuList(this, theme, { x: 4, y: geo.inset, w: geo.w - 8, rowH: geo.rowH, items, scale: geo.scale, parent: this.menuPanel });
  }

  // ------------------------------------------------------------------ cabinet card

  /** The right-hand card: player section, Daily Patch, missions. */
  _buildCard() {
    const theme = this.theme;
    const C = TITLE_CARD;
    const S = C.sections;
    this.cardPanel = new Panel(this, theme, { x: C.x, y: C.y, w: C.w, h: C.h, color: 'magenta', fillAlpha: 0.66 });
    const card = this.cardPanel;
    // decoration under the text: player-section wash, section rules, the MISSIONS rule
    this.cardG = new Phaser.GameObjects.Graphics(this);
    card.add(this.cardG);
    this.cardDecoUnbind = theme.bind((pal) => this._paintCard(pal));
    card.once('destroy', () => this.cardDecoUnbind && this.cardDecoUnbind());
    const txt = (x, y, text, opts) => {
      const t = new NeonText(this, theme, x, y, text, { outline: 'none', ...opts });
      card.add(t);
      return t;
    };
    // the cabinet label: "1UP", right of the badge
    txt(C.w - C.pad, S.level, '1UP', { color: 'amber', anchor: 'right', outline: 'glow' });
    this._buildLevelBadge();
    this.bestText = txt(TITLE_BEST_X - C.x, TITLE_BEST_Y - C.y, 'BEST --', { color: 'lime' });
    this._loadBest();
    this._buildDailyCard(txt);
    this._buildMissions();
  }

  _paintCard(pal) {
    const g = this.cardG;
    if (!g || !g.scene) return;
    const C = TITLE_CARD;
    const S = C.sections;
    g.clear();
    // player section: a lime wash fading down, like a lit marquee
    for (let i = 0; i < 6; i++) {
      g.fillStyle(pal.lime, 0.07 * (1 - i / 6));
      g.fillRect(3, 3 + i * 5, C.w - 6, 5);
    }
    const rule = (y, color) => {
      const steps = 10;
      const x0 = C.pad;
      const w = C.w - C.pad * 2;
      for (let i = 0; i < steps; i++) {
        g.fillStyle(color, 0.75 * (1 - Math.abs(i - steps / 2) / (steps / 2 + 1)));
        g.fillRect(x0 + Math.round((i * w) / steps), y, Math.ceil(w / steps), 1);
      }
    };
    rule(S.rule1, pal.magenta);
    // MISSIONS header rule, right of the label
    const mx = C.pad + measureText('MISSIONS') + 5;
    g.fillStyle(pal.cyan, 0.45);
    g.fillRect(mx, S.missionsHead + 4, C.w - C.pad - mx, 1);
    g.fillStyle(pal.cyan, 1);
    g.fillRect(mx, S.missionsHead + 3, 2, 3);
    // the Daily Patch date chip frame
    if (this.dailyDateText && this.dailyDateText.scene) {
      const w = this.dailyDateText.textWidth + 6;
      const x = C.w - C.pad - w + 3;
      g.fillStyle(pal.amber, 0.14);
      g.fillRect(x, S.dailyHead - 1, w, 10);
      g.fillStyle(pal.amber, 0.6);
      g.fillRect(x, S.dailyHead + 9, w, 1);
    }
  }

  /**
   * The level badge, at the top of the card. Geometry comes from ProfileLayout.titleBadgeLayout (screen
   * coordinates, overlap-tested); inside the card it is drawn card-local. Works without the card too (tests
   * build only the menu).
   */
  _buildLevelBadge() {
    const theme = this.theme;
    const layout = titleBadgeLayout({
      profile: this.registry.get(REG.PROFILE),
      levels: (this.registry.get(REG.CONTENT) || {}).progression,
    });
    if (!layout) return;
    this.levelBadge = [];
    const card = this.cardPanel && this.cardPanel.scene ? this.cardPanel : null;
    layout.items.forEach((it, i) => {
      const x = card ? it.x - card.x : it.x;
      const y = card ? it.y - card.y : it.y;
      // the first line shares its row with the card's 1UP label
      const room = TITLE_CARD_INNER_W - (i === 0 ? 22 : 0);
      const t = new NeonText(this, theme, x, y, ellipsize(it.text, room), { color: it.color, outline: it.outline, alpha: it.alpha });
      if (card) card.add(t);
      this.levelBadge.push(t);
    });
  }

  /** Redraw the level badge from the current profile (SHOP-2: the equipped title replaces the level title). */
  _refreshLevelBadge() {
    for (const t of this.levelBadge || []) {
      try { t.destroy(); } catch (e) { /* already gone */ }
    }
    this.levelBadge = [];
    this._buildLevelBadge();
  }

  _loadBest() {
    try {
      const store = this.registry.get(REG.SAVE_STORE);
      Promise.resolve(store.getRecentRuns(1000)).then((all) => {
        // Clean runs only (Ranking.rankableOnly): a Head Start run is a different game and must not set
        // the device BEST shown on the Title, any more than it can set a clean leaderboard entry.
        const runs = rankableOnly(all);
        if (!runs.length || !this.bestText.scene) return;
        const m = Math.max(...runs.map((r) => r.distanceM || 0));
        const sc = Math.max(...runs.map((r) => r.score || 0));
        if (m > 0) this.bestText.setText(titleBestText(fmtInt(m), fmtInt(sc)));
      }).catch(() => {});
    } catch (e) { /* cosmetic */ }
  }

  /** The three active missions, in the card's last section. Geometry is unit-tested in MissionsLayout. */
  _buildMissions() {
    try {
      const view = this.registry.get(REG.MISSIONS);
      const rows = (view && view.active) || [];
      const card = this.cardPanel;
      if (card) {
        const S = TITLE_CARD.sections;
        const done = rows.filter((r) => r && r.done).length;
        card.add(new NeonText(this, this.theme, TITLE_CARD.pad, S.missionsHead, 'MISSIONS', { color: 'cyan', outline: 'none' }));
        if (rows.length) {
          card.add(new NeonText(this, this.theme, TITLE_CARD.w - TITLE_CARD.pad, S.missionsHead, `${done}/${Math.min(3, rows.length)}`, {
            color: done ? 'lime' : 'text', anchor: 'right', outline: 'none', alpha: 0.8,
          }));
        }
      }
      if (!rows.length) {
        if (card) {
          card.add(new NeonText(this, this.theme, TITLE_CARD.pad, TITLE_CARD.sections.missions, 'NO ACTIVE MISSIONS', { color: 'text', outline: 'none', alpha: 0.5 }));
        }
        return;
      }
      this.missionsPanel = buildTitleMissionList(this, this.theme, rows);
      if (this.missionsPanel && card) {
        this.missionsPanel.setPosition(this.missionsPanel.x - card.x, this.missionsPanel.y - card.y);
        card.add(this.missionsPanel);
      }
    } catch (e) { /* cosmetic: a missing mission service must never block the Title screen */ }
  }

  _buildDailyCard(txt) {
    const C = TITLE_CARD;
    const S = C.sections;
    this.dailyHeadText = txt(C.pad, S.dailyHead, 'DAILY PATCH', { color: 'amber', outline: 'glow' });
    this.dailyDateText = txt(C.w - C.pad, S.dailyHead, '', { color: 'amber', anchor: 'right' });
    this.dailyRuleText = txt(C.pad, S.ruleName, '', { color: 'magenta', outline: 'glow', scale: 2 });
    this.dailyDescText = txt(C.pad, S.desc1, '', { color: 'text', alpha: 0.82 });
    this.nextPatchText = txt(C.pad, S.next, '', { color: 'cyan' });
    this.chaseText = txt(C.pad, S.chase, '', { color: 'lime' });
    this._applyDaily();
    this._refreshDaily();
    // slow refresh (countdown minutes, midnight rollover); the scene clock stops with the scene
    this.time.addEvent({ delay: 15000, loop: true, callback: () => this._refreshDaily() });
  }

  /** Rebuild everything that shows this.daily: card header, rule, description and the DAILY RUN sub label. */
  _applyDaily() {
    const rule = this.daily.rule || { name: '-', description: '', id: '' };
    const name = rule.name.toUpperCase();
    if (this.dailyDateText) {
      // MM-DD: the year is noise on a daily card, and the full key is on the DAILY RUN screen
      this.dailyDateText.setText(`${String(this.daily.dateKey).slice(5)} UTC`);
    }
    if (this.dailyRuleText) {
      // 2x when it fits the card, else 1x centred in the same 16 px band
      const big = measureText(name) * 2 <= TITLE_CARD_INNER_W;
      this.dailyRuleText.setText(big ? name : ellipsize(name, TITLE_CARD_INNER_W));
      this.dailyRuleText.setScale(big ? 2 : 1);
      this.dailyRuleText.y = TITLE_CARD.sections.ruleName + (big ? 0 : 4);
    }
    this.dailyDesc = rule.description || idToLabel(rule.id);
    if (this.dailyDescText) this.dailyDescText.setText(wrapText(this.dailyDesc.toUpperCase(), TITLE_CARD_INNER_W, 2));
    const row = this.menu && this.menu.rows[1];
    if (row && row.sub) row.sub.setText(ellipsize(name, 76));
    if (this.cardG) this._paintCard(this.theme.pal);
  }

  /** Streak, today's best (or NOT PLAYED TODAY) and the NEXT PATCH IN countdown. All synchronous reads, never throws. */
  _refreshDaily() {
    if (!this.nextPatchText || !this.nextPatchText.scene) return;
    const now = new Date();
    // midnight UTC rollover: re-read the daily info so the rule, the DAILY RUN seed and the stats below all agree
    const fresh = DailyPatch.getDailyInfo(now);
    if (fresh.dateKey !== this.daily.dateKey) {
      this.daily = fresh;
      this._applyDaily();
    }
    this.nextPatchText.setText(`NEXT PATCH IN ${DailyPatch.formatCountdown(DailyPatch.msUntilNextRule(now))}`);
    let chase = 'NOT PLAYED TODAY';
    let key = 'amber';
    try {
      const store = this.registry.get(REG.SAVE_STORE);
      const st = store.getDailyStreak(now.getTime());
      const today = store.getDailyStats(now.getTime());
      const played = !!(today && today.attempts > 0);
      chase = titleChaseText(st && st.streak > 0 ? st.streak : 0, played ? fmtInt(today.bestScore) : null);
      if (played) key = 'lime';
    } catch (e) { /* cosmetic: leave the default */ }
    this.chaseText.setText(ellipsize(chase, TITLE_CARD_INNER_W)).setColorKey(key);
  }

  // ------------------------------------------------------------------ footer, help

  _buildFooter() {
    const theme = this.theme;
    this.hint = new NeonText(this, theme, GAME_WIDTH / 2, TITLE_BANDS.hint.y + 4, HINT_TEXT, {
      color: 'text', anchor: 'center', vAnchor: 0.5, outline: 'dark',
    });
    this.hint.setAlpha(0.72);
    // Show the actual bundled version once per game load; never revive it
    // on attract-mode wake or a later return to the title screen.
    this.versionLabel = null;
    if (!versionShown.has(this.game)) {
      versionShown.add(this.game);
      const v = TITLE_BANDS.version;
      const label = this.versionLabel = new NeonText(this, theme, v.x, v.y, `v${packageInfo.version}`, {
        color: 'text', outline: 'dark', scale: 1,
      }).setDepth(LOGO_DEPTH).setAlpha(VERSION_LABEL_ALPHA);
      this.time.delayedCall(3000, () => {
        if (!label.scene) return;
        tweenProgress(this, {
          duration: isReducedMotion(this) ? 120 : 400,
          ease: Ease.outQuad,
          onUpdate: (p) => { if (label.scene) label.setAlpha(VERSION_LABEL_ALPHA * (1 - p)); },
          onComplete: () => { if (label.scene) label.setVisible(false); },
        });
      });
    }
    const h = TITLE_BANDS.help;
    // The touch / mouse route to HOW TO PLAY (keyboard: H; pad: X / Y or SELECT).
    this.helpButton = new Button(this, theme, { x: h.x, y: h.y, w: h.w, h: h.h, label: '? HOW TO PLAY', color: 'amber', onClick: () => this._openHelp(true) });
    // #67: open a postcard (keyboard: O). The title menu is full, so it is a chip above HOW TO PLAY.
    const pc = POSTCARD_CHIP;
    this.postcardButton = new Button(this, theme, { x: pc.x, y: pc.y, w: pc.w, h: pc.h, label: 'O POSTCARD', color: 'magenta', onClick: () => this._openPostcard(true) });
    // A public, local-file-only static pose gallery, NOT a real old-physics runner.
    // A separate route avoids adding a seventh main-menu row or loading tapes automatically.
    const m = MUSEUM_CHIP;
    this.museumButton = new Button(this, theme, { x:m.x, y:m.y, w:m.w, h:m.h, label:'M MUSEUM', color:'amber', onClick: () => this._openMuseum(true) });
    const r=RESUME_CHIP;
    this.resumeState={ok:false,status:'checking'};
    this.discardConfirm=false;
    this.resumeButton=new Button(this,theme,{x:r.x,y:r.y,w:r.w,h:r.h,
      label:'R RESUME',color:'lime',onClick:()=>void this._savedSlotAction(true)}).setDisabled(true);
    this.resumeNote=new NeonText(this,theme,266,177,'CHECKING SAVE',{
      color:'text',anchor:'center',outline:'dark',
    }).setAlpha(0.75);
    this.lastSuspendNotice=this.registry.get('bb.localSuspendNotice')||null;
    this.registry.remove?.('bb.localSuspendNotice');
    void this._refreshSuspendSlot();
  }

  /** Local-only single-use availability; this observation NEVER claims or
   * clears storage. A true atomic claim runs only after explicit R/tap. */
  async _refreshSuspendSlot(){
    let result;
    try{result=await peekPlayerSuspend();}
    catch{result={ok:false,code:'storage-unavailable'};}
    if(!this.sys?.isActive?.()||!this.resumeButton?.scene)return;
    this.resumeState=result;
    const ready=result?.ok&&result.status==='ready';
    const discardable=!result?.ok&&['corrupt','incompatible'].includes(result.status);
    this.discardConfirm=false;
    this.resumeButton.setLabel(discardable?'D DISCARD':'R RESUME');
    this.resumeButton.colorKey=discardable?'amber':'lime';
    this.resumeButton._paint();
    this.resumeButton.setDisabled(!ready&&!discardable);
    const message=this.lastSuspendNotice||
      (discardable?'INCOMPATIBLE / DAMAGED SAVE':
       ready?'ONE USE - THIS VERSION':suspendMessage(result?.ok?result.status:result?.code));
    this.resumeNote.setText(ellipsize(message,79));
    this.lastSuspendNotice=null;
  }

  _savedSlotAction(fromButton=false){
    if(!this.resumeState?.ok&&['incompatible','corrupt'].includes(this.resumeState?.status))
      return this._discardSavedRun();
    return this._resumeSavedRun(fromButton);
  }

  /** Explicit double-confirm cleanup ONLY for incompatible/corrupt READY.
   * No automatic cleanup or clearing of a claimed slot can occur. */
  async _discardSavedRun(){
    if(this.view||this.starting||this.attract||
      !['incompatible','corrupt'].includes(this.resumeState?.status))return;
    if(!this.discardConfirm){
      this.discardConfirm=true;
      this.resumeNote?.setText('TAP D AGAIN TO DISCARD');
      return;
    }
    this.starting=true;
    this.resumeButton?.setDisabled(true);
    let result;
    try{result=await discardPlayerSuspend();}
    catch{result={ok:false,code:'storage-unavailable'};}
    this.starting=false;
    this.discardConfirm=false;
    this.lastSuspendNotice=result?.ok?'SAVED SLOT DISCARDED':suspendMessage(result?.code);
    await this._refreshSuspendSlot();
  }

  /** #424 single-use resume. A claimed token cannot be reused in another tab.
   * No automatic storage read becomes trusted gameplay, scoring or Verified.
   */
  async _resumeSavedRun(fromButton=false){
    if(this.view||this.starting||this.attract||this.resumeState?.status!=='ready')return;
    this.starting=true;
    this.resumeButton?.setDisabled(true);
    this.resumeNote?.setText('CLAIMING SAVE');
    let claim;
    try{claim=await claimPlayerSuspend();}
    catch{claim={ok:false,code:'storage-unavailable'};}
    if(!claim?.ok){
      this.starting=false;
      this.lastSuspendNotice=suspendMessage(claim?.code);
      await this._refreshSuspendSlot();
      return;
    }
    // Recreate only a proven base-biome, unmodified stock RunScene. The native
    // eight-section codec must independently reject changed profile/config.
    // No stale replay, Takeover, Gym or daily handoff is allowed to leak in.
    this.registry.set(REG.SEED,claim.seed);
    this.registry.set(REG.BIOME_MASK,0);
    this.registry.set(REG.DAILY_OFFICIAL,false);
    this.registry.set(REG.DAILY_MODE,'classic');
    this.registry.set(REG.BSOD_GYM,false);
    for(const key of [REG.GHOST_REPLAY,REG.TAKEOVER,REG.GUEST_PRACTICE])
      this.registry.remove?.(key);
    this._closeView();
    try{this.scene.start(SCENES.RUN,{suspendResume:claim});}
    catch(e){
      const released=await claim.slot.release(claim.token);
      this.starting=false;
      this.lastSuspendNotice=released.ok?'RESTORE NOT STARTED':'SAVE LOCKED - DO NOT CLEAR';
      await this._refreshSuspendSlot();
    }
  }

  /** #85: leave Title for the local-file-only Museum page, never mid-run. */
  _openMuseum(fromButton = false) {
    if (this.starting || this.view) return;
    if (!fromButton) uiSfx(this, 'uiSelect');
    if (fromButton && this.attract) { this._exitAttract(); return; }
    window.location.assign(MUSEUM_GALLERY_PATH);
  }

  /** #67: the open-postcard view. Nothing is read or started until the player presses OPEN. */
  _openPostcard(fromButton) {
    if (this.starting || this.view) return;
    if (!fromButton) uiSfx(this, 'uiSelect');
    if (fromButton && this.attract) { this._exitAttract(); return; }
    this._openView(new PostcardOpenView(this, this.theme, { onClose: () => this._closeView(), onOpen: (d) => this._launchPostcard(d) }));
  }

  /** #67: hand a validated postcard descriptor to RunScene (an UNRANKED takeover; RunScene re-validates it and checks the fingerprint at N). */
  _launchPostcard(descriptor) {
    if (this.starting) return;
    this.starting = true;
    uiSfx(this, 'uiSelect', { pitch: 1.3 });
    this._closeView();
    launchTakeover(this, descriptor);
  }

  /** @param {boolean} [fromButton] the chip already played its own click */
  _openHelp(fromButton) {
    if (this.starting || this.view) return;
    if (!fromButton) uiSfx(this, 'uiSelect');
    if (fromButton && this.attract) { this._exitAttract(); return; }
    this._openView(new HowToPlayView(this, this.theme, { onClose: () => this._closeView() }));
  }

  _openSeed() {
    this._openView(new SeedView(this, this.theme, {
      onClose: () => this._closeView(),
      onSubmit: (seed) => this.startRun(seed || randomSeed()),
      onGhostLink: () => this._openGhostLink(),
    }));
  }

  /** #69: explicit, read-only paste/preview, never startup auto-import. */
  _openGhostLink() {
    // A direct Ghost-in-a-Link URL may be in the address bar, but it never
    // parses or touches a stored ghost unless the player opens this preview.
    const hasHash=typeof location!=='undefined'&&location.hash.startsWith('#bbghost=');
    this._openView(new GhostLinkView(this,this.theme,{
      initial:hasHash?location.href:'',onClose:()=>this._openSeed(),
      onPractice:(tape)=>this.startRun(tape.seed,tape.biomeMask,{guestPractice:tape}),
    }));
  }

  _openView(view) {
    // The dim survives a view-to-view hop (Profile -> Shop) so it does not flash; Motion fades it otherwise.
    const keepDim = this.dim;
    this.dim = null;
    this._closeView();
    this.dim = openDim(this, keepDim, 0.8);
    this.view = view;
  }

  _closeView() {
    if (this.view) this.view.destroy();
    this.view = null;
    closeDim(this, this.dim);
    this.dim = null;
    this.lastInputAt = this.time ? this.time.now : 0;
  }

  // ------------------------------------------------------------------ input, idle / attract

  /** True (and the input is consumed) when this input should only wake the cabinet. */
  _wakeGate() {
    const now = this.time ? this.time.now : 0;
    this.lastInputAt = now;
    if (this.attract) {
      this._exitAttract();
      return true;
    }
    return now - this.attractExitAt < WAKE_SWALLOW_MS;
  }

  _onAction(action) {
    if (this.starting) return;
    if (this._wakeGate()) return;
    if (this.view) {
      this.view.handleAction(action);
      return;
    }
    // pad X / Y and the N key: HOW TO PLAY (the menu has no use for 'alt')
    if (action === 'alt') {
      this._openHelp();
      return;
    }
    this.menu.handleAction(action);
  }

  /**
   * Inputs MenuInput does not deliver but that must still count as "someone is here": any key (H opens HOW TO
   * PLAY), pointer moves and taps, and every router action (pad buttons, touch). Each wakes attract mode.
   */
  _bindIdleInputs() {
    this._onAnyKey = (ev) => {
      const e = ev && (ev.originalEvent || ev);
      if (this._wakeGate()) return;
      if (e && (e.key === 'h' || e.key === 'H') && !e.repeat && !this.view && !this.starting) this._openHelp();
      if (e && (e.key === 'o' || e.key === 'O') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !this.view && !this.starting) this._openPostcard();
      if (e && (e.key === 'm' || e.key === 'M') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !this.view && !this.starting) this._openMuseum();
      if (e && (e.key === 'r' || e.key === 'R') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !this.view && !this.starting) void this._resumeSavedRun();
      if (e && (e.key === 'd' || e.key === 'D') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !this.view && !this.starting) void this._discardSavedRun();
    };
    this._onPointer = () => { this._wakeGate(); };
    this._onRouter = (p) => { if (p && p.pressed) this._wakeGate(); };
    if (this.input.keyboard) this.input.keyboard.on('keydown', this._onAnyKey);
    this.input.on('pointerdown', this._onPointer);
    this.input.on('pointermove', this._onPointer);
    this.game.events.on(EVT.INPUT_ACTION, this._onRouter);
  }

  _unbindIdleInputs() {
    if (this.input && this.input.keyboard && this._onAnyKey) this.input.keyboard.off('keydown', this._onAnyKey);
    if (this.input && this._onPointer) {
      this.input.off('pointerdown', this._onPointer);
      this.input.off('pointermove', this._onPointer);
    }
    if (this.game && this._onRouter) this.game.events.off(EVT.INPUT_ACTION, this._onRouter);
  }

  /** Pad SELECT (button 8) opens HOW TO PLAY; MenuInput does not map it. */
  _pollPadSelect() {
    let down = false;
    try {
      const pads = (navigator.getGamepads && navigator.getGamepads()) || [];
      for (const p of pads) if (p && p.connected && p.buttons[8] && p.buttons[8].pressed) down = true;
    } catch (e) { /* no gamepad API */ }
    if (down && !this.padSelectPrev && !this._wakeGate() && !this.view && !this.starting) this._openHelp();
    this.padSelectPrev = down;
  }

  /** The things attract mode dims. */
  _attractTargets() {
    return [this.menuPanel, this.cardPanel, this.jukebox && this.jukebox.panel, this.hint, this.helpButton, this.postcardButton, this.museumButton, this.resumeButton, this.resumeNote, this.sub].filter((o) => o && o.scene);
  }

  _enterAttract() {
    if (this.attract || this.view || this.starting) return;
    this.attract = true;
    const reduced = isReducedMotion(this);
    const targets = this._attractTargets();
    this.attractBase = targets.map((o) => o.alpha);
    this._fadeTargets(targets, this.attractBase.map((a) => a * 0.22), reduced ? 0 : 600);
    // A full-screen catcher above the menu and the jukebox: a tap only wakes the cabinet, it never also
    // lands on a menu row or a transport key.
    this.attractCatcher = this.add.zone(0, 0, GAME_WIDTH, GAME_HEIGHT).setOrigin(0, 0).setDepth(450).setInteractive();
    this.attractCatcher.on('pointerdown', () => this._wakeGate());
    const A = TITLE_BANDS.attract;
    this.attractPrompt = new NeonText(this, this.theme, GAME_WIDTH / 2, A.y, 'PRESS START', {
      color: 'text', anchor: 'center', scale: 2, outline: 'dark',
    }).setDepth(30);
    this.attractSub = new NeonText(this, this.theme, GAME_WIDTH / 2, A.y + 21, 'INSERT COIN', {
      color: 'amber', anchor: 'center', outline: 'dark',
    }).setDepth(30);
    this.nextTrickAt = 0;
  }

  _exitAttract() {
    if (!this.attract) return;
    this.attract = false;
    this.attractExitAt = this.time.now;
    this.lastInputAt = this.time.now;
    const targets = this._attractTargets();
    const base = targets.map((o, i) => (this.attractBase && this.attractBase[i] !== undefined ? this.attractBase[i] : 1));
    this._fadeTargets(targets, base, isReducedMotion(this) ? 0 : 180);
    for (const k of ['attractCatcher', 'attractPrompt', 'attractSub']) {
      if (this[k] && this[k].scene) this[k].destroy();
      this[k] = null;
    }
  }

  _fadeTargets(targets, to, ms) {
    const from = targets.map((o) => o.alpha);
    tweenProgress(this, {
      duration: ms,
      ease: Ease.outQuad,
      onUpdate: (p) => targets.forEach((o, i) => { if (o.scene) o.setAlpha(from[i] + (to[i] - from[i]) * p); }),
    });
  }

  _updateAttract(t, reduced) {
    if (!this.attract) {
      if (this.view || this.starting) this.lastInputAt = t;
      else if (t - this.lastInputAt > ATTRACT_MS) this._enterAttract();
      return;
    }
    // PRESS START blinks (steady when reduced); the sub line alternates INSERT COIN / FREE PLAY
    if (this.attractPrompt) {
      const on = reduced || Math.floor(t / 530) % 2 === 0;
      this.attractPrompt.setVisible(on);
      // reduced: nothing flashes or swaps, the prompt just sits there
      this.attractPrompt.setColorKey(!reduced && Math.floor(t / 1060) % 2 ? 'magenta' : 'text');
      this.attractSub.setText(!reduced && Math.floor(t / 2120) % 2 ? 'FREE PLAY' : 'INSERT COIN');
    }
    if (!reduced && t >= this.nextTrickAt) {
      this.backdrop.trick({ height: 30, flips: 2 });
      this.nextTrickAt = t + 4200;
    }
  }

  // ------------------------------------------------------------------ starting a run

  /**
   * DAILY RUN. The seed and the mask are both derived at press time from ONE clock read. `this.daily` is
   * refreshed only every 15 s, so reading the seed from it and the mask from "now" could pair yesterday's
   * seed with today's mask for a press just after 00:00 UTC. RunScene reads the daily rule at create(), so
   * deriving all three from the current day keeps seed, mask and rule on the same date.
   * @returns {void}
   */
  _openDailyModes(){
    const openChoices=()=>this._openView(new DailyModesView(this,this.theme,{
      onClose:()=>this._closeView(),
      onClassic:()=>this._startDaily('classic'),
      onDraft:()=>this._startDaily('draft'),
      onEdit:()=>this._openView(new DailyDraftEditorView(this,this.theme,{
        onClose:openChoices,onPlay:()=>this._startDaily('draft'),
      })),
      onBoard:()=>this._openView(new DailyDraftLeaderboardView(this,this.theme,{
        onClose:openChoices,
      })),
    }));
    openChoices();
  }

  _startDaily(mode='classic') {
    const now = new Date();
    // Decision 2: this menu item is the ONLY way to start an official Daily.
    this.startRun(DailyPatch.getDailyInfo(now).seed, DailyPatch.biomeMaskForDate(now), { official: true,mode });
  }

  /**
   * @param {string} seed seed text, optionally with a `seed@mask` suffix (W3).
   * @param {number} [maskOverride] explicit mask (daily run); wins over any suffix.
   * @param {{official?:boolean}} [o] `official: true` only from the DAILY RUN item (decision 2).
   * @returns {void}
   */
  startRun(seed, maskOverride, o) {
    if (this.starting) return;
    const requestedPractice = o?.guestPractice !== undefined;
    const guest = requestedPractice ? guestPracticeLaunch(o.guestPractice) : null;
    // A malformed guest request must NEVER silently become a normal/ranked run.
    if(requestedPractice&&!guest)return;
    this.starting = true;
    const biomeDefs = Object.values((this.registry.get(REG.CONTENT) || {}).biomes || {});
    const parsed = guest?{seed:guest.seed,biomeMask:guest.biomeMask,hadSuffix:true}
      :parseSeedMask(seed, biomeDefs);
    if(guest)this.registry.set(REG.GUEST_PRACTICE,guest.tape);
    else this.registry.remove?.(REG.GUEST_PRACTICE);
    this.registry.set(REG.SEED, parsed.seed || seed);
    // Decision 2: set on EVERY Title start, so a typed `daily-*` seed (ENTER SEED) is never official.
    this.registry.set(REG.DAILY_OFFICIAL, !guest && !!(o && o.official === true));
    const draft=!guest&&o?.official===true&&o?.mode==='draft';
    this.registry.set(REG.DAILY_MODE,draft?'draft':'classic');
    this.registry.set(REG.DAILY_DRAFT_RANKS,draft?
      {...(this.registry.get(REG.PROGRESSION)?.store?.profile?.dailyDraft?.ranks||{})}:{});
    // A normal/daily start MUST clear the one-shot training flag.
    const owned = this.registry.get(REG.PROFILE)?.bsodGym?.owned === true;
    this.registry.set(REG.BSOD_GYM, !!(o && o.gym === true && owned));
    // A typed `daily-YYYY-MM-DD` with no suffix is a PRACTICE run of that date: it replays that date's
    // mask (and RunScene plays that date's rule), not the profile's own biomes.
    const typedDay = parsed.hadSuffix ? null : DailyPatch.dateKeyFromSeed(parsed.seed);
    const typedDayInfo = typedDay ? DailyPatch.infoForDateKey(typedDay) : null;
    // W3 mask precedence, highest first:
    //   1. an explicit maskOverride (the Daily: date-derived, identical for every player)
    //   2. a `seed@mask` suffix (a shared seed must reproduce the sender's world)
    //   3. a typed `daily-YYYY-MM-DD`: that date's Daily mask (decision 2, practice run)
    //   4. the profile's own enabled-and-unlocked signatures (an ordinary run)
    // Falling back to 0 at step 4 is what CC Friday caught: START RUN ignored the profile entirely.
    const mask = Number.isFinite(maskOverride)
      ? maskOverride >>> 0
      : parsed.hadSuffix
        ? parsed.biomeMask
        : typedDayInfo
          ? typedDayInfo.biomeMask
          : enabledBiomeMask(this.registry.get(REG.PROFILE), biomeDefs);
    this.registry.set(REG.BIOME_MASK, mask);
    uiSfx(this, 'uiSelect', { pitch: 1.3 });
    this._closeView();
    // a module function, not this._launch(): startRun is also driven on plain contexts (title-biome-start)
    launchRun(this);
  }

  /** Leave for the run (see launchRun). Kept as a method so a scene can be driven through it directly. */
  _launch() {
    launchRun(this);
  }

  update(time) {
    this.backdrop.update(time);
    const reduced = isReducedMotion(this);
    this._updateLogo(time, reduced);
    if (!reduced && !this.attract && !this.starting) this.sub.setAlpha(0.78 + 0.2 * Math.sin(time * 0.004));
    this._pollPadSelect();
    this._updateAttract(time, reduced);
  }
}

/**
 * Leave the Title for the run: the grid and ranges warp, the panels slide off, then the scanline wipe into
 * RunScene. Reduced motion: no warp (Backdrop.warp returns 0), a short fade. Without a backdrop or a tween
 * manager (tests) the scene starts at once, exactly as before.
 * @param {TitleScene} scene
 * @returns {void}
 */
function launchRun(scene) {
  const go = () => scene.scene.start(SCENES.RUN);
  const bd = scene.backdrop;
  const warpMs = bd && typeof bd.warp === 'function' ? bd.warp({ duration: 700 }) : 0;
  const accent = bd && scene.theme && scene.theme.pal ? scene.theme.pal.cyan : undefined;
  if (warpMs > 0 && scene.time && typeof scene.time.delayedCall === 'function') {
    launchFx(scene, warpMs);
    scene.time.delayedCall(Math.round(warpMs * 0.6), () => sceneTransition(scene, go, { duration: 320, accent }));
    return;
  }
  sceneTransition(scene, go, { accent });
}

/** The launch flourish: menu out left, card out right, footer, tagline and jukebox fade. */
function launchFx(scene, ms) {
  const slide = (o, dx) => {
    if (!o || !o.scene) return;
    const x0 = o.x;
    const a0 = o.alpha;
    tweenProgress(scene, {
      duration: ms,
      ease: Ease.inCubic,
      onUpdate: (p) => { if (o.scene) o.setPosition(x0 + dx * p, o.y).setAlpha(a0 * (1 - p)); },
    });
  };
  slide(scene.menuPanel, -240);
  slide(scene.cardPanel, 180);
  for (const o of [scene.hint, scene.helpButton, scene.postcardButton, scene.museumButton, scene.resumeButton, scene.resumeNote, scene.jukebox && scene.jukebox.panel, scene.sub]) slide(o, 0);
}
