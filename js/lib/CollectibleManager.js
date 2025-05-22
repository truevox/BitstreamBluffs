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
     * Matches the original GameScene implementation
     * @param {number} currentTime - Current game time
     * @private
     */
    manageExtraLives(currentTime) {
        if (!this.physicsConfig) return;
        
        // Multiple safety checks to avoid crashing
        if (!this.scene || !this.scene.scene || !this.scene.scene.isActive) {
            return; // Exit if the scene isn't active
        }
        
        if (!this.scene.player || !this.scene.player.body || !this.scene.player.body.position) {
            return; // Exit early if player doesn't exist or isn't initialized
        }
        
        try {
            // Clean up off-screen collectibles (safely)
            this.cleanupOffscreenCollectibles(this.scene.player.x);
            
            // Only spawn if conditions are all met
            const nextLifeAvailableTime = this.nextLifeAvailableTime || 0;
            
            const canSpawn = currentTime > nextLifeAvailableTime && 
                          Array.isArray(this.extraLives) && 
                          this.extraLives.length < 2 && 
                          this.scene.lives < this.physicsConfig.extraLives.maxLives;
                          
            if (canSpawn) {
                // Only spawn with a 20% chance each cycle - prevents too many spawns
                if (Math.random() < 0.2) {
                    console.log('Spawning new extra life collectible');
                    this.spawnExtraLife();
                    // Update next available time regardless of successful spawn
                    this.nextLifeAvailableTime = currentTime + Phaser.Math.Between(
                        this.physicsConfig.extraLives.minTimeToNextLife, 
                        this.physicsConfig.extraLives.maxTimeToNextLife
                    );
                }
            }
        } catch (error) {
            console.error('Error in manageExtraLives:', error);
            // Reset collectibles array if there was an error
            this.extraLives = [];
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
     * Matches the original GameScene implementation
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
            
            // Get player position safely
            const player = this.scene.player;
            if (!player || !player.body || !player.body.position) {
                console.warn('Cannot spawn extra life: player not available');
                return;
            }

            const playerPos = player.body.position;
            
            // Ensure texture exists
            if (!this.scene.textures.exists('extraLife')) {
                this.createExtraLifeTexture();
            }
            
            // Calculate a safe position in front of the player
            const spawnX = playerPos.x + this.physicsConfig.extraLives.spawnDistance;
            
            // Find the terrain height directly below the spawn point
            const terrainHeight = this.terrainManager.findTerrainHeightAt(spawnX);
            if (!terrainHeight) {
                console.warn('Cannot spawn extra life: no terrain at spawn point');
                return;
            }
            
            // Calculate player sprite height (approximated from player body + sled height)
            const playerSpriteHeight = 50; // Player body height from create() method
            
            // Position powerup above terrain but not too high (less than 7 player sprite heights)
            const maxHeightAboveTerrain = playerSpriteHeight * 6;
            const minHeightAboveTerrain = playerSpriteHeight * 2; // At least 2 sprite heights for safety
            
            // Random height between min and max, but ensure it's at a reasonable height
            const heightAboveTerrain = Phaser.Math.Between(minHeightAboveTerrain, maxHeightAboveTerrain);
            const spawnY = terrainHeight - heightAboveTerrain; // Subtract because Y increases downward
            
            // Create static sprite for the collectible
            const lifeSprite = this.scene.add.sprite(spawnX, spawnY, 'extraLife');
            lifeSprite.setScale(0.5); // Scale to appropriate size
            lifeSprite.setDepth(10);  // Set depth to ensure it appears above terrain
            
            // Create a STATIC circular collision area that won't be affected by gravity
            const lifeBody = this.scene.matter.add.circle(
                spawnX, 
                spawnY, 
                this.physicsConfig.extraLives.collectibleRadius,
                {
                    isSensor: true,
                    isExtraLife: true,
                    label: 'extraLife',
                    isStatic: true, // Make it static so it doesn't fall
                }
            );
            
            // Store references to link the sprite and physics body
            lifeSprite.collider = lifeBody;
            lifeBody.gameObject = lifeSprite;
            
            // Store original Y position for hover animation
            lifeSprite.originalY = spawnY;
            
            // Store in our tracking object
            const extraLife = {
                sprite: lifeSprite,
                body: lifeBody,
                collected: false
            };
            
            // Add to our tracking array
            this.extraLives.push(extraLife);
            
            // Calculate hover distance (approximately 3 sprite widths) - matching original
            const spriteWidth = this.physicsConfig.extraLives.collectibleRadius * 2;
            const hoverDistance = spriteWidth * 3;
            
            // Instead of tweening the physics body directly, use a dummy object
            const hoverController = { y: 0 };
            
            // Add hover animation with tweens
            this.scene.tweens.add({
                targets: hoverController,
                y: 1,                      // Normalize from 0 to 1 for easier math
                duration: 2000,            // 2 seconds for one direction
                ease: 'Sine.easeInOut',    // Smooth sine wave motion
                yoyo: true,                // Makes it go back down
                repeat: -1,                // Repeat indefinitely
                onUpdate: () => {
                    // Safety checks for scene transition/destruction
                    if (!this.scene || !this.scene.scene || !this.scene.scene.isActive) {
                        return; // Skip update if scene is gone or not active
                    }
                    
                    // Safety check for Matter physics engine
                    if (!this.scene.matter || !this.scene.matter.body || !this.scene.matter.world) {
                        return; // Matter physics has been destroyed
                    }
                    
                    // Check if objects still exist and are valid
                    if (!lifeBody || !lifeBody.position || !lifeSprite || lifeSprite.destroyed) {
                        return; // Objects no longer exist
                    }
                    
                    try {
                        // If somehow the body became non-static, make it static again
                        if (!lifeBody.isStatic) {
                            this.scene.matter.body.setStatic(lifeBody, true);
                        }
                        
                        // Calculate Y position based on sine wave (0-1 normalized value)
                        const offset = Math.sin(hoverController.y * Math.PI) * hoverDistance;
                        
                        // Update the static body position directly
                        this.scene.matter.body.setPosition(lifeBody, {
                            x: lifeBody.position.x,
                            y: spawnY - offset
                        });
                        
                        // Update sprite to match collider
                        lifeSprite.x = lifeBody.position.x;
                        lifeSprite.y = lifeBody.position.y;
                    } catch (error) {
                        // Silently fail if any operation fails
                        // This can happen during scene transitions
                    }
                }
            });
            
            console.log(`Spawned extra life at X: ${spawnX}, Y: ${spawnY} (${heightAboveTerrain}px above terrain)`);
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
