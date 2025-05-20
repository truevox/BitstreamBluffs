// js/systems/TerrainManager.js
// Handles all terrain generation and management
// ------------------------------------------------------

export default class TerrainManager {
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
        
        // Initialize terrain system
        this.init();
    }
    
    init() {
        // Create graphics object for terrain rendering
        this.terrainGraphics = this.scene.add.graphics({ lineStyle: { width: 2, color: this.neonBlue } });
        
        // Initialize the first terrain segment
        this.initTerrain();
    }
    
    // Initialize the first terrain platform
    initTerrain() {
        this.generateNextTerrainSegment(true); // Generate initial flat segment
    }
    
    // Generate the next terrain segment
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
            const variation = Math.random() * 80 - 50;
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
        
        // Return the created segment for reference if needed
        return segment;
    }
    
    // Draw terrain neon lines
    drawTerrain() {
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
    
    // Find the terrain height at a specific X position
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
    
    // Update terrain based on player position
    update(playerX) {
        // Generate new terrain segments as the player moves right
        const lastSegment = this.terrainSegments[this.terrainSegments.length - 1];
        if (lastSegment && playerX > lastSegment.x - this.worldBoundsPadding) {
            this.generateNextTerrainSegment();
            // Redraw terrain after adding new segment
            this.drawTerrain();
        }
        
        // Clean up off-screen terrain
        this.cleanupTerrain(playerX);
    }
    
    // Clean up terrain segments that are off-screen
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
    
    // Get all terrain segments (useful for collision checks)
    getTerrainSegments() {
        return this.terrainSegments;
    }
    
    // Clean up resources
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
    }
}
