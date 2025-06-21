// js/StartScene.js
// Start screen scene for Bitstream Bluffs
// ------------------------------------------------------

// Phaser is loaded globally via CDN in index.html - no import needed
// Import crypto library for SHA-256 hashing
import { generateGameSeed } from './utils/seed-generator.js';
import StarfieldParallax from './background/StarfieldParallax.js';

/**
 * Start screen scene for Bitstream Bluffs.
 * Handles the main menu UI, starfield, and game seed generation.
 *
 * @extends Phaser.Scene
 */
export default class StartScene extends Phaser.Scene {
    /**
     * Constructs the StartScene and binds context for callbacks.
     */
    constructor() {
        super({ key: 'StartScene' });
        // Explicitly set key for test compliance and Phaser.Scene contract
        this.key = 'StartScene'; // Required for tests and scene management
        this.seed = '';
        
        // Bind methods to preserve 'this' context
        this.startGame = this.startGame.bind(this);
    }

    /**
     * Loads any assets needed for the start screen. Most elements are created programmatically.
     */
    preload() {
        // Load GitHub SVG and PNG icons
        this.load.svg('githubMark', '/assets/icons/github-mark.svg');
        this.load.image('githubMarkPng', '/assets/icons/github-mark.png');
        // Load snowBee icon
        this.load.image('snowBee', '/assets/snowBee.png');
        // Load extraLife icon
        this.load.image('extraLife', '/assets/extraLife.png');
    }

    /**
     * Sets up the start screen, generates a game seed, and displays the UI and background.
     */
    create() {
        // Generate a seed for this game session
        this.seed = generateGameSeed();
        
        // Add player-following parallax starfield background (always behind everything else)
        const { width, height } = this.cameras.main;
        this.starfield = new StarfieldParallax(this, { 
            width, 
            height, 
            depth: -100,            // Ensure it's behind everything
            density: 1.5,          // Density of stars
            cellSize: 800,         // Size of each cell in pixels
            sizes: [3, 5, 7],      // Larger stars for better visibility
            visibleBuffer: 2,      // Extra cells beyond visible area
            speeds: [0.01, 0.02, 0.05] // Much slower parallax for true cosmic background feeling
        });

        // Create a dark background with arcade cabinet feel (drawn above stars but still behind gameplay)
        const backgroundGraphics = this.add.graphics();
        backgroundGraphics.setDepth(-90); // Still behind UI/gameplay, but above stars
        backgroundGraphics.fillStyle(0x000022, 1);
        backgroundGraphics.fillRect(0, 0, width, height);
        
        // Add retro scan lines for arcade feel
        const scanLines = this.add.graphics();
        scanLines.setDepth(-80);
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
        const titleBox = {
            x: width / 2 - 280,
            y: height * 0.15 - 20,
            width: 560,
            height: 150,
            borderRadius: 15
        };
        
        const titleGlow = this.add.graphics();
        titleGlow.fillStyle(0xff00ff, 0.2);
        titleGlow.fillRoundedRect(titleBox.x, titleBox.y, titleBox.width, titleBox.height, titleBox.borderRadius);
        
        // Create title as a container for bouncing animation
        const titleContainer = this.add.container(width / 2, height * 0.2);
        
        // Create title text with Press Start 2P font
        const titleText = this.add.text(0, 0, 'BITSTREAM\nBLUFFS', {
            fontFamily: '"Press Start 2P"',
            fontSize: '42px',
            color: '#ff00ff',
            align: 'center',
            stroke: '#ffffff',
            strokeThickness: 3,
            padding: { x: 20, y: 10 },
            lineSpacing: 20
        }).setOrigin(0.5);
        
        // Add text to container
        titleContainer.add(titleText);
        
        // Calculate bounds for bouncing
        const textWidth = titleText.width;
        const textHeight = titleText.height;
        
        // Calculate bounce boundaries to keep title inside the glow box
        const boundsLeft = titleBox.x + textWidth/2;
        const boundsRight = titleBox.x + titleBox.width - textWidth/2;
        const boundsTop = titleBox.y + textHeight/2;
        const boundsBottom = titleBox.y + titleBox.height - textHeight/2;
        
        // Initial velocity (pixels per second)
        const velocity = {
            x: Phaser.Math.Between(50, 100) * (Math.random() > 0.5 ? 1 : -1),
            y: Phaser.Math.Between(30, 60) * (Math.random() > 0.5 ? 1 : -1)
        };
        
        // Update function for bouncing
        this.bounceUpdate = (time, delta) => {
            // Convert delta to seconds
            const deltaSeconds = delta / 1000;
            
            // Update position based on velocity
            titleContainer.x += velocity.x * deltaSeconds;
            titleContainer.y += velocity.y * deltaSeconds;
            
            // Check for collision with boundaries
            if (titleContainer.x <= boundsLeft) {
                titleContainer.x = boundsLeft;
                velocity.x *= -1; // Reverse x direction
            } else if (titleContainer.x >= boundsRight) {
                titleContainer.x = boundsRight;
                velocity.x *= -1; // Reverse x direction
            }
            
            if (titleContainer.y <= boundsTop) {
                titleContainer.y = boundsTop;
                velocity.y *= -1; // Reverse y direction
            } else if (titleContainer.y >= boundsBottom) {
                titleContainer.y = boundsBottom;
                velocity.y *= -1; // Reverse y direction
            }
        };
        
        // Add the update function to the scene
        this.events.on('update', this.bounceUpdate);
        
        // Add glow effect to text
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
        
        // Button text with Press Start 2P font
        const startText = this.add.text(
            width / 2,
            height * 0.5,
            'START GAME',
            {
                fontFamily: '"Press Start 2P"',
                fontSize: '18px',
                color: '#00ffff',
                padding: { x: 4, y: 8 }
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
        
        // Game preview and terrain display section
        
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
        
        // Create interactive seed management section with input field and buttons
        const seedSectionY = height * 0.8;
        
        // SHA-256 hash is 64 characters in hex format, need a wider rectangle with some extra padding
        // Create a styled visual background for the seed display
        const seedBackground = this.add.graphics();
        seedBackground.fillStyle(0x000033, 1);
        seedBackground.fillRoundedRect(width / 2 - 315, seedSectionY - 20, 630, 40, 10);
        seedBackground.lineStyle(2, 0x00ffff, 1);
        seedBackground.strokeRoundedRect(width / 2 - 315, seedSectionY - 20, 630, 40, 10);
        
        // Create the seed text display
        const seedText = this.add.text(
            width / 2,
            seedSectionY,
            this.seed,
            {
                fontFamily: 'VT323',
                fontSize: '24px',
                color: '#00ffff',
                align: 'center'
            }
        ).setOrigin(0.5);
        
        // Flag to indicate if we're in seed editing mode
        this.isEditingSeed = false;
        
        // Make the seed text interactive to allow editing
        seedText.setInteractive({ useHandCursor: true });
        
        // Add a custom pulse effect to the border to indicate it's editable
        this.tweens.add({
            targets: seedBackground,
            alpha: { from: 1, to: 0.7 },
            duration: 1500,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
        
        // Create a cursor graphic to indicate text editing
        const cursor = this.add.text(0, seedSectionY, '|', {
            fontFamily: 'VT323',
            fontSize: '24px',
            color: '#00ffff'
        }).setOrigin(0, 0.5).setVisible(false);
        
        // Set up blinking cursor animation
        this.blinkCursorInterval = null;
        
        // Handle clicking on the seed to start editing mode
        seedText.on('pointerdown', () => {
            // Start editing mode
            this.isEditingSeed = true;
            // Position cursor at end of text
            const textWidth = seedText.width;
            cursor.setPosition(width / 2 + textWidth / 2 + 2, seedSectionY);
            cursor.setVisible(true);
            
            // Create blinking cursor effect
            if (this.blinkCursorInterval) clearInterval(this.blinkCursorInterval);
            this.blinkCursorInterval = setInterval(() => {
                cursor.setVisible(!cursor.visible);
            }, 500);
            
            // Change border to indicate edit mode
            seedBackground.clear();
            seedBackground.fillStyle(0x001a33, 1); // Slightly lighter background
            seedBackground.fillRoundedRect(width / 2 - 315, seedSectionY - 20, 630, 40, 10);
            seedBackground.lineStyle(2, 0xffff00, 1); // Yellow border while editing
            seedBackground.strokeRoundedRect(width / 2 - 315, seedSectionY - 20, 630, 40, 10);
        });
        
        // Enable keyboard input for editing the seed
        this.input.keyboard.on('keydown', (event) => {
            if (!this.isEditingSeed) return;
            
            const key = event.key;
            
            // Handle different key inputs
            if (key === 'Escape' || key === 'Enter') {
                // Exit editing mode
                this.isEditingSeed = false;
                cursor.setVisible(false);
                if (this.blinkCursorInterval) clearInterval(this.blinkCursorInterval);
                
                // Reset border to normal
                seedBackground.clear();
                seedBackground.fillStyle(0x000033, 1);
                seedBackground.fillRoundedRect(width / 2 - 315, seedSectionY - 20, 630, 40, 10);
                seedBackground.lineStyle(2, 0x00ffff, 1);
                seedBackground.strokeRoundedRect(width / 2 - 315, seedSectionY - 20, 630, 40, 10);
                
            } else if (key === 'Backspace') {
                // Handle backspace key
                if (this.seed.length > 0) {
                    this.seed = this.seed.slice(0, -1);
                    seedText.setText(this.seed);
                    window.gameSeed = this.seed;
                    
                    // Update cursor position
                    const textWidth = seedText.width;
                    cursor.setPosition(width / 2 + textWidth / 2 + 2, seedSectionY);
                }
            } else if (key.length === 1) {
                // Add character to seed only if we haven't reached the SHA-256 hash length limit (64 chars)
                if (this.seed.length < 64) {
                    this.seed += key;
                    seedText.setText(this.seed);
                    window.gameSeed = this.seed;
                    
                    // Update cursor position
                    const textWidth = seedText.width;
                    cursor.setPosition(width / 2 + textWidth / 2 + 2, seedSectionY);
                }
            }
        });
        
        // Exit edit mode when clicking elsewhere
        this.input.on('pointerdown', (pointer, gameObjects) => {
            if (this.isEditingSeed && !gameObjects.includes(seedText)) {
                this.isEditingSeed = false;
                cursor.setVisible(false);
                if (this.blinkCursorInterval) clearInterval(this.blinkCursorInterval);
                
                // Reset border to normal
                seedBackground.clear();
                seedBackground.fillStyle(0x000033, 1);
                seedBackground.fillRoundedRect(width / 2 - 315, seedSectionY - 20, 630, 40, 10);
                seedBackground.lineStyle(2, 0x00ffff, 1);
                seedBackground.strokeRoundedRect(width / 2 - 315, seedSectionY - 20, 630, 40, 10);
            }
        });
        
        // Add input label above
        const inputLabel = this.add.text(
            width / 2,
            seedSectionY - 30,
            'GAME SEED:',
            {
                fontFamily: 'VT323',
                fontSize: '22px',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 2
            }
        ).setOrigin(0.5);
        
        // Create Copy Seed button with identical logic as Start Game
        const copyButtonWidth = 170;
        const copyButtonHeight = 40;
        
        // Glow for Copy button
        const copyButtonGlow = this.add.graphics();
        copyButtonGlow.fillStyle(0x00ffaa, 0.2);
        copyButtonGlow.fillRoundedRect(
            width / 2 - 90 - copyButtonWidth/2 - 5, 
            seedSectionY + 50 - copyButtonHeight/2 - 5, 
            copyButtonWidth + 10, 
            copyButtonHeight + 10, 
            10
        );
        
        // Copy button background
        const copyButton = this.add.rectangle(
            width / 2 - 90,
            seedSectionY + 50,
            copyButtonWidth,
            copyButtonHeight,
            0x000022
        ).setStrokeStyle(4, 0x00ffaa, 1).setInteractive();
        
        // Copy button text
        const copyText = this.add.text(
            width / 2 - 90,
            seedSectionY + 50,
            'COPY SEED',
            {
                fontFamily: '"Press Start 2P"',
                fontSize: '16px',
                color: '#00ffaa',
                padding: { x: 4, y: 8 }
            }
        ).setOrigin(0.5);
        
        // Copy button hover and click effects - exactly like Start Game
        copyButton.on('pointerover', () => {
            copyButton.setStrokeStyle(4, 0xffff00, 1);
            copyText.setColor('#ffff00');
        });
        
        copyButton.on('pointerout', () => {
            copyButton.setStrokeStyle(4, 0x00ffaa, 1);
            copyText.setColor('#00ffaa');
        });
        
        // Create Paste Seed button with identical logic as Start Game
        const pasteButtonWidth = 170;
        const pasteButtonHeight = 40;
        
        // Glow for Paste button
        const pasteButtonGlow = this.add.graphics();
        pasteButtonGlow.fillStyle(0xffaa00, 0.2);
        pasteButtonGlow.fillRoundedRect(
            width / 2 + 90 - pasteButtonWidth/2 - 5, 
            seedSectionY + 50 - pasteButtonHeight/2 - 5, 
            pasteButtonWidth + 10, 
            pasteButtonHeight + 10, 
            10
        );
        
        // Paste button background
        const pasteButton = this.add.rectangle(
            width / 2 + 90,
            seedSectionY + 50,
            pasteButtonWidth,
            pasteButtonHeight,
            0x000022
        ).setStrokeStyle(4, 0xffaa00, 1).setInteractive();
        
        // Paste button text
        const pasteText = this.add.text(
            width / 2 + 90,
            seedSectionY + 50,
            'PASTE SEED',
            {
                fontFamily: '"Press Start 2P"',
                fontSize: '16px',
                color: '#ffaa00',
                padding: { x: 4, y: 8 }
            }
        ).setOrigin(0.5);
        
        // Paste button hover and click effects - exactly like Start Game
        pasteButton.on('pointerover', () => {
            pasteButton.setStrokeStyle(4, 0xffff00, 1);
            pasteText.setColor('#ffff00');
        });
        
        pasteButton.on('pointerout', () => {
            pasteButton.setStrokeStyle(4, 0xffaa00, 1);
            pasteText.setColor('#ffaa00');
        });
        
        // Add glow animation like Start Game
        this.tweens.add({
            targets: [copyButtonGlow, pasteButtonGlow],
            alpha: { from: 0.6, to: 0.2 },
            duration: 1000,
            yoyo: true, 
            repeat: -1
        });
        
        // Add button functionality
        copyButton.on('pointerdown', () => {
            // Copy the current seed
            this.copyTextToClipboard(this.seed);
            
            // Flash the seed text for visual feedback
            this.tweens.add({
                targets: seedText,
                alpha: { from: 1, to: 0.2 },
                yoyo: true,
                duration: 150,
                repeat: 1
            });
            
            // Flash the background for extra feedback
            seedBackground.clear();
            seedBackground.fillStyle(0x00aa66, 1); // Success green
            seedBackground.fillRoundedRect(width / 2 - 315, seedSectionY - 20, 630, 40, 10);
            seedBackground.lineStyle(2, 0x00ffff, 1);
            seedBackground.strokeRoundedRect(width / 2 - 315, seedSectionY - 20, 630, 40, 10);
            
            // Reset background after short delay
            this.time.delayedCall(300, () => {
                seedBackground.clear();
                seedBackground.fillStyle(0x000033, 1);
                seedBackground.fillRoundedRect(width / 2 - 315, seedSectionY - 20, 630, 40, 10);
                seedBackground.lineStyle(2, 0x00ffff, 1);
                seedBackground.strokeRoundedRect(width / 2 - 315, seedSectionY - 20, 630, 40, 10);
            });
            
            // Visual feedback for button click (temporary color change)
            const originalStrokeColor = 0x00ffaa;
            const originalTextColor = '#00ffaa';
            const clickStrokeColor = 0xffffff;
            const clickTextColor = '#ffffff';
            
            // Change to click state
            copyButton.setFillStyle(0x003322);
            copyText.setColor(clickTextColor);
            
            // Reset after a short delay
            this.time.delayedCall(300, () => {
                copyButton.setFillStyle(0x000022);
                copyText.setColor(originalTextColor);
            });
        });
        
        pasteButton.on('pointerdown', () => {
            // Visual feedback for button click (temporary color change)
            pasteButton.setFillStyle(0x332200);
            pasteText.setColor('#ffffff');
            
            // Try to get text from clipboard
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.readText()
                    .then(text => {
                        // Limit pasted text to SHA-256 hash length (64 characters)
                        const limitedText = text.substring(0, 64);
                        
                        // Update the seed text display
                        seedText.setText(limitedText);
                        
                        // Update the game seed
                        this.seed = limitedText;
                        window.gameSeed = limitedText;
                        
                        // Visual feedback animation
                        this.tweens.add({
                            targets: seedText,
                            alpha: { from: 0.2, to: 1 },
                            duration: 300
                        });
                        
                        // Flash the background for extra feedback
                        seedBackground.clear();
                        seedBackground.fillStyle(0xaa6600, 1); // Orange for paste
                        seedBackground.fillRoundedRect(width / 2 - 315, seedSectionY - 20, 630, 40, 10);
                        seedBackground.lineStyle(2, 0xffaa00, 1);
                        seedBackground.strokeRoundedRect(width / 2 - 315, seedSectionY - 20, 630, 40, 10);
                        
                        // Reset background after short delay
                        this.time.delayedCall(300, () => {
                            seedBackground.clear();
                            seedBackground.fillStyle(0x000033, 1);
                            seedBackground.fillRoundedRect(width / 2 - 315, seedSectionY - 20, 630, 40, 10);
                            seedBackground.lineStyle(2, 0x00ffff, 1);
                            seedBackground.strokeRoundedRect(width / 2 - 315, seedSectionY - 20, 630, 40, 10);
                        });
                    })
                    .catch(err => {
                        console.error('Failed to read clipboard: ', err);
                    });
            } else {
                // Alert if clipboard API is not available
                console.error('Clipboard API not available');
                alert('Clipboard paste not available in this browser or context.');
            }
            
            // Reset visual after a delay
            this.time.delayedCall(300, () => {
                pasteButton.setFillStyle(0x000022);
                pasteText.setColor('#ffaa00');
            });
        });
        
        // Seed is now updated in the key event handlers
        // No need for additional event listeners
        
        
        // Instructions text with VT323 font
        this.add.text(
            width / 2,
            height * 0.9,
            'CLICK START GAME ABOVE OR PRESS SPACE/ENTER TO START',
            {
                fontFamily: 'VT323',
                fontSize: '22px',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 2
            }
        ).setOrigin(0.5);
        
        // Add GitHub link, instruction manual, and sledhead.ing links in the bottom right corner
        this.createBottomRightLinks(width, height);
        
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
    
    /**
     * Updates the scene, including any animated UI or background elements.
     */
    update() {
        // Update the starfield (use camera center as 'player' position in start screen)
        if (this.starfield && this.cameras && this.cameras.main) {
            // No player object in start screen, so the camera center will be used as player position
            this.starfield.update(this.cameras.main);
        }
        // Additional gamepad polling if needed
    }
    
    /**
     * Called when scene is shutdown (e.g., when transitioning to another scene)
     */
    /**
     * Called when the scene is shutdown (e.g., when transitioning to another scene).
     */
    shutdown() {
        // Remove the bounce update event listener to prevent memory leaks
        if (this.bounceUpdate) {
            this.events.off('update', this.bounceUpdate);
            this.bounceUpdate = null;
        }
    }
    
    /**
     * Creates links to GitHub, Instruction Manual, and Sledhead.ing in the bottom right corner
     * @param {number} width - Screen width
     * @param {number} height - Screen height
     */
    /**
     * Creates links to GitHub, Instruction Manual, and Sledhead.ing in the bottom right corner.
     *
     * @param {number} width - Screen width.
     * @param {number} height - Screen height.
     */
    createBottomRightLinks(width, height) {
        // Container for the links
        const linksContainer = this.add.container(width - 20, height - 20);
        linksContainer.setDepth(100); // Keep on top of everything
        
        // Load GitHub mark images (SVG and PNG fallback)
        this.load.svg('githubMark', 'assets/icons/github-mark.svg');
        this.load.image('githubMarkPng', 'assets/icons/github-mark.png');
        
        // After loading is complete create the GitHub icon
        const createGithubIcon = () => {
            // Try to use SVG first, fall back to PNG if SVG load failed
            const textureKey = this.textures.exists('githubMark') ? 'githubMark' : 'githubMarkPng';
            
            // Create the GitHub icon
            const githubIcon = this.add.image(0, 0, textureKey)
                .setOrigin(1, 1)
                .setScale(0.3) // 10% smaller than previous size (0.33)
                .setInteractive();
            
            // Set a white tint since the GitHub mark is typically dark
            githubIcon.setTint(0xFFFFFF);
            
            // Add to container
            linksContainer.add(githubIcon);
            
            // Add hover effect and click handler
            this.addIconInteractivity(githubIcon, 'https://github.com/truevox/BitstreamBluffs', 'GitHub Repository');
        };
        
        // Instruction manual icon (position adjusted to account for GitHub icon width)
        const instructionsIcon = this.add.text(-50, 0, '📖', {
            fontFamily: 'Arial',
            fontSize: '28px'
        }).setOrigin(1, 1).setInteractive();
        
        // Load the Snow Bee icon for Sledhead.ing link
        this.load.image('snowBee', 'assets/AltLogo_Bee (Snow Bee).png');
        this.load.once('complete', () => {
            // Create GitHub icon now that assets are loaded
            createGithubIcon();
            
            // Create Snow Bee icon
            const snowBeeIcon = this.add.image(-100, -5, 'snowBee')
                .setOrigin(1, 1)
                .setScale(0.06) // Scaled down to 60% of original size
                .setInteractive();
            
            // Add to container
            linksContainer.add(snowBeeIcon);
            
            // Add hover effect and click handler
            this.addIconInteractivity(snowBeeIcon, 'https://sledhead.ing', 'Visit SledHEAD');
        });
        this.load.start();
        
        // Add instruction icon to container
        linksContainer.add(instructionsIcon);
        
        // Add hover effects and click handler for instructions
        this.addIconInteractivity(instructionsIcon, 'docs/instructions.html', 'Game Instructions');
    }
    
    /**
     * Adds hover effects and click handler to an icon
     * @param {Phaser.GameObjects.GameObject} icon - The icon to add interactivity to
     * @param {string} url - The URL to open on click
     * @param {string} tooltip - Tooltip text to show on hover
     */
    /**
     * Adds hover effects and click handler to an icon.
     *
     * @param {Phaser.GameObjects.GameObject} icon - The icon to add interactivity to.
     * @param {string} url - The URL to open on click.
     * @param {string} tooltip - Tooltip text to show on hover.
     */
    addIconInteractivity(icon, url, tooltip) {
        // Determine tooltip position based on the icon - special case for the Snow Bee icon
        let tooltipX = icon.x - icon.width/2;
        let tooltipY = icon.y - icon.height - 10;
        let tooltipOrigin = { x: 0.5, y: 1 };
        
        // Special case for the Snow Bee icon - position tooltip directly above it
        if (url === 'https://sledhead.ing') {
            tooltipX = icon.x;
            tooltipY = icon.y - 45; // Moved higher so bottom is where top used to be
            tooltipOrigin = { x: 0.5, y: 1 };
        }
        
        // Create tooltip (initially hidden)
        const tooltipText = this.add.text(
            tooltipX,
            tooltipY,
            tooltip,
            {
                fontFamily: 'VT323',
                fontSize: '16px',
                color: '#ffffff',
                backgroundColor: '#000000',
                padding: { x: 5, y: 3 }
            }
        ).setOrigin(tooltipOrigin.x, tooltipOrigin.y).setAlpha(0);
        
        // If icon is in a container, add tooltip to the same container
        if (icon.parentContainer) {
            icon.parentContainer.add(tooltipText);
        }
        
        // Hover effects
        icon.on('pointerover', () => {
            // Scale up icon
            this.tweens.add({
                targets: icon,
                scale: icon.scale * 1.2,
                duration: 200
            });
            
            // Show tooltip
            this.tweens.add({
                targets: tooltipText,
                alpha: 1,
                duration: 200
            });
        });
        
        icon.on('pointerout', () => {
            // Scale down icon
            this.tweens.add({
                targets: icon,
                scale: icon.scale / 1.2,
                duration: 200
            });
            
            // Hide tooltip
            this.tweens.add({
                targets: tooltipText,
                alpha: 0,
                duration: 200
            });
        });
        
        // Click handler
        icon.on('pointerdown', () => {
            // Open URL in new tab
            window.open(url, '_blank');
        });
    }
    
    /**
     * Creates a styled retro button with hover effects
     * @param {number} x - X position of button
     * @param {number} y - Y position of button
     * @param {number} width - Width of button
     * @param {number} height - Height of button
     * @param {string} text - Button text
     * @param {string} color - Text color (hex)
     * @returns {Phaser.GameObjects.Container} - Button container
     */
    /**
     * Creates a styled retro button with hover effects.
     *
     * @param {number} x - X position of button.
     * @param {number} y - Y position of button.
     * @param {number} width - Width of button.
     * @param {number} height - Height of button.
     * @param {string} text - Button text.
     * @param {string} [color='#00ffff'] - Text color (hex).
     * @returns {Phaser.GameObjects.Container} Button container.
     */
    createRetroButton(x, y, width, height, text, color = '#00ffff') {
        // Create container for the button
        const buttonContainer = this.add.container(x, y);
        
        // Add button background
        const buttonBackground = this.add.graphics();
        buttonBackground.fillStyle(0x001a33, 1);
        buttonBackground.fillRoundedRect(-width/2, -height/2, width, height, 10);
        buttonBackground.lineStyle(2, color.replace('#', '0x'), 1);
        buttonBackground.strokeRoundedRect(-width/2, -height/2, width, height, 10);
        
        // Add button text
        const buttonText = this.add.text(
            0,
            0,
            text,
            {
                fontFamily: '"Press Start 2P"',
                fontSize: '16px',
                color: color,
                align: 'center'
            }
        ).setOrigin(0.5);
        
        // Add components to container
        buttonContainer.add(buttonBackground);
        buttonContainer.add(buttonText);
        
        // Make button interactive
        buttonContainer.setInteractive(new Phaser.Geom.Rectangle(-width/2, -height/2, width, height), Phaser.Geom.Rectangle.Contains);
        
        // Add hover effects
        buttonContainer.on('pointerover', () => {
            buttonBackground.clear();
            buttonBackground.fillStyle(0x003366, 1);
            buttonBackground.fillRoundedRect(-width/2, -height/2, width, height, 10);
            buttonBackground.lineStyle(2, color.replace('#', '0x'), 1);
            buttonBackground.strokeRoundedRect(-width/2, -height/2, width, height, 10);
        });
        
        buttonContainer.on('pointerout', () => {
            buttonBackground.clear();
            buttonBackground.fillStyle(0x001a33, 1);
            buttonBackground.fillRoundedRect(-width/2, -height/2, width, height, 10);
            buttonBackground.lineStyle(2, color.replace('#', '0x'), 1);
            buttonBackground.strokeRoundedRect(-width/2, -height/2, width, height, 10);
        });
        
        // Store width and height for later use
        buttonContainer.width = width;
        buttonContainer.height = height;
        buttonContainer.buttonBackground = buttonBackground;
        buttonContainer.buttonText = buttonText;
        
        return buttonContainer;
    }
    
    /**
     * Starts the ModularGameScene with a transition effect.
     */
    startGame() {
        // Always use the modular architecture
        window.useModularArchitecture = true;
        
        // Transition effect
        this.cameras.main.fadeOut(500, 0, 0, 0);
        
        this.cameras.main.once('camerafadeoutcomplete', () => {
            // Always start the ModularGameScene
            this.scene.start('ModularGameScene');
            console.log('Starting game with modular architecture');
        });
    }
    
    /**
     * Copies the provided text to the clipboard using the best available method.
     *
     * @param {string} text - The text to copy.
     */
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
