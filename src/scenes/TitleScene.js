/**
 * OWNER: UI engineer.
 * Title / main menu. Menu: Start Run (random seed), Daily Run (UTC-date seed + today's Daily Patch rule),
 * Enter Seed, Leaderboard, Settings. Operable by keyboard, gamepad and touch/mouse. Writes the chosen seed to
 * registry REG.SEED, unlocks audio on first input (MenuInput does this) and starts SCENES.RUN.
 */
import Phaser from 'phaser';
import { SCENES, REG, GAME_WIDTH, GAME_HEIGHT } from '../constants.js';
import { DailyPatch } from '../systems/DailyPatch.js';
import { parseSeedMask } from '../systems/SaveStore.js';
import { unlockedBiomeIds, enabledBiomeMask } from '../systems/ProfileStore.js';
import { Theme } from '../ui/Theme.js';
import { NeonText } from '../ui/Neon.js';
import { measureText, ellipsize } from '../ui/PixelFont.js';
import { Panel } from '../ui/Panel.js';
import { MenuList } from '../ui/MenuList.js';
import { MenuInput } from '../ui/MenuInput.js';
import { Backdrop } from '../ui/Backdrop.js';
import { buildTitleMissionList } from '../ui/MissionsUi.js';
import { TITLE_BEST_X, TITLE_BEST_Y, TITLE_BANDS, titleMenuLayout } from '../ui/MissionsLayout.js';
import { addScanlines } from '../ui/Scanlines.js';
import { LeaderboardView, SettingsView, SeedView, ProfileView, ShopView } from '../ui/Views.js';
import { titleBadgeLayout } from '../ui/ProfileLayout.js';
import { randomSeed, idToLabel, fmtInt } from '../ui/Format.js';
import { uiSfx } from '../ui/Sound.js';

const CONTROLS_A = [['W', 'PUSH'], ['A/D', 'TILT'], ['A+D', 'TUCK'], ['S', 'BRAKE'], ['SPACE', 'HOP']];
const CONTROLS_B = [['SHIFT', 'RESET'], ['← →', 'HELI SPIN'], ['↑', 'AIR BRAKE'], ['↓', 'CHUTE'], ['ESC', 'PAUSE']];

export class TitleScene extends Phaser.Scene {
  constructor() {
    super(SCENES.TITLE);
  }

  create() {
    this.starting = false;
    this.view = null;
    this.dim = null;
    this.glitchUntil = 0;
    this.nextGlitch = 2500;
    const theme = (this.theme = new Theme(this));
    theme.bind((pal) => this.cameras.main.setBackgroundColor(pal.bg));
    this.backdrop = new Backdrop(this, theme, { horizon: 228, alpha: 0.9 });
    this.daily = DailyPatch.getDailyInfo();

    this._buildLogo();
    this._buildMenu();
    this._buildLevelBadge();
    this._buildControls();
    this._buildDailyStrip();
    this._buildMissions();
    // BEST moved off centre: the W2 mission list occupies the left column of this band, so a centred
    // BEST line ran straight through it (Luna's W2 finding 3). Geometry lives in MissionsLayout.
    this.bestText = new NeonText(this, theme, TITLE_BEST_X, TITLE_BEST_Y, '', { color: 'lime', anchor: 'right', vAnchor: 0.5, outline: 'none' });
    this._loadBest();
    // GAME_HEIGHT - 8, i.e. glyphs 258..266: the mission list needed 228..257 to give each of its three
    // rows a full 8 px glyph box at a 9 px pitch (a bar drawn under a label at an 8 px pitch is what
    // sliced the text in half), so the hint moved down 4 px rather than the list clipping its glyphs.
    this.hint = new NeonText(this, theme, GAME_WIDTH / 2, GAME_HEIGHT - 8, '↑↓ SELECT   ENTER/SPACE/A CONFIRM   TAP ANY ITEM', {
      color: 'text', anchor: 'center', vAnchor: 0.5,
    });
    this.hint.setAlpha(0.7);
    addScanlines(this);

    this.input_ = new MenuInput(this, (a) => this._onAction(a));
    this.events.once('shutdown', () => this._closeView());
    this.cameras.main.fadeIn(180, 5, 6, 15);
  }

  _buildLogo() {
    const theme = this.theme;
    this.logo = [];
    const lines = [
      { text: 'BITSTREAM', y: 8, scale: 4, color: 'cyan' },
      { text: 'BLUFFS', y: 40, scale: 4, color: 'magenta' },
    ];
    for (const ln of lines) {
      const total = measureText(ln.text) * ln.scale;
      let x = Math.round(GAME_WIDTH / 2 - total / 2);
      [...ln.text].forEach((ch, i) => {
        const t = new NeonText(this, theme, x, ln.y, ch, { color: ln.color, scale: ln.scale, outline: 'dark' });
        this.logo.push({ t, baseY: ln.y, baseX: x, i, base: ln.color, line: ln.text });
        x += (measureText(ch) + 1) * ln.scale;
      });
    }
    this.sub = new NeonText(this, theme, GAME_WIDTH / 2, 76, 'A DOWNHILL NEON TRICK RACE', { color: 'amber', anchor: 'center', outline: 'none' });
    this.sub.setAlpha(0.9);
  }

  _buildMenu() {
    const theme = this.theme;
    // Panel height is DERIVED from the row count, not hard-coded, so a future row cannot be silently
    // clipped. It is NOT derived times `scale`: MenuList already treats rowH as the pitch and only the
    // glyphs are scaled 2x, so multiplying by scale reported a 228px panel for 112px of rows — which is how
    // the panel came to be drawn over the DAILY PATCH strip (CC Friday's W4 defect 3).
    //
    // Six rows at a 16px pitch occupy 92..188 inside a band that ends at 196; a seventh would reach 204 and
    // overrun the strip at 202. BOTH extra entries therefore live in PROFILE, which is where they belong
    // anyway: W5's ACHIEVEMENTS grid (the spec puts it in Profile) and W4's SHARD SHOP (Profile already
    // shows what you own and what it looks like).
    const items = [
      { kind: 'action', label: 'START RUN', color: 'lime', onSelect: () => this.startRun(randomSeed()) },
      { kind: 'action', label: 'DAILY RUN', color: 'magenta', sub: ellipsize(this.daily.rule ? this.daily.rule.name.toUpperCase() : '', 80), onSelect: () => this.startRun(this.daily.seed, DailyPatch.biomeMaskForDate()) },
      { kind: 'action', label: 'ENTER SEED', color: 'cyan', onSelect: () => this._openSeed() },
      { kind: 'action', label: 'PROFILE', color: 'lime', onSelect: () => this._openView(new ProfileView(this, theme, { onClose: () => this._closeView(), onShop: () => this._openView(new ShopView(this, theme, { onClose: () => this._closeView() })) })) },
      { kind: 'action', label: 'LEADERBOARD', color: 'amber', onSelect: () => this._openView(new LeaderboardView(this, theme, { onClose: () => this._closeView() })) },
      { kind: 'action', label: 'SETTINGS', color: 'cyan', onSelect: () => this._openView(new SettingsView(this, theme, { onClose: () => this._closeView() })) },
    ];
    // Declared AFTER `items`: reading it first was a temporal-dead-zone ReferenceError that blanked the
    // whole Title screen at boot.
    // Geometry comes from MissionsLayout.titleMenuLayout() so the row count, the panel height and the
    // DAILY PATCH strip are one tested relationship instead of three numbers in a scene nobody can test.
    const geo = titleMenuLayout(items.length);
    if (!geo.fits) {
      // Fail visibly in development rather than shipping a row under the daily strip: the menu is full.
      console.warn(`Title menu does not fit: ${items.length} rows reach y${geo.lastRowBottom}, band ends at ${TITLE_BANDS.menu.y + TITLE_BANDS.menu.h}`);
    }
    this.menuPanel = new Panel(this, theme, {
      x: geo.x, y: geo.y, w: geo.w, h: geo.h, color: 'cyan', fillAlpha: 0.88,
    });
    this.menu = new MenuList(this, theme, { x: 4, y: 4, w: 208, rowH: geo.rowH, items, scale: geo.scale, parent: this.menuPanel });
  }

  /**
   * The level badge lives in the top-left corner, left of the 4x logo: the centred slot under the
   * logo is already taken by the subtitle (y 76-83), so a centred badge collided with it and with the
   * menu panel at y 92. Geometry comes from ProfileLayout so it is overlap-tested in Jest.
   */
  _buildLevelBadge() {
    const theme = this.theme;
    const layout = titleBadgeLayout({
      profile: this.registry.get(REG.PROFILE),
      levels: (this.registry.get(REG.CONTENT) || {}).progression,
    });
    if (!layout) return;
    this.levelBadge = [];
    for (const it of layout.items) {
      const t = new NeonText(this, theme, it.x, it.y, it.text, { color: it.color, outline: it.outline, alpha: it.alpha });
      this.levelBadge.push(t);
    }
  }

  _buildControls() {
    const theme = this.theme;
    const p = new Panel(this, theme, { x: 252, y: 92, w: 204, h: 104, color: 'magenta', title: 'CONTROLS', fillAlpha: 0.88 });
    const col = (rows, x) => rows.forEach(([k, a], i) => {
      p.add(new NeonText(this, theme, x, 22 + i * 11, k, { color: 'amber', outline: 'none' }));
      p.add(new NeonText(this, theme, x + 34, 22 + i * 11, a, { color: 'text', outline: 'none' }));
    });
    col(CONTROLS_A, 8);
    col(CONTROLS_B, 106);
    p.add(new NeonText(this, theme, 8, 79, 'PAD  STICK=TILT  RT=PUSH', { color: 'cyan', outline: 'none' }).setAlpha(0.85));
    p.add(new NeonText(this, theme, 8, 90, 'FACE BTNS=TRICKS  TOUCH=ON-SCREEN', { color: 'cyan', outline: 'none' }).setAlpha(0.85));
    this.controlsPanel = p;
  }

  _loadBest() {
    try {
      const store = this.registry.get(REG.SAVE_STORE);
      Promise.resolve(store.getRecentRuns(1000)).then((runs) => {
        if (!Array.isArray(runs) || !runs.length || !this.bestText.scene) return;
        const m = Math.max(...runs.map((r) => r.distanceM || 0));
        const sc = Math.max(...runs.map((r) => r.score || 0));
        if (m > 0) this.bestText.setText(`BEST ${fmtInt(m)} M   ${fmtInt(sc)} PTS`);
      }).catch(() => {});
    } catch (e) { /* cosmetic */ }
  }

  /**
   * W2: the three active missions, in the only free band on this screen (below the DAILY PATCH
   * strip). Geometry and overlap are unit-tested in MissionsLayout; this only supplies data.
   */
  _buildMissions() {
    try {
      const view = this.registry.get(REG.MISSIONS);
      const rows = (view && view.active) || [];
      if (!rows.length) return;
      this.missionsPanel = buildTitleMissionList(this, this.theme, rows);
    } catch (e) { /* cosmetic: a missing mission service must never block the Title screen */ }
  }

  _buildDailyStrip() {
    const theme = this.theme;
    const p = new Panel(this, theme, { x: 24, y: 202, w: 432, h: 26, color: 'amber', fillAlpha: 0.88 });
    this.dailyHeadText = new NeonText(this, theme, 8, 4, '', { color: 'amber', outline: 'none' });
    p.add(this.dailyHeadText);
    this.dailyDescText = new NeonText(this, theme, 8, 15, '', { color: 'text', outline: 'none' });
    this.dailyDescText.setAlpha(0.85);
    // right-aligned chase info: countdown on the first line, streak + today's best on the second
    this.nextPatchText = new NeonText(this, theme, 424, 4, '', { color: 'cyan', anchor: 'right', outline: 'none' });
    this.chaseText = new NeonText(this, theme, 424, 15, '', { color: 'lime', anchor: 'right', outline: 'none' });
    p.add([this.dailyDescText, this.nextPatchText, this.chaseText]);
    this.dailyPanel = p;
    this._applyDaily();
    this._refreshDaily();
    // slow refresh (countdown minutes, midnight rollover); the scene clock stops with the scene
    this.time.addEvent({ delay: 15000, loop: true, callback: () => this._refreshDaily() });
  }

  /** Rebuild everything that shows this.daily: strip header, description and the DAILY RUN menu sub label (its seed is read lazily). */
  _applyDaily() {
    const rule = this.daily.rule || { name: '-', description: '', id: '' };
    this.dailyHeadText.setText(`DAILY PATCH ${this.daily.dateKey} UTC: ${rule.name.toUpperCase()}`);
    this.dailyDesc = rule.description || idToLabel(rule.id);
    const row = this.menu && this.menu.rows[1];
    if (row && row.sub) row.sub.setText(ellipsize(rule.name.toUpperCase(), 80));
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
      const parts = [];
      if (st && st.streak > 0) parts.push(`STREAK ${st.streak}`);
      if (today && today.attempts > 0) {
        parts.push(`TODAY'S BEST ${fmtInt(today.bestScore)}`);
        key = 'lime';
      } else {
        parts.push('NOT PLAYED TODAY');
      }
      chase = parts.join('   ');
    } catch (e) { /* cosmetic: leave the default */ }
    this.chaseText.setText(chase).setColorKey(key);
    // the description gets whatever width the right-hand line leaves
    const room = 416 - measureText(chase) - 12;
    this.dailyDescText.setText(ellipsize(this.dailyDesc, Math.max(60, room)));
  }

  _openSeed() {
    this._openView(new SeedView(this, this.theme, {
      onClose: () => this._closeView(),
      onSubmit: (seed) => this.startRun(seed || randomSeed()),
    }));
  }

  _openView(view) {
    this._closeView();
    this.dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.8).setOrigin(0, 0).setDepth(400).setInteractive();
    this.view = view;
  }

  _closeView() {
    if (this.view) this.view.destroy();
    this.view = null;
    if (this.dim) this.dim.destroy();
    this.dim = null;
  }

  _onAction(action) {
    if (this.starting) return;
    if (this.view) {
      this.view.handleAction(action);
      return;
    }
    this.menu.handleAction(action);
  }

  /**
   * @param {string} seed seed text, optionally with a `seed@mask` suffix (W3).
   * @param {number} [maskOverride] explicit mask (daily run); wins over any suffix.
   * @returns {void}
   */
  startRun(seed, maskOverride) {
    if (this.starting) return;
    this.starting = true;
    const biomeDefs = Object.values((this.registry.get(REG.CONTENT) || {}).biomes || {});
    const parsed = parseSeedMask(seed, biomeDefs);
    this.registry.set(REG.SEED, parsed.seed || seed);
    // W3 mask precedence, highest first:
    //   1. an explicit maskOverride (the Daily: date-derived, identical for every player)
    //   2. a `seed@mask` suffix (a shared seed must reproduce the sender's world)
    //   3. the profile's own enabled-and-unlocked signatures (an ordinary run)
    // Falling back to 0 at step 3 is what CC Friday caught: START RUN ignored the profile entirely.
    const mask = Number.isFinite(maskOverride)
      ? maskOverride >>> 0
      : parsed.hadSuffix
        ? parsed.biomeMask
        : enabledBiomeMask(this.registry.get(REG.PROFILE), biomeDefs);
    this.registry.set(REG.BIOME_MASK, mask);
    uiSfx(this, 'uiSelect', { pitch: 1.3 });
    this._closeView();
    this.scene.start(SCENES.RUN);
  }

  update(time) {
    this.backdrop.update(time);
    const t = time;
    const glitching = t < this.glitchUntil;
    if (!glitching && t > this.nextGlitch) {
      this.glitchUntil = t + 130;
      this.nextGlitch = t + 2500 + Math.random() * 3500;
      this.glitchPick = new Set([Math.floor(Math.random() * this.logo.length), Math.floor(Math.random() * this.logo.length)]);
    }
    for (const L of this.logo) {
      const wave = Math.round(Math.sin(t * 0.004 + L.i * 0.55 + (L.line === 'BLUFFS' ? 1.5 : 0)) * 2);
      let dx = 0;
      if (glitching && this.glitchPick && this.glitchPick.has(this.logo.indexOf(L))) dx = (Math.random() < 0.5 ? -3 : 3);
      L.t.setPosition(L.baseX + dx, L.baseY + wave);
      const sweep = (Math.floor(t / 90) + L.i) % 16 === 0 || (Math.floor(t / 90) + L.i + 5) % 16 === 0 ? 'text' : L.base;
      L.t.setColorKey(sweep);
    }
    this.sub.setAlpha(0.75 + 0.2 * Math.sin(t * 0.004));
  }
}
