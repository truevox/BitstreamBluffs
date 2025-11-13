/**
 * TerrainGenerator - Procedural terrain generation with seeded randomness
 *
 * Generates three terrain types:
 * - Blue: Bonus points for riding
 * - Green: Reduced friction (faster)
 * - Magenta: Increased friction (slower)
 *
 * Uses streaming approach: generates ahead, removes behind
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
        this.segmentWidth = 60;
        this.segmentHeight = 20;
        this.worldWidth = 480;
        this.generateAhead = 1000; // Generate this far ahead
        this.lastGeneratedY = 0;

        // Noise parameters for terrain generation
        this.noiseScale = 0.01;
        this.amplitude = 100;

        // Initialize first segments
        this.generateInitialTerrain();
    }

    generateInitialTerrain() {
        // Generate starting platform
        this.createSegment(0, 120, this.worldWidth, 20, 'normal');

        // Generate ahead
        for (let y = 140; y < this.generateAhead; y += this.segmentHeight) {
            this.generateSegmentRow(y);
        }

        this.lastGeneratedY = this.generateAhead;
    }

    generateSegmentRow(y) {
        // Generate terrain segments for this row
        const baseHeight = this.getTerrainHeight(y);
        const numSegments = Math.floor(this.worldWidth / this.segmentWidth);

        for (let i = 0; i < numSegments; i++) {
            const x = i * this.segmentWidth;
            const localHeight = this.getTerrainHeight(y + i * 10) * 0.3; // Local variation
            const terrainType = this.getTerrainType(x, y);
            const height = this.segmentHeight + localHeight;

            // Create platforms and gaps
            const hasGap = this.random() < 0.1; // 10% chance of gap

            if (!hasGap) {
                this.createSegment(x, y + baseHeight, this.segmentWidth, height, terrainType);
            }
        }
    }

    getTerrainHeight(y) {
        // Simple sine-based terrain generation
        const noise1 = Math.sin(y * 0.01) * 30;
        const noise2 = Math.sin(y * 0.03) * 15;
        const noise3 = this.random() * 10 - 5;

        return noise1 + noise2 + noise3;
    }

    getTerrainType(x, y) {
        // Determine terrain type based on position
        const hash = (x * 73 + y * 37) % 100;

        if (hash < 15) return 'blue';      // 15% blue (bonus points)
        if (hash < 35) return 'green';     // 20% green (low friction)
        if (hash < 50) return 'magenta';   // 15% magenta (high friction)
        return 'normal';                    // 50% normal
    }

    createSegment(x, y, width, height, type) {
        // Create Matter.js static body
        const rect = this.scene.matter.add.rectangle(
            x + width / 2,
            y + height / 2,
            width,
            height,
            {
                isStatic: true,
                friction: this.getFriction(type),
                label: type
            }
        );

        // Set collision category
        rect.collisionFilter.category = 0x0002;

        // Store segment data
        this.segments.push({
            body: rect,
            x: x,
            y: y,
            width: width,
            height: height,
            type: type,
            color: this.colors[type]
        });

        // Draw segment
        this.drawSegment(x, y, width, height, this.colors[type]);

        return rect;
    }

    getFriction(type) {
        switch (type) {
            case 'blue': return 0.4;
            case 'green': return 0.1;    // Low friction (fast)
            case 'magenta': return 0.8;  // High friction (slow)
            default: return 0.3;
        }
    }

    drawSegment(x, y, width, height, color) {
        // Draw filled rectangle
        this.graphics.fillStyle(color, 0.6);
        this.graphics.fillRect(x, y, width, height);

        // Draw wireframe border
        this.graphics.lineStyle(2, color, 1);
        this.graphics.strokeRect(x, y, width, height);

        // Add grid pattern for visual interest
        this.graphics.lineStyle(1, color, 0.3);
        for (let i = 4; i < width; i += 8) {
            this.graphics.lineBetween(x + i, y, x + i, y + height);
        }
        for (let j = 4; j < height; j += 8) {
            this.graphics.lineBetween(x, y + j, x + width, y + j);
        }
    }

    update(playerY) {
        // Generate new terrain ahead of player
        while (this.lastGeneratedY < playerY + this.generateAhead) {
            this.generateSegmentRow(this.lastGeneratedY);
            this.lastGeneratedY += this.segmentHeight;
        }

        // Remove terrain far behind player
        const removeThreshold = playerY - 500;
        this.segments = this.segments.filter(segment => {
            if (segment.y < removeThreshold) {
                // Remove physics body
                this.scene.matter.world.remove(segment.body);
                return false;
            }
            return true;
        });
    }

    /**
     * Check what terrain type the player is on
     * Returns terrain type or null
     */
    getTerrainAt(x, y) {
        for (let segment of this.segments) {
            if (
                x >= segment.x &&
                x <= segment.x + segment.width &&
                y >= segment.y &&
                y <= segment.y + segment.height
            ) {
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
