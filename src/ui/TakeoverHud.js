/**
 * #72: the Replay Takeover HUD banner, driven only by EVT.TAKEOVER_STATE. SEEKING n% while the prefix is re-simulated,
 * READY while the sim is frozen at tick N, hidden once control is live. A separate file so UIScene needs two lines.
 */
import { GAME_WIDTH } from '../constants.js';
import { EVT } from '../events.js';
import { NeonText } from './Neon.js';
import { fmtTickTime } from '../systems/replay/Takeover.js';

export class TakeoverHud {
  /** @param {Phaser.Scene} scene the UIScene @param {import('./Theme.js').Theme} theme @param {Phaser.GameObjects.Container} [parent] */
  constructor(scene, theme, parent) {
    this.scene = scene;
    const cx = GAME_WIDTH / 2;
    this.title = new NeonText(scene, theme, cx, 96, '', { color: 'amber', anchor: 'center', outline: 'dark', scale: 2 });
    this.sub = new NeonText(scene, theme, cx, 118, '', { color: 'cyan', anchor: 'center', outline: 'dark' });
    for (const t of [this.title, this.sub]) { t.setVisible(false); if (parent) parent.add(t); else scene.add.existing(t); }
    this._on = (p) => this.onState(p);
    scene.game.events.on(EVT.TAKEOVER_STATE, this._on);
    const off = () => this.destroy();
    scene.events.once('shutdown', off);
    scene.events.once('destroy', off);
  }

  onState(p) {
    if (!p || !this.title || !this.title.scene) return;
    if (p.phase === 'seeking') {
      this.title.setText(`SEEKING ${p.pct}%`);
      this.sub.setText(`TICK ${p.tick} / ${p.target}   UNRANKED PRACTICE / TAS`);
      this.title.setVisible(true); this.sub.setVisible(true);
    } else if (p.phase === 'ready') {
      this.title.setText('READY');
      this.sub.setText(`AT ${fmtTickTime(p.tick)} (TICK ${p.tick})   PRESS SPACE / ENTER / A TO TAKE CONTROL`);
      this.title.setVisible(true); this.sub.setVisible(true);
    } else {
      this.title.setVisible(false); this.sub.setVisible(false);
    }
  }

  destroy() {
    if (this._on) this.scene.game?.events?.off(EVT.TAKEOVER_STATE, this._on);
    this._on = null;
    for (const t of [this.title, this.sub]) { try { t && t.destroy(); } catch (e) { /* already gone */ } }
    this.title = this.sub = null;
  }
}
