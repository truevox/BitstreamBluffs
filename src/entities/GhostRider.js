/** Visual-only replay ghost (issue #56): a translucent rider drawn from a tape's recorded
 * trace at the current simulation tick. No Matter body, no events, no score: it cannot touch
 * gameplay. Up to five per course (Latest, Best, Favorites), one per distinct run.
 */
import { FONT_KEY } from '../ui/PixelFont.js';
import { decodeTrace, tracePose } from '../systems/ghost/GhostTape.js';

export const GHOST_ALPHA = 0.42;
export const GHOST_DEPTH = 19; // just behind the live sled (20)
const ROLE_LABEL = { best: 'BEST', latest: 'LAST', fav0: 'FAV A', fav1: 'FAV B', fav2: 'FAV C' };
const ROLE_ORDER = ['best', 'latest', 'fav0', 'fav1', 'fav2'];

/** Tag text and colour key for a run holding `roles` (best wins, then latest, then favorites). */
export function ghostTag(roles) {
  const sorted = ROLE_ORDER.filter((r) => roles.includes(r));
  const lead = sorted[0] || 'latest';
  return { text: sorted.map((r) => ROLE_LABEL[r]).join('+'), color: lead === 'best' ? 'amber' : lead === 'latest' ? 'cyan' : 'magenta' };
}

export class GhostRider {
  /**
   * @param {Phaser.Scene} scene RunScene
   * @param {{tape:object, roles:string[]}} ghost
   * @param {Object<string,number>} palette
   */
  constructor(scene, ghost, palette) {
    this.scene = scene;
    this.runId = ghost.tape.runId;
    this.roles = ghost.roles;
    this.trace = decodeTrace(ghost.tape);
    const tag = ghostTag(ghost.roles);
    this.color = palette[tag.color] ?? 0xffffff;
    this.gfx = scene.add.graphics().setDepth(GHOST_DEPTH).setAlpha(GHOST_ALPHA);
    this.label = scene.add.bitmapText(0, 0, FONT_KEY, tag.text, 8).setOrigin(0.5, 1)
      .setTint(this.color).setDepth(GHOST_DEPTH).setAlpha(0.7);
    this.visible = false;
  }

  /** Draw the ghost at simulation tick `tick`; hidden past the end of its run. */
  update(tick) {
    const pose = tracePose(this.trace, tick);
    this.visible = Boolean(pose);
    this.gfx.clear().setVisible(this.visible);
    this.label.setVisible(this.visible);
    if (!pose) return;
    const c = Math.cos(pose.angle), s = Math.sin(pose.angle);
    // Same local frame as Sled._draw: the trace holds the physics body's centre, the drawing
    // origin sits at the body minus the rotated spawn offset.
    const off = this.scene.sled?.off || { x: 0, y: 0 };
    const ox = pose.x - (c * off.x - s * off.y), oy = pose.y - (s * off.x + c * off.y);
    const P = (lx, ly) => ({ x: ox + lx * c - ly * s, y: oy + lx * s + ly * c });
    const g = this.gfx;
    // Runner with its curved prow, and the deck
    const run = [P(-24, 11), P(18, 11), P(25, 9), P(29, 4)];
    g.lineStyle(2, this.color, 1).strokePoints(run, false, false);
    g.fillStyle(this.color, 0.55).fillPoints([P(-23, 1.5), P(21, 1.5), P(28, -1), P(22, 5.5), P(-23, 5.5)], true);
    // Rider: torso wedge and helmet
    g.fillStyle(this.color, 0.9).fillPoints([P(-8, 1), P(0, 1), P(1, -14), P(-5, -14)], true);
    const h = P(0, -20.5);
    g.fillCircle(h.x, h.y, 4.6);
    // Tag over the helmet. The run camera zooms out with speed: keep it at 1x pixel scale so it stays legible.
    const z = this.scene.cameras?.main?.zoom > 0 ? this.scene.cameras.main.zoom : 1;
    this.label.setScale(1 / z).setPosition(h.x, h.y - 6 - 4 / z);
  }

  destroy() {
    this.gfx?.destroy();
    this.label?.destroy();
    this.gfx = null;
    this.label = null;
  }
}
