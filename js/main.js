/**
 * @fileoverview Entry point for Bitstream Bluffs using ES modules.
 * Sets up Phaser game configuration, handles font loading, and initializes the modular game architecture.
 * All scene and utility imports are managed here.
 */
// js/main.js - Entry point for the game using ES modules
// ---------------------------------------------------------------------

// Import config loader and physics config
import configLoader from './config/config-loader.js';
import PhysicsConfig from './config/physics-config.js';

// Import game scenes
import BootScene from './BootScene.js';
import PreloadScene from './PreloadScene.js';
import StartScene from './StartScene.js';
import GameScene from './GameScene.js';
import ModularGameScene from './ModularGameScene.js'; // New modular architecture

// Import utility classes
import './utils/RotationSystem.js';
import './Manette.js';

import Phaser from 'phaser';
// Function to initialize the game
/**
 * Initializes the Phaser game instance after fonts are loaded and sets up resize handling.
 * Calculates optimal game dimensions and attaches the game to the DOM.
 *
 * @function
 */
function initializeGame() {
    console.log('Initializing game after fonts are loaded...');
    // Calculate game dimensions based on the window size
    /**
     * Calculates game dimensions based on the current window size, preserving aspect ratio.
     * @returns {{width: number, height: number}} The calculated width and height for the game canvas.
     */
    const calculateGameDimensions = () => {
        // Base design aspect ratio (original game dimensions)
        const baseWidth = 1000;
        const baseHeight = 700;
        const baseAspectRatio = baseWidth / baseHeight;
        
        // Current window dimensions
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const windowAspectRatio = windowWidth / windowHeight;
        
        let width, height;
        
        // Determine if we should constrain by width or height
        if (windowAspectRatio >= baseAspectRatio) {
            // Window is wider than our base aspect ratio
            height = windowHeight;
            width = height * baseAspectRatio;
        } else {
            // Window is taller than our base aspect ratio
            width = windowWidth;
            height = width / baseAspectRatio;
        }
        
        // Return dimensions as integers
        return {
            width: Math.round(width),
            height: Math.round(height)
        };
    };
    
    // Get initial dimensions
    const { width, height } = calculateGameDimensions();
    
    // Always use the modular architecture
    const useModular = true;
    console.log('Using modular game architecture');
    
    // Game configuration
    const config = {
        type: Phaser.AUTO,          // WebGL if available, otherwise Canvas
        width: width,
        height: height,
        parent: 'game-container',
        backgroundColor: '#000000',
        scale: {
            mode: Phaser.Scale.RESIZE,
            autoCenter: Phaser.Scale.CENTER_BOTH
        },

        // ───────────────────────────────────────────
        //  PHYSICS: Matter.js physics engine
        // ───────────────────────────────────────────
        physics: {
            default: 'matter',
            matter: {
                gravity: { y: 1 },  // ≈ 1000 px/s²; configurable via PhysicsConfig
                debug: false  // Always disable debug visualization
            }
        },

        // Important: Start with BootScene which should transition to PreloadScene, then StartScene
        // The order matters - first scene in the array is the one that starts first
        scene: [ BootScene, PreloadScene, StartScene, GameScene, ModularGameScene ]
    };

    console.log('Starting Phaser game with config:', config);
    
    // Initialize the game
    const game = new Phaser.Game(config);
    
    // Set up window resize handler
    window.addEventListener('resize', () => {
        // Call the game's resize method to adjust the canvas size
        if (game.scale) {
            const { width, height } = calculateGameDimensions();
            game.scale.resize(width, height);
            
            // Emit a custom event that scenes can listen for
            game.events.emit('resize', { width, height });
        }
    });
    
    // Make physics config available globally for easy tweaking in console
    window.PhysicsConfig = PhysicsConfig;
    window.game = game;
}

// Initialize the game when document is loaded and fonts are ready
document.addEventListener('DOMContentLoaded', () => {
    // Check if fonts are already loaded
    if (window.fontsLoaded) {
        initializeGame();
    } else {
        console.log('Waiting for fonts to load before starting game...');
        // Set up an interval to check font loading status
        const fontCheckInterval = setInterval(() => {
            if (window.fontsLoaded) {
                clearInterval(fontCheckInterval);
                initializeGame();
            }
        }, 100);
        
        // Fallback - start the game after 3 seconds even if fonts aren't detected as loaded
        setTimeout(() => {
            if (!window.game) {
                clearInterval(fontCheckInterval);
                console.warn('Font loading timed out, starting game anyway');
                initializeGame();
            }
        }, 3000);
    }
});
