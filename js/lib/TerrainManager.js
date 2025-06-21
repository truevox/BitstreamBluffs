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
/**
 * Manages the procedural terrain generation, physics, and rendering.
 */
export default class TerrainManager {
    /**
     * Creates a new TerrainManager instance
     * @param {Phaser.Scene} scene - The scene this manager is attached to
     */
    constructor(scene) {
        this.scene = scene;
        this.terrainGraphics = null;
        this.debugGraphics = null; // For visualizing physics bodies
        this.terrainSegments = [];
        
        // Terrain configuration
        this.segmentWidth = 100;
        this.terrainStartX = -200;
        this.lastTerrainY = 500;
        this.worldBoundsPadding = 2000;
        
        // Anti-tunneling configuration
        this.floorDepth = 2000; // How far down the floor extends below terrain
        this.floorBodies = []; // Store floor bodies for cleanup
        this.showDebugBodies = false; // Set to false to hide debug visualization
        this.floorOffset = 100; // Pixels below terrain to start the floor body - increased for safety
        
        // Colors
        this.neonYellow = 0xffff00;
        this.neonBlue = 0x00ffff;
        this.neonPink = 0xff00ff;
        this.neonGreen = 0x00ff88; // Added for green terrain type (bright neon green)
        this.debugColor = 0xff3333; // Red color for debug visualization
        
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
        
        // Create debug graphics for visualizing physics bodies
        this.debugGraphics = this.scene.add.graphics({ fillStyle: { color: this.debugColor, alpha: 0.3 } });
        
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
            // Pick color randomly between blue, pink, and green for terrain variety
            // We want roughly equal distribution for visual diversity
            color: (() => {
                const r = this.seededRandom();
                if (r < 1/3) return this.neonBlue;
                if (r < 2/3) return this.neonPink;
                return this.neonGreen;
            })(),
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
        
        // Create a single large safe floor block that starts 50px below the lowest point of the segment
        // This is much simpler and more reliable than trying to follow the terrain contour exactly
        const lowestY = Math.max(segment.y, segment.endY); // Find the lowest (higher Y value) point of the segment
        const safeFloorY = lowestY + 50; // Position floor 50 pixels below the lowest point
        
        // Create a rectangle that covers the entire segment width and extends down
        const floorWidth = segment.endX - segment.x;
        const floorHeight = this.floorDepth; // How far down the floor extends
        
        // Create the floor body - positioned safely below terrain
        const safeFloorBody = this.scene.matter.add.rectangle(
            segment.x + (floorWidth / 2), // Center X of segment
            safeFloorY + (floorHeight / 2), // Center Y starting 50px below terrain and extending down
            floorWidth, // Cover the entire segment width
            floorHeight, // Extend down by floorDepth
            {
                isStatic: true,
                friction: 0, // No friction to avoid affecting player physics when not needed
                label: 'terrain_floor',
                collisionFilter: {
                    category: 0x0002, // Floor category
                    mask: 0x0001     // Player category
                }
            }
        );
        
        // Store the floor body for cleanup
        segment.floorBody = safeFloorBody;
        this.floorBodies.push(safeFloorBody);
    }

    
    /**
     * Draws all terrain segments with neon lines
     * Renders the visible terrain surface with same style as GameScene
     */
    drawTerrain() {
        if (!this.terrainGraphics) return;
        
        this.terrainGraphics.clear();
        
        // Also clear debug graphics if it exists
        if (this.debugGraphics) {
            this.debugGraphics.clear();
        }
        
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
            
            // Draw debug visualization for floor bodies if enabled
            if (this.showDebugBodies && this.debugGraphics) {
                // Draw the main floor body as a polygon
                if (seg.floorBody && seg.floorBody.parts && seg.floorBody.parts.length > 0) {
                    // For composite bodies, we need to draw each part
                    for (const part of seg.floorBody.parts) {
                        if (part.vertices && part.vertices.length > 0) {
                            this.debugGraphics.fillStyle(this.debugColor, 0.3);
                            this.debugGraphics.beginPath();
                            
                            // Draw the vertices as a filled polygon
                            this.debugGraphics.moveTo(part.vertices[0].x, part.vertices[0].y);
                            for (let i = 1; i < part.vertices.length; i++) {
                                this.debugGraphics.lineTo(part.vertices[i].x, part.vertices[i].y);
                            }
                            this.debugGraphics.closePath();
                            this.debugGraphics.fillPath();
                        }
                    }
                }
            }
        }
        
        // Draw all floor bodies for debugging
        if (this.showDebugBodies && this.debugGraphics) {
            for (const body of this.floorBodies) {
                if (body && body.parts && body.parts.length > 0) {
                    for (const part of body.parts) {
                        if (part.vertices && part.vertices.length > 0) {
                            this.debugGraphics.fillStyle(0xff0000, 0.2);
                            this.debugGraphics.beginPath();
                            this.debugGraphics.moveTo(part.vertices[0].x, part.vertices[0].y);
                            for (let i = 1; i < part.vertices.length; i++) {
                                this.debugGraphics.lineTo(part.vertices[i].x, part.vertices[i].y);
                            }
                            this.debugGraphics.closePath();
                            this.debugGraphics.fillPath();
                        }
                    }
                }
            }
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
                // Remove main terrain body
                if (segment.body) {
                    this.scene.matter.world.remove(segment.body);
                }
                
                // Remove floor body if it exists
                if (segment.floorBody) {
                    this.scene.matter.world.remove(segment.floorBody);
                    // Also remove from our tracking array
                    const idx = this.floorBodies.indexOf(segment.floorBody);
                    if (idx !== -1) {
                        this.floorBodies.splice(idx, 1);
                    }
                }
                
                // Remove any sub-segment bodies
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
                
                // Remove floor body if it exists
                if (segment.floorBody && segment.floorBody.id) {
                    this.scene.matter.world.remove(segment.floorBody);
                    // Also remove from our tracking array
                    const idx = this.floorBodies.indexOf(segment.floorBody);
                    if (idx !== -1) {
                        this.floorBodies.splice(idx, 1);
                    }
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
            
            if (segment.floorBody && segment.floorBody.id) {
                this.scene.matter.world.remove(segment.floorBody);
            }
        });
        
        // Clean up all floor bodies
        this.floorBodies.forEach(body => {
            if (body && body.id) {
                this.scene.matter.world.remove(body);
            }
        });
        
        // Reset floor bodies array
        this.floorBodies = [];
        
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
            
            if (segment.floorBody && segment.floorBody.id) {
                this.scene.matter.world.remove(segment.floorBody);
            }
        });
        
        // Clean up all floor bodies
        this.floorBodies.forEach(body => {
            if (body && body.id) {
                this.scene.matter.world.remove(body);
            }
        });
        
        // Reset floor bodies array
        this.floorBodies = [];
        
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
