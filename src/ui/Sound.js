/**
 * OWNER: UI engineer.
 * UI sounds through the AudioSynth contract (silent with the stub; never throws).
 */
import { REG } from '../constants.js';

/**
 * @param {Phaser.Scene|Phaser.Game} sceneOrGame
 * @param {'uiMove'|'uiSelect'|'uiBack'|'powerup'|'combo'|'trick'|'landPerfect'|string} name
 * @param {{pitch?:number, volume?:number}} [opts]
 * @returns {void}
 */
export function uiSfx(sceneOrGame, name, opts) {
  try {
    const game = sceneOrGame.game || sceneOrGame;
    const audio = game.registry.get(REG.AUDIO);
    if (audio) audio.playSfx(name, opts);
  } catch (e) {
    /* audio must never break UI */
  }
}
