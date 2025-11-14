/**
 * Bitstream Bluffs - Main Entry Point
 * A neon-soaked downhill sledding game
 *
 * Design: 480×270 virtual resolution, pixel-perfect 1-bit Tron aesthetic
 */

import Phaser from 'phaser';
import BootScene from './scenes/BootScene.js';
import PreloadScene from './scenes/PreloadScene.js';
import GameScene from './scenes/GameScene.js';

// Game configuration - 480×270 virtual canvas with pixel-perfect scaling
const config = {
    type: Phaser.AUTO,
    width: 480,
    height: 270,
    parent: 'game',
    backgroundColor: '#000000',
    pixelArt: true,

    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 480,
        height: 270
    },

    physics: {
        default: 'matter',
        matter: {
            gravity: { y: 0.9 },  // ~900 px/s² as per spec
            debug: false,
            debugBodyColor: 0x00ffff,
            debugStaticBodyColor: 0xff00ff
        }
    },

    scene: [BootScene, PreloadScene, GameScene],

    // Audio config
    audio: {
        disableWebAudio: false
    }
};

// Initialize the game
const game = new Phaser.Game(config);

// Make game accessible for debugging
window.game = game;

export default game;
