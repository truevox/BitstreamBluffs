// js/lib/CollectibleManager.js
// Handles all collectible items like extra lives
// ------------------------------------------------------

/**
 * @fileoverview CollectibleManager module handles spawning, updating, and collecting 
 * of in-game pickups such as extra lives. It manages their lifecycle including positioning,
 * physics integration, collection effects, and cleanup.
 * 
 * @module CollectibleManager
 */

/**
 * Manages all collectible items like extra lives throughout the game
 */
export default class CollectibleManager {
    /**
     * Creates a new CollectibleManager instance
     * @param {Phaser.Scene} scene - The scene this manager is attached to
     * @param {TerrainManager} terrainManager - Reference to the terrain manager for placement
     */
    constructor(scene, terrainManager) {
        this.scene = scene;
        this.terrainManager = terrainManager;
        
        // Collectibles state
        this.extraLives = []; // Array to store extra life objects
        this.lastLifeCollectTime = 0; // Track time between spawns
        
        // Import physics configuration from scene to avoid circular dependencies
        this.physicsConfig = null;
    }
    
    /**
     * Initializes the collectibles system
     * @param {Object} physicsConfig - Physics configuration settings
     */
    init(physicsConfig) {
        // Store physics config for use in this manager
        this.physicsConfig = physicsConfig;
        
        // Ensure we have the extra life texture
        this.createExtraLifeTexture();
    }
    
    /**
     * Updates the collectibles system based on current game state
     * @param {number} currentTime - Current game time
     * @param {number} playerX - Current player X position
     */
    update(currentTime, playerX) {
        if (!this.physicsConfig) return;
        
        // Manage extra lives spawning
        this.manageExtraLives(currentTime);
        
        // Clean up off-screen collectibles
        this.cleanupOffscreenCollectibles(playerX);
    }
    
    /**
     * Manages the spawning cycle of extra life collectibles
     * Based on elapsed time and randomization
     * @param {number} currentTime - Current game time
     * @private
     */
    manageExtraLives(currentTime) {
        if (!this.physicsConfig) return;
        
        // Check if it's time to spawn a new extra life
        const timeSinceLastLife = currentTime - this.lastLifeCollectTime;
        const minSpawnDelay = this.physicsConfig.extraLives.minSpawnDelay;
        
        if (timeSinceLastLife >= minSpawnDelay) {
            // Random chance to spawn based on elapsed time
            const chanceToSpawn = Math.min(
                0.005, // Base chance
                0.005 * (timeSinceLastLife / minSpawnDelay) // Increasing chance over time
            );
            
            if (Math.random() < chanceToSpawn) {
                this.spawnExtraLife();
                this.lastLifeCollectTime = currentTime; // Reset timer
            }
        }
    }
    
    /**
     * Cleans up collectibles that are off-screen
     * Optimizes performance by removing objects far behind the player
     * @param {number} playerX - Current player X position
     * @private
     */
    cleanupOffscreenCollectibles(playerX) {
        // Calculate viewport boundaries (with buffer)
        const viewportLeft = playerX - 2000;
        
        // Loop through all extra lives
        let i = 0;
        while (i < this.extraLives.length) {
            const life = this.extraLives[i];
            
            if (!life || !life.sprite || !life.sprite.active) {
                // Remove invalid entries
                this.extraLives.splice(i, 1);
                continue;
            }
            
            // If life is off-screen to the left
            if (life.sprite.x < viewportLeft) {
                // Remove matter body safely
                if (life.body && life.body.id) {
                    this.scene.matter.world.remove(life.body);
                }
                
                // Destroy the sprite
                life.sprite.destroy();
                
                // Remove from array
                this.extraLives.splice(i, 1);
            } else {
                // Move to next item
                i++;
            }
        }
    }
    
    /**
     * Spawns an extra life collectible in the game world
     * Places it on terrain ahead of the player with proper physics
     * @returns {Object|undefined} The created extra life object or undefined on failure
     * @private
     */
    spawnExtraLife() {
        if (!this.physicsConfig) return;
        
        try {
            // Check terrain manager exists
            if (!this.terrainManager) {
                console.warn('Cannot spawn extra life: terrain manager not available');
                return;
            }
            
            // Ensure texture exists
            if (!this.scene.textures.exists('extraLife')) {
                this.createExtraLifeTexture();
            }
            
            // Calculate spawn position
            const segments = this.terrainManager.getTerrainSegments();
            if (segments.length < 3) return; // Need some terrain first
            
            // Spawn ahead of player, around 2000px forward
            const cameraX = this.scene.cameras.main.scrollX;
            const spawnX = cameraX + 2000 + Math.random() * 1000;
            
            // Find terrain height at spawn X
            const terrainY = this.terrainManager.findTerrainHeightAt(spawnX);
            if (!terrainY) return; // No valid terrain found
            
            // Spawn above terrain at a random height
            const spawnY = terrainY - 100 - Math.random() * 300;
            
            // Create a new sprite using our texture
            const lifeSprite = this.scene.add.sprite(spawnX, spawnY, 'extraLife');
            lifeSprite.setDepth(10);
            
            // Add a Matter physics body (sensor)
            const lifeBody = this.scene.matter.add.circle(
                spawnX,
                spawnY,
                20,
                {
                    isSensor: true,
                    label: 'extraLife',
                    plugin: {
                        attractors: [
                            // No attractors for now
                        ]
                    }
                }
            );
            
            // Store references together
            const extraLife = {
                sprite: lifeSprite,
                body: lifeBody,
                collected: false
            };
            
            // Add to our tracking array
            this.extraLives.push(extraLife);
            
            // Set the sprite to match physics body position
            lifeSprite.setOrigin(0.5, 0.5);
            
            // Add animation effects
            this.scene.tweens.add({
                targets: lifeSprite,
                y: spawnY + 20,
                duration: 1000,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut'
            });
            
            // Add rotation animation
            this.scene.tweens.add({
                targets: lifeSprite,
                angle: 360,
                duration: 3000,
                repeat: -1,
                ease: 'Linear'
            });
        } catch (error) {
            console.error('Error spawning extra life:', error);
        }
    }
    
    /**
     * Handles the collection of an extra life by the player
     * Includes visual effects and physics cleanup
     * @param {MatterJS.Body} collider - The body that collided with the extra life
     * @param {Function} callback - Callback to execute after collection (e.g., increase lives)
     * @returns {boolean} Whether the collection was successful
     */
    collectExtraLife(collider, callback) {
        try {
            // Find the matching extra life in our array
            const foundIndex = this.extraLives.findIndex(life => life.body === collider);
            if (foundIndex === -1) return;
            
            const extraLife = this.extraLives[foundIndex];
            if (!extraLife || extraLife.collected) return;
            
            // Mark as collected so we don't process it multiple times
            extraLife.collected = true;
            
            // Create collection animation/effect
            const x = extraLife.sprite.x;
            const y = extraLife.sprite.y;
            
            // Create a shockwave effect (expanding circle)
            const shockwave = this.scene.add.circle(x, y, 10, 0xffff00, 0.4);
            shockwave.setDepth(20);
            
            this.scene.tweens.add({
                targets: shockwave,
                radius: 100,
                alpha: 0,
                duration: 500,
                ease: 'Power2',
                onComplete: () => {
                    shockwave.destroy();
                }
            });
            
            // Create particle effect
            for (let i = 0; i < 20; i++) {
                const particle = this.scene.add.circle(x, y, 2, 0xffff00);
                particle.setDepth(21);
                
                const angle = Math.random() * Math.PI * 2;
                const speed = 2 + Math.random() * 3;
                const destX = x + Math.cos(angle) * 100 * speed;
                const destY = y + Math.sin(angle) * 100 * speed;
                
                this.scene.tweens.add({
                    targets: particle,
                    x: destX,
                    y: destY,
                    alpha: 0,
                    duration: 500 + Math.random() * 500,
                    onComplete: () => {
                        particle.destroy();
                    }
                });
            }
            
            // Remove Matter body safely
            if (extraLife.body && extraLife.body.id) {
                this.scene.matter.world.remove(extraLife.body);
            }
            
            // Destroy the sprite with a scaling/fading effect
            this.scene.tweens.add({
                targets: extraLife.sprite,
                scaleX: 2,
                scaleY: 2,
                alpha: 0,
                duration: 300,
                onComplete: () => {
                    extraLife.sprite.destroy();
                    
                    // Remove from our array
                    this.extraLives.splice(foundIndex, 1);
                    
                    // Call the provided callback if any
                    if (callback) callback();
                }
            });
            
            // Update the last collection time
            this.lastLifeCollectTime = this.scene.time.now;
            
            return true; // Return true to indicate successful collection
        } catch (error) {
            console.error('Error collecting extra life:', error);
            return false;
        }
    }
    
    /**
     * Creates the texture for extra life collectibles
     * Generates a yellow triangle pointing upward
     * @private
     */
    createExtraLifeTexture() {
        try {
            // Skip if texture already exists
            if (this.scene.textures.exists('extraLife')) return;
            
            const size = 40;
            const graphics = this.scene.make.graphics({x: 0, y: 0, add: false});
            
            // Draw triangle
            graphics.fillStyle(0xffff00, 1); // Yellow
            graphics.lineStyle(2, 0x000000, 1);
            
            // Draw a triangle (pointing up)
            graphics.beginPath();
            graphics.moveTo(size / 2, 0);
            graphics.lineTo(0, size);
            graphics.lineTo(size, size);
            graphics.closePath();
            graphics.fillPath();
            graphics.strokePath();
            
            // Generate texture from graphics
            graphics.generateTexture('extraLife', size, size);
            graphics.destroy();
        } catch (error) {
            console.error('Error creating extraLife texture:', error);
        }
    }
    
    /**
     * Gets all active collectibles
     * Useful for external collision checks and queries
     * @returns {Array<Object>} Array of all active collectible objects
     */
    getCollectibles() {
        return this.extraLives;
    }
    
    /**
     * Resets the collectible system
     * Cleans up all existing collectibles and resets timers
     * Used when restarting the scene or level
     */
    reset() {
        // Clean up all existing collectibles
        this.extraLives.forEach(life => {
            if (life.body && life.body.id) {
                this.scene.matter.world.remove(life.body);
            }
            if (life.sprite) {
                life.sprite.destroy();
            }
        });
        
        // Reset arrays and timers
        this.extraLives = [];
        this.lastLifeCollectTime = 0;
    }
    
    /**
     * Cleans up all resources used by the collectible manager
     * Should be called when the scene is shutdown or destroyed
     */
    destroy() {
        this.reset();
        this.terrainManager = null;
        this.scene = null;
        this.physicsConfig = null;
    }
}
