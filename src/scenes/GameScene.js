/**
 * GameScene - Main gameplay scene
 * Handles player, terrain, tricks, scoring, and The Bit Stream
 */

import Phaser from 'phaser';
import TerrainGenerator from '../core/TerrainGenerator.js';
import Player from '../core/Player.js';
import TrickSystem from '../core/TrickSystem.js';
import ScoringSystem from '../core/ScoringSystem.js';
import Starfield from '../effects/Starfield.js';
import GlitchFX from '../effects/GlitchFX.js';
import { generateSeed, seededRandom } from '../utils/seedUtils.js';

export default class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    create() {
        console.log('GameScene: Starting new run');

        // Initialize game state
        this.gameActive = true;
        this.seed = generateSeed();
        this.random = seededRandom(this.seed);

        // Neon color palette
        this.colors = {
            cyan: 0x00ffff,
            magenta: 0xff00ff,
            lime: 0x00ff88,
            amber: 0xffaa00,
            blue: 0x0088ff,      // Blue terrain
            green: 0x00ff44,     // Green terrain
            pink: 0xff00aa       // Magenta terrain
        };

        // Set up camera
        this.cameras.main.setBounds(0, 0, 480, 100000);
        this.cameras.main.setBackgroundColor(0x000000);

        // Create starfield background
        this.starfield = new Starfield(this, 150);

        // Create glitch FX
        this.glitchFX = new GlitchFX(this);

        // Initialize core systems
        this.terrain = new TerrainGenerator(this, this.random);
        this.player = new Player(this, 240, 100);
        this.trickSystem = new TrickSystem(this);
        this.scoring = new ScoringSystem(this);

        // Set up input
        this.setupInput();

        // Create HUD
        this.createHUD();

        // Camera follows player in both X and Y with dynamic leading
        this.cameras.main.startFollow(this.player.sprite, false, 0.08, 0.2);

        // Camera leading state
        this.cameraLeadX = 0;
        this.cameraOffsetY = -60; // Keep player slightly above center

        // Initialize The Bit Stream (chasing element)
        this.bitStream = {
            y: -200,
            speed: 0.5,
            active: true
        };

        // Create visual representation of The Bit Stream
        this.createBitStreamVisual();

        // Track game state
        this.distance = 0;
        this.startTime = this.time.now;
    }

    setupInput() {
        // Keyboard input
        this.keys = {
            tab: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB),
            w: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
            a: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
            s: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
            d: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
            space: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
            shift: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
            esc: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC)
        };

        // Prevent default tab behavior
        this.input.keyboard.on('keydown-TAB', (event) => {
            event.preventDefault();
        });
    }

    createHUD() {
        // Score display (top-left)
        this.scoreText = this.add.text(10, 10, 'SCORE: 0', {
            fontFamily: 'Courier New',
            fontSize: '12px',
            color: '#00ffff',
            stroke: '#000000',
            strokeThickness: 2
        }).setScrollFactor(0).setDepth(1000);

        // Combo display (top-right)
        this.comboText = this.add.text(470, 10, '', {
            fontFamily: 'Courier New',
            fontSize: '12px',
            color: '#ff00ff',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(1, 0).setScrollFactor(0).setDepth(1000);

        // Seed display (bottom-left)
        this.seedText = this.add.text(10, 250, `SEED: ${this.seed}`, {
            fontFamily: 'Courier New',
            fontSize: '10px',
            color: '#888888',
            stroke: '#000000',
            strokeThickness: 2
        }).setScrollFactor(0).setDepth(1000);

        // Mode indicator (bottom-right)
        this.modeText = this.add.text(470, 250, 'SLED', {
            fontFamily: 'Courier New',
            fontSize: '10px',
            color: '#00ff88',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(1, 0).setScrollFactor(0).setDepth(1000);
    }

    update(time, delta) {
        if (!this.gameActive) return;

        // Update visual effects
        this.starfield.update(this.cameras.main.scrollY);
        this.glitchFX.update(time, delta);

        // Update player
        this.player.update(this.keys, delta);

        // Update camera leading based on player velocity
        this.updateCameraLeading(delta);

        // Update terrain
        this.terrain.update(this.player.sprite.y);

        // Update trick system
        this.trickSystem.update(this.player, delta);

        // Update scoring
        this.distance = Math.abs(this.player.sprite.y - 100);
        this.scoring.updateDistance(this.distance);

        // Check terrain type for bonuses
        const terrainType = this.terrain.getTerrainAt(
            this.player.sprite.x,
            this.player.sprite.y + 10
        );
        this.scoring.updateTerrainBonus(terrainType, delta / 1000);

        // Update The Bit Stream (chasing element)
        if (this.bitStream.active) {
            this.bitStream.y += this.bitStream.speed;

            // Update visual
            this.bitStreamGraphics.clear();
            this.bitStreamGraphics.fillStyle(0xff0000, 0.3);
            this.bitStreamGraphics.fillRect(0, this.bitStream.y - 50, 480, 100);

            // Draw glitchy lines
            this.bitStreamGraphics.lineStyle(2, 0xff00ff, 1);
            for (let i = 0; i < 10; i++) {
                const lineY = this.bitStream.y - 50 + (Math.random() * 100);
                const glitchOffset = (Math.random() - 0.5) * 20;
                this.bitStreamGraphics.lineBetween(
                    0 + glitchOffset,
                    lineY,
                    480 + glitchOffset,
                    lineY
                );
            }

            // Position particle emitter
            this.bitStreamParticles.setPosition(240, this.bitStream.y);

            // Game over if The Bit Stream catches the player
            if (this.bitStream.y > this.player.sprite.y - 100) {
                this.gameOver('CAUGHT BY THE BIT STREAM');
            }
        }

        // Update HUD
        this.updateHUD();

        // Check for reset
        if (Phaser.Input.Keyboard.JustDown(this.keys.shift)) {
            this.restartGame();
        }

        // Check for pause
        if (Phaser.Input.Keyboard.JustDown(this.keys.esc)) {
            this.scene.pause();
            // TODO: Show pause menu
        }
    }

    createBitStreamVisual() {
        // Create graphics for the bit stream
        this.bitStreamGraphics = this.add.graphics();
        this.bitStreamGraphics.setDepth(100);

        // Create particles for the bit stream effect using Phaser 3.60+ API
        this.bitStreamParticles = this.add.particles(240, 0, 'particle-magenta', {
            x: { min: -240, max: 240 },
            y: 0,
            speedY: { min: 20, max: 50 },
            speedX: { min: -20, max: 20 },
            scale: { start: 2, end: 0 },
            alpha: { start: 1, end: 0 },
            lifespan: 1000,
            frequency: 20,
            tint: [0xff0000, 0xff00ff, 0x8800ff]
        });
        this.bitStreamParticles.setDepth(99);
    }

    updateCameraLeading(delta) {
        // Calculate camera lead based on player velocity
        // Player sprite is ~24 units wide, so 4 widths = ~96 units
        const playerWidth = 24;
        const maxLead = playerWidth * 4; // 96 units ahead at max speed

        // Get player velocity
        const velocity = this.player.sprite.body.velocity;
        const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);

        // Good clip speed is around 10-15 units/frame
        const maxSpeed = 15;
        const speedRatio = Math.min(speed / maxSpeed, 1.0);

        // Calculate target lead (direction matters)
        const velocityAngle = Math.atan2(velocity.y, velocity.x);
        const targetLeadX = Math.cos(velocityAngle) * maxLead * speedRatio;
        const targetLeadY = Math.sin(velocityAngle) * maxLead * speedRatio * 0.3; // Less vertical leading

        // Smooth interpolation to target lead
        const lerpFactor = 0.05;
        this.cameraLeadX += (targetLeadX - this.cameraLeadX) * lerpFactor;
        const cameraLeadY = this.cameraOffsetY + targetLeadY;

        // Update camera offset
        this.cameras.main.setFollowOffset(this.cameraLeadX, cameraLeadY);
    }

    updateHUD() {
        // Update score
        this.scoreText.setText(`SCORE: ${Math.floor(this.scoring.totalScore)}`);

        // Update combo
        const combo = this.trickSystem.comboMultiplier;
        if (combo > 1) {
            this.comboText.setText(`COMBO x${combo.toFixed(2)}`);
            this.comboText.setVisible(true);
        } else {
            this.comboText.setVisible(false);
        }

        // Update mode
        this.modeText.setText(this.player.isWalkingMode ? 'WALKING' : 'SLED');
    }

    gameOver(reason = 'GAME OVER') {
        this.gameActive = false;

        // Display game over
        const centerX = this.cameras.main.scrollX + 240;
        const centerY = this.cameras.main.scrollY + 135;

        this.add.rectangle(centerX, centerY, 480, 270, 0x000000, 0.8)
            .setScrollFactor(0)
            .setDepth(2000);

        this.add.text(centerX, centerY - 40, reason, {
            fontFamily: 'Courier New',
            fontSize: '20px',
            color: '#ff0000',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);

        this.add.text(centerX, centerY, `FINAL SCORE: ${Math.floor(this.scoring.totalScore)}`, {
            fontFamily: 'Courier New',
            fontSize: '16px',
            color: '#00ffff',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);

        this.add.text(centerX, centerY + 40, 'PRESS SHIFT TO RESTART', {
            fontFamily: 'Courier New',
            fontSize: '12px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);

        // Allow restart
        this.input.keyboard.once('keydown-SHIFT', () => {
            this.restartGame();
        });
    }

    restartGame() {
        this.scene.restart();
    }
}
