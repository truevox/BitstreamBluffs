/**
 * Settings -> PAST ATTEMPTS (issue #68, owner decision 2026-11-25). The player chooses how many past attempts per
 * course the Cemetery Montage keeps (default 5, 0 = keep none, MAX_ATTEMPT_KEEP shown as the limit), its style, and
 * can clear the history. Everything here is about the separate local attempt history; ghost roles, leaderboards and
 * replay evidence are untouched.
 */
import { ATTEMPT_HISTORY_KEY } from '../systems/ghost/attemptHistoryService.js';
import { REG } from '../constants.js';
import { updateSetting } from '../services.js';
import { View } from './View.js';
import { MenuList } from './MenuList.js';
import { NeonText } from './Neon.js';
import { uiSfx } from './Sound.js';
import { MAX_ATTEMPT_KEEP, sanitizeAttemptKeep, sanitizeMontageStyle } from '../systems/ghost/montageSettings.js';

/** A second CLEAR press must come within this long, or the confirmation lapses. */
export const CLEAR_CONFIRM_MS = 4000;

/** Stepper choices 0..MAX, with the two ends spelled out so the limit is never hidden. */
export function keepOptions() {
  return Array.from({ length: MAX_ATTEMPT_KEEP + 1 }, (_, n) => ({
    value: n, label: n === 0 ? '0 (OFF)' : n === MAX_ATTEMPT_KEEP ? `${n} (MAX)` : String(n),
  }));
}

/** '123 KB' / '1.4 MB'. */
export function fmtBytes(n) {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
}

export class AttemptHistoryView extends View {
  constructor(scene, theme, o) {
    super(scene, theme, { w: 380, h: 196, title: 'PAST ATTEMPTS', color: 'lime', onClose: o.onClose,
      hints: [{ keys: ['↑', '↓'], label: 'SELECT' }, { keys: ['←', '→'], label: 'CHANGE' }] });
    const game = scene.game;
    this.game = game;
    this.history = game.registry.get(ATTEMPT_HISTORY_KEY) || null;
    const settings = () => game.registry.get(REG.SETTINGS) || {};
    this._armedUntil = 0;
    this._timer = null;
    const items = [
      { kind: 'choice', label: 'MONTAGE STYLE', options: [
        { value: 'montage', label: 'MONTAGE' }, { value: 'swarm', label: 'SWARM' }, { value: 'off', label: 'OFF' }],
        get: () => sanitizeMontageStyle(settings().cemeteryMontage), set: (v) => updateSetting(game, 'cemeteryMontage', v) },
      { kind: 'choice', label: 'PAST ATTEMPTS TO KEEP', options: keepOptions(),
        get: () => sanitizeAttemptKeep(settings().attemptHistoryKeep),
        set: (v) => { updateSetting(game, 'attemptHistoryKeep', v); this._later(() => this._stats(), 60); } },
      { kind: 'action', label: 'CLEAR HISTORY', color: 'magenta', sub: 'ALL COURSES', onSelect: () => this._clear() },
    ];
    this.menu = new MenuList(scene, theme, { x: 10, y: 22, w: 360, rowH: 16, items, color: 'lime', parent: this.panel });
    const line = (y, text, color = 'text', alpha = 0.75) => {
      const t = new NeonText(scene, theme, 14, y, text, { color, outline: 'none' });
      t.setAlpha(alpha);
      this.panel.add(t);
      return t;
    };
    this.statsLine = line(78, '', 'cyan', 1);
    line(94, `KEEPS UP TO ${MAX_ATTEMPT_KEEP} PER COURSE, 12 MB IN ALL. 0 KEEPS NONE.`);
    line(106, 'LOWERING THE NUMBER DELETES THE OLDEST AT ONCE;');
    line(118, 'RAISING IT CANNOT BRING DELETED ATTEMPTS BACK.');
    line(130, 'POSES ONLY, ON THIS DEVICE. NEVER UPLOADED. BEST,');
    line(142, 'FAVORITE AND REPLAY-EVIDENCE GHOSTS ARE SEPARATE.');
    this.status = line(this.h - 19, '', 'lime', 1);
    this._stats();
  }

  _stats() {
    if (!this.alive || !this.statsLine) return;
    const s = this.history?.stats?.() || { attempts: 0, bytes: 0, courses: 0 };
    const where = this.history ? (this.history.kind === 'idb' ? 'SAVED ON DEVICE' : 'THIS SESSION ONLY') : 'UNAVAILABLE';
    this.statsLine.setText(`STORED ${s.attempts} ON ${s.courses} COURSES, ${fmtBytes(s.bytes)}  ${where}`);
  }

  _later(fn, ms) {
    try { this.scene.time?.delayedCall?.(ms, () => { if (this.alive) fn(); }); } catch { fn(); }
  }

  _setClearLabel(armed) {
    const row = this.menu?.rows?.[2];
    row?.label?.setText(armed ? 'CONFIRM CLEAR' : 'CLEAR HISTORY');
    row?.sub?.setText(armed ? 'PRESS AGAIN TO DELETE' : 'ALL COURSES');
  }

  /** Two presses: the first arms (CLEAR_CONFIRM_MS), the second deletes every kept attempt in this store only. */
  async _clear() {
    const now = Date.now();
    if (!this.history) { this.status.setText('NO HISTORY STORE'); return; }
    if (now > this._armedUntil) {
      this._armedUntil = now + CLEAR_CONFIRM_MS;
      this._setClearLabel(true);
      this.status.setText(`DELETE ${this.history.stats().attempts} PAST ATTEMPTS?`);
      this._later(() => { if (Date.now() >= this._armedUntil) { this._setClearLabel(false); this.status.setText(''); } }, CLEAR_CONFIRM_MS + 20);
      return;
    }
    this._armedUntil = 0;
    this._setClearLabel(false);
    const n = await this.history.clear();
    if (!this.alive) return;
    uiSfx(this.scene, 'uiBack');
    this.status.setText(`CLEARED ${n} PAST ATTEMPTS`);
    this._stats();
  }

  handleAction(action) {
    if (action === 'cancel') { this.close(); return true; }
    return this.menu.handleAction(action);
  }

  destroy() {
    this.menu = null;
    super.destroy();
  }
}
