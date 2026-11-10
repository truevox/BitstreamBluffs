/**
 * OWNER: gameplay engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Sled + rider as ONE compound Matter body (SAT on convex hulls, doc 4.2), drawn with Phaser Graphics shapes.
 */
export class Sled {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x world px spawn.
   * @param {number} y world px spawn.
   * @param {Object<string,number>} palette colour ints from ui/Palette.getPalette().
   */
  constructor(scene, x, y, palette) {
    this.scene = scene;
    this.x = x;
    this.y = y;
  }

  /**
   * Apply input + effective physics for one sub-step.
   * @param {import('../systems/VirtualPad.js').VirtualPadState} pad
   * @param {import('../systems/PhysicsTuner.js').EffectivePhysics} phys
   * @param {number} stepMs
   * @returns {void}
   */
  applyControls(pad, phys, stepMs) {}

  /**
   * Build the per-frame state consumed by TrickTracker.
   * @param {number} timeMs
   * @param {number} dtMs
   * @returns {import('../systems/TrickTracker.js').SledFrameState}
   */
  getFrameState(timeMs, dtMs) {
    return {
      timeMs, dtMs, x: this.x, y: this.y, vx: 0, vy: 0, angleDeg: 0, angularVelDegS: 0,
      grounded: true, groundAngleDeg: 0, input: { heli: 0, airBrake: false, parachute: false }, crashed: false,
    };
  }

  /** Sync graphics to body. @returns {void} */
  render() {}

  /** @returns {void} */
  destroy() {}
}
