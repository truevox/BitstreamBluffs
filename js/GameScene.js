// js/GameScene.js
class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        this.player = null;
        this.cursors = null;
        this.terrainGraphics = null;
        this.terrainSegments = [];
        this.terrainSegmentsPhysicsGroup = null; // Initialize to null

        this.segmentWidth = 100;
        this.terrainStartX = -200; // Start terrain generation to the left of player's initial view
        this.lastTerrainY = 500;   // Initial Y for the first terrain segment (player starts at Y=100)

        this.worldBoundsPadding = 2000;

        this.neonYellow = 0xffff00;
        this.neonBlue = 0x00ffff;
        this.neonPink = 0xff00ff;
        this.neonRed = 0xff0000;

        this.debugTextStyle = { font: '16px Monospace', fill: '#00ff00' };
        this.debugText = null;
    }

    preload() {
        // console.log("GameScene: preload");
    }

    create() {
        // console.log("GameScene: create");

        this.cameras.main.setBackgroundColor('#000000');
        this.manette = new Manette(this);
        this.cursors = this.input.keyboard.createCursorKeys();

        // --- Initialize Terrain System ---
        this.terrainGraphics = this.add.graphics();
        this.terrainSegmentsPhysicsGroup = this.physics.add.staticGroup();

        // --- Player Creation ---
        const playerWidth = 30;
        const playerHeight = 50; // Total height of the container for physics
        const sledHeight = 15;   // Height of the sled part
        const riderHeight = playerHeight - sledHeight; // Height allocated for the rider

        // Start player higher up to ensure it falls onto terrain
        this.player = this.add.container(200, 100);
        this.player.setSize(playerWidth, playerHeight); // This size is for the physics body

        // Rider: Neon Yellow equilateral triangle
        // Positioned in the top part of the container
        const rider = this.add.triangle(
            0, 0, // Center of triangle before offsetting
            0, -riderHeight / 2,                      // Top point
            -playerWidth / 2, riderHeight / 2,       // Bottom-left
            playerWidth / 2, riderHeight / 2,        // Bottom-right
            this.neonYellow
        );
        rider.y = -(playerHeight / 2) + (riderHeight / 2); // Position rider in the upper portion of the container

        // Sled: Neon Red rectangle
        // Positioned in the bottom part of the container
        const sled = this.add.graphics();
        sled.fillStyle(this.neonRed);
        sled.fillRect(-playerWidth / 2, -sledHeight / 2, playerWidth, sledHeight); // Draw sled centered
        sled.y = (playerHeight / 2) - (sledHeight / 2); // Position sled in the lower portion of the container

        this.player.add([rider, sled]); // Add graphics to the container

        this.physics.add.existing(this.player);
        this.player.body.setGravityY(800);
        this.player.body.setCollideWorldBounds(false); // Will manage bounds with terrain/killzones
        this.player.body.setBounce(0.1);
        this.player.body.setFrictionX(0.02); // Low friction while in air
        this.player.body.setDamping(false); // No automatic damping from phaser, we control friction

        console.log(`Player created at X: ${this.player.x}, Y: ${this.player.y}`);
        console.log(`Player body gravity Y: ${this.player.body.gravity.y}, allowGravity: ${this.player.body.allowGravity}`);

        // --- Camera Setup ---
        this.cameras.main.startFollow(this.player, true, 0.08, 0.08); // Smoother follow
        this.cameras.main.setFollowOffset(0, 100); // Look a bit below the player
        this.cameras.main.setZoom(1);

        // --- World Bounds ---
        this.physics.world.setBounds(
            -this.worldBoundsPadding,
            -this.worldBoundsPadding,
            this.cameras.main.width + this.worldBoundsPadding * 2,
            this.cameras.main.height + this.worldBoundsPadding * 2
        );

        // --- Initial Terrain Generation ---
        console.log(`Initial terrain generation starting. First segment from Y: ${this.lastTerrainY}`);
        for (let i = 0; i < 25; i++) { // Generate more initial segments to fill screen and beyond
            this.generateNextTerrainSegment(i === 0); // Pass true for the very first segment
        }
        this.drawTerrain();
        console.log(`${this.terrainSegments.length} terrain segments generated.`);
        if (this.terrainSegments.length > 0) {
            const firstSeg = this.terrainSegments[0];
            console.log(`First segment: (${firstSeg.x1},${firstSeg.y1}) to (${firstSeg.x2},${firstSeg.y2})`);
        }


        // --- Collision: Player and Terrain ---
        this.physics.add.collider(this.player, this.terrainSegmentsPhysicsGroup, this.playerHitTerrain, null, this);

        // --- Debug Text ---
        this.debugText = this.add.text(10, 10, '', this.debugTextStyle).setScrollFactor(0).setDepth(100);

        console.log("GameScene setup complete. Player should fall and interact with terrain.");
    }

    playerHitTerrain(player, segmentGameObject) {
        // segmentGameObject is the Arcade Image associated with the terrain segment
        console.log(`Player hit terrain segment. Player Y: ${player.y.toFixed(2)}, Segment Angle: ${Phaser.Math.RadToDeg(segmentGameObject.terrainAngle).toFixed(2)}`);
        // Basic attempt to align player angle to terrain, needs refinement
        // player.setAngle(Phaser.Math.RadToDeg(segmentGameObject.terrainAngle));
    }

    generateNextTerrainSegment(isFirstSegment = false) {
        const prevX = this.terrainStartX + (this.terrainSegments.length * this.segmentWidth);
        const prevY = this.lastTerrainY;

        let newY = prevY;
        let segmentAngle;

        if (isFirstSegment) {
            // Ensure the very first segment slopes downwards gently
            newY += Phaser.Math.Between(20, 40); // Gentle downward slope
            console.log(`Generating FIRST terrain segment: ${prevX},${prevY} -> ${prevX + this.segmentWidth},${newY}`);
        } else {
            const randomFactor = Math.random();
            if (randomFactor < 0.55) { // More gentle slopes
                newY += Phaser.Math.Between(10, 40);
            } else if (randomFactor < 0.75) { // Moderate slopes
                newY += Phaser.Math.Between(40, 80);
            } else if (randomFactor < 0.9) { // Plateau or slight incline
                newY += Phaser.Math.Between(-20, 10);
            } else { // Upward slope - "Jump" ramp
                newY -= Phaser.Math.Between(30, 80); // Steeper jumps possible
            }
        }

        // Clamp Y changes to prevent extreme slopes per segment
        newY = Phaser.Math.Clamp(newY, prevY - 80, prevY + 100);


        // Try to keep terrain generally on screen, but allow it to go off bottom
        const cameraBottom = this.cameras.main.worldView.bottom;
        if (newY > cameraBottom + 300 && this.terrainSegments.length > 10) { // If well below camera view
             if (Math.random() < 0.25) newY -= Phaser.Math.Between(50,100); // Chance to pull up a bit
        }
        if (newY < this.player.y - 400 && this.terrainSegments.length > 10) { // If terrain is way above player
            if (Math.random() < 0.25) newY += Phaser.Math.Between(50,100); // Chance to push down
        }


        segmentAngle = Math.atan2(newY - prevY, this.segmentWidth);

        const segment = {
            x1: prevX,
            y1: prevY,
            x2: prevX + this.segmentWidth,
            y2: newY,
            color: Math.random() < 0.5 ? this.neonBlue : this.neonPink,
            angle: segmentAngle
        };
        this.terrainSegments.push(segment);
        this.lastTerrainY = newY;

        const centerX = (segment.x1 + segment.x2) / 2;
        const centerY = (segment.y1 + segment.y2) / 2;
        const length = Phaser.Math.Distance.Between(segment.x1, segment.y1, segment.x2, segment.y2);

        const terrainBody = this.terrainSegmentsPhysicsGroup.create(centerX, centerY, null);
        terrainBody.setVisible(false);
        // terrainBody.setImmovable(true); // StaticGroup bodies are already immovable
        terrainBody.body.allowGravity = false;
        terrainBody.setSize(length, 10); // Thickness of 10 for collision
        // terrainBody.setOffset(-length / 2 + length / 2, -10 / 2 + 5); // Offset is tricky with rotation.
                                                                    // Arcade physics bodies are centered by default.
                                                                    // For rotated bodies, setSize then setRotation is usually enough.
                                                                    // If collision is off, this is a place to check.
        terrainBody.setRotation(segment.angle);
        terrainBody.terrainAngle = segment.angle; // Store for player interaction
        terrainBody.isTerrain = true; // Custom flag

        segment.physicsBody = terrainBody;
    }

    drawTerrain() {
        this.terrainGraphics.clear();
        for (const segment of this.terrainSegments) {
            this.terrainGraphics.lineStyle(5, segment.color, 1); // Slightly thicker lines
            this.terrainGraphics.beginPath();
            this.terrainGraphics.moveTo(segment.x1, segment.y1);
            this.terrainGraphics.lineTo(segment.x2, segment.y2);
            this.terrainGraphics.strokePath();
        }
    }

    manageTerrain() {
        const camera = this.cameras.main;
        const lookAheadTriggerX = this.player.x + camera.width * 1.5; // Generate further ahead
        const lastSegment = this.terrainSegments[this.terrainSegments.length - 1];
        const lastGeneratedSegmentX = lastSegment ? lastSegment.x2 : this.terrainStartX;

        if (lastGeneratedSegmentX < lookAheadTriggerX) {
            this.generateNextTerrainSegment();
            this.drawTerrain(); // Could optimize to only draw new segment
        }

        const removeThresholdX = this.player.x - camera.width * 1.5; // Remove further behind
        let segmentsRemovedCount = 0;
        this.terrainSegments = this.terrainSegments.filter(segment => {
            if (segment.x2 < removeThresholdX) {
                if (segment.physicsBody && segment.physicsBody.active) {
                    this.terrainSegmentsPhysicsGroup.remove(segment.physicsBody, true, true);
                }
                segmentsRemovedCount++;
                return false;
            }
            return true;
        });

        if (segmentsRemovedCount > 0) {
            this.drawTerrain(); // Redraw if segments were removed
            if (this.terrainSegments.length > 0) {
                this.terrainStartX = this.terrainSegments[0].x1;
            } else { // All segments removed, emergency regeneration
                console.warn("All terrain segments removed. Regenerating from player position.");
                this.terrainStartX = this.player.x - this.segmentWidth * 10; // Start well behind player
                this.lastTerrainY = this.player.y + 200; // Start below player
                for (let i = 0; i < 20; i++) this.generateNextTerrainSegment(i === 0);
                this.drawTerrain();
            }
        }
    }

    update(time, delta) {
        const onGround = this.player.body.blocked.down || this.player.body.touching.down;
        const speed = 300; // Max horizontal speed from leaning
        const leanForce = 600; // Force applied when leaning
        const jumpPower = 450;

        // --- Player Controls ---
        if (this.cursors.left.isDown) {
            this.player.body.setAngularVelocity(-250); // Faster rotation
            if (onGround) this.player.body.setAccelerationX(-leanForce);
        } else if (this.cursors.right.isDown) {
            this.player.body.setAngularVelocity(250);
            if (onGround) this.player.body.setAccelerationX(leanForce);
        } else {
            this.player.body.setAngularVelocity(0);
            this.player.body.setAccelerationX(0); // Stop horizontal acceleration if not leaning
        }

        // Apply force based on player angle if on ground (sliding down slopes)
        if (onGround) {
            const angleRad = Phaser.Math.DegToRad(this.player.angle);
            const gravitySlideForce = 400; // How much gravity pulls player down slope
            // Add a component of gravity along the slope based on player's angle
            this.player.body.acceleration.x += Math.sin(angleRad) * gravitySlideForce;

            this.player.body.setFrictionX(0.05); // Ground friction (applies to velocity, not acceleration)
                                                // We want some friction to stop if on flat ground and not pressing.
                                                // If we use setVelocityX directly, friction is less of a concern.
        } else {
            // Air control / friction
            this.player.body.setFrictionX(0.01); // Very low air friction for X
            // Auto-upright rotation in air if not leaning
            if (!this.cursors.left.isDown && !this.cursors.right.isDown) {
                if (this.player.angle > 1) this.player.body.setAngularVelocity(-150);
                else if (this.player.angle < -1) this.player.body.setAngularVelocity(150);
                else {
                    this.player.body.setAngularVelocity(0);
                    this.player.setAngle(Phaser.Math.Linear(this.player.angle, 0, 0.1)); // Dampen rotation
                }
            }
        }

        // Max speed cap
        if (this.player.body.velocity.x > speed) this.player.body.setVelocityX(speed);
        if (this.player.body.velocity.x < -speed) this.player.body.setVelocityX(-speed);


        if ((this.cursors.up.isDown || this.cursors.space.isDown) && onGround) {
            this.player.body.setVelocityY(-jumpPower);
        }

        this.manageTerrain();

        // --- Out of Bounds / Death ---
        if (this.player.y > this.cameras.main.worldView.bottom + this.player.height + 300) {
            console.log("Player fell too far. Restarting.");
            this.scene.restart();
        }
        if (this.player.x < this.cameras.main.worldView.left - this.player.width - 200) {
            console.log("Player went too far left. Restarting.");
            this.scene.restart();
        }

        // --- Update Debug Text ---
        if (this.debugText && this.player && this.player.body) {
            this.debugText.setText([
                `Player X: ${this.player.x.toFixed(0)}, Y: ${this.player.y.toFixed(0)}`,
                `Velocity X: ${this.player.body.velocity.x.toFixed(0)}, Y: ${this.player.body.velocity.y.toFixed(0)}`,
                `Accel X: ${this.player.body.acceleration.x.toFixed(0)}, Y: ${this.player.body.acceleration.y.toFixed(0)}`,
                `Angle: ${this.player.angle.toFixed(1)}`,
                `OnGround: ${onGround}`,
                `Terrain Segments: ${this.terrainSegments.length}`
            ]);
        }
    }
}
