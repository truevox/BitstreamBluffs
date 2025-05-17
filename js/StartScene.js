// js/StartScene.js
// Start screen scene for Bitstream Bluffs
// ------------------------------------------------------

// Import crypto library for SHA-256 hashing
import { generateGameSeed } from './utils/seed-generator.js';

export default class StartScene extends Phaser.Scene {
    constructor() {
        super({ key: 'StartScene' });
        this.seed = '';
        
        // Bind methods to preserve 'this' context
        this.startGame = this.startGame.bind(this);
    }

    preload() {
        // Load any assets needed for the start screen
        // For now, we'll create everything programmatically
    }

    create() {
        // Generate a seed for this game session
        this.seed = generateGameSeed();
        
        // Add background
        const { width, height } = this.cameras.main;
        
        // Create a dark background with arcade cabinet feel
        const backgroundGraphics = this.add.graphics();
        backgroundGraphics.fillStyle(0x000022, 1);
        backgroundGraphics.fillRect(0, 0, width, height);
        
        // Add retro scan lines for arcade feel
        const scanLines = this.add.graphics();
        for (let y = 0; y < height; y += 4) {
            scanLines.lineStyle(1, 0x000000, 0.1);
            scanLines.lineBetween(0, y, width, y);
        }
        
        // Add starfield
        for (let i = 0; i < 100; i++) {
            const x = Phaser.Math.Between(0, width);
            const y = Phaser.Math.Between(0, height);
            const size = Phaser.Math.Between(1, 3);
            const color = Phaser.Math.RND.pick([0xff00ff, 0x00ffff, 0xffff00]);
            const star = this.add.circle(x, y, size, color, 0.8);
            
            // Add twinkling effect to some stars
            if (Math.random() > 0.7) {
                this.tweens.add({
                    targets: star,
                    alpha: 0.3,
                    duration: Phaser.Math.Between(1000, 3000),
                    yoyo: true,
                    repeat: -1
                });
            }
        }
        
        // Create retro mountains in background (like in the image)
        const mountainGraphics = this.add.graphics();
        
        // Left mountain (with neon glow effect)
        mountainGraphics.lineStyle(3, 0xff00ff, 0.7); // Neon outline
        mountainGraphics.fillStyle(0x330033, 0.5);
        mountainGraphics.beginPath();
        mountainGraphics.moveTo(0, height);
        mountainGraphics.lineTo(0, height - 200);
        mountainGraphics.lineTo(width * 0.3, height - 300);
        mountainGraphics.lineTo(width * 0.5, height);
        mountainGraphics.closePath();
        mountainGraphics.fill();
        mountainGraphics.strokePath();
        
        // Right mountain
        mountainGraphics.lineStyle(3, 0xff00ff, 0.7); // Neon outline
        mountainGraphics.fillStyle(0x330033, 0.5);
        mountainGraphics.beginPath();
        mountainGraphics.moveTo(width, height);
        mountainGraphics.lineTo(width, height - 200);
        mountainGraphics.lineTo(width * 0.7, height - 300);
        mountainGraphics.lineTo(width * 0.5, height);
        mountainGraphics.closePath();
        mountainGraphics.fill();
        mountainGraphics.strokePath();
        
        // Add a neon-style border around the game area (similar to the arcade cabinet in the image)
        const borderWidth = 8;
        const borderGradient = [
            { x: 0, y: 0, color: 0xff00ff, alpha: 1 },
            { x: width, y: 0, color: 0x00ffff, alpha: 1 },
            { x: width, y: height, color: 0xff00ff, alpha: 1 },
            { x: 0, y: height, color: 0x00ffff, alpha: 1 }
        ];
        
        // Create the border with gradient effect
        const border = this.add.graphics();
        border.lineStyle(borderWidth, 0xff00ff, 1);
        border.strokeRect(borderWidth/2, borderWidth/2, width - borderWidth, height - borderWidth);
        
        // Add inner glow to simulate arcade cabinet frame
        const innerBorder = this.add.graphics();
        innerBorder.lineStyle(2, 0xffffff, 0.3);
        innerBorder.strokeRect(borderWidth * 2, borderWidth * 2, width - borderWidth * 4, height - borderWidth * 4);
        
        // Add title with retro glow effect (like the image shows)
        // Add a glow background for the title
        const titleGlow = this.add.graphics();
        titleGlow.fillStyle(0xff00ff, 0.2);
        titleGlow.fillRoundedRect(width / 2 - 280, height * 0.15 - 20, 560, 150, 15);
        
        // Create title text with arcade-style font
        const titleText = this.add.text(width / 2, height * 0.2, 'BITSTREAM\nBLUFFS', {
            fontFamily: 'Arial',
            fontSize: '68px',
            fontStyle: 'bold',
            color: '#ff00ff',
            align: 'center',
            stroke: '#ffffff',
            strokeThickness: 4,
            padding: { x: 20, y: 10 }
        }).setOrigin(0.5);
        
        // Add glow effect
        this.tweens.add({
            targets: titleText,
            alpha: { from: 0.8, to: 1 },
            duration: 1500,
            yoyo: true,
            repeat: -1
        });
        
        // Add start button with neon effect
        const buttonWidth = 200;
        const buttonHeight = 60;
        const buttonX = width / 2 - buttonWidth / 2;
        const buttonY = height * 0.5 - buttonHeight / 2;
        
        // Create a more arcade-like button with neon effect
        // Outer glow for button
        const buttonGlow = this.add.graphics();
        buttonGlow.fillStyle(0x00ffff, 0.2);
        buttonGlow.fillRoundedRect(width / 2 - buttonWidth/2 - 5, height * 0.5 - buttonHeight/2 - 5, buttonWidth + 10, buttonHeight + 10, 10);
        
        // Button background
        const startButton = this.add.rectangle(
            width / 2,
            height * 0.5,
            buttonWidth,
            buttonHeight,
            0x000022
        ).setStrokeStyle(4, 0x00ffff, 1).setInteractive();
        
        // Button text with pixel-like font
        const startText = this.add.text(
            width / 2,
            height * 0.5,
            'START GAME',
            {
                fontFamily: 'monospace',
                fontSize: '24px',
                fontStyle: 'bold',
                color: '#00ffff',
                padding: { x: 4, y: 4 }
            }
        ).setOrigin(0.5);
        
        // Add a pulsing effect to the button
        this.tweens.add({
            targets: buttonGlow,
            alpha: { from: 0.6, to: 0.2 },
            duration: 1000,
            yoyo: true, 
            repeat: -1
        });
        
        // Button hover and click effects
        startButton.on('pointerover', () => {
            startButton.setStrokeStyle(4, 0xffff00, 1);
            startText.setColor('#ffff00');
        });
        
        startButton.on('pointerout', () => {
            startButton.setStrokeStyle(3, 0x00ffff, 1);
            startText.setColor('#00ffff');
        });
        
        startButton.on('pointerdown', this.startGame);
        
        // Show seed info
        const seedLabel = this.add.text(
            width / 2,
            height * 0.65,
            'GAME SEED:',
            {
                fontFamily: 'monospace',
                fontSize: '16px',
                color: '#ffffff'
            }
        ).setOrigin(0.5);
        
        // Create a screen that shows the game terrain line like in the image
        const gamePreview = this.add.graphics();
        gamePreview.fillStyle(0x000000, 1);
        gamePreview.fillRect(width/2 - 180, height * 0.65 - 10, 360, 90);
        gamePreview.lineStyle(3, 0x00ffff, 1);
        gamePreview.strokeRect(width/2 - 180, height * 0.65 - 10, 360, 90);
        
        // Add a sample terrain line like in the image
        gamePreview.lineStyle(2, 0x00ffff, 1);
        gamePreview.beginPath();
        gamePreview.moveTo(width/2 - 170, height * 0.65 + 30);
        gamePreview.lineTo(width/2 - 120, height * 0.65 + 20);
        gamePreview.lineTo(width/2 - 70, height * 0.65 + 40);
        gamePreview.lineTo(width/2, height * 0.65 + 25);
        gamePreview.lineTo(width/2 + 50, height * 0.65 + 35);
        gamePreview.lineTo(width/2 + 100, height * 0.65 + 45);
        gamePreview.lineTo(width/2 + 170, height * 0.65 + 25);
        gamePreview.strokePath();
        
        // Add a player dot on the terrain line
        const playerDot = this.add.circle(width/2 - 70, height * 0.65 + 34, 8, 0xffff00, 1);
        playerDot.setStrokeStyle(2, 0xff00ff);
        
        // The seed value (clickable to copy)
        const seedDisplay = this.add.text(
            width / 2,
            height * 0.8,
            'SEED: ' + this.seed,
            {
                fontFamily: 'monospace',
                fontSize: '16px',
                color: '#ffff00',
                backgroundColor: '#222244',
                padding: { left: 10, right: 10, top: 5, bottom: 5 }
            }
        ).setOrigin(0.5).setInteractive();
        
        // Tooltip text
        const tooltipText = this.add.text(
            width / 2,
            height * 0.8 + 25,
            '(Click to copy)',
            {
                fontFamily: 'Arial',
                fontSize: '14px',
                color: '#aaaaaa'
            }
        ).setOrigin(0.5);
        
        // Copy seed on click
        seedDisplay.on('pointerdown', () => {
            // Create a temporary text area to copy the seed
            this.copyTextToClipboard(this.seed);
            
            // Visual feedback for copy
            tooltipText.setText('Copied!');
            tooltipText.setColor('#00ff00');
            
            // Reset tooltip after a delay
            this.time.delayedCall(1500, () => {
                tooltipText.setText('(Click to copy)');
                tooltipText.setColor('#aaaaaa');
            });
        });
        
        // Instructions text
        this.add.text(
            width / 2,
            height * 0.9,
            'PRESS SPACE, ENTER, A OR START BUTTON TO PLAY',
            {
                fontFamily: 'Arial',
                fontSize: '16px',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 3
            }
        ).setOrigin(0.5);
        
        // Setup keyboard controls
        this.input.keyboard.on('keydown-SPACE', this.startGame, this);
        this.input.keyboard.on('keydown-ENTER', this.startGame, this);
        
        // Setup gamepad controls (checked in update)
        // Only set up gamepad events if the gamepad is available
        if (this.input.gamepad && this.input.gamepad.total > 0) {
            this.input.gamepad.on('down', (pad, button) => {
                // Button 0 is usually 'A' on most gamepads
                // Button 9 is usually 'Start' on most gamepads
                if (button.index === 0 || button.index === 9) {
                    this.startGame();
                }
            });
        } else {
            // Check for gamepad connections during the game
            this.input.gamepad?.once('connected', (pad) => {
                console.log('Gamepad connected:', pad.id);
                pad.on('down', (button) => {
                    if (button.index === 0 || button.index === 9) {
                        this.startGame();
                    }
                });
            });
        }
        
        // Store the seed in a global property that GameScene can access
        window.gameSeed = this.seed;
        console.log('Game initialized with seed:', this.seed);
    }
    
    update() {
        // Additional gamepad polling if needed
    }
    
    startGame() {
        // Transition effect
        this.cameras.main.fadeOut(500, 0, 0, 0);
        
        this.cameras.main.once('camerafadeoutcomplete', () => {
            // Start the game scene
            this.scene.start('GameScene');
        });
    }
    
    copyTextToClipboard(text) {
        // This function uses the Navigator clipboard API when available
        // or falls back to document.execCommand for older browsers
        if (navigator.clipboard && window.isSecureContext) {
            // Navigator clipboard API is available
            navigator.clipboard.writeText(text)
                .catch(err => {
                    console.error('Could not copy text: ', err);
                });
        } else {
            // Fallback for browsers that don't support clipboard API
            // Create temporary element
            const textArea = document.createElement("textarea");
            textArea.value = text;
            
            // Make the textarea out of viewport
            textArea.style.position = "fixed";
            textArea.style.left = "-999999px";
            textArea.style.top = "-999999px";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            try {
                document.execCommand('copy');
            } catch (err) {
                console.error('Failed to copy: ', err);
            }
            
            document.body.removeChild(textArea);
        }
    }
}
