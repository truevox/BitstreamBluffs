// js/GameScene.js
class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        this.player = null;
        this.cursors = null;
        this.terrainGraphics = null;
        this.terrainSegments = [];
        // this.terrainSegmentsPhysicsGroup = null; // Will be a regular group

        this.segmentWidth = 100;
        this.terrainStartX = -200;
        this.lastTerrainY = 500;

        this.worldBoundsPadding = 2000;

        this.neonYellow = 0xffff00;
        this.neonBlue = 0x00ffff;
        this.neonPink = 0xff00ff;
        this.neonRed = 0xff0000;
        this.debugGreen = 0x00ff00;
        this.debugOrange = 0xffa500;


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
        // terrainSegmentsPhysicsGroup will now be a regular group to hold terrain GameObjects
        // The physics bodies will be managed directly.
        this.terrainSegmentsPhysicsGroup = this.add.group();


        // --- Player Creation ---
        const playerBodyWidth = 30;
        const playerBodyHeight = 50;
        const sledHeight = 15;
        const riderHeight = playerBodyHeight - sledHeight;

        this.player = this.add.container(200, 100);
        this.player.setSize(playerBodyWidth, playerBodyHeight);

        const riderX = 12; //DO NOT TOUCH
        // Fix rider positioning to be exactly centered over the sled
        const riderY = -sledHeight - (riderHeight-120 / 2); //DO NOT TOUCH
        const rider = this.add.triangle(
            riderX, riderY,
            0, -riderHeight / 2,
            -playerBodyWidth / 2, riderHeight / 2,
            playerBodyWidth / 2, riderHeight / 2,
            this.neonYellow
        );
        // rider.setOrigin(0.5,0.5); // Default for triangle

        const sledX = 0;
        const sledY = (playerBodyHeight / 2) - (sledHeight / 2);
        const sled = this.add.rectangle(
            sledX, sledY,
            playerBodyWidth+10, sledHeight,
            this.neonRed
        );
        // sled.setOrigin(0.5,0.5); // Default for rectangle

        const riderOriginMarker = this.add.circle(riderX, riderY, 5, this.debugGreen, 0.8).setDepth(20);
        const sledOriginMarker = this.add.circle(sledX, sledY, 5, this.debugOrange, 0.8).setDepth(20);

        this.player.add([sled, rider, riderOriginMarker, sledOriginMarker]);

        this.physics.add.existing(this.player);
        this.player.body.setGravityY(800);
        this.player.body.setCollideWorldBounds(false);
        this.player.body.setBounce(0.1);

        console.log(`Player created. Container X: ${this.player.x}, Y: ${this.player.y}`);
        console.log(`Rider local X: ${rider.x}, Y: ${rider.y}`);
        console.log(`Sled local X: ${sled.x}, Y: ${sled.y}`);

        this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
        this.cameras.main.setFollowOffset(0, 100);

        this.physics.world.setBounds(
            -this.worldBoundsPadding, -this.worldBoundsPadding,
            this.cameras.main.width + this.worldBoundsPadding * 2,
            this.cameras.main.height + this.worldBoundsPadding * 2
        );

        console.log(`Initial terrain generation. First segment from Y: ${this.lastTerrainY}`);
        for (let i = 0; i < 25; i++) {
            this.generateNextTerrainSegment(i === 0);
        }
        this.drawTerrain();
        console.log(`${this.terrainSegments.length} terrain segments generated.`);

        // Collider will check player against all children of terrainSegmentsPhysicsGroup
        this.physics.add.collider(this.player, this.terrainSegmentsPhysicsGroup.getChildren(), this.playerHitTerrain, null, this);

        this.debugText = this.add.text(10, 10, '', this.debugTextStyle).setScrollFactor(0).setDepth(100);
        console.log("GameScene setup complete.");
    }

    playerHitTerrain(player, segmentGameObject) {
        // When player hits terrain, adjust player's rotation to better match the terrain angle
        // This helps with the physics feel of sliding along the terrain
        
        if (segmentGameObject && segmentGameObject.terrainAngle !== undefined) {
            // Get the terrain angle in degrees
            const terrainAngleDeg = Phaser.Math.RadToDeg(segmentGameObject.terrainAngle);
            
            // Optional: gradually adjust player's angle towards the terrain angle
            // for smoother transition when moving from segment to segment
            const playerAngleDeg = player.angle;
            const angleDiff = terrainAngleDeg - playerAngleDeg;
            
            // Apply a small impulse based on the slope angle to help with downhill momentum
            if (Math.abs(angleDiff) > 5 && player.body.velocity.y < 5) {
                const slopeImpulse = Math.sin(segmentGameObject.terrainAngle) * 50;
                player.body.velocity.x += slopeImpulse;
            }
            
            // Debug info
            if (this.debugText) {
                this.debugText.setText([
                    ...this.debugText.text.split('\n').slice(0, 5),
                    `Terrain Angle: ${terrainAngleDeg.toFixed(1)}°`
                ]);
            }
        }
    }

    generateNextTerrainSegment(isFirstSegment = false) {
        const prevX = this.terrainStartX + (this.terrainSegments.length * this.segmentWidth);
        const prevY = this.lastTerrainY;
        let newY = prevY;
        let segmentAngleRad;

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
            angle: segmentAngleRad
        };
        this.terrainSegments.push(segment);
        this.lastTerrainY = newY;

        // Instead of using one big rectangle, we'll use multiple small ones to approximate the slope
        // This ensures a smooth slope rather than steps
        const subSegmentCount = 5; // Number of sub-segments to create for smooth slope
        const physicsSubSegments = [];
        
        for (let i = 0; i < subSegmentCount; i++) {
            // Calculate positions for this sub-segment
            const t1 = i / subSegmentCount;
            const t2 = (i + 1) / subSegmentCount;
            
            // Linear interpolation to find points along the line
            const x1 = Phaser.Math.Linear(segment.x1, segment.x2, t1);
            const y1 = Phaser.Math.Linear(segment.y1, segment.y2, t1);
            const x2 = Phaser.Math.Linear(segment.x1, segment.x2, t2);
            const y2 = Phaser.Math.Linear(segment.y1, segment.y2, t2);
            
            // Calculate center point and length for this sub-segment
            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;
            const length = Phaser.Math.Distance.Between(x1, y1, x2, y2);
            const thickness = 4; // Thinner bodies for more precise collisions
            
            // Create a physics body for this sub-segment
            const subRect = this.add.rectangle(centerX, centerY, length, thickness);
            subRect.setOrigin(0.5, 0.5);
            
            // Enable static physics
            this.physics.world.enable(subRect, Phaser.Physics.Arcade.STATIC_BODY);
            
            // Set rotation to match this segment's slope
            const subAngleRad = Math.atan2(y2 - y1, x2 - x1);
            subRect.setRotation(subAngleRad);
            
            // Update physics body
            subRect.body.updateFromGameObject();
            
            // Store properties for collision handling
            subRect.terrainAngle = subAngleRad;
            subRect.parentSegment = segment;
            
            // Add to the physics group for collision detection
            this.terrainSegmentsPhysicsGroup.add(subRect);
            
            // Keep track of all sub-segments for this terrain piece
            physicsSubSegments.push(subRect);
        }
        
        // Store all sub-segments with the main segment for cleanup later
        segment.physicsSubSegments = physicsSubSegments;
    }

    drawTerrain() {
        this.terrainGraphics.clear();
        
        // Draw the terrain lines
        for (const segment of this.terrainSegments) {
            // Draw the main neon line
            this.terrainGraphics.lineStyle(5, segment.color, 1);
            this.terrainGraphics.beginPath();
            this.terrainGraphics.moveTo(segment.x1, segment.y1);
            this.terrainGraphics.lineTo(segment.x2, segment.y2);
            this.terrainGraphics.strokePath();
            
            // Optional: Draw a subtle glow effect to make the lines pop
            this.terrainGraphics.lineStyle(8, segment.color, 0.3);
            this.terrainGraphics.beginPath();
            this.terrainGraphics.moveTo(segment.x1, segment.y1);
            this.terrainGraphics.lineTo(segment.x2, segment.y2);
            this.terrainGraphics.strokePath();
            
            // Optional debugging - visualize the collision bodies
            // if (segment.physicsBody && segment.physicsBody.body) {
            //     const body = segment.physicsBody.body;
            //     this.terrainGraphics.lineStyle(1, 0x0000ff, 0.5);
            //     this.terrainGraphics.strokeRect(
            //         body.x, body.y, body.width, body.height
            //     );
            // }
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
        let removedAny = false;
        
        // Find segments that are completely off-screen (all subsegments are past threshold)
        const segmentsToRemove = [];
        
        // First identify complete segments to remove
        for (let i = 0; i < this.terrainSegments.length; i++) {
            const segment = this.terrainSegments[i];
            if (segment.x2 < removeThresholdX) {
                segmentsToRemove.push(segment);
            } else {
                // Once we find a segment that's still on screen, we can stop checking
                // (segments are ordered by x-position)
                break;
            }
        }
        
        // Now clean up the identified segments
        if (segmentsToRemove.length > 0) {
            removedAny = true;
            
            // Remove each segment and its associated physics bodies
            segmentsToRemove.forEach(segment => {
                // Clean up all subsegments for this terrain piece
                if (segment.physicsSubSegments) {
                    segment.physicsSubSegments.forEach(subRect => {
                        // Remove from physics group and destroy
                        this.terrainSegmentsPhysicsGroup.remove(subRect, true, true);
                    });
                }
                
                // Remove the segment from our tracking array
                const index = this.terrainSegments.indexOf(segment);
                if (index !== -1) {
                    this.terrainSegments.splice(index, 1);
                }
            });
            
            console.log(`Removed ${segmentsToRemove.length} terrain segments`);
        }

        if (removedAny) {
            this.drawTerrain(); // Redraw terrain after removing segments
            
            if (this.terrainSegments.length === 0) {
                console.warn("All terrain segments removed. Regenerating from player position.");
                this.terrainStartX = this.player.x - this.segmentWidth * 10;
                this.lastTerrainY = this.player.y + 200;
                for (let i = 0; i < 20; i++) {
                    this.generateNextTerrainSegment(i === 0);
                }
                this.drawTerrain();
            }
        }
    }

    update(time, delta) {
        if(this.player && this.player.body){
            this.player.body.setAccelerationX(0);
        } else {
            return; // Player not ready
        }

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
                `Vel X: ${this.player.body.velocity.x.toFixed(0)}, Y: ${this.player.body.velocity.y.toFixed(0)}`,
                `Accel X: ${this.player.body.acceleration.x.toFixed(0)}, Accel Y: ${this.player.body.acceleration.y.toFixed(0)}`,
                `Angle: ${this.player.angle.toFixed(1)}`,
                `OnGround: ${onGround}`
            ]);
        }
    }
}
