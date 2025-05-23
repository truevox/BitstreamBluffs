// js/flip-impulse.js
// Applies a single, spring-like velocity impulse to the player after landing a flip.
// Keeps ModularGameScene.js lean and encapsulates all boost logic here.
//
// Usage:
//   import applyFlipImpulse from './flip-impulse.js';
//   applyFlipImpulse(player, fullFlips, partialFlip);

/**
 * Applies a one-time velocity impulse to the player body based on trick complexity.
 * @param {Phaser.Physics.Matter.Sprite} player - The player game object with a Matter body.
 * @param {number} fullFlips - Number of full flips completed.
 * @param {number} partialFlip - Fractional flip (0.0-1.0) completed.
 * @param {object} [options] - Optional tuning overrides.
 */
/**
 * Applies a one-time velocity impulse to the player body based on trick complexity.
 * Keeps ModularGameScene.js lean and encapsulates all boost logic here.
 *
 * @param {Phaser.Physics.Matter.Sprite} player - The player game object with a Matter body.
 * @param {number} fullFlips - Number of full flips completed.
 * @param {number} partialFlip - Fractional flip (0.0-1.0) completed.
 * @param {object} [options] - Optional tuning overrides.
 */
export default function applyFlipImpulse(player, fullFlips, partialFlip, options = {}) {
  // Numbers tuned for "feels good" zone; tweak as needed
  const baseImpulse = options.baseImpulse ?? 2.0;
  const fullFlipBonus = options.fullFlipBonus ?? 1.5;
  const partialFlipBonus = options.partialFlipBonus ?? 0.5;

  // Get Matter.Body from the player's scene (no import needed)
  const Body = player.scene.matter.body || player.scene.matter.world.engine.world.constructor.Body || player.body.constructor;
  // Fallback for Phaser 3: player.scene.matter.world.engine.world.constructor.Body
  // Most projects: player.body.constructor

  const bonusImpulse = fullFlips * fullFlipBonus + partialFlip * partialFlipBonus;

  // Apply an instantaneous velocity bump (spring-like)
  Body.setVelocity(player.body, {
    x: player.body.velocity.x + baseImpulse + bonusImpulse,
    y: player.body.velocity.y,
  });
}
