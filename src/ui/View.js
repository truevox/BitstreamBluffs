/**
 * The base View (a centred panel with a BACK button), in its own module so views outside Views.js
 * (GhostFavoritesView) can extend it without importing the whole view catalogue. Views.js re-exports it.
 */
import { GAME_WIDTH, GAME_HEIGHT } from '../constants.js';
import { Panel } from './Panel.js';
import { Keycaps } from './ViewChrome.js';
import { Button } from './Button.js';
import { uiSfx } from './Sound.js';
import { transitionIn, transitionOut } from './Motion.js';
import { measureText } from './PixelFont.js';

/**
 * Base: centred panel with a BACK button.
 *
 * Motion: the panel opens with Motion.transitionIn (a CRT zip: a line draws across, the panel unfolds from
 * it) and closes with Motion.transitionOut (a ghost frame collapses where the panel was). Both collapse to a
 * short fade under reduce motion. The panel's geometry is never animated away from its layout outside the
 * open tween, and destroy() stays synchronous (the ghost is a separate, self-destroying graphic), so view
 * navigation and teardown behave exactly as before for every caller and test. The host scene owns the
 * dim layer behind the panel (Motion.openDim/closeDim).
 */
export class View {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{w:number,h:number,title:string,color?:string,onClose:function():void,y?:number,backLabel?:string,
   *          hints?:Array<{keys?:string[],key?:string,label?:string}>, hintsAt?:'tab'|'foot'}} o
   *   `hints` draws a keycap row: in the title-tab line (right-aligned, the default) or at the panel foot,
   *   left of BACK. A tab-row hint that would run into the title tab is dropped, never overlapped.
   */
  constructor(scene, theme, o) {
    this.scene = scene;
    this.theme = theme;
    this.onClose = o.onClose;
    this.alive = true;
    const x = Math.round((GAME_WIDTH - o.w) / 2);
    const y = o.y !== undefined ? o.y : Math.round((GAME_HEIGHT - o.h) / 2);
    this.frameColorKey = o.color || 'cyan';
    this.panel = new Panel(scene, theme, { x, y, w: o.w, h: o.h, title: o.title, color: this.frameColorKey, fillAlpha: 1 });
    this.panel.setDepth(500);
    this.w = o.w;
    this.h = o.h;
    this.back = new Button(scene, theme, {
      x: o.w - 76, y: o.h - 22, w: 68, h: 16, label: o.backLabel || 'BACK', color: 'magenta', onClick: () => this.close(),
    });
    this.panel.add(this.back);
    this.hintRow = null;
    if (o.hints && o.hints.length) {
      const foot = o.hintsAt === 'foot';
      const caps = new Keycaps(scene, theme, {
        x: foot ? 12 : o.w - 10, y: foot ? o.h - 19 : 2, items: o.hints, align: foot ? 'left' : 'right', color: this.frameColorKey,
      });
      // the tab is the title plus 16 px padding, a 10 px slant and the three data ticks (~26 px)
      const tabEnd = measureText(String(o.title || '')) + 16 + 10 + 26;
      if (!foot && caps.x < tabEnd) caps.destroy();
      else { this.panel.add(caps); this.hintRow = caps; }
    }
    transitionIn(scene, this.panel, { w: o.w, h: o.h, color: theme.color(this.frameColorKey) });
  }

  close() {
    uiSfx(this.scene, 'uiBack');
    if (this.alive) this.onClose();
  }

  handleAction(action) {
    if (action === 'cancel') this.close();
    return true;
  }

  destroy() {
    this.alive = false;
    if (this.panel) {
      // A hidden panel (Settings while Manage Sound is open over it) leaves no ghost: it was not on screen.
      if (this.panel.visible !== false && this.panel.scene) {
        transitionOut(this.scene, {
          x: this.panel.x, y: this.panel.y, w: this.w, h: this.h,
          color: this.theme.color(this.frameColorKey), depth: 501,
        });
      }
      this.panel.destroy();
    }
    this.panel = null;
  }
}
