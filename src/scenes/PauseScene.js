/**
 * OWNER: UI engineer.
 * "Pascal's Ledger". Launched ON TOP of the paused RunScene by RunScene (scene.pause(RUN) + scene.launch(PAUSE, {runTimeMs})).
 * Resume: `scene.stop()`, `scene.resume(SCENES.RUN)`, emit EVT.GAME_RESUME {runTimeMs,runId,reason,pauseToken,gym}. Restart (same seed) and Quit to
 * title emit EVT.RUN_ABORT {runId,reason,pauseToken} first (nothing is saved for an aborted run). Also contains the leaderboard,
 * settings (palette, screen shake, volumes, tilt controls - only through updateSetting()) and sharecode export / import.
 * Optional launch data `runId` is used for RUN_ABORT; otherwise it is read from UIScene.runId.
 */
import Phaser from 'phaser';
import { SCENES, REG, GAME_WIDTH, GAME_HEIGHT } from '../constants.js';
import { EVT } from '../events.js';
import { DailyPatch } from '../systems/DailyPatch.js';
import { Theme } from '../ui/Theme.js';
import { NeonText } from '../ui/Neon.js';
import { ellipsize, wrapText } from '../ui/PixelFont.js';
import { columnRows } from '../ui/MissionsLayout.js';
import { Panel } from '../ui/Panel.js';
import { MenuList } from '../ui/MenuList.js';
import { MenuInput } from '../ui/MenuInput.js';
import { LeaderboardView, SettingsView, SharecodeView } from '../ui/Views.js';
import { openDim, closeDim, transitionIn, fadeTo, tweenProgress, isReducedMotion, motionMs, Ease } from '../ui/Motion.js';
import { mixColor } from '../ui/MenuArt.js';
import { addScanlines } from '../ui/Scanlines.js';
import { fmtClock } from '../ui/Format.js';
import { uiSfx } from '../ui/Sound.js';
import { JukeboxHUD } from '../ui/JukeboxHUD.js';
import { cosmeticRandom } from '../systems/CosmeticRandom.js';
import { guestPracticeEligible } from '../systems/ghost/GuestPractice.js';
import { pauseRestartTakeover, pauseQuitTakeover } from '../ui/TakeoverLauncher.js';
import {canCaptureManualPauseCandidate} from '../systems/savestate/pausedCandidate.js';
import {suspendManualRun} from '../systems/savestate/manualSuspendController.js';

export class PauseScene extends Phaser.Scene {
  constructor() {
    super(SCENES.PAUSE);
  }

  /** @param {{runTimeMs:number, runId?:string}} data */
  init(data) {
    this.runTimeMs = (data && data.runTimeMs) || 0;
    this.runIdFromData = (data && data.runId) || '';
    this.manualPauseToken = (data && data.pauseToken) || '';
    this.manualPauseGym = data?.gym === true;
    this.manualPauseGuest = data?.practice === true;
    this.manualPauseTakeover = data?.takeover === true;
  }

  create() {
    this.leaving = false;
    this.guestPractice = this.manualPauseGuest || this.scene?.get?.(SCENES.RUN)?.guestPractice === true;
    // #72: a takeover is UNRANKED PRACTICE / TAS: no ranked items, RESTART = retry from the same tick, QUIT = the takeover end screen.
    this.takeoverRun = this.manualPauseTakeover || !!this.scene?.get?.(SCENES.RUN)?.takeover;
    this.gymPractice = this.registry.get(REG.BSOD_GYM) === true || this.guestPractice || this.takeoverRun;
    this.view = null;
    this.dim = null;
    const theme = (this.theme = new Theme(this));
    this.reduced = isReducedMotion(this);
    // Freeze-frame: the run stays visible behind a dark, magenta-tinted shade (palette-bound, so the
    // colour-blind palette and UI themes apply), with a faint CRT glitch layer on top of it.
    this.shade = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.74).setOrigin(0, 0).setInteractive();
    theme.bind((pal) => { if (this.shade && this.shade.scene) this.shade.setFillStyle(mixColor(0x000000, pal.magenta, 0.16), 0.74); });
    this.glitchG = this.add.graphics().setDepth(1);
    this.glitchT = 1400;
    this.glitchLeft = 0;
    this._buildHeader(theme);
    const px = 30;
    const py = 36;
    this.canSuspend=canCaptureManualPauseCandidate(this.scene.get(SCENES.RUN));
    const panelH=this.canSuspend?200:180;
    const panel = (this.panel = new Panel(this, theme, { x: px, y: py, w: 420, h: panelH, color: 'magenta', title: this.takeoverRun ? 'TAKEOVER // UNRANKED' : this.guestPractice ? 'GUEST GHOST // UNRANKED' : this.gymPractice ? 'BSOD GYM // PRACTICE' : "PASCAL'S LEDGER", fillAlpha: 0.96 }));

    const items = [
      { kind: 'action', label: 'RESUME', color: 'lime', onSelect: () => this.resume() },
      { kind: 'action', label: 'RESTART', color: 'amber', onSelect: () => this.restart() },
      ...(!this.gymPractice ? [{ kind: 'action', label: 'LEADERBOARD', color: 'cyan', onSelect: () => this._open(new LeaderboardView(this, theme, { onClose: () => this._close() })) }] : []),
      { kind: 'action', label: 'SETTINGS', color: 'cyan', onSelect: () => this._open(new SettingsView(this, theme, { onClose: () => this._close() })) },
      ...(!this.gymPractice ? [
        { kind: 'action', label: 'EXPORT CODE', color: 'cyan', onSelect: () => this._open(new SharecodeView(this, theme, { mode: 'export', onClose: () => this._close() })) },
        { kind: 'action', label: 'IMPORT CODE', color: 'cyan', onSelect: () => this._open(new SharecodeView(this, theme, { mode: 'import', onClose: () => this._close() })) },
      ] : []),
      ...(this.canSuspend?[{kind:'action',label:'SUSPEND RUN',color:'lime',onSelect:()=>this.suspend()}]:[]),
      { kind: 'action', label: 'QUIT TO TITLE', color: 'magenta', onSelect: () => this.quit() },
    ];
    this.menu = new MenuList(this, theme, { x: 6, y: 22, w: 214, rowH: 20, items, scale: 2, parent: panel });

    // run info column
    const info = DailyPatch.getDailyInfo();
    const rule = info.rule || { name: '-', description: '' };
    const seed = String(this.registry.get(REG.SEED) || '-').toUpperCase();
    const col = (y, label, value, color, scale = 1) => {
      panel.add(new NeonText(this, theme, 236, y, label, { color: 'text', outline: 'none' }).setAlpha(0.55));
      panel.add(new NeonText(this, theme, 236, y + 10, value, { color, scale, outline: 'dark' }));
    };
    if (this.gymPractice) {
      // No seed-sharing, Daily-rule or progression promises inside a sandbox.
      col(24, 'MODE', this.takeoverRun ? 'TAKEOVER' : 'PRACTICE', 'lime', 2);
      col(54, 'RETRIES', 'UNLIMITED', 'cyan');
      col(80, 'XP / SHARDS', 'NONE', 'amber');
      panel.add(new NeonText(this, theme, 236, 110, 'NOT RANKED', {
        color: 'magenta', outline: 'none',
      }).setAlpha(0.9));
    } else {
      col(24, 'RUN TIME', fmtClock(this.runTimeMs), 'lime', 2);
      col(54, 'SEED', ellipsize(seed, 172), 'cyan');
      col(80, 'DAILY RULE', ellipsize(rule.name.toUpperCase(), 172), 'amber');
      panel.add(new NeonText(this, theme, 236, 102, wrapText(rule.description || '', 176, 3), { color: 'text', outline: 'none' }).setAlpha(0.7));
    }
    // W2: the three active missions. Keep the full three-line rule description clear; the panel is
    // extended so the mission bars and ledger line fit without colliding with the hint below.
    const mview = this.registry.get(REG.MISSIONS);
    const mrows = this.gymPractice ? [] : (mview && mview.active) || [];
    if (mrows.length) {
      const geom = columnRows({ x: 236, y: 138, w: 172, count: Math.min(3, mrows.length), rowH: 11, barH: 2 });
      panel.add(new NeonText(this, theme, 236, 128, 'MISSIONS', { color: 'cyan', outline: 'none' }).setAlpha(0.8));
      mrows.slice(0, 3).forEach((row, i) => {
        const r = geom.rows[i];
        const b = geom.bars[i];
        if (!r || !b) return;
        // Ellipsized to the row's own text box (which already excludes the inline bar), not to the
        // whole panel width: a title that ran under its bar would be the same class of defect as a bar
        // drawn over a title.
        const label = new NeonText(this, theme, r.x, r.y, ellipsize(row.title, geom.textW), {
          color: row.done ? 'lime' : 'text', outline: 'none',
        });
        label.setAlpha(0.9);
        panel.add(label);
        const g = this.add.graphics();
        g.fillStyle(0x1a2b3a, 1);
        g.fillRect(b.x, b.y, b.w, b.h);
        const frac = Math.max(0, Math.min(1, row.fraction || 0));
        if (frac > 0) {
          g.fillStyle(row.done ? 0x9cff57 : theme.color('cyan'), 1);
          g.fillRect(b.x, b.y, Math.max(1, Math.round(b.w * frac)), b.h);
        }
        panel.add(g);
      });
    }
    // Under the menu column, clear of the panel's inner border hairline (panel floor 180, hairline at 176).
    panel.add(new NeonText(this, theme, 10, this.canSuspend?186:165,
      this.gymPractice ? 'LEARN. RETRY. REPEAT.' : 'THE LEDGER NEVER FORGETS.',
      { color: 'magenta', outline: 'none' }).setAlpha(0.6));
    this.suspendStatus=this.canSuspend?new NeonText(this,theme,236,169,'',{
      color:'amber',outline:'none'
    }):null;
    if(this.suspendStatus)panel.add(this.suspendStatus);

    this.hint = new NeonText(this, theme, GAME_WIDTH / 2, py + panelH - 8 + 12, 'ESC RESUME    ↑↓ SELECT    ENTER/SPACE/A CONFIRM', {
      color: 'text', anchor: 'center', vAnchor: 0.5,
    });
    this.hint.setAlpha(0.7);

    addScanlines(this, 1, { roll: true });
    this._playIntro();

    this.input_ = new MenuInput(this, (a) => this._onAction(a), { graceMs: 250 });
    // The same shared soundtrack; pause scene does not own a music player.
    this.jukebox=new JukeboxHUD(this,theme,{x:335,y:4});
    this.events.once('shutdown',()=>{
      this.jukebox?.destroy();this.jukebox=null;
      this._close();
    });
  }

  /** Neon PAUSED header with a chromatic split (cyan left, magenta right, `danger` never used). */
  _buildHeader(theme) {
    const x = GAME_WIDTH / 2;
    const y = 10;
    const mk = (dx, color, alpha, outline) => new NeonText(this, theme, x + dx, y, 'PAUSED', { color, scale: 2, outline, anchor: 'center' }).setAlpha(alpha);
    this.hdrA = mk(-1, 'cyan', 0.5, 'none');
    this.hdrB = mk(1, 'magenta', 0.5, 'none');
    this.hdr = mk(0, 'text', 1, 'dark');
    this.hdrX = x;
    this.hdrParts = [this.hdrA, this.hdrB, this.hdr];
    this.hdrBar = this.add.graphics();
    theme.bind((pal) => {
      const g = this.hdrBar;
      if (!g || !g.scene) return;
      g.clear();
      g.fillStyle(pal.magenta, 0.35);
      g.fillRect(x - 70, 28, 140, 1);
      g.fillStyle(pal.magenta, 0.95);
      g.fillRect(x - 30, 28, 60, 1);
      g.fillStyle(pal.cyan, 0.7);
      g.fillRect(x - 12, 30, 24, 1);
    });
  }

  /** Open: shade fades in, header glitches in, the panel CRT-zips open. Reduced motion: short fades only. */
  _playIntro() {
    // The CRT panel's geometry is animated during the opening transition.
    // Interactive rows can physically move under a mouse click and select a
    // NEIGHBORING destructive command (notably Quit instead of Suspend).
    // Disable all action zones AND keyboard confirmation until layout settles.
    this._menuOpening=true;
    this.menu?.rows?.forEach(({zone})=>zone.disableInteractive());
    this.time.delayedCall(motionMs(340,this.reduced),()=>{
      if(!this.sys?.isActive?.())return;
      this.menu?.rows?.forEach(({zone})=>{if(zone?.scene)zone.setInteractive();});
      this._menuOpening=false;
    });
    const panel = this.panel;
    const parts = [...this.hdrParts, this.hdrBar, this.hint];
    const targetA = parts.map((o) => o.alpha);
    this.shade.setAlpha(0);
    fadeTo(this, this.shade, 1, motionMs(180, this.reduced));
    parts.forEach((o) => o.setAlpha(0));
    tweenProgress(this, {
      duration: motionMs(260, this.reduced),
      delay: this.reduced ? 0 : 60,
      ease: Ease.outQuad,
      onUpdate: (p) => {
        parts.forEach((o, i) => { if (o.scene) o.setAlpha(targetA[i] * p); });
        if (this.reduced) return;
        // split opens wide and snaps shut
        const d = Math.round(7 * (1 - p));
        if (this.hdrA.scene) { this.hdrA.setX(this.hdrX - 1 - d); this.hdrB.setX(this.hdrX + 1 + d); }
      },
      onComplete: () => { this.hdrA.setX(this.hdrX - 1); this.hdrB.setX(this.hdrX + 1); },
    });
    transitionIn(this, panel, { w: panel.w, h: panel.h, color: this.theme.color('magenta'), duration: 240 });
  }

  /** Close: everything fades quickly, then `done` runs the real action. */
  _playOutro(done) {
    const objs = [this.shade, this.panel, this.hint, this.hdrBar, ...this.hdrParts];
    const from = objs.map((o) => o.alpha);
    tweenProgress(this, {
      duration: motionMs(110, this.reduced),
      ease: Ease.inQuad,
      onUpdate: (p) => objs.forEach((o, i) => { if (o.scene) o.setAlpha(from[i] * (1 - p)); }),
      onComplete: done,
    });
  }

  _onAction(action) {
    if (this.leaving||this._menuOpening) return;
    if (this.view) {
      this.view.handleAction(action);
      return;
    }
    if (action === 'cancel') {
      this.resume();
      return;
    }
    this.menu.handleAction(action);
  }

  _open(view) {
    // As on the Title: the dim is kept across a view-to-view hop and faded in/out by Motion otherwise.
    const keepDim = this.dim;
    this.dim = null;
    this._close();
    this.dim = openDim(this, keepDim, 0.7);
    this.view = view;
  }

  _close() {
    if (this.view) this.view.destroy();
    this.view = null;
    closeDim(this, this.dim);
    this.dim = null;
  }

  _runId() {
    if (this.runIdFromData) return this.runIdFromData;
    const ui = this.scene.get(SCENES.UI);
    return (ui && ui.runId) || '';
  }

  /** Resume the run exactly as the contract describes. @returns {void} */
  resume() {
    if (this.leaving) return;
    this.leaving = true;
    uiSfx(this, 'uiBack');
    this._playOutro(() => this._doResume());
  }

  _doResume() {
    this.scene.stop();
    this.scene.resume(SCENES.RUN);
    try {
      this.game.events.emit(EVT.GAME_RESUME, {
        runTimeMs: this.runTimeMs, runId: this._runId(),
        reason: 'manual', pauseToken: this.manualPauseToken,
        gym: this.manualPauseGym,
      });
    } catch (e) { console.warn('Manual resume observer failed; continuing', e); }
    this._flushPadEdges();
  }

  /**
   * The key that resumed the game (Esc / Start) also sets the pad's one-shot `pressed.pause` edge; RunScene would
   * read it on its first frame and pause again. Consume pending edges right after the current input dispatch.
   */
  _flushPadEdges() {
    const input = this.registry.get(REG.INPUT);
    if (!input || !input.poll) return;
    const flush = () => {
      try {
        input.poll();
      } catch (e) {
        /* ignore */
      }
    };
    flush();
    setTimeout(flush, 0);
    setTimeout(flush, 30);
  }

  /** One-use local-only Suspend: retain ORIGINAL GhostTape and tick; never
   * navigate away until the entire exact-build native candidate is persisted.
   */
  async suspend(){
    if(this.leaving||!this.canSuspend)return;
    this.leaving=true;
    this.suspendStatus?.setText('SAVING...');
    const saved=await suspendManualRun(this,Phaser);
    if(!saved.ok){
      this.leaving=false;
      this.suspendStatus?.setText('SUSPEND FAILED: '+saved.code.replace(/-/g,' ').toUpperCase());
      return;
    }
    uiSfx(this,'uiSelect');
    // Do not generate RUN_ABORT: the complete causal run was saved and its
    // original recorder will continue in a fresh scene. The old scene cannot
    // be continued once the one-use snapshot has successfully been stored.
    this.scene.stop(SCENES.RUN);
    this.scene.stop(SCENES.UI);
    this.scene.start(SCENES.TITLE);
  }

  /** Abort this run and start a new one with the same seed. @returns {void} */
  restart() {
    if (this.leaving) return;
    if (this.takeoverRun) { this.leaving = true; uiSfx(this, 'uiSelect'); pauseRestartTakeover(this); return; }
    if(this.guestPractice){
      const guest=this.scene.get(SCENES.RUN)?.guestPracticeTape;
      // A missing/stale guest cannot silently become a ranked restart.
      if(!guestPracticeEligible(guest)){this.quit();return;}
      this.registry.set(REG.GUEST_PRACTICE,guest);
      this.registry.set(REG.DAILY_OFFICIAL,false);
      this.registry.set(REG.BSOD_GYM,false);
    }
    this.leaving = true;
    uiSfx(this, 'uiSelect');
    try {
      this.game.events.emit(EVT.RUN_ABORT, {
        runId: this._runId(), reason: 'restart', pauseToken: this.manualPauseToken,
      });
    } catch (e) { console.warn('Restart observer failed; continuing', e); }
    this.scene.stop(SCENES.RUN);
    this.scene.stop(SCENES.UI);
    this.scene.start(SCENES.RUN);
  }

  /** Abort the run and go back to the title screen. @returns {void} */
  quit() {
    if (this.leaving) return;
    this.leaving = true;
    uiSfx(this, 'uiBack');
    if (this.takeoverRun && pauseQuitTakeover(this)) return;
    try {
      this.game.events.emit(EVT.RUN_ABORT, {
        runId: this._runId(), reason: 'quit', pauseToken: this.manualPauseToken,
      });
    } catch (e) { console.warn('Quit observer failed; continuing', e); }
    // Clear the practice flag before showing the normal title/menu.
    this.registry.set(REG.BSOD_GYM, false);
    this.registry.remove(REG.GUEST_PRACTICE);
    this.scene.stop(SCENES.RUN);
    this.scene.stop(SCENES.UI);
    this.scene.start(SCENES.TITLE);
  }

  update(time, delta) {
    if (this.view && this.view.table) this.view.table.tick(delta);
    this._tickGlitch(delta);
  }

  /**
   * Freeze-frame glitch: every couple of seconds the paused picture tears for ~100 ms (a few displaced
   * tinted strips, the header split jitters). Still under reduced motion.
   */
  _tickGlitch(delta) {
    const g = this.glitchG;
    if (!g || !g.scene || this.leaving) return;
    if (isReducedMotion(this)) { if (this.glitchLeft !== -1) { g.clear(); this.glitchLeft = -1; } return; }
    this.glitchT -= delta;
    if (this.glitchLeft > 0) {
      this.glitchLeft -= delta;
      if (this.glitchLeft <= 0) {
        g.clear();
        this.hdrA.setX(this.hdrX - 1);
        this.hdrB.setX(this.hdrX + 1);
        this.hdr.setX(this.hdrX);
      }
    }
    if (this.glitchT > 0) return;
    this.glitchT = cosmeticRandom('pause/glitch').int(1800, 3600);
    this.glitchLeft = 110;
    const pal = this.theme.pal;
    g.clear();
    const n = cosmeticRandom('pause/glitch').int(2, 4);
    for (let i = 0; i < n; i++) {
      const y = cosmeticRandom('pause/glitch').int(0, GAME_HEIGHT - 12);
      const h = cosmeticRandom('pause/glitch').int(2, 9);
      g.fillStyle(i % 2 ? pal.cyan : pal.magenta, 0.1);
      g.fillRect(0, y, GAME_WIDTH, h);
      g.fillStyle(pal.text, 0.12);
      g.fillRect(0, y, GAME_WIDTH, 1);
    }
    const j = cosmeticRandom('pause/glitch').int(2, 4);
    this.hdrA.setX(this.hdrX - j);
    this.hdrB.setX(this.hdrX + j);
    this.hdr.setX(this.hdrX + cosmeticRandom('pause/glitch').int(-1, 1));
  }
}
