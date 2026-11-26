/**
 * #66 Crash Coach: the screen opened from Game Over with C. It shows
 *   - the cause, one claim per row with the field that backs it in a muted sub-line,
 *   - live search progress and an honest summary,
 *   - the Butterfly Meter (one bar per searched variation: green survived, red crashed, amber unstable; height = divergence),
 *   - SHOW ALTERNATIVE (a validated survivor's path against the original), and PRACTICE THIS MOMENT (a #72 takeover).
 * It owns no simulation and writes nothing: the hook feeds it progress and results and acts on its two callbacks.
 */
import { View } from './View.js';
import { NeonText } from './Neon.js';
import { Button } from './Button.js';
import { measureText } from './PixelFont.js';
import { butterflyBars } from '../systems/coach/Butterfly.js';
import { decodeTrace, TRACE_EVERY } from '../systems/ghost/GhostTape.js';
import {
  COACH_BANNER, COACH_ASSUMPTION, claimRows, wrapText, progressLine, buttonStates, unavailableLine,
} from './CrashCoachModel.js';

const W = 456;
const H = 248;
const X0 = 12;
const INNER_W = W - 2 * X0;
const CLAIMS_Y = 33;
const ROW_H = 16;
const PROGRESS_Y = 133;
const SUMMARY_Y = 150;
const STRIP = { x: X0, y: 172, w: INNER_W, h: 30 };
const SENS_Y = 207;
const BTN_Y = 221;
const COLOR_KEY = { survived: 'lime', crashed: 'danger', unstable: 'amber', error: 'text' };

export class CrashCoachView extends View {
  /**
   * @param {Phaser.Scene} scene @param {import('./Theme.js').Theme} theme
   * @param {{cause:object, ctx:object, onClose:function():void, onPractice:function():void}} o
   *   ctx = CrashCoachModel.coachContext(...) (ok or a refusal)
   */
  constructor(scene, theme, o) {
    super(scene, theme, { w: W, h: H, title: 'CRASH COACH', color: 'amber', onClose: o.onClose });
    this.ctx = o.ctx;
    this.cause = o.cause;
    this.onPractice = o.onPractice;
    this.phase = o.ctx && o.ctx.ok ? 'running' : 'unavailable';
    this.result = null;
    this.progress = null;
    this.showingAlt = false;
    const text = (x, y, value, color = 'text', alpha = 1) => {
      const t = new NeonText(scene, theme, x, y, value, { color, outline: 'none' });
      if (alpha !== 1) t.setAlpha(alpha);
      this.panel.add(t);
      return t;
    };
    this.text = text;
    text(X0, 21, COACH_BANNER, 'amber');
    this.claimObjs = [];
    claimRows(o.cause).forEach((r, i) => {
      const y = CLAIMS_Y + i * ROW_H;
      this.claimObjs.push(text(X0, y, r.main, 'text'), text(X0 + 4, y + 8, r.sub, 'cyan', 0.55));
    });
    this.progressText = text(X0, PROGRESS_Y, '', 'cyan');
    this.barG = scene.add.graphics();
    this.panel.add(this.barG);
    this.summaryObjs = [];
    this.sensText = text(X0, SENS_Y, '', 'lime');
    this.stripG = scene.add.graphics();
    this.panel.add(this.stripG);
    this.altG = scene.add.graphics();
    this.panel.add(this.altG);
    this.altObjs = [];
    this.altBtn = new Button(scene, theme, { x: X0, y: BTN_Y, w: 128, h: 24, label: 'SHOW ALTERNATIVE', hint: 'ENTER', color: 'lime', onClick: () => this.toggleAlternative() });
    this.practiceBtn = new Button(scene, theme, { x: X0 + 134, y: BTN_Y, w: 150, h: 24, label: 'PRACTICE THIS MOMENT', hint: 'N', color: 'cyan', onClick: () => this.practice() });
    this.panel.add(this.altBtn);
    this.panel.add(this.practiceBtn);
    this.canPractice = !!(o.ctx && o.ctx.ok);
    this._paint();
  }

  /** Called by the hook after every searched candidate. */
  setProgress(p) {
    if (!this.alive) return;
    this.progress = p;
    this._paint();
  }

  /** Called once with runCoach's result. */
  setResult(result) {
    if (!this.alive) return;
    this.phase = 'done';
    this.result = result;
    this._paint();
  }

  setFailed(message) {
    if (!this.alive) return;
    this.phase = 'done';
    this.failure = String(message || 'the search failed');
    this._paint();
  }

  handleAction(action) {
    if (action === 'cancel') { this.close(); return true; }
    if (action === 'confirm') { if (this.phase === 'done' && this.result && this.result.survivors.length) this.toggleAlternative(); return true; }
    if (action === 'alt') { this.practice(); return true; } // N is MenuInput's 'alt' action
    return true;
  }

  practice() {
    if (!this.alive || !this.canPractice) return;
    this.onPractice();
  }

  toggleAlternative() {
    if (!this.alive || !buttonStates({ phase: this.phase, result: this.result, canPractice: this.canPractice }).alternative) return;
    this.showingAlt = !this.showingAlt;
    this._paint();
  }

  _clear(list) { for (const o of list.splice(0)) { try { o.destroy(); } catch (e) { /* already gone */ } } }

  _paint() {
    if (!this.alive || !this.panel) return;
    const st = buttonStates({ phase: this.phase, result: this.result, canPractice: this.canPractice });
    this.altBtn.setDisabled(!st.alternative);
    this.altBtn.setLabel(this.showingAlt ? 'HIDE ALTERNATIVE' : 'SHOW ALTERNATIVE');
    this.practiceBtn.setDisabled(!st.practice);
    const showClaims = !this.showingAlt;
    for (const o of this.claimObjs) o.setVisible(showClaims);
    this.progressText.setVisible(showClaims);
    this.barG.setVisible(showClaims);
    this._clear(this.summaryObjs);
    this.barG.clear();
    this.stripG.clear();
    this.altG.clear();
    this._clear(this.altObjs);
    if (this.phase === 'unavailable') {
      this.progressText.setText('');
      this._summary(unavailableLine(this.ctx));
      this.sensText.setText('');
      return;
    }
    if (this.showingAlt) { this._paintAlternative(); return; }
    if (this.phase === 'running') {
      this.progressText.setText(progressLine(this.progress));
      const frac = this.progress && this.progress.planned ? this.progress.searched / this.progress.planned : 0;
      this.barG.fillStyle(this.theme.color('cyan'), 0.25);
      this.barG.fillRect(X0, PROGRESS_Y + 10, INNER_W, 3);
      this.barG.fillStyle(this.theme.color('cyan'), 1);
      this.barG.fillRect(X0, PROGRESS_Y + 10, Math.round(INNER_W * Math.min(1, frac)), 3);
      this._summary(COACH_ASSUMPTION);
      this.sensText.setText('');
      this._paintStrip(this.progress && this.progress.points);
      return;
    }
    // done
    if (this.failure) {
      this.progressText.setText('');
      this._summary(`THE SEARCH FAILED: ${this.failure.toUpperCase()}`);
      this.sensText.setText('');
      return;
    }
    const r = this.result;
    this.progressText.setText(r.cancelled ? 'SEARCH CANCELLED' : 'SEARCH FINISHED');
    this._summary(`${r.summary} ${COACH_ASSUMPTION}.`.toUpperCase());
    this.sensText.setText(String(r.sensitivity.summary).toUpperCase());
    this._paintStrip(r.sensitivity.points, r);
  }

  _summary(str) {
    const lines = wrapText(str, INNER_W, measureText, 2);
    lines.forEach((l, i) => this.summaryObjs.push(this.text(X0, SUMMARY_Y + i * 9, l, 'text')));
  }

  /** The Butterfly Meter: one bar per variation, left to right by offset. Colour = outcome, height = divergence. */
  _paintStrip(points, result) {
    const g = this.stripG;
    g.lineStyle(1, this.theme.color('cyan'), 0.3);
    g.strokeRect(STRIP.x, STRIP.y, STRIP.w, STRIP.h);
    if (!points || !points.length) return;
    const horizon = result ? Math.max(1, result.untilTick - result.branchTick) : 600;
    const bars = butterflyBars({ points }, { maxHeight: STRIP.h - 4, horizonTicks: horizon });
    const slot = Math.max(2, Math.min(10, Math.floor((STRIP.w - 4) / bars.length)));
    bars.forEach((b, i) => {
      const h = Math.max(2, Math.round(b.height));
      g.fillStyle(this.theme.color(COLOR_KEY[b.outcome] || 'text'), b.outcome === 'crashed' ? 0.8 : 1);
      g.fillRect(STRIP.x + 2 + i * slot, STRIP.y + STRIP.h - 2 - h, Math.max(1, slot - 1), h);
    });
  }

  /** The first validated survivor's path against the original, from the branch tick. */
  _paintAlternative() {
    const r = this.result;
    const surv = r.survivors[0];
    const area = { x: X0, y: CLAIMS_Y, w: INNER_W, h: 112 };
    const g = this.altG;
    g.lineStyle(1, this.theme.color('cyan'), 0.3);
    g.strokeRect(area.x, area.y, area.w, area.h);
    const tape = this.ctx.tape;
    const trace = decodeTrace(tape);
    const from = Math.floor(r.branchTick / TRACE_EVERY);
    const orig = [];
    for (let i = from; i * 3 + 1 < trace.length; i++) orig.push(trace[i * 3], trace[i * 3 + 1]);
    const alt = surv.poseTrace ? surv.poseTrace.xy : [];
    const all = [...orig, ...alt];
    const label = (y, str, color) => this.altObjs.push(this.text(X0 + 4, y, str, color));
    label(area.y + 3, 'ORIGINAL: ENDED IN THE CRASH', 'danger');
    label(area.y + 12, `ALTERNATIVE: ${String(surv.label).toUpperCase()}`, 'lime');
    if (all.length < 4) { label(area.y + 30, 'NO PATH SAMPLES TO DRAW', 'text'); return; }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < all.length; i += 2) { x0 = Math.min(x0, all[i]); x1 = Math.max(x1, all[i]); y0 = Math.min(y0, all[i + 1]); y1 = Math.max(y1, all[i + 1]); }
    const pad = 6, top = 24;
    const k = Math.min((area.w - 2 * pad) / Math.max(1, x1 - x0), (area.h - top - pad) / Math.max(1, y1 - y0));
    const sx = (x) => area.x + pad + (x - x0) * k;
    const sy = (y) => area.y + top + (y - y0) * k;
    const line = (pts, color, alpha) => {
      g.lineStyle(1, this.theme.color(color), alpha);
      g.beginPath();
      for (let i = 0; i < pts.length; i += 2) { if (i === 0) g.moveTo(sx(pts[i]), sy(pts[i + 1])); else g.lineTo(sx(pts[i]), sy(pts[i + 1])); }
      g.strokePath();
    };
    line(orig, 'danger', 0.9);
    line(alt, 'lime', 1);
    if (orig.length >= 2) { g.fillStyle(this.theme.color('danger'), 1); g.fillRect(Math.round(sx(orig[orig.length - 2])) - 2, Math.round(sy(orig[orig.length - 1])) - 2, 5, 5); }
    if (alt.length >= 2) { g.fillStyle(this.theme.color('lime'), 1); g.fillRect(Math.round(sx(alt[alt.length - 2])) - 2, Math.round(sy(alt[alt.length - 1])) - 2, 5, 5); }
    this.progressText.setText('');
    this._summary(`${r.summary} ${COACH_ASSUMPTION}.`.toUpperCase());
  }

  destroy() {
    this._clear(this.summaryObjs);
    this._clear(this.altObjs);
    super.destroy();
  }
}
