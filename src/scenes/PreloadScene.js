/**
 * PreloadScene - Asset loading and preparation
 * Loads all game assets and creates procedural graphics
 */

import Phaser from 'phaser';

export default class PreloadScene extends Phaser.Scene {
    constructor() {
        super({ key: 'PreloadScene' });
    }

    preload() {
        // Create a simple loading bar
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        const progressBar = this.add.graphics();
        const progressBox = this.add.graphics();
        progressBox.fillStyle(0x222222, 0.8);
        progressBox.fillRect(width/2 - 160, height/2 - 25, 320, 50);

        const loadingText = this.add.text(width/2, height/2 - 50, 'LOADING BITSTREAM BLUFFS', {
            fontFamily: 'Courier New',
            fontSize: '16px',
            color: '#00ffff'
        }).setOrigin(0.5);

        // Update progress bar
        this.load.on('progress', (value) => {
            progressBar.clear();
            progressBar.fillStyle(0x00ffff, 1);
            progressBar.fillRect(width/2 - 150, height/2 - 15, 300 * value, 30);
        });

        this.load.on('complete', () => {
            progressBar.destroy();
            progressBox.destroy();
            loadingText.destroy();
        });

        // Load any future assets here
        // For now, we'll use procedural graphics
    }

    create() {
        console.log('PreloadScene: Assets loaded');

        // Create procedural graphics for the game
        this.createSledGraphic();
        this.createParticleGraphics();

        // Transition to game
        this.scene.start('GameScene');
    }

    /**
     * Create a simple wireframe sled graphic
     */
    createSledGraphic() {
        const graphics = this.add.graphics();

        // Draw a simple sled shape (trapezoid)
        graphics.lineStyle(2, 0x00ffff, 1);
        graphics.beginPath();
        graphics.moveTo(0, 0);
        graphics.lineTo(20, 0);
        graphics.lineTo(18, 8);
        graphics.lineTo(2, 8);
        graphics.closePath();
        graphics.strokePath();

        // Add runners
        graphics.lineStyle(2, 0x00ffff, 1);
        graphics.beginPath();
        graphics.moveTo(2, 8);
        graphics.lineTo(0, 12);
        graphics.moveTo(18, 8);
        graphics.lineTo(20, 12);
        graphics.strokePath();

        // Generate texture from graphics
        graphics.generateTexture('sled', 24, 16);
        graphics.destroy();
    }

    /**
     * Create particle graphics for effects
     */
    createParticleGraphics() {
        // Cyan particle
        const cyan = this.add.graphics();
        cyan.fillStyle(0x00ffff, 1);
        cyan.fillCircle(2, 2, 2);
        cyan.generateTexture('particle-cyan', 4, 4);
        cyan.destroy();

        // Magenta particle
        const magenta = this.add.graphics();
        magenta.fillStyle(0xff00ff, 1);
        magenta.fillCircle(2, 2, 2);
        magenta.generateTexture('particle-magenta', 4, 4);
        magenta.destroy();

        // Lime particle
        const lime = this.add.graphics();
        lime.fillStyle(0x00ff88, 1);
        lime.fillCircle(2, 2, 2);
        lime.generateTexture('particle-lime', 4, 4);
        lime.destroy();

        // Amber particle
        const amber = this.add.graphics();
        amber.fillStyle(0xffaa00, 1);
        amber.fillCircle(2, 2, 2);
        amber.generateTexture('particle-amber', 4, 4);
        amber.destroy();
    }
}
