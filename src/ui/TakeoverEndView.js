/**
 * #72: the small end screen of a Replay Takeover (never Game Over). A takeover is UNRANKED PRACTICE / TAS: nothing was
 * saved, scored or credited. RETRY starts a fresh, independent attempt from the same tick of the same parent tape;
 * BACK returns to the title.
 */
import { View } from './View.js';
import { NeonText } from './Neon.js';
import { Button } from './Button.js';
import { fmtTickTime } from '../systems/replay/Takeover.js';

const CAUSE_LABEL = { bsod: 'CAUGHT BY THE BSOD', quit: 'YOU QUIT', crash: 'CRASHED', hazard: 'HIT A HAZARD', chasm: 'FELL OFF THE WORLD', badLanding: 'BAD LANDING' };

export class TakeoverEndView extends View {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{tick:number, cause?:string, liveTicks?:number, onRetry:function():void, onClose:function():void}} o
   */
  constructor(scene, theme, o) {
    super(scene, theme, { w: 300, h: 124, title: 'TAKEOVER ENDED', color: 'amber', onClose: o.onClose,
      hints: [{ keys: ['ENTER'], label: 'RETRY' }, { keys: ['ESC'], label: 'BACK' }], hintsAt: 'foot' });
    this.onRetry = o.onRetry;
    const text = (x, y, value, color = 'text') => this.panel.add(new NeonText(scene, theme, x, y, value, { color, outline: 'none' }));
    text(12, 22, CAUSE_LABEL[o.cause] || String(o.cause || 'ENDED').toUpperCase(), 'danger');
    text(12, 36, 'UNRANKED PRACTICE / TAS', 'amber');
    text(12, 48, 'NOTHING WAS SAVED: NO SCORE, XP, SHARDS', 'text');
    text(12, 58, 'OR ACHIEVEMENTS', 'text');
    this.retryBtn = new Button(scene, theme, {
      x: 12, y: 74, w: 276, h: 18, label: `RETRY FROM ${fmtTickTime(o.tick)} (TICK ${o.tick})`, color: 'lime', onClick: () => this.retry(),
    });
    this.panel.add(this.retryBtn);
  }

  retry() {
    if (this.alive) this.onRetry();
  }

  handleAction(action) {
    if (action === 'confirm' || action === 'retry') { this.retry(); return true; }
    return super.handleAction(action);
  }
}
