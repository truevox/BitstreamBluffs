/**
 * Game Over -> Cemetery Montage (issue #68). Shows this course's kept past attempts riding beside the run that just
 * ended, then the whole field with a grave where each one fell. Opened with M or the MONTAGE button; never automatic.
 *
 * Sources, read only: the separate local AttemptHistory (the player's PAST ATTEMPTS TO KEEP setting) and this
 * course's existing GhostLibrary roles (Best / Latest / Favorites), deduplicated by run id. Only traces of this exact
 * course (seed + biome mask) and this build's ruleset/terrain revision are drawn; anything else is skipped and
 * counted. Nothing is written anywhere, nothing starts a run, nothing leaves the device.
 */
import { REG } from '../constants.js';
import { View } from './View.js';
import { NeonText } from './Neon.js';
import { fmtInt } from './Format.js';
import { ellipsize } from './PixelFont.js';
import { isReducedMotion } from './Motion.js';
import { CemeteryMontage } from './CemeteryMontage.js';
import { decodeTrace, courseKey } from '../systems/ghost/GhostTape.js';
import { tapeCompatible } from '../systems/ghost/GhostLibrary.js';
import { validPoses, sanitizeAttemptKeep } from '../systems/ghost/AttemptHistory.js';
import { planMontage, deviceBudget, sanitizeMontageStyle } from '../systems/ghost/MontagePlan.js';
import { SIM_REVISION } from '../systems/replay/ruleset.js';

export const MONTAGE_VIEW = Object.freeze({ w: 464, h: 258, y: 6, area: { x: 8, y: 22, w: 448, h: 194 } });

/**
 * Gather the montage's inputs. Pure apart from the two read-only stores; exported for tests.
 * @returns {Promise<{hero:object|null, attempts:object[], skipped:number, reason?:string}>}
 */
export async function gatherMontage({ history, library, tape, simRevision = SIM_REVISION }) {
  const out = { hero: null, attempts: [], skipped: 0 };
  if (!tape || tape.seed === undefined) return { ...out, reason: 'no-run' };
  const key = courseKey(tape.seed, tape.biomeMask);
  if (tapeCompatible(tape) && tape.simRevision === simRevision) {
    const poses = decodeTrace(tape);
    if (validPoses(poses)) out.hero = { meta: { id: tape.runId, distanceM: tape.distanceM || 0, endedAt: tape.endedAt || 0 }, poses };
  }
  const seen = new Set([tape.runId]);
  const rows = [];
  if (history) {
    let kept = [];
    try { kept = await history.attemptsFor(tape.seed, tape.biomeMask, { simRevision, excludeId: tape.runId }); } catch { kept = []; }
    const listed = history.list?.(tape.seed, tape.biomeMask) || [];
    out.skipped += Math.max(0, listed.filter((m) => m.id !== tape.runId).length - kept.length);
    for (const a of kept) { seen.add(a.meta.id); rows.push({ meta: a.meta, poses: a.poses, at: a.meta.endedAt || 0 }); }
  }
  if (library) {
    let ghosts = [];
    try { ghosts = await library.ghostsFor(tape.seed, tape.biomeMask, {}, { simRevision }); } catch { ghosts = []; }
    for (const g of ghosts) {
      const t = g.tape;
      if (!t || seen.has(t.runId) || courseKey(t.seed, t.biomeMask) !== key) continue;
      seen.add(t.runId);
      const poses = decodeTrace(t);
      if (!validPoses(poses)) { out.skipped++; continue; }
      rows.push({ meta: { id: t.runId, distanceM: t.distanceM || 0, endedAt: t.endedAt || 0 }, poses, at: t.endedAt || 0 });
    }
  }
  // Chronological, ties broken by id: the same stores always give the same order (and the same #numbers).
  rows.sort((a, b) => a.at - b.at || (a.meta.id < b.meta.id ? -1 : a.meta.id > b.meta.id ? 1 : 0));
  out.attempts = rows.map(({ meta, poses }) => ({ meta, poses }));
  return out;
}

export class CemeteryMontageView extends View {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{history:object|null, library:object|null, tape:object, heroIsBest?:boolean, onClose:function():void}} o
   */
  constructor(scene, theme, o) {
    const reduced = isReducedMotion(scene);
    super(scene, theme, { w: MONTAGE_VIEW.w, h: MONTAGE_VIEW.h, y: MONTAGE_VIEW.y, title: 'CEMETERY', color: 'lime', onClose: o.onClose,
      hints: reduced ? [{ keys: ['←', '→'], label: 'STEP' }]
        : [{ keys: ['ENTER'], label: 'PLAY' }, { keys: ['←', '→'], label: 'STEP' }, { keys: ['↑', '↓'], label: 'VIEW' }] });
    this.reduced = reduced;
    this.o = o;
    this.montage = null;
    const settings = scene.registry?.get?.(REG.SETTINGS) || {};
    this.style = sanitizeMontageStyle(settings.cemeteryMontage);
    this.keep = sanitizeAttemptKeep(settings.attemptHistoryKeep);
    const a = MONTAGE_VIEW.area;
    this.frame = scene.add.graphics();
    this.frame.fillStyle(theme.color('bg'), 1).fillRect(a.x, a.y, a.w, a.h);
    this.frame.lineStyle(1, theme.color('lime'), 0.35).strokeRect(a.x - 0.5, a.y - 0.5, a.w + 1, a.h + 1);
    this.panel.add(this.frame);
    this.legend = new NeonText(scene, theme, 10, MONTAGE_VIEW.h - 38, 'LOADING PAST ATTEMPTS', { color: 'text', outline: 'none' });
    this.status = new NeonText(scene, theme, 10, MONTAGE_VIEW.h - 19, reduced ? 'STILL VIEW: REDUCE MOTION' : '', { color: 'cyan', outline: 'none' });
    this.panel.add(this.legend);
    this.panel.add(this.status);
    this._onUpdate = (_t, dt) => { if (this.montage && this.alive) { this.montage.update(dt); this._status(); } };
    scene.events?.on?.('update', this._onUpdate);
    this._load();
  }

  async _load() {
    const o = this.o;
    let data;
    try { data = await gatherMontage({ history: o.history, library: o.library, tape: o.tape }); }
    catch { data = { hero: null, attempts: [], skipped: 0 }; }
    if (!this.alive) return;
    this.data = data;
    const budget = deviceBudget();
    const plan = planMontage({ hero: data.hero, attempts: data.attempts, style: this.style, cap: budget.riders, heroIsBest: o.heroIsBest === true });
    if (!plan) { this._empty(data); return; }
    const pal = this.theme;
    this.montage = new CemeteryMontage(this.scene, {
      parent: this.panel, view: MONTAGE_VIEW.area, plan, reduced: this.reduced, budget,
      colors: { hero: pal.color('lime'), past: [pal.color('cyan'), pal.color('magenta'), pal.color('amber')],
        swarm: pal.color('cyan'), grave: pal.color('text'), trail: pal.color('text') },
    });
    const here = plan.heroM === null ? '' : `${plan.riders.at(-1).label} ${fmtInt(plan.heroM)} M  `;
    const shown = plan.pastShown < plan.pastTotal ? `${plan.pastShown} OF ${plan.pastTotal}` : `${plan.pastTotal}`;
    const word = plan.style === 'swarm' ? 'SWARM' : 'PAST';
    this.legend.setText(ellipsize(`${here}${word} ${shown}  FURTHEST PAST ${fmtInt(plan.bestPastM)} M`
      + (data.skipped ? `  ${data.skipped} SKIPPED` : ''), MONTAGE_VIEW.w - 20));
    this._status();
  }

  _empty(data) {
    const msg = this.style === 'off' ? 'MONTAGE IS OFF IN SETTINGS'
      : !this.o.tape ? 'NO RUN TO CELEBRATE'
      : this.keep === 0 && !data.attempts.length ? 'NO PAST ATTEMPTS: KEEPING IS OFF (SETTINGS)'
      : 'NO PAST ATTEMPTS ON THIS COURSE YET';
    this.legend.setText(msg + (data.skipped ? `  (${data.skipped} INCOMPATIBLE)` : ''));
    this.status.setText('');
  }

  _status() {
    const m = this.montage;
    if (!m) return;
    const text = this.reduced ? 'STILL VIEW: REDUCE MOTION'
      : m.playing ? `PLAYING ${m.plan.speed > 1 ? `${m.plan.speed.toFixed(1)}X` : ''}`
        : m.finished ? 'ENTER REPLAYS' : 'PAUSED';
    if (text !== this._lastStatus) { this.status.setText(text); this._lastStatus = text; }
  }

  handleAction(action) {
    if (action === 'cancel' || action === 'montage') { this.close(); return true; }
    const m = this.montage;
    if (!m) return true;
    if (action === 'confirm') m.togglePlay();
    else if (action === 'left') m.step(-1);
    else if (action === 'right') m.step(1);
    else if (action === 'up' || action === 'down') m.toggleMode();
    this._status();
    return true;
  }

  destroy() {
    this.scene?.events?.off?.('update', this._onUpdate);
    try { this.montage?.destroy(); } catch { /* scene already gone */ }
    this.montage = null;
    super.destroy();
  }
}
