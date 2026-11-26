/**
 * #72: the Replay Takeover picker, opened from Game Over with T. Source = the run that just finished
 * (REG.LAST_GHOST_TAPE). Eligibility is checked UP FRONT: an ineligible tape shows its reason and offers only BACK.
 *
 * Scrub: Left / Right = 1 s, Shift = 5 s, `,` / `.` = one tick (Shift = 10 ticks); gamepad D-pad left/right = 1 s,
 * up/down = 5 s, A = take control, B = back. The tape's pose trace is every 4 ticks, so the preview pose is interpolated
 * between samples. No BSOD gap is shown: a tape carries no per-tick wall position, and this picker will not fake one.
 */
import { View } from './View.js';
import { NeonText } from './Neon.js';
import { Button } from './Button.js';
import { decodeTrace, tracePose } from '../systems/ghost/GhostTape.js';
import { takeoverEligible, fmtTickTime } from '../systems/replay/Takeover.js';
import { fmtInt } from './Format.js';

export const PICKER_BANNER = 'UNRANKED PRACTICE / TAS: NO SCORE, XP, SHARDS OR ACHIEVEMENTS';
const SEC = 120;
const MAP = { x: 12, y: 74, w: 336, h: 58 };

export class TakeoverPicker extends View {
  /**
   * @param {Phaser.Scene} scene @param {import('./Theme.js').Theme} theme
   * @param {{tape:object, rulesetId:string, onClose:function():void, onLaunch:function(number):void}} o
   */
  constructor(scene, theme, o) {
    super(scene, theme, { w: 360, h: 176, title: 'REPLAY TAKEOVER', color: 'amber', onClose: o.onClose,
      hints: [{ keys: ['←', '→'], label: '1 S' }, { keys: ['SHIFT'], label: '5 S' }, { keys: [',', '.'], label: '1 TICK' }], hintsAt: 'foot' });
    this.tape = o.tape;
    this.onLaunch = o.onLaunch;
    this.ctx = { rulesetId: o.rulesetId };
    this.max = Math.max(1, (o.tape && o.tape.endTick | 0) - 1);
    this.tick = Math.max(1, this.max - 3 * SEC);
    this._shift = false;
    // Container.add returns the container, not the child: build, add, then return the NeonText itself.
    const text = (x, y, value, color = 'text') => { const t = new NeonText(scene, theme, x, y, value, { color, outline: 'none' }); this.panel.add(t); return t; };
    text(12, 22, PICKER_BANNER, 'amber');
    this.elig = takeoverEligible(o.tape, 1, this.ctx);
    if (!this.elig.ok) {
      text(12, 40, 'THIS RUN CANNOT BE TAKEN OVER', 'danger');
      text(12, 54, String(this.elig.message).toUpperCase(), 'text');
      text(12, 68, `REASON: ${String(this.elig.reason).toUpperCase()}`, 'text');
      return;
    }
    text(12, 34, `LAST RUN  ${fmtInt(o.tape.distanceM || 0)} M   ${fmtTickTime(o.tape.endTick)}`, 'text');
    this.timeText = text(12, 48, '', 'lime');
    this.tickText = text(12, 60, '', 'cyan');
    this.map = this.scene.add.graphics();
    this.panel.add(this.map);
    this.trace = decodeTrace(o.tape);
    this.goBtn = new Button(scene, theme, { x: 12, y: 142, w: 130, h: 16, label: 'TAKE CONTROL', color: 'lime', onClick: () => this.launch() });
    this.panel.add(this.goBtn);
    this._onWinKey = (e) => this._winKey(e);
    this._onWinKeyUp = (e) => { this._shift = e.shiftKey; };
    if (typeof window !== 'undefined') { window.addEventListener('keydown', this._onWinKey); window.addEventListener('keyup', this._onWinKeyUp); }
    this._paint();
  }

  /** Move to `tick` (clamped to the takeover range) and repaint. Returns the tick actually selected. */
  setTick(tick) {
    this.tick = Math.max(1, Math.min(this.max, Math.round(tick)));
    this._paint();
    return this.tick;
  }

  step(delta) { return this.setTick(this.tick + delta); }

  handleAction(action) {
    if (!this.elig.ok) return action === 'cancel' ? (this.close(), true) : true;
    const big = this._shift ? 5 : 1;
    switch (action) {
      case 'left': this.step(-SEC * big); break;
      case 'right': this.step(SEC * big); break;
      case 'up': this.step(5 * SEC); break;
      case 'down': this.step(-5 * SEC); break;
      case 'confirm': this.launch(); break;
      case 'cancel': this.close(); break;
      default: break;
    }
    return true;
  }

  _winKey(e) {
    this._shift = e.shiftKey;
    if (!this.alive || e.ctrlKey || e.metaKey || e.altKey) return;
    const unit = e.shiftKey ? 10 : 1;
    if (e.code === 'Comma') this.step(-unit);
    else if (e.code === 'Period') this.step(unit);
  }

  launch() {
    if (!this.alive || !this.elig.ok) return;
    this.onLaunch(this.tick);
  }

  _paint() {
    if (!this.timeText) return;
    this.timeText.setText(`TAKE OVER AT ${fmtTickTime(this.tick)}`);
    this.tickText.setText(`TICK ${this.tick} / ${this.max}`);
    const g = this.map;
    g.clear();
    g.lineStyle(1, this.theme.color('cyan'), 0.35);
    g.strokeRect(MAP.x, MAP.y, MAP.w, MAP.h);
    const n = Math.floor(this.trace.length / 3);
    if (n < 2) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = this.trace[i * 3], y = this.trace[i * 3 + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const sx = (x) => MAP.x + 2 + ((x - x0) / Math.max(1, x1 - x0)) * (MAP.w - 4);
    const sy = (y) => MAP.y + 2 + ((y - y0) / Math.max(1, y1 - y0)) * (MAP.h - 4);
    g.lineStyle(1, this.theme.color('cyan'), 0.8);
    g.beginPath();
    const stride = Math.max(1, Math.floor(n / 168));
    for (let i = 0; i < n; i += stride) { const px = sx(this.trace[i * 3]), py = sy(this.trace[i * 3 + 1]); if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); }
    g.strokePath();
    // The takeover point: the pose is interpolated between the 4-tick trace samples (it is never faked beyond them).
    const pose = tracePose(this.trace, this.tick);
    if (pose) {
      g.fillStyle(this.theme.color('amber'), 1);
      g.fillRect(Math.round(sx(pose.x)) - 2, Math.round(sy(pose.y)) - 2, 5, 5);
    }
    // scrub bar
    const bx = MAP.x, by = MAP.y + MAP.h + 4, bw = MAP.w;
    g.fillStyle(this.theme.color('cyan'), 0.25);
    g.fillRect(bx, by, bw, 3);
    g.fillStyle(this.theme.color('lime'), 1);
    g.fillRect(bx + Math.round(((this.tick - 1) / Math.max(1, this.max - 1)) * (bw - 3)), by - 2, 3, 7);
  }

  destroy() {
    if (typeof window !== 'undefined') {
      if (this._onWinKey) window.removeEventListener('keydown', this._onWinKey);
      if (this._onWinKeyUp) window.removeEventListener('keyup', this._onWinKeyUp);
    }
    this._onWinKey = this._onWinKeyUp = null;
    super.destroy();
  }
}

