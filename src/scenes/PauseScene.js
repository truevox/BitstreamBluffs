/**
 * OWNER: UI engineer.
 * "Pascal's Ledger". Launched ON TOP of the paused RunScene by RunScene (scene.pause(RUN) + scene.launch(PAUSE, {runTimeMs})).
 * Resume: `scene.stop()`, `scene.resume(SCENES.RUN)`, emit EVT.GAME_RESUME {runTimeMs}. Restart (same seed) and Quit to
 * title emit EVT.RUN_ABORT {runId} first (nothing is saved for an aborted run). Also contains the leaderboard,
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
import { fmtClock } from '../ui/Format.js';
import { uiSfx } from '../ui/Sound.js';

export class PauseScene extends Phaser.Scene {
  constructor() {
    super(SCENES.PAUSE);
  }

  /** @param {{runTimeMs:number, runId?:string}} data */
  init(data) {
    this.runTimeMs = (data && data.runTimeMs) || 0;
    this.runIdFromData = (data && data.runId) || '';
  }

  create() {
    this.leaving = false;
    this.view = null;
    this.dim = null;
    const theme = (this.theme = new Theme(this));
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.72).setOrigin(0, 0).setInteractive();
    const px = 30;
    const py = 36;
    const panel = (this.panel = new Panel(this, theme, { x: px, y: py, w: 420, h: 180, color: 'magenta', title: "PASCAL'S LEDGER // PAUSED", fillAlpha: 0.96 }));

    const items = [
      { kind: 'action', label: 'RESUME', color: 'lime', onSelect: () => this.resume() },
      { kind: 'action', label: 'RESTART', color: 'amber', onSelect: () => this.restart() },
      { kind: 'action', label: 'LEADERBOARD', color: 'cyan', onSelect: () => this._open(new LeaderboardView(this, theme, { onClose: () => this._close() })) },
      { kind: 'action', label: 'SETTINGS', color: 'cyan', onSelect: () => this._open(new SettingsView(this, theme, { onClose: () => this._close() })) },
      { kind: 'action', label: 'EXPORT CODE', color: 'cyan', onSelect: () => this._open(new SharecodeView(this, theme, { mode: 'export', onClose: () => this._close() })) },
      { kind: 'action', label: 'IMPORT CODE', color: 'cyan', onSelect: () => this._open(new SharecodeView(this, theme, { mode: 'import', onClose: () => this._close() })) },
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
    col(24, 'RUN TIME', fmtClock(this.runTimeMs), 'lime', 2);
    col(54, 'SEED', ellipsize(seed, 172), 'cyan');
    col(80, 'DAILY RULE', ellipsize(rule.name.toUpperCase(), 172), 'amber');
    panel.add(new NeonText(this, theme, 236, 102, wrapText(rule.description || '', 176, 3), { color: 'text', outline: 'none' }).setAlpha(0.7));
    // W2: the three active missions. Keep the full three-line rule description clear; the panel is
    // extended so the mission bars and ledger line fit without colliding with the hint below.
    const mview = this.registry.get(REG.MISSIONS);
    const mrows = (mview && mview.active) || [];
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
    panel.add(new NeonText(this, theme, 236, 174, 'THE LEDGER NEVER FORGETS.', { color: 'magenta', outline: 'none' }).setAlpha(0.6));

    this.hint = new NeonText(this, theme, GAME_WIDTH / 2, py + 172 + 12, 'ESC RESUME    ↑↓ SELECT    ENTER/SPACE/A CONFIRM', {
      color: 'text', anchor: 'center', vAnchor: 0.5,
    });
    this.hint.setAlpha(0.7);

    this.input_ = new MenuInput(this, (a) => this._onAction(a), { graceMs: 250 });
    this.events.once('shutdown', () => this._close());
  }

  _onAction(action) {
    if (this.leaving) return;
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
    this._close();
    this.dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.7).setOrigin(0, 0).setDepth(400).setInteractive();
    this.view = view;
  }

  _close() {
    if (this.view) this.view.destroy();
    this.view = null;
    if (this.dim) this.dim.destroy();
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
    this.scene.stop();
    this.scene.resume(SCENES.RUN);
    this.game.events.emit(EVT.GAME_RESUME, { runTimeMs: this.runTimeMs });
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

  /** Abort this run and start a new one with the same seed. @returns {void} */
  restart() {
    if (this.leaving) return;
    this.leaving = true;
    uiSfx(this, 'uiSelect');
    this.game.events.emit(EVT.RUN_ABORT, { runId: this._runId() });
    this.scene.stop(SCENES.RUN);
    this.scene.stop(SCENES.UI);
    this.scene.start(SCENES.RUN);
  }

  /** Abort the run and go back to the title screen. @returns {void} */
  quit() {
    if (this.leaving) return;
    this.leaving = true;
    uiSfx(this, 'uiBack');
    this.game.events.emit(EVT.RUN_ABORT, { runId: this._runId() });
    this.scene.stop(SCENES.RUN);
    this.scene.stop(SCENES.UI);
    this.scene.start(SCENES.TITLE);
  }

  update(time, delta) {
    if (this.view && this.view.table) this.view.table.tick(delta);
  }
}
