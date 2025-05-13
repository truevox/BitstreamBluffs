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
        // segmentGameObject is the Phaser.GameObjects.Rectangle used for physics
        // Log the GameObject's rotation (which we set)
        console.log(`Player hit terrain. Segment GO Rotation (deg): ${Phaser.Math.RadToDeg(segmentGameObject.rotation).toFixed(1)}`);
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

        const centerX = (segment.x1 + segment.x2) / 2;
        const centerY = (segment.y1 + segment.y2) / 2;
        const length = Phaser.Math.Distance.Between(segment.x1, segment.y1, segment.x2, segment.y2);
        const thickness = 10;

        // 1. Create the Rectangle GameObject
        const terrainRect = this.add.rectangle(centerX, centerY, length, thickness);
        terrainRect.setOrigin(0.5, 0.5);
        terrainRect.setVisible(false); // Debug outlines should still show if global debug is true

        // 2. Enable static physics body directly on the GameObject
        this.physics.world.enableBody(terrainRect, Phaser.Physics.Arcade.STATIC_BODY);
        // Note: enableBody sets properties like immovable=true, allowGravity=false for static bodies.

        // 3. Set GameObject's rotation (in radians)
        terrainRect.setRotation(segmentAngleRad);

        // 4. CRITICAL: Update the body from the GameObject's transform
        if (terrainRect.body) {
            terrainRect.body.updateFromGameObject();
        } else {
            console.error(`Terrain segment at (${centerX}, ${centerY}) created WITHOUT a physics body!`);
        }

        // 5. Add to a regular group for tracking/management (and for the collider)
        this.terrainSegmentsPhysicsGroup.add(terrainRect);

        terrainRect.terrainAngle = segmentAngleRad; // Custom property
        segment.physicsBody = terrainRect; // Reference to the GameObject
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
        let removedAny = false;
        // Iterate over a copy of the group's children if modifying the group directly
        const childrenToRemove = [];
        this.terrainSegmentsPhysicsGroup.getChildren().forEach(terrainRect => {
            if (terrainRect.x + (terrainRect.width / 2) < removeThresholdX) { // Check right edge of body
                 childrenToRemove.push(terrainRect);
            }
        });

        childrenToRemove.forEach(terrainRect => {
            // Remove from our tracking array first
            this.terrainSegments = this.terrainSegments.filter(s => s.physicsBody !== terrainRect);
            // Then destroy the GameObject (which also removes its body and from the group)
            terrainRect.destroy();
            removedAny = true;
        });


        if (removedAny) {
            this.drawTerrain(); // Redraw if any visual segments might have changed (though physics is main concern)
            if (this.terrainSegments.length > 0) {
                 // This might need adjustment if terrainStartX isn't purely based on array index anymore
                // For now, let's assume it's okay, or we might need a different way to track the leading edge.
                // this.terrainStartX = this.terrainSegments[0].x1;
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
