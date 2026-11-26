/**
 * #67: where a postcard attempt ends: SURVIVED the window, CRASHED at +x.xs (a fatal crash or a BSOD catch inside it), or QUIT.
 * Never Game Over, never a record: UNRANKED PRACTICE. RETRY = an independent attempt from the same descriptor (unlimited);
 * COPY REPLY CODE = a `bb-postcard-reply` built from the live suffix inside the window (local clipboard only, no network).
 */
import { View } from './View.js';
import { NeonText } from './Neon.js';
import { Button } from './Button.js';
import { fmtTickTime } from '../systems/replay/Takeover.js';

export const POSTCARD_END_BANNER = 'UNRANKED PRACTICE: NOT LEADERBOARD ELIGIBLE';

/** The headline for an outcome. Pure. `crashOffsetTicks` / 120 gives the "+x.xs". */
export function outcomeHeadline(outcome) {
  if (!outcome) return { text: 'ENDED', color: 'amber' };
  if (outcome.result === 'survived') return { text: 'SURVIVED', color: 'lime' };
  if (outcome.result === 'crashed') return { text: `CRASHED AT +${(outcome.crashOffsetTicks / 120).toFixed(1)}S`, color: 'danger' };
  return { text: 'YOU QUIT', color: 'amber' };
}

export class PostcardEndView extends View {
  /**
   * @param {Phaser.Scene} scene @param {import('./Theme.js').Theme} theme
   * @param {{tick:number, outcome:object|null, replyAvailable:boolean, onRetry:function():void, onClose:function():void,
   *   onReply:function():Promise<{ok:boolean, message?:string}>}} o
   */
  constructor(scene, theme, o) {
    super(scene, theme, { w: 320, h: 140, title: 'POSTCARD RESULT', color: 'amber', onClose: o.onClose,
      hints: [{ keys: ['ENTER'], label: 'RETRY' }, { keys: ['C'], label: 'REPLY' }, { keys: ['ESC'], label: 'BACK' }], hintsAt: 'foot' });
    this.onRetry = o.onRetry;
    this.onReply = o.onReply;
    const text = (x, y, value, color = 'text', scale = 1) => { const t = new NeonText(scene, theme, x, y, value, { color, outline: 'none', scale }); this.panel.add(t); return t; };
    const head = outcomeHeadline(o.outcome);
    this.headline = text(12, 22, head.text, head.color, 2);
    text(12, 44, POSTCARD_END_BANNER, 'amber');
    text(12, 54, 'NOTHING WAS SAVED: NO SCORE, XP, SHARDS OR RECORD', 'text');
    this.retryBtn = new Button(scene, theme, { x: 12, y: 68, w: 296, h: 16, label: `RETRY FROM ${fmtTickTime(o.tick)} (UNLIMITED)`, color: 'lime', onClick: () => this.retry() });
    this.replyBtn = new Button(scene, theme, { x: 12, y: 88, w: 296, h: 16, label: 'COPY REPLY CODE', color: 'cyan', onClick: () => this.reply() });
    this.replyBtn.setDisabled(!o.replyAvailable);
    this.panel.add(this.retryBtn); this.panel.add(this.replyBtn);
    this.status = text(12, 108, o.replyAvailable ? 'THE REPLY SAYS HOW YOU DID, UNRANKED' : 'NO REPLY FOR A QUIT ATTEMPT', 'text');
    this._key = (e) => { if (e && e.code === 'KeyC' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) this.reply(); };
    if (typeof window !== 'undefined') window.addEventListener('keydown', this._key);
  }

  retry() { if (this.alive) this.onRetry(); }

  async reply() {
    if (!this.alive || this.replyBtn.disabled) return;
    const r = await this.onReply();
    if (this.alive) this.status.setText(r.ok ? 'REPLY CODE COPIED' : String(r.message || 'COULD NOT COPY').toUpperCase().slice(0, 56));
  }

  handleAction(action) {
    if (action === 'confirm' || action === 'retry') { this.retry(); return true; }
    return super.handleAction(action);
  }

  destroy() {
    if (typeof window !== 'undefined' && this._key) window.removeEventListener('keydown', this._key);
    this._key = null;
    super.destroy();
  }
}
