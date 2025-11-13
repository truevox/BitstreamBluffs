/**
 * BootScene - Initial boot and setup
 * Handles early initialization before asset loading
 */

import Phaser from 'phaser';

export default class BootScene extends Phaser.Scene {
    constructor() {
        super({ key: 'BootScene' });
    }

    create() {
        console.log('BootScene: Initializing...');

        // Set up any global game state
        this.registry.set('version', '2.0.0');
        this.registry.set('highScore', 0);

        // Transition to preload
        this.scene.start('PreloadScene');
    }
}
