// js/utils/ExplosionEffects.js
// Handles explosive visual effects for game over and other dramatic moments
// -----------------------------------------------------------------------

/**
 * ExplosionEffects - Utility class for creating visual explosion effects
 */
/**
 * Utility class for creating visual explosion effects in the game.
 */
export default class ExplosionEffects {
    /**
     * Create a new ExplosionEffects instance
     * @param {Phaser.Scene} scene - The scene to add effects to
     */
    /**
     * Creates a new ExplosionEffects instance.
     * @param {Phaser.Scene} scene - The scene to add effects to.
     */
    constructor(scene) {
        this.scene = scene;
    }

    /**
     * Create an explosion effect for player and sled
     * @param {Object} playerContainer - The player container with sled and rider
     */
    /**
     * Creates an explosion effect for the player and sled.
     * @param {Object} playerContainer - The player container with sled and rider.
     */
    createPlayerExplosion(playerContainer) {
        if (!playerContainer || !playerContainer.getAll) {
            console.warn('Cannot create explosion effect - player not available');
            return;
        }
        
        try {
            // Get the player's current position
            const playerX = playerContainer.x;
            const playerY = playerContainer.y;
            
            // Get the children components (sled and rider)
            const children = playerContainer.getAll();
            if (!children || children.length < 2) {
                console.warn('Cannot create explosion effect - player components not available');
                return;
            }
            
            // Get the sled (first child) and rider (second child)
            const sled = children[0];
            const rider = children[1];
            
            // Hide the original container but NOT the components
            playerContainer.visible = false;
            
            // Create clones of the original rider and sled at the correct world positions
            // We need to create new objects because the originals are tied to the container
            const riderWorldPos = playerContainer.getLocalPoint(rider.x, rider.y);
            const sledWorldPos = playerContainer.getLocalPoint(sled.x, sled.y);
            
            // Create new triangle for the rider that matches the original
            const riderClone = this.scene.add.triangle(
                playerX + rider.x, 
                playerY + rider.y,
                0, -rider.height/2,
                -rider.width/2, rider.height/2,
                rider.width/2, rider.height/2,
                0xffff00 // Neon yellow
            );
            riderClone.setRotation(playerContainer.rotation);
            riderClone.setDepth(60);
            
            // Create new rectangle for the sled that matches the original
            const sledClone = this.scene.add.rectangle(
                playerX + sled.x,
                playerY + sled.y,
                sled.width,
                sled.height,
                0xff0000 // Neon red
            );
            sledClone.setRotation(playerContainer.rotation);
            sledClone.setDepth(60);
            
            // Add smaller particle effects for added drama
            this.createParticles(playerX, playerY, 0xff0000, { width: 20, height: 10 });
            this.createParticles(playerX, playerY - 20, 0xffff00, { width: 15, height: 15 });
            
            // Make the rider blast upward and spin
            this.scene.tweens.add({
                targets: riderClone,
                x: playerX + (Math.random() > 0.5 ? 150 : -150),
                y: playerY - 200 - Math.random() * 100,
                rotation: riderClone.rotation + (Math.random() > 0.5 ? 8 : -8),
                alpha: 0,
                scaleX: 0.5,
                scaleY: 0.5,
                duration: 1500,
                ease: 'Power2',
                onComplete: () => {
                    riderClone.destroy();
                }
            });
            
            // Make the sled blast in a different direction and spin
            this.scene.tweens.add({
                targets: sledClone,
                x: playerX + (Math.random() > 0.5 ? -120 : 120),
                y: playerY + 100 + Math.random() * 80,
                rotation: sledClone.rotation + (Math.random() > 0.5 ? 6 : -6),
                alpha: 0,
                scaleX: 0.7,
                scaleY: 0.7,
                duration: 1500,
                ease: 'Power2',
                onComplete: () => {
                    sledClone.destroy();
                }
            });
            
            // Add a shockwave effect
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
        } catch (error) {
            console.error('Error creating explosion effect:', error);
        }
    }
    
    /**
     * Create particle explosion effect
     * @param {number} x - X position
     * @param {number} y - Y position
     * @param {number} color - Color in hex format
     * @param {Object} size - Width and height object
     */
    /**
     * Creates a particle explosion effect at the specified position.
     * @param {number} x - X position.
     * @param {number} y - Y position.
     * @param {number} color - Color in hex format.
     * @param {Object} size - Width and height object.
     */
    createParticles(x, y, color, size) {
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
}
