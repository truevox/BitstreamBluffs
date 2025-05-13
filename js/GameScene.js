// js/GameScene.js
class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        this.player = null;
        this.cursors = null;
        this.terrainGraphics = null;
        this.terrainSegments = [];
        this.terrainSegmentsPhysicsGroup = null;

        this.segmentWidth = 100;
        this.terrainStartX = -200;
        this.lastTerrainY = 500;

        this.worldBoundsPadding = 2000;

        this.neonYellow = 0xffff00;
        this.neonBlue = 0x00ffff;
        this.neonPink = 0xff00ff;
        this.neonRed = 0xff0000;

        this.debugTextStyle = { font: '16px Monospace', fill: '#00ff00', stroke: '#000000', strokeThickness: 2 };
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

        this.terrainGraphics = this.add.graphics();
        this.terrainSegmentsPhysicsGroup = this.physics.add.staticGroup();

        // --- Player Creation ---
        const playerWidth = 30;
        const playerHeight = 50; // Total height of the container for physics
        const sledHeight = 15;   // Height of the sled part
        const riderHeight = playerHeight - sledHeight; // Height allocated for the rider

        // Player container - its origin becomes (0.5, 0.5) after setSize
        this.player = this.add.container(200, 100);
        this.player.setSize(playerWidth, playerHeight); // Physics body size for the container

        // Rider: Neon Yellow equilateral triangle
        // Rider's origin is (0.5, 0.5) by default.
        // Position its center (0,0 locally) relative to the container's center.
        const rider = this.add.triangle(
            0, // Local x within container (0 means centered horizontally)
            -(sledHeight / 2), // Position rider's center slightly above the container's vertical center, effectively on top of the sled.
            0, -riderHeight / 2,                      // Top point (relative to triangle's own origin)
            -playerWidth / 2, riderHeight / 2,       // Bottom-left point
            playerWidth / 2, riderHeight / 2,        // Bottom-right point
            this.neonYellow
        );
        // rider.setOrigin(0.5, 0.5); // Default, can be explicit

        // Sled: Neon Red rectangle
        // Sled's origin is (0.5, 0.5) by default.
        // Position its center (0,0 locally) relative to the container's center.
        const sled = this.add.rectangle(
            0, // Local x within container (0 means centered horizontally)
            (riderHeight / 2),  // Position sled's center slightly below the container's vertical center.
            playerWidth,    // width of the rectangle
            sledHeight,     // height of the rectangle
            this.neonRed    // fill color
        );
        // sled.setOrigin(0.5, 0.5); // Default, can be explicit

        this.player.add([sled, rider]); // Sled drawn first, then rider on top

        this.physics.add.existing(this.player);
        this.player.body.setGravityY(800);
        this.player.body.setCollideWorldBounds(false);
        this.player.body.setBounce(0.1);
        this.player.body.setFrictionX(0.02);
        this.player.body.setDamping(false);

        console.log(`Player created at X: ${this.player.x}, Y: ${this.player.y}`);

        this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
        this.cameras.main.setFollowOffset(0, 100);
        this.cameras.main.setZoom(1);

        this.physics.world.setBounds(
            -this.worldBoundsPadding, -this.worldBoundsPadding,
            this.cameras.main.width + this.worldBoundsPadding * 2,
            this.cameras.main.height + this.worldBoundsPadding * 2
        );

        console.log(`Initial terrain generation starting. First segment from Y: ${this.lastTerrainY}`);
        for (let i = 0; i < 25; i++) {
            this.generateNextTerrainSegment(i === 0);
        }
        this.drawTerrain(); // Draws the visual neon lines
        console.log(`${this.terrainSegments.length} terrain segments generated.`);

        this.physics.add.collider(this.player, this.terrainSegmentsPhysicsGroup, this.playerHitTerrain, null, this);

        this.debugText = this.add.text(10, 10, '', this.debugTextStyle).setScrollFactor(0).setDepth(100);

        console.log("GameScene setup complete. Physics debug outlines should be visible and ROTATED for terrain.");
    }

    playerHitTerrain(player, segmentGameObject) {
        console.log(`Player hit terrain. Segment Angle (deg): ${Phaser.Math.RadToDeg(segmentGameObject.terrainAngle).toFixed(1)}`);
    }

    generateNextTerrainSegment(isFirstSegment = false) {
        const prevX = this.terrainStartX + (this.terrainSegments.length * this.segmentWidth);
        const prevY = this.lastTerrainY;

        let newY = prevY;
        let segmentAngleRad; // Angle in radians

        if (isFirstSegment) { newY += Phaser.Math.Between(20, 40); }
        else {
            const randomFactor = Math.random();
            if (randomFactor < 0.55) { newY += Phaser.Math.Between(10, 40); }
            else if (randomFactor < 0.75) { newY += Phaser.Math.Between(40, 80); }
            else if (randomFactor < 0.9) { newY += Phaser.Math.Between(-20, 10); }
            else { newY -= Phaser.Math.Between(30, 80); }
        }
        newY = Phaser.Math.Clamp(newY, prevY - 80, prevY + 100);
        segmentAngleRad = Math.atan2(newY - prevY, this.segmentWidth);

        const segment = {
            x1: prevX, y1: prevY, x2: prevX + this.segmentWidth, y2: newY,
            color: Math.random() < 0.5 ? this.neonBlue : this.neonPink,
            angle: segmentAngleRad // Store angle in radians
        };
        this.terrainSegments.push(segment);
        this.lastTerrainY = newY;

        const centerX = (segment.x1 + segment.x2) / 2;
        const centerY = (segment.y1 + segment.y2) / 2;
        const length = Phaser.Math.Distance.Between(segment.x1, segment.y1, segment.x2, segment.y2);
        const thickness = 10;

        const terrainRect = this.add.rectangle(centerX, centerY, length, thickness);
        terrainRect.setVisible(false); // Keep invisible, debug outlines should still show.

        this.physics.add.existing(terrainRect, true); // true for static body

        // Set the GameObject's rotation (in radians) - this also orients the debug draw if visible
        terrainRect.setRotation(segmentAngleRad);

        // CRITICAL FIX: Set the Arcade Physics Body's angle property directly (in degrees).
        if (terrainRect.body instanceof Phaser.Physics.Arcade.StaticBody || terrainRect.body instanceof Phaser.Physics.Arcade.Body) {
            terrainRect.body.angle = Phaser.Math.RadToDeg(segmentAngleRad);
        }

        // Refresh the physics body to reflect changes.
        // This ensures the collision bounds are updated after rotation.
        if (terrainRect.body.world) {
            terrainRect.body.updateFromGameObject();
        }

        terrainRect.terrainAngle = segmentAngleRad; // Custom property
        this.terrainSegmentsPhysicsGroup.add(terrainRect); // Add to group for collision
        segment.physicsBody = terrainRect;
    }

    drawTerrain() {
        this.terrainGraphics.clear();
        for (const segment of this.terrainSegments) {
            this.terrainGraphics.lineStyle(5, segment.color, 1);
            this.terrainGraphics.beginPath();
            this.terrainGraphics.moveTo(segment.x1, segment.y1);
            this.terrainGraphics.lineTo(segment.x2, segment.y2);
            this.terrainGraphics.strokePath();
        }
    }

    manageTerrain() {
        const camera = this.cameras.main;
        const lookAheadTriggerX = this.player.x + camera.width * 1.5;
        const lastSegment = this.terrainSegments[this.terrainSegments.length - 1];
        const lastGeneratedSegmentX = lastSegment ? lastSegment.x2 : this.terrainStartX;

        if (lastGeneratedSegmentX < lookAheadTriggerX) {
            this.generateNextTerrainSegment();
            this.drawTerrain();
        }

        const removeThresholdX = this.player.x - camera.width * 1.5;
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
            this.drawTerrain();
            if (this.terrainSegments.length > 0) {
                this.terrainStartX = this.terrainSegments[0].x1;
            } else {
                console.warn("All terrain segments removed. Regenerating from player position.");
                this.terrainStartX = this.player.x - this.segmentWidth * 10;
                this.lastTerrainY = this.player.y + 200;
                for (let i = 0; i < 20; i++) this.generateNextTerrainSegment(i === 0);
                this.drawTerrain();
            }
        }
    }

    update(time, delta) {
        const onGround = this.player.body.blocked.down || this.player.body.touching.down;
        const speed = 300;
        const leanForce = 600;
        const jumpPower = 450;

        if (this.cursors.left.isDown) {
            this.player.body.setAngularVelocity(-250);
            if (onGround) this.player.body.setAccelerationX(-leanForce);
        } else if (this.cursors.right.isDown) {
            this.player.body.setAngularVelocity(250);
            if (onGround) this.player.body.setAccelerationX(leanForce);
        } else {
            this.player.body.setAngularVelocity(0);
            this.player.body.setAccelerationX(0);
        }

        if (onGround) {
            const angleRad = Phaser.Math.DegToRad(this.player.angle);
            const gravitySlideForce = 400;
            this.player.body.acceleration.x += Math.sin(angleRad) * gravitySlideForce;
            this.player.body.setFrictionX(0.05);
        } else {
            this.player.body.setFrictionX(0.01);
            if (!this.cursors.left.isDown && !this.cursors.right.isDown) {
                if (this.player.angle > 1) this.player.body.setAngularVelocity(-150);
                else if (this.player.angle < -1) this.player.body.setAngularVelocity(150);
                else {
                    this.player.body.setAngularVelocity(0);
                    this.player.setAngle(Phaser.Math.Linear(this.player.angle, 0, 0.1));
                }
            }
        }

        if (this.player.body.velocity.x > speed) this.player.body.setVelocityX(speed);
        if (this.player.body.velocity.x < -speed) this.player.body.setVelocityX(-speed);

        if ((this.cursors.up.isDown || this.cursors.space.isDown) && onGround) {
            this.player.body.setVelocityY(-jumpPower);
        }

        this.manageTerrain();

        if (this.player.y > this.cameras.main.worldView.bottom + this.player.height + 300) {
            console.log("Player fell too far. Restarting.");
            this.scene.restart();
        }
        if (this.player.x < this.cameras.main.worldView.left - this.player.width - 200) {
            console.log("Player went too far left. Restarting.");
            this.scene.restart();
        }

        if (this.debugText && this.player && this.player.body) {
            this.debugText.setText([
                `Player X: ${this.player.x.toFixed(0)}, Y: ${this.player.y.toFixed(0)}`,
                `Velocity X: ${this.player.body.velocity.x.toFixed(0)}, Y: ${this.player.body.velocity.y.toFixed(0)}`,
                `Angle: ${this.player.angle.toFixed(1)}`,
                `OnGround: ${onGround}`
            ]);
        }
    }
}
