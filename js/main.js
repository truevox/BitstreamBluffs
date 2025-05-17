// js/main.js - Entry point for the game using ES modules
// ---------------------------------------------------------------------

// Import config loader and physics config
import configLoader from './config/config-loader.js';
import PhysicsConfig from './config/physics-config.js';

// Import game scenes
import BootScene from './BootScene.js';
import PreloadScene from './PreloadScene.js';
import GameScene from './GameScene.js';

// Import utility classes
import './utils/RotationSystem.js';
import './Manette.js';

// Initialize the game when document is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Game configuration
    const config = {
        type: Phaser.AUTO,          // WebGL if available, otherwise Canvas
        width: 1000,
        height: 700,
        parent: 'game-container',
        backgroundColor: '#000000',

        // ───────────────────────────────────────────
        //  PHYSICS: Matter.js physics engine
        // ───────────────────────────────────────────
        physics: {
            default: 'matter',
            matter: {
                gravity: { y: 1 },  // ≈ 1000 px/s²; configurable via PhysicsConfig
                debug: configLoader.isDebuggingEnabled()  // Use config setting
            }
        },

        scene: [ GameScene ]  // Start directly with GameScene for now
    };

    console.log('Starting Phaser game with config:', config);
    
    // Initialize the game
    const game = new Phaser.Game(config);
    
    // Make physics config available globally for easy tweaking in console
    window.PhysicsConfig = PhysicsConfig;
    window.game = game;
});
