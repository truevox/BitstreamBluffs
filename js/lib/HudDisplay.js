// js/lib/HudDisplay.js
// Handles all HUD and UI elements display
// ------------------------------------------------------

/**
 * @fileoverview HudDisplay module manages all UI elements, including speed indicators,
 * score displays, lives indicators, and toast notifications. It handles updating these
 * elements based on game state and provides methods for game events like explosions.
 * 
 * @module HudDisplay
 */

/**
 * Manages all heads-up display (HUD) elements and visual effects in the game
 */
/**
 * Manages all heads-up display (HUD) elements and visual effects in the game.
 */
export default class HudDisplay {
    /**
     * Creates a new HudDisplay instance
     * @param {Phaser.Scene} scene - The scene this display manager is attached to
     */
    constructor(scene) {
        this.scene = scene;
        
        // UI elements
        this.speedText = null;
        this.altitudeDropText = null;
        this.pointsText = null;
        this.livesDisplay = null;
        this.toastContainer = null;
        
        // Colors
        this.neonYellow = 0xffff00;
        this.neonBlue = 0x00ffff;
        this.neonPink = 0xff00ff;
        this.neonRed = 0xff0000;
        
        // Track initial Y position at start of run for altitude drop
        this.initialY = 0;
    }
    
    /**
     * Initializes all HUD elements
     * Creates speed, altitude, score, and lives displays
     */
    init() {
        // Create HUD text elements
        this.speedText = this.scene.add.text(
            10, 10, 
            'Speed: 0.00', 
            {
                font: '18px Arial',
                fill: '#00ffff',  // Neon blue
                stroke: '#000000',
                strokeThickness: 4
            }
        ).setScrollFactor(0).setDepth(100);
        
        this.altitudeDropText = this.scene.add.text(
            10, 40, 
            'Altitude Drop: 0.00', 
            {
                font: '18px Arial',
                fill: '#00ffff',  // Neon blue
                stroke: '#000000',
                strokeThickness: 4
            }
        ).setScrollFactor(0).setDepth(100);
        
        this.pointsText = this.scene.add.text(
            this.scene.cameras.main.width / 2, 10, 
            'Points: 0', 
            {
                font: '24px Arial',
                fill: '#ffff00',  // Neon yellow
                stroke: '#000000',
                strokeThickness: 4
            }
        ).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);
        
        // Create lives display container (top right)
        this.livesDisplay = this.scene.add.container(
            this.scene.cameras.main.width - 20,
            20
        ).setScrollFactor(0).setDepth(100);
        
        // Initialize toast message container (bottom center)
        this.initToastSystem();
        
        // Handle window resizing
        this.scene.scale.on('resize', this.handleResize, this);
    }
    
    /**
     * Initializes the toast notification system
     * Used for displaying temporary messages like trick completions and point awards
     */
    initToastSystem() {
        // Create container for toast messages at bottom center
        this.toastContainer = this.scene.add.container(
            this.scene.cameras.main.width / 2,
            this.scene.cameras.main.height - 100
        ).setScrollFactor(0).setDepth(100);
    }
    
    /**
     * Sets the initial Y position for altitude drop calculation
     * @param {number} y - The initial Y position of the player
     */
    setInitialY(y) {
        this.initialY = y;
    }
    
    /**
     * Updates all HUD elements with current game state
     * @param {Phaser.Physics.Matter.Sprite} player - The player object
     * @param {number} score - Current game score
     * @param {number} speed - Current player speed
     * @param {number} lives - Current lives remaining
     * @param {number} maxLives - Maximum possible lives
     */
    update(player, score, speed, lives, maxLives) {
        if (!player) return;
        
        // Update speed display
        this.updateSpeed(Math.abs(Math.round(speed)));
        
        // Update altitude drop display
        this.updateAltitudeDrop(player.y);
        
        // Update score display
        this.updateScore(score);
        
        // Update lives display
        this.updateLivesDisplay(lives, maxLives);
    }
    
    /**
     * Updates the speed display
     * @param {number} speed - Current player speed
     */
    updateSpeed(speed) {
        if (this.speedText) {
            this.speedText.setText(`Speed: ${speed}`);
        }
    }
    
    /**
     * Updates the altitude drop display
     * @param {number} playerY - Current player Y position
     */
    updateAltitudeDrop(playerY) {
        if (this.altitudeDropText && this.initialY !== undefined) {
            const altitudeDrop = Math.max(0, Math.round(playerY - this.initialY));
            this.altitudeDropText.setText(`Altitude Drop: ${altitudeDrop}`);
        }
    }
    
    /**
     * Updates the score display
     * @param {number} score - Current game score
     */
    updateScore(score) {
        if (this.pointsText) {
            this.pointsText.setText(`Points: ${score}`);
        }
    }
    
    /**
     * Updates the lives display with visual indicators
     * @param {number} lives - Current lives remaining
     * @param {number} maxLives - Maximum possible lives
     */
    updateLivesDisplay(lives, maxLives) {
        if (!this.livesDisplay) return;
        
        // Clear previous lives display
        this.livesDisplay.removeAll(true);
        
        // Display current lives as yellow triangles
        const triangleSize = 10;
        const spacing = 5;
        
        for (let i = 0; i < maxLives; i++) {
            // Triangle vertices (pointing up)
            const triangle = this.scene.add.triangle(
                -(triangleSize + spacing) * i,
                0,
                0, -triangleSize,           // Top
                -triangleSize, triangleSize, // Bottom left
                triangleSize, triangleSize,  // Bottom right
                i < lives ? this.neonYellow : 0x555555 // Yellow for active lives, gray for lost ones
            ).setOrigin(0.5, 0.5);
            
            this.livesDisplay.add(triangle);
        }
    }
    
    /**
     * Shows a toast notification message
     * @param {string} message - Message to display
     * @param {number} [duration=2000] - Duration to show the message in milliseconds
     */
    showToast(message, duration = 2000) {
        if (!this.toastContainer) return;
        
        // Create toast text
        const toast = this.scene.add.text(0, 0, message, {
            font: '24px Arial',
            fill: '#ffff00', // Neon yellow for visibility
            stroke: '#000000',
            strokeThickness: 4,
            backgroundColor: 'rgba(0,0,0,0.5)',
            padding: { x: 15, y: 10 }
        }).setOrigin(0.5, 0);
        
        // Add to container
        this.toastContainer.add(toast);
        
        // Shift existing toasts upward
        const toasts = this.toastContainer.getAll();
        for (let i = 0; i < toasts.length - 1; i++) {
            toasts[i].y -= toast.height + 10;
        }
        
        // Fade in and out animation
        this.scene.tweens.add({
            targets: toast,
            alpha: { from: 0, to: 1 },
            duration: 300,
            ease: 'Power2',
            onComplete: () => {
                // Start fading out after a delay
                this.scene.time.delayedCall(duration, () => {
                    this.scene.tweens.add({
                        targets: toast,
                        alpha: 0,
                        y: toast.y - 30,
                        duration: 500,
                        ease: 'Power2',
                        onComplete: () => {
                            // Remove from container when done
                            this.toastContainer.remove(toast, true);
                            toast.destroy();
                        }
                    });
                });
            }
        });
    }
    
    /**
     * Positions the toast container at the bottom center of the screen
     * @private
     */
    positionToastContainer() {
        if (!this.toastContainer) return;
        
        // Position at bottom center
        this.toastContainer.x = this.scene.cameras.main.width / 2;
        this.toastContainer.y = this.scene.cameras.main.height - 100;
    }
    
    /**
     * Handles window resizing events to reposition UI elements
     * @param {object} gameSize - Object containing the new width and height
     * @param {number} gameSize.width - New game width
     * @param {number} gameSize.height - New game height
     */
    handleResize(gameSize) {
        const { width, height } = gameSize;
        
        // Reposition HUD elements
        if (this.pointsText) {
            this.pointsText.x = width / 2;
        }
        
        if (this.livesDisplay) {
            this.livesDisplay.x = width - 20;
        }
        
        // Reposition toast container
        this.positionToastContainer();
    }
    
    /**
     * Creates explosion particle effects
     * @param {number} x - X position of the explosion
     * @param {number} y - Y position of the explosion
     * @param {number} color - Color of the particles in hex format
     * @param {object} size - Size dimensions for the particles
     * @param {number} size.width - Width of the particles
     * @param {number} size.height - Height of the particles
     */
    createExplosionParticles(x, y, color, size) {
        const particleCount = 20;
        const particles = [];
        
        for (let i = 0; i < particleCount; i++) {
            // Create particle shapes - mix of triangles and rectangles
            let particle;
            
            if (Math.random() > 0.5) {
                // Triangle particles
                particle = this.scene.add.triangle(
                    x, y,
                    0, -5,
                    -5, 5,
                    5, 5,
                    color
                );
            } else {
                // Rectangle particles
                const width = Math.random() * (size.width / 2) + 3;
                const height = Math.random() * (size.height / 2) + 3;
                particle = this.scene.add.rectangle(x, y, width, height, color);
            }
            
            // Random rotation
            particle.rotation = Math.random() * Math.PI * 2;
            particle.setDepth(60);
            particles.push(particle);
            
            // Calculate random velocity
            const angle = Math.random() * Math.PI * 2;
            const speed = 2 + Math.random() * 4;
            const velocityX = Math.cos(angle) * speed;
            const velocityY = Math.sin(angle) * speed;
            
            // Animate the particle
            this.scene.tweens.add({
                targets: particle,
                x: x + velocityX * 100,
                y: y + velocityY * 100,
                scaleX: 0,
                scaleY: 0,
                rotation: particle.rotation + (Math.random() > 0.5 ? 5 : -5),
                alpha: 0,
                duration: 800 + Math.random() * 400,
                onComplete: () => {
                    particle.destroy();
                }
            });
        }
    }
    
    /**
     * Creates full player explosion effect for game over
     * Combines multiple particle effects and shockwave
     * @param {number} playerX - Player X position
     * @param {number} playerY - Player Y position
     * @param {number} sledX - Sled X position
     * @param {number} sledY - Sled Y position
     */
    createPlayerExplosionEffect(playerX, playerY, sledX, sledY) {
        try {
            // Create a shockwave effect
            const shockwave = this.scene.add.circle(playerX, playerY, 10, 0xffffff, 0.4);
            shockwave.setDepth(50);
            
            this.scene.tweens.add({
                targets: shockwave,
                radius: 250,
                alpha: 0,
                duration: 800,
                ease: 'Power2',
                onComplete: () => {
                    shockwave.destroy();
                }
            });
            
            // Create particles for rider
            this.createExplosionParticles(
                playerX, 
                playerY, 
                this.neonBlue, 
                { width: 25, height: 50 }
            );
            
            // Create particles for sled
            this.createExplosionParticles(
                sledX, 
                sledY, 
                this.neonYellow, 
                { width: 40, height: 10 }
            );
        } catch (error) {
            console.error('Error creating explosion effect:', error);
        }
    }
    
    /**
     * Cleans up all resources used by the HUD display
     * Should be called when the scene is shutdown or destroyed
     */
    destroy() {
        // Remove resize event listener
        this.scene.scale.off('resize', this.handleResize, this);
        
        // Clean up HUD elements
        if (this.speedText) this.speedText.destroy();
        if (this.altitudeDropText) this.altitudeDropText.destroy();
        if (this.pointsText) this.pointsText.destroy();
        if (this.livesDisplay) this.livesDisplay.destroy();
        if (this.toastContainer) this.toastContainer.destroy();
        
        this.scene = null;
    }
}
