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
        
        // First, add a text display of the seed that's clearly visible
        const seedText = this.add.text(
            width / 2,
            seedSectionY,
            this.seed,
            {
                fontFamily: 'VT323',
                fontSize: '20px',
                color: '#00ffff',
                align: 'center',
                backgroundColor: '#000033',
                padding: { x: 10, y: 8 }
            }
        ).setOrigin(0.5).setDepth(10);
        
        // Add a styled background for the seed text
        const seedBackground = this.add.graphics();
        seedBackground.fillStyle(0x000033, 1);
        seedBackground.fillRoundedRect(
            width / 2 - 260/2, 
            seedSectionY - 20, 
            260, 
            40, 
            5
        );
        seedBackground.lineStyle(2, 0x00ffff, 1);
        seedBackground.strokeRoundedRect(
            width / 2 - 260/2, 
            seedSectionY - 20, 
            260, 
            40, 
            5
        );
        seedBackground.setDepth(9);
        
        // Create DOM element for text input (positioned offscreen but accessible)
        const seedInput = this.add.dom(width / 2, seedSectionY + 1000).createFromHTML(`
            <input type="text" id="seedInput" value="${this.seed}" 
                   style="width: 250px; height: 30px; background-color: #000033; 
                          color: #00ffff; border: 2px solid #00ffff; 
                          border-radius: 5px; text-align: center; 
                          font-family: 'VT323', monospace; font-size: 18px; 
                          padding: 5px;">
        `);
        
        // Make the visual seed text act as a button to focus on the input
        seedText.setInteractive();
        seedText.on('pointerdown', () => {
            // When clicked, bring the input on screen temporarily and focus it
            seedInput.y = seedSectionY;
            const inputElement = seedInput.getChildByID('seedInput');
            inputElement.focus();
            inputElement.select();
        });
        
        // Get the actual input element for later reference
        const inputElement = seedInput.getChildByID('seedInput');
        
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
        
        // Create Copy Seed button
        const copyButton = this.createRetroButton(
            width / 2 - 90, 
            seedSectionY + 50, 
            170, 
            40, 
            'COPY SEED', 
            '#00ffaa'
        );
        
        // Create Paste Seed button
        const pasteButton = this.createRetroButton(
            width / 2 + 90, 
            seedSectionY + 50, 
            170, 
            40, 
            'PASTE SEED', 
            '#ffaa00'
        );
        
        // Add button functionality
        copyButton.on('pointerdown', () => {
            // Copy the current visible seed
            const currentSeed = this.seed;
            this.copyTextToClipboard(currentSeed);
            
            // Flash the seed text for visual feedback
            this.tweens.add({
                targets: seedText,
                alpha: { from: 1, to: 0.2 },
                yoyo: true,
                duration: 150,
                repeat: 1
            });
            
            // Visual feedback for the button
            copyButton.buttonText.setColor('#ffffff');
            copyButton.buttonBackground.clear();
            copyButton.buttonBackground.fillStyle(0x00aa66, 1);
            copyButton.buttonBackground.fillRoundedRect(
                -copyButton.width/2, -copyButton.height/2, 
                copyButton.width, copyButton.height, 10
            );
            copyButton.buttonBackground.lineStyle(2, 0x00ffaa, 1);
            copyButton.buttonBackground.strokeRoundedRect(
                -copyButton.width/2, -copyButton.height/2, 
                copyButton.width, copyButton.height, 10
            );
            
            // Reset visual after a delay
            this.time.delayedCall(300, () => {
                copyButton.buttonText.setColor('#00ffaa');
                copyButton.buttonBackground.clear();
                copyButton.buttonBackground.fillStyle(0x001a33, 1);
                copyButton.buttonBackground.fillRoundedRect(
                    -copyButton.width/2, -copyButton.height/2, 
                    copyButton.width, copyButton.height, 10
                );
                copyButton.buttonBackground.lineStyle(2, 0x00ffaa, 1);
                copyButton.buttonBackground.strokeRoundedRect(
                    -copyButton.width/2, -copyButton.height/2, 
                    copyButton.width, copyButton.height, 10
                );
            });
        });
        
        pasteButton.on('pointerdown', () => {
            // Visual feedback first
            pasteButton.buttonText.setColor('#ffffff');
            pasteButton.buttonBackground.clear();
            pasteButton.buttonBackground.fillStyle(0xaa6600, 1);
            pasteButton.buttonBackground.fillRoundedRect(
                -pasteButton.width/2, -pasteButton.height/2, 
                pasteButton.width, pasteButton.height, 10
            );
            pasteButton.buttonBackground.lineStyle(2, 0xffaa00, 1);
            pasteButton.buttonBackground.strokeRoundedRect(
                -pasteButton.width/2, -pasteButton.height/2, 
                pasteButton.width, pasteButton.height, 10
            );
            
            // Try to get text from clipboard
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.readText()
                    .then(text => {
                        // Update both the input value and visible seed text
                        inputElement.value = text;
                        seedText.setText(text);
                        
                        // Update the game seed
                        this.seed = text;
                        window.gameSeed = text;
                        
                        // Flash the seed text for visual feedback
                        this.tweens.add({
                            targets: seedText,
                            alpha: { from: 0.2, to: 1 },
                            yoyo: false,
                            duration: 300
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
                pasteButton.buttonText.setColor('#ffaa00');
                pasteButton.buttonBackground.clear();
                pasteButton.buttonBackground.fillStyle(0x331a00, 1);
                pasteButton.buttonBackground.fillRoundedRect(
                    -pasteButton.width/2, -pasteButton.height/2, 
                    pasteButton.width, pasteButton.height, 10
                );
                pasteButton.buttonBackground.lineStyle(2, 0xffaa00, 1);
                pasteButton.buttonBackground.strokeRoundedRect(
                    -pasteButton.width/2, -pasteButton.height/2, 
                    pasteButton.width, pasteButton.height, 10
                );
            });
        });
        
        // Add event listener to update the game seed when input changes
        inputElement.addEventListener('change', () => {
            this.seed = inputElement.value;
            window.gameSeed = inputElement.value;
            
            // Update the visible seed text
            seedText.setText(inputElement.value);
            
            // Move input back offscreen
            seedInput.y = seedSectionY + 1000;
            
            console.log('Seed updated to:', this.seed);
        });
        
        // Add event listener to select all text when input is clicked
        inputElement.addEventListener('click', () => {
            inputElement.select();
        });
        
        // Add event listener to handle input blur (losing focus)
        inputElement.addEventListener('blur', () => {
            // Move input back offscreen
            seedInput.y = seedSectionY + 1000;
        });
        
        // Instructions text with VT323 font
        this.add.text(
            width / 2,
            height * 0.9,
            'PRESS SPACE, ENTER, A OR START BUTTON TO PLAY',
            {
                fontFamily: 'VT323',
                fontSize: '22px',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 2
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
    
    /**
     * Called when scene is shutdown (e.g., when transitioning to another scene)
     */
    shutdown() {
        // Remove the bounce update event listener to prevent memory leaks
        if (this.bounceUpdate) {
            this.events.off('update', this.bounceUpdate);
            this.bounceUpdate = null;
        }
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
