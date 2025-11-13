/**
 * TerrainGenerator - Procedural terrain generation with seeded randomness
 *
 * Generates sloped, downhill terrain with three types:
 * - Blue: Bonus points for riding
 * - Green: Reduced friction (faster)
 * - Magenta: Increased friction (slower)
 *
 * Creates angled slopes instead of flat platforms for proper sledding
 */

import Phaser from 'phaser';

export default class TerrainGenerator {
    constructor(scene, randomFunc) {
        this.scene = scene;
        this.random = randomFunc;

        // Terrain colors
        this.colors = {
            blue: 0x0088ff,
            green: 0x00ff44,
            magenta: 0xff00aa,
            normal: 0x00ffff  // Default cyan
        };

        // Terrain segments (active physics bodies)
        this.segments = [];
        this.graphics = scene.add.graphics();
        this.graphics.setDepth(-1);

        // Generation parameters
        this.segmentLength = 100;  // Length of each slope segment
        this.worldWidth = 480;
        this.generateAhead = 1500; // Generate this far ahead
        this.lastGeneratedY = 0;

        // Slope parameters
        this.minSlope = 10;  // Minimum downward slope angle (degrees)
        this.maxSlope = 45;  // Maximum downward slope angle (degrees)

        // Initialize first segments
        this.generateInitialTerrain();
    }

    generateInitialTerrain() {
        // Start with a flat starting platform
        this.createSlopeSegment(240, 100, 200, 0, 'normal', 15);

        // Generate initial downhill segments
        let currentX = 340;
        let currentY = 100;

        for (let i = 0; i < 15; i++) {
            const angle = this.minSlope + this.random() * (this.maxSlope - this.minSlope);
            const length = 80 + this.random() * 80;
            const terrainType = this.getTerrainType(currentX, currentY);
            const thickness = 12 + this.random() * 8;

            // Calculate end position based on angle
            const rad = (angle * Math.PI) / 180;
            const endX = currentX + length * Math.cos(rad);
            const endY = currentY + length * Math.sin(rad);

            this.createSlopeSegment(currentX, currentY, length, angle, terrainType, thickness);

            // Add some horizontal variation
            currentX = endX + (this.random() - 0.5) * 50;
            currentY = endY;

            this.lastGeneratedY = Math.max(this.lastGeneratedY, currentY);
        }
    }

    createSlopeSegment(startX, startY, length, angle, type, thickness = 15) {
        // Calculate end point
        const rad = (angle * Math.PI) / 180;
        const endX = startX + length * Math.cos(rad);
        const endY = startY + length * Math.sin(rad);

        // Create angled rectangle as slope
        const centerX = (startX + endX) / 2;
        const centerY = (startY + endY) / 2;

        // Create Matter.js body with angle
        const rect = this.scene.matter.add.rectangle(
            centerX,
            centerY,
            length,
            thickness,
            {
                isStatic: true,
                friction: this.getFriction(type),
                angle: rad,
                label: type
            }
        );

        // Set collision category
        rect.collisionFilter.category = 0x0002;

        // Store segment data
        this.segments.push({
            body: rect,
            startX: startX,
            startY: startY,
            endX: endX,
            endY: endY,
            length: length,
            angle: angle,
            type: type,
            thickness: thickness,
            color: this.colors[type]
        });

        // Draw segment
        this.drawSlopeSegment(startX, startY, endX, endY, thickness, this.colors[type]);

        return rect;
    }

    drawSlopeSegment(startX, startY, endX, endY, thickness, color) {
        const angle = Math.atan2(endY - startY, endX - startX);
        const perpX = Math.cos(angle + Math.PI / 2) * (thickness / 2);
        const perpY = Math.sin(angle + Math.PI / 2) * (thickness / 2);

        // Draw filled slope
        this.graphics.fillStyle(color, 0.6);
        this.graphics.beginPath();
        this.graphics.moveTo(startX + perpX, startY + perpY);
        this.graphics.lineTo(endX + perpX, endY + perpY);
        this.graphics.lineTo(endX - perpX, endY - perpY);
        this.graphics.lineTo(startX - perpX, startY - perpY);
        this.graphics.closePath();
        this.graphics.fillPath();

        // Draw wireframe border
        this.graphics.lineStyle(2, color, 1);
        this.graphics.strokePath();

        // Draw center line for visual interest
        this.graphics.lineStyle(1, color, 0.5);
        this.graphics.lineBetween(startX, startY, endX, endY);
    }

    getFriction(type) {
        switch (type) {
            case 'blue': return 0.4;
            case 'green': return 0.1;    // Low friction (fast)
            case 'magenta': return 0.8;  // High friction (slow)
            default: return 0.3;
        }
    }

    getTerrainType(x, y) {
        // Determine terrain type based on position
        const hash = (Math.floor(x / 100) * 73 + Math.floor(y / 100) * 37) % 100;

        if (hash < 15) return 'blue';      // 15% blue (bonus points)
        if (hash < 35) return 'green';     // 20% green (low friction)
        if (hash < 50) return 'magenta';   // 15% magenta (high friction)
        return 'normal';                    // 50% normal
    }

    update(playerY) {
        // Generate new terrain ahead of player
        while (this.lastGeneratedY < playerY + this.generateAhead) {
            // Get last segment end position
            const lastSegment = this.segments[this.segments.length - 1];
            let currentX, currentY;

            if (lastSegment) {
                currentX = lastSegment.endX;
                currentY = lastSegment.endY;
            } else {
                currentX = 240;
                currentY = 100;
            }

            // Generate new slope segment
            const angle = this.minSlope + this.random() * (this.maxSlope - this.minSlope);
            const length = 80 + this.random() * 100;
            const terrainType = this.getTerrainType(currentX, currentY);
            const thickness = 12 + this.random() * 8;

            // Calculate end position
            const rad = (angle * Math.PI) / 180;
            const endY = currentY + length * Math.sin(rad);

            this.createSlopeSegment(currentX, currentY, length, angle, terrainType, thickness);

            // Add horizontal variation occasionally
            if (this.random() < 0.3) {
                currentX += (this.random() - 0.5) * 100;
            }

            this.lastGeneratedY = endY;
        }

        // Remove terrain far behind player
        const removeThreshold = playerY - 500;
        this.segments = this.segments.filter(segment => {
            if (segment.startY < removeThreshold) {
                // Remove physics body
                this.scene.matter.world.remove(segment.body);
                return false;
            }
            return true;
        });

        // Redraw visible terrain (clear and redraw for efficiency)
        if (this.segments.length > 0 && Math.floor(playerY / 100) !== Math.floor((playerY - 1) / 100)) {
            this.redrawTerrain(playerY);
        }
    }

    redrawTerrain(playerY) {
        // Clear graphics
        this.graphics.clear();

        // Redraw visible segments
        const visibleRange = 800;
        this.segments.forEach(segment => {
            if (segment.startY > playerY - visibleRange && segment.startY < playerY + visibleRange) {
                this.drawSlopeSegment(
                    segment.startX,
                    segment.startY,
                    segment.endX,
                    segment.endY,
                    segment.thickness,
                    segment.color
                );
            }
        });
    }

    /**
     * Check what terrain type the player is on
     * Returns terrain type or null
     */
    getTerrainAt(x, y) {
        // Check which segment the player is touching
        for (let segment of this.segments) {
            // Simple distance check to segment line
            const dx = segment.endX - segment.startX;
            const dy = segment.endY - segment.startY;
            const lengthSq = dx * dx + dy * dy;

            if (lengthSq === 0) continue;

            const t = Math.max(0, Math.min(1, ((x - segment.startX) * dx + (y - segment.startY) * dy) / lengthSq));
            const projX = segment.startX + t * dx;
            const projY = segment.startY + t * dy;

            const distSq = (x - projX) * (x - projX) + (y - projY) * (y - projY);
            const threshold = (segment.thickness / 2 + 5) * (segment.thickness / 2 + 5);

            if (distSq < threshold) {
                return segment.type;
            }
        }
        return null;
    }

    destroy() {
        // Clean up
        this.segments.forEach(segment => {
            this.scene.matter.world.remove(segment.body);
        });
        this.segments = [];
        this.graphics.destroy();
    }
}
