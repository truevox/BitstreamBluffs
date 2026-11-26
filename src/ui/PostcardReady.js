/**
 * #67: the UIScene half of Playable Postcards, in its own file so UIScene needs two lines.
 *  - READY of your own takeover: "P / PAD LB = POSTCARD" opens the PostcardView (the sim stays frozen at tick N; the READY
 *    key is ignored while the view is open).
 *  - READY of a received postcard: the sender's challenge in plain language, and UNRANKED PRACTICE.
 *  - LIVE postcard: the window countdown (SURVIVE N s).
 * Driven by EVT.TAKEOVER_STATE only. No network, no storage.
 */
import { GAME_WIDTH, SCENES } from '../constants.js';
import { EVT } from '../events.js';
import { NeonText } from './Neon.js';
import { PostcardView } from './PostcardView.js';
import { shareFromReady, DEFAULT_WINDOW_SEC } from '../systems/replay/PostcardShare.js';
import { describeChallenge } from '../systems/replay/PostcardChallenge.js';
import { POSTCARD_SOURCE } from '../systems/replay/Takeover.js';

/** Pad button used at READY: LB (index 4). Free there: the sim is frozen and READY reads only hop / confirm / pause. */
export const POSTCARD_PAD_BUTTON = 4;

export class PostcardReady {
  /** @param {Phaser.Scene} scene the UIScene @param {import('./Theme.js').Theme} theme @param {Phaser.GameObjects.Container} [parent] */
  constructor(scene, theme, parent) {
    this.scene = scene;
    this.theme = theme;
    const cx = GAME_WIDTH / 2;
    this.hint = new NeonText(scene, theme, cx, 132, '', { color: 'amber', anchor: 'center', outline: 'dark' });
    this.lines = [0, 1, 2, 3, 4].map((i) => new NeonText(scene, theme, cx, 144 + i * 10, '', { color: i === 0 ? 'cyan' : 'text', anchor: 'center', outline: 'dark' }));
    this.count = new NeonText(scene, theme, cx, 28, '', { color: 'amber', anchor: 'center', outline: 'dark', scale: 2 });
    this.all = [this.hint, ...this.lines, this.count];
    for (const t of this.all) { t.setVisible(false); if (parent) parent.add(t); else scene.add.existing(t); }
    this.view = null;
    this.opening = false;
    this.generation = 0;
    this.ready = false;
    this.padPrev = false;
    this._on = (p) => this.onState(p);
    this._key = (e) => { if (e && e.code === 'KeyP' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) this.open(); };
    scene.game.events.on(EVT.TAKEOVER_STATE, this._on);
    if (typeof window !== 'undefined') window.addEventListener('keydown', this._key);
    this._poll = () => this.pollPad();
    scene.events.on('update', this._poll);
    const off = () => this.destroy();
    scene.events.once('shutdown', off);
    scene.events.once('destroy', off);
  }

  run() { return this.scene.scene.get(SCENES.RUN); }

  onState(p) {
    if (!p || !this.hint || !this.hint.scene) return;
    const run = this.run();
    const d = run && run.takeover && run.takeover.descriptor;
    this.ready = p.phase === 'ready';
    const show = (v) => this.all.forEach((t) => t !== this.count && t.setVisible(v));
    if (p.phase === 'ready' && d) {
      if (d.source === POSTCARD_SOURCE) {
        const rows = d.postcard && d.postcard.challenge ? describeChallenge(d.postcard.challenge) : [];
        this.hint.setText(`POSTCARD: SURVIVE ${d.postcard ? d.postcard.windowTicks / 120 : '?'} S   UNRANKED PRACTICE`);
        this.lines.forEach((l, i) => l.setText(rows[i] || ''));
      } else {
        this.hint.setText('P / PAD LB = MAKE A POSTCARD OF THIS MOMENT');
        this.lines.forEach((l) => l.setText(''));
      }
      show(true);
      this.count.setVisible(false);
    } else if (p.phase === 'window') {
      show(false);
      this.count.setText(`${(p.remainingTicks / 120).toFixed(1)} S`);
      this.count.setVisible(true);
    } else {
      show(false);
      this.count.setVisible(false);
    }
  }

  pollPad() {
    if (!this.ready || this.view) { this.padPrev = false; return; }
    let down = false;
    try {
      const pads = (typeof navigator !== 'undefined' && navigator.getGamepads && navigator.getGamepads()) || [];
      for (const g of pads) if (g && g.connected && g.buttons[POSTCARD_PAD_BUTTON] && g.buttons[POSTCARD_PAD_BUTTON].pressed) down = true;
    } catch (e) { /* no gamepad API */ }
    if (down && !this.padPrev) this.open();
    this.padPrev = down;
  }

  /** Open the postcard view for the frozen READY state. A no-op anywhere else (and for a received postcard). */
  async open() {
    const run = this.run();
    const t = run && run.takeover;
    if (this.view || this.opening || !this.ready || !t || t.phase !== 'ready' || t.descriptor.source === POSTCARD_SOURCE) return;
    this.opening = true;
    const generation = ++this.generation;
    t.modal = true; // RunScene ignores the READY key while the view is open
    const windowSec = DEFAULT_WINDOW_SEC;
    let first;
    try { first = await shareFromReady(run, { windowSec }); }
    catch (e) { first = { ok: false, message: 'could not encode this postcard' }; }
    if (generation !== this.generation) return;
    this.opening = false;
    if (!this.scene.scene.isActive() || run.takeover !== t || t.phase !== 'ready') { t.modal = false; return; }
    const close = () => {
      try { if (this.view) this.view.destroy(); } catch (e) { /* ignore */ }
      this.view = null;
      if (run.takeover === t) t.modal = false;
    };
    this.view = new PostcardView(this.scene, this.theme, { share: first, windowSec, rebuild: (sec) => shareFromReady(run, { windowSec: sec }), onClose: close });
    this.view.panel.setDepth(900);
  }

  destroy() {
    this.generation++;
    this.opening = false;
    if (this._on) this.scene.game?.events?.off(EVT.TAKEOVER_STATE, this._on);
    this._on = null;
    if (typeof window !== 'undefined' && this._key) window.removeEventListener('keydown', this._key);
    this._key = null;
    if (this._poll) this.scene.events?.off('update', this._poll);
    try { if (this.view) this.view.destroy(); } catch (e) { /* ignore */ }
    this.view = null;
    const run = this.run();
    if (run && run.takeover) run.takeover.modal = false;
    for (const t of this.all) { try { t && t.destroy(); } catch (e) { /* already gone */ } }
    this.all = [];
  }
}
