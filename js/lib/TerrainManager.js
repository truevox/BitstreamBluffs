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
        this.neonPink = 0xff00ff;
        
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
        // Get previous endpoint from last segment
        const prevSegment = this.terrainSegments[this.terrainSegments.length - 1];
        const prevX = prevSegment ? prevSegment.endX : this.terrainStartX;
        const prevY = this.lastTerrainY;
        
        // Pick a new Y using the same probability distribution as GameScene
        let newY = prevY;
        
        if (isFirstSegment) {
            // Steeper initial descent, matching GameScene
            newY += Phaser.Math.Between(40, 70);
        } else {
            // Use seeded random with same probability distribution as GameScene
            const r = this.seededRandom();
            
            // Match GameScene probability distribution exactly
            if (r < 0.60) {
                // 60% chance: Moderate downslope (more common)
                newY += Phaser.Math.Between(35, 70);
            } else if (r < 0.85) {
                // 25% chance: Steep downslope (more common)
                newY += Phaser.Math.Between(70, 120);
            } else if (r < 0.95) {
                // 10% chance: Mild variation for interest
                newY += Phaser.Math.Between(-15, 25);
            } else {
                // 5% chance: Occasional small upslope (less common/less steep)
                newY -= Phaser.Math.Between(10, 40);
            }
        }
        
        // Apply same clamping as GameScene to allow steeper descents
        newY = Phaser.Math.Clamp(newY, prevY - 60, prevY + 150);
        
        // Calculate segment angle for physics
        const segmentAngleRad = Math.atan2(newY - prevY, this.segmentWidth);
        
        // Create segment with same properties as GameScene
        const segment = {
            x: prevX,
            y: prevY,
            endX: prevX + this.segmentWidth,
            endY: newY,
            // Use same color selection logic as GameScene
            color: this.seededRandom() < 0.5 ? this.neonBlue : this.neonPink,
            angle: segmentAngleRad,
            bodies: [] // Track associated physics bodies for cleanup
        };
        
        // Add to terrain segments array
        this.terrainSegments.push(segment);
        
        // Update last terrain Y for next segment
        this.lastTerrainY = newY;
        
        // Create sub-segments for collision like in GameScene
        this.createSubSegments(segment);
        
        // Return the created segment
        return segment;
    }
    
    /**
     * Creates sub-segments for smoother collision detection
     * @param {Object} segment - The main segment to divide into sub-segments
     */
    createSubSegments(segment) {
        // Break the slope into sub-rectangles for smooth collision, just like GameScene
        const subSegmentCount = 5; // Same as GameScene
        
        for (let i = 0; i < subSegmentCount; i++) {
            const t1 = i / subSegmentCount;
            const t2 = (i + 1) / subSegmentCount;
            
            const x1 = Phaser.Math.Linear(segment.x, segment.endX, t1);
            const y1 = Phaser.Math.Linear(segment.y, segment.endY, t1);
            const x2 = Phaser.Math.Linear(segment.x, segment.endX, t2);
            const y2 = Phaser.Math.Linear(segment.y, segment.endY, t2);
            
            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;
            const length = Phaser.Math.Distance.Between(x1, y1, x2, y2);
            const thickness = 5; // Same as GameScene
            
            // Create a static Matter rectangle (invisible, purely for collision)
            const body = this.scene.matter.add.rectangle(
                centerX, centerY, length, thickness, {
                    isStatic: true,
                    angle: Math.atan2(y2 - y1, x2 - x1),
                    friction: 0.01,
                    label: 'terrain',
                    segmentId: this.terrainSegments.length - 1 // Associate with segment for cleanup
                }
            );
            
            // Store terrain angle for collision callback, same as GameScene
            body.terrainAngle = body.angle;
            segment.bodies.push(body); // Store reference to body for cleanup
        }
    }
    
    /**
     * Draws all terrain segments with neon lines
     * Renders the visible terrain surface with same style as GameScene
     */
    drawTerrain() {
        if (!this.terrainGraphics) return;
        
        this.terrainGraphics.clear();
        
        // Draw each segment using the same visual style as GameScene
        for (const seg of this.terrainSegments) {
            // Primary neon line (thinner, full brightness)
            this.terrainGraphics.lineStyle(5, seg.color, 1).beginPath();
            this.terrainGraphics.moveTo(seg.x, seg.y);
            this.terrainGraphics.lineTo(seg.endX, seg.endY).strokePath();
            
            // Secondary glow line (thicker, lower opacity)
            this.terrainGraphics.lineStyle(8, seg.color, 0.3).beginPath();
            this.terrainGraphics.moveTo(seg.x, seg.y);
            this.terrainGraphics.lineTo(seg.endX, seg.endY).strokePath();
        }
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
     * Manages terrain generation and cleanup using same approach as GameScene
     * @param {number} playerX - Current player X position for terrain management
     */
    update(playerX) {
        // Get camera for reference (same as GameScene)
        const cam = this.scene.cameras.main;
        
        // Generate new terrain ahead with same lookahead distance as GameScene
        const lookAheadTrigger = playerX + cam.width * 1.5;
        
        // Get position of last segment
        const lastSeg = this.terrainSegments[this.terrainSegments.length - 1];
        const lastX = lastSeg ? lastSeg.endX : this.terrainStartX;
        
        // Generate more terrain if needed
        if (lastX < lookAheadTrigger) {
            this.generateNextTerrainSegment();
            this.drawTerrain();
        }
        
        // Remove segments that are far behind, using same threshold as GameScene
        const removeThresholdX = playerX - cam.width * 1.5;
        
        // Identify segments to remove
        const segmentsToRemove = [];
        let i = 0;
        
        while (i < this.terrainSegments.length && 
               this.terrainSegments[i].endX < removeThresholdX) {
            segmentsToRemove.push(this.terrainSegments[i]);
            i++;
        }
        
        // Remove the identified segments and their physics bodies
        if (segmentsToRemove.length > 0) {
            // Remove physics bodies for each segment
            segmentsToRemove.forEach(segment => {
                if (segment.bodies) {
                    segment.bodies.forEach(body => {
                        this.scene.matter.world.remove(body);
                    });
                }
            });
            
            // Remove visual segments
            this.terrainSegments.splice(0, segmentsToRemove.length);
        }
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
