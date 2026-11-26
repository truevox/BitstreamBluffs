/**
 * #67: open a postcard from the Title screen: paste its code, or open a `.bbpostcard` file from this device. Everything is local:
 * the file is read with FileReader in the page, nothing is fetched, uploaded or stored. Nothing is imported until the player
 * presses OPEN; a refused postcard says why and starts nothing. A good one goes decode -> same-build check -> takeover
 * (fingerprint-only) -> READY.
 */
import { View } from './View.js';
import { DomTextBox } from './DomTextBox.js';
import { NeonText } from './Neon.js';
import { Button } from './Button.js';
import { openPostcardText } from '../systems/replay/PostcardOpen.js';
import { currentPostcardIdentity, POSTCARD_EXT } from '../systems/replay/PostcardShare.js';
import { MAX_ENCODED_POSTCARD_CHARS } from '../systems/replay/Postcard.js';

/** The Title chip that opens this view (centre column, above HOW TO PLAY). Screen coordinates. */
export const POSTCARD_CHIP = Object.freeze({ x: 226, y: 222, w: 80, h: 14 });

export class PostcardOpenView extends View {
  /**
   * @param {Phaser.Scene} scene @param {import('./Theme.js').Theme} theme
   * @param {{onClose:function():void, onOpen:function(object, object):void}} o onOpen(descriptor, postcard) starts the takeover
   */
  constructor(scene, theme, o) {
    super(scene, theme, { w: 420, h: 176, y: 40, title: 'OPEN POSTCARD', color: 'amber', onClose: o.onClose,
      hints: [{ keys: ['CTRL+ENTER'], label: 'OPEN' }, { keys: ['ESC'], label: 'BACK' }], hintsAt: 'foot' });
    this.onOpen = o.onOpen;
    this.token = 0;
    const text = (x, y, value, color = 'text') => { const t = new NeonText(scene, theme, x, y, value, { color, outline: 'none' }); this.panel.add(t); return t; };
    text(12, 22, 'UNRANKED PRACTICE: NOT LEADERBOARD ELIGIBLE', 'amber');
    this.status = text(12, 33, 'PASTE A POSTCARD CODE OR OPEN A FILE. NOTHING LEAVES THIS DEVICE.', 'cyan');
    this.box = new DomTextBox(scene, theme, {
      x: this.panel.x + 12, y: this.panel.y + 46, w: 396, h: 56, multiline: true, maxLength: MAX_ENCODED_POSTCARD_CHARS * 2, value: '',
      placeholder: 'PASTE POSTCARD CODE HERE (CTRL+V)', color: 'amber', onSubmit: () => this.open(), onCancel: () => this.close(),
    });
    this.openBtn = new Button(scene, theme, { x: 12, y: 112, w: 120, h: 16, label: 'OPEN POSTCARD', color: 'lime', onClick: () => this.open() });
    this.fileBtn = new Button(scene, theme, { x: 138, y: 112, w: 110, h: 16, label: 'OPEN FILE', color: 'cyan', onClick: () => this.pickFile() });
    this.panel.add(this.openBtn); this.panel.add(this.fileBtn);
    text(12, 134, 'A POSTCARD ONLY WORKS ON THE SAME GAME BUILD IT WAS MADE ON', 'text');
    scene.time.delayedCall(30, () => { if (this.alive && this.box) this.box.focus(); });
  }

  /** Read a chosen file as text (local) and open it. */
  pickFile() {
    if (typeof document === 'undefined') return;
    if (this.fileInput) return;
    const input = document.createElement('input');
    this.fileInput = input;
    input.type = 'file';
    input.accept = `${POSTCARD_EXT},.txt,text/plain`;
    input.style.display = 'none';
    input.setAttribute('data-bb-postcard-file', '1');
    const cleanup = () => {
      input.remove();
      if (this.fileInput === input) this.fileInput = null;
    };
    input.addEventListener('cancel', cleanup, { once: true });
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      cleanup();
      if (!this.alive || !f) return;
      if (f.size > MAX_ENCODED_POSTCARD_CHARS * 2) { this.say('THAT FILE IS TOO LARGE TO BE A POSTCARD', 'danger'); return; }
      const rd = new FileReader();
      rd.onload = () => { if (this.alive) { this.box.setValue(String(rd.result || '')); this.open(); } };
      rd.onerror = () => this.say('COULD NOT READ THAT FILE', 'danger');
      rd.readAsText(f);
    });
    document.body.appendChild(input);
    try { input.click(); } catch (e) { cleanup(); this.say('COULD NOT OPEN FILE PICKER', 'danger'); }
  }

  say(msg, color = 'cyan') {
    if (!this.alive) return;
    this.status.setText(String(msg).toUpperCase().slice(0, 68));
    this.status.setColorKey(color);
  }

  async open() {
    if (!this.alive) return;
    const token = ++this.token;
    this.say('OPENING...', 'cyan');
    const r = await openPostcardText(this.box.getValue(), { identity: currentPostcardIdentity(this.scene.registry) });
    if (!this.alive || token !== this.token) return;
    if (!r.ok) { this.say(`REFUSED: ${r.message}`, 'danger'); return; }
    this.say('POSTCARD OK: RE-SIMULATING...', 'lime');
    this.onOpen(r.descriptor, r.postcard);
  }

  destroy() {
    this.token++;
    this.fileInput?.remove();
    this.fileInput = null;
    try { if (this.box) this.box.destroy(); } catch (e) { /* already gone */ }
    this.box = null;
    super.destroy();
  }
}
