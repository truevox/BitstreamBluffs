// js/lib/TerrainManager.js
// Handles all terrain generation and management
// ------------------------------------------------------

/**
 * @fileoverview TerrainManager module handles procedural terrain generation and physics.
 * It creates, renders, and manages terrain segments as the player traverses the game world,
 * providing proper collision detection and dynamically generating new terrain ahead of the player.
 * 
 * @module TerrainManager
 */

/**
 * Manages the procedural terrain generation, physics, and rendering
 */
export default class TerrainManager {
    /**
     * Creates a new TerrainManager instance
     * @param {Phaser.Scene} scene - The scene this manager is attached to
     */
    constructor(scene) {
        this.scene = scene;
        this.terrainGraphics = null;
        this.terrainSegments = [];
        
        // Terrain configuration
        this.segmentWidth = 100;
        this.terrainStartX = -200;
        this.lastTerrainY = 500;
        this.worldBoundsPadding = 2000;
        
        // Colors
        this.neonYellow = 0xffff00;
        this.neonBlue = 0x00ffff;
        
        // Seeded random function - initialized by scene
        this.seededRandom = null;
    }
    
    /**
     * Initializes the terrain system
     */
    init() {
        // Get seeded random function from scene if available
        this.seededRandom = this.scene.seededRandom || Math.random;
        
        // Create graphics object for terrain rendering
        this.terrainGraphics = this.scene.add.graphics({ lineStyle: { width: 2, color: this.neonBlue } });
        
        // Initialize the first terrain segment
        this.initTerrain();
    }
    
    /**
     * Initializes the first terrain platform/segment
     * Creates a flat starting area for the player
     */
    initTerrain() {
        // Reset terrain state
        this.terrainSegments = [];
        this.lastTerrainY = 500; // Reset terrain starting point
        
        // Generate initial flat segment
        this.generateNextTerrainSegment(true); 
    }
    
    /**
     * Generates the next terrain segment procedurally
     * @param {boolean} isFirstSegment - Whether this is the first segment (flat platform)
     * @returns {Object} The generated terrain segment
     */
    generateNextTerrainSegment(isFirstSegment = false) {
        const lastSegment = this.terrainSegments[this.terrainSegments.length - 1];
        let startX = isFirstSegment ? this.terrainStartX : lastSegment ? lastSegment.x + this.segmentWidth : this.terrainStartX;
        
        // Use fixed starting height for first segment, or last terrain Y for subsequent segments
        let startY = isFirstSegment ? this.lastTerrainY : this.lastTerrainY;
        
        // For first segment, create a flat platform
        let endY = startY;
        
        if (!isFirstSegment) {
            // Calculate slope with some random variation for subsequent segments
            // Random variation between -50 and +30
            const variation = this.seededRandom() * 80 - 50;
            endY = Math.max(100, Math.min(800, startY + variation));
        }
        
        // Create terrain segment object with vertices for drawing and collision
        const segment = {
            x: startX,
            y: startY,
            endX: startX + this.segmentWidth,
            endY: endY,
            isRamp: !isFirstSegment && Math.abs(endY - startY) > 10,
            vertices: [
                { x: startX, y: startY },
                { x: startX + this.segmentWidth, y: endY },
                { x: startX + this.segmentWidth, y: endY + 500 }, // Extended bottom point
                { x: startX, y: startY + 500 } // Extended bottom point
            ]
        };
        
        // Create Matter physics body for this segment
        const terrainBody = this.scene.matter.add.fromVertices(
            (startX + startX + this.segmentWidth) / 2, // x center
            (startY + endY + 500) / 2, // y center (include the extended bottom)
            [segment.vertices],
            { isStatic: true, label: 'terrain' }
        );
        
        // Store reference to physics body for later cleanup
        segment.body = terrainBody;
        
        // Add segment to array
        this.terrainSegments.push(segment);
        
        // Update last terrain Y for next segment
        this.lastTerrainY = endY;
        
        // Redraw terrain after adding new segment
        this.drawTerrain();
        
        // Return the created segment for reference if needed
        return segment;
    }
    
    /**
     * Draws all terrain segments with neon lines
     * Renders the visible terrain surface
     */
    drawTerrain() {
        if (!this.terrainGraphics) return;
        
        this.terrainGraphics.clear();
        
        // Set line style for terrain top surface
        this.terrainGraphics.lineStyle(2, this.neonBlue, 1);
        
        // Draw each segment's top line
        this.terrainSegments.forEach(segment => {
            this.terrainGraphics.beginPath();
            this.terrainGraphics.moveTo(segment.x, segment.y);
            this.terrainGraphics.lineTo(segment.endX, segment.endY);
            this.terrainGraphics.strokePath();
        });
    }
    
    /**
     * Finds the terrain height at a specific X position
     * Uses linear interpolation to determine the exact height
     * @param {number} xPos - The x position to check
     * @returns {number} The terrain height at the specified position
     */
    findTerrainHeightAt(xPos) {
        for (let i = 0; i < this.terrainSegments.length; i++) {
            const segment = this.terrainSegments[i];
            if (xPos >= segment.x && xPos <= segment.endX) {
                // Linear interpolation to find y value
                const ratio = (xPos - segment.x) / this.segmentWidth;
                const height = segment.y + (segment.endY - segment.y) * ratio;
                return height;
            }
        }
        
        // Default if no terrain found at that position
        return 500;
    }
    
    /**
     * Gets the slope angle (in radians) at a specific X position
     * Used for physics calculations and player orientation
     * @param {number} xPos - The x position to check
     * @returns {number} The slope angle in radians
     */
    getSlopeAngleAt(xPos) {
        for (let i = 0; i < this.terrainSegments.length; i++) {
            const segment = this.terrainSegments[i];
            if (xPos >= segment.x && xPos <= segment.endX) {
                // Calculate angle based on segment slope
                const deltaY = segment.endY - segment.y;
                const deltaX = this.segmentWidth;
                return Math.atan2(deltaY, deltaX);
            }
        }
        
        // Default to flat ground if no terrain found
        return 0;
    }
    
    /**
     * Updates terrain based on player position
     * Generates new segments ahead and removes old ones behind
     * @param {number} playerX - Current player X position
     */
    update(playerX) {
        // Generate new terrain segments as the player moves right
        const lastSegment = this.terrainSegments[this.terrainSegments.length - 1];
        if (lastSegment && playerX > lastSegment.x - this.worldBoundsPadding) {
            this.generateNextTerrainSegment();
        }
        
        // Clean up off-screen terrain
        this.cleanupTerrain(playerX);
    }
    
    /**
     * Cleans up terrain segments that are off-screen
     * Removes segments that are far behind the player to optimize performance
     * @param {number} playerX - Current player X position
     */
    cleanupTerrain(playerX) {
        // Remove terrain segments that are far behind the player
        const viewportLeft = playerX - this.worldBoundsPadding * 2;
        
        let i = 0;
        while (i < this.terrainSegments.length) {
            const segment = this.terrainSegments[i];
            
            // If segment is far behind the player
            if (segment.endX < viewportLeft) {
                // Remove this segment's physics body safely
                if (segment.body && segment.body.id) {
                    this.scene.matter.world.remove(segment.body);
                }
                
                // Remove from our array
                this.terrainSegments.splice(i, 1);
            } else {
                i++;
            }
        }
    }
    
    /**
     * Gets all terrain segments
     * Useful for collision checks and terrain queries
     * @returns {Array<Object>} All current terrain segments
     */
    getTerrainSegments() {
        return this.terrainSegments;
    }
    
    /**
     * Sets the seeded random function
     * Ensures consistent terrain generation for the same seed
     * @param {Function} seededRandomFn - The seeded random function to use
     */
    setSeededRandom(seededRandomFn) {
        this.seededRandom = seededRandomFn || Math.random;
    }
    
    /**
     * Resets the terrain system
     * Used when restarting the scene or resetting the game
     */
    reset() {
        // Clean up all terrain bodies
        this.terrainSegments.forEach(segment => {
            if (segment.body && segment.body.id) {
                this.scene.matter.world.remove(segment.body);
            }
        });
        
        // Reset arrays and properties
        this.terrainSegments = [];
        this.lastTerrainY = 500;
        
        // Initialize new terrain
        this.initTerrain();
    }
    
    /**
     * Cleans up all resources used by the terrain manager
     * Should be called when the scene is shutdown or destroyed
     */
    destroy() {
        // Clean up all terrain bodies from Matter world
        this.terrainSegments.forEach(segment => {
            if (segment.body && segment.body.id) {
                this.scene.matter.world.remove(segment.body);
            }
        });
        
        // Clear arrays and graphics
        this.terrainSegments = [];
        if (this.terrainGraphics) {
            this.terrainGraphics.clear();
            this.terrainGraphics.destroy();
            this.terrainGraphics = null;
        }
        
        this.scene = null;
    }
}
