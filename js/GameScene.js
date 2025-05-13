// js/GameScene.js
// Uses Phaser 3 with the built‑in Matter physics plugin.
// ------------------------------------------------------

class GameScene extends Phaser.Scene {
    constructor() {
        super({ 
            key: 'GameScene',
            physics: {
                matter: {
                    gravity: { y: 1 },
                    debug: true
                }
            }
        });

        // --- unchanged state -------------------------------------------------
        this.player           = null;
        this.cursors          = null;
        this.terrainGraphics  = null;
        this.terrainSegments  = [];

        this.segmentWidth       = 100;
        this.terrainStartX      = -200;
        this.lastTerrainY       = 500;
        this.worldBoundsPadding = 2000;

        this.neonYellow  = 0xffff00;
        this.neonBlue    = 0x00ffff;
        this.neonPink    = 0xff00ff;
        this.neonRed     = 0xff0000;
        this.debugGreen  = 0x00ff00;
        this.debugOrange = 0xffa500;

        this.debugTextStyle = {
            font: '16px Monospace',
            fill: '#00ff00',
            stroke: '#000000',
            strokeThickness: 2
        };
        this.debugText = null;

        // --- helpers for Matter ---------------------------------------------
        this.onGround           = false;   // updated from collision events
        this.currentSlopeAngle  = 0;       // rad
    }

    preload() {
        /* nothing to load right now */
    }

    create() {
        // --------------------------------------------------------------------
        // world + input setup (unchanged)
        // --------------------------------------------------------------------
        this.cameras.main.setBackgroundColor('#000000');
        this.manette = new Manette(this);                 // ⬅ still works
        this.cursors = this.input.keyboard.createCursorKeys();

        // switch to Matter bounds
        this.matter.world.setBounds(
            -this.worldBoundsPadding,
            -this.worldBoundsPadding,
            this.cameras.main.width  + this.worldBoundsPadding * 2,
            this.cameras.main.height + this.worldBoundsPadding * 2
        );

        // --------------------------------------------------------------------
        // PHYSICS ‑‑ PLAYER  (now Matter)
        // --------------------------------------------------------------------
        const playerBodyWidth  = 30;
        const playerBodyHeight = 50;
        const sledHeight       = 15;
        const riderHeight      = playerBodyHeight - sledHeight;
        const circleRadius     = Math.max(playerBodyWidth, sledHeight) / 1.5;

        // build visuals first (unchanged)
        const riderX = 12; // DO NOT TOUCH
        const riderY = -sledHeight - (riderHeight - 120 / 2); // DO NOT TOUCH
        const rider  = this.add.triangle(
            riderX, riderY,
            0, -riderHeight / 2,
            -playerBodyWidth / 2, riderHeight / 2,
            playerBodyWidth / 2,  riderHeight / 2,
            this.neonYellow
        );

        const sledX = 0;
        const sledY = (playerBodyHeight / 2) - (sledHeight / 2);
        const sled  = this.add.rectangle(
            sledX, sledY,
            playerBodyWidth + 10,
            sledHeight,
            this.neonRed
        );

        const physicsCircle = this.add.circle(0, sledY - 5, circleRadius)
                                      .setStrokeStyle(1, 0x00ff00, 0.3);

        const riderOriginMarker = this.add.circle(riderX, riderY, 5,
                                                  this.debugGreen, 0.8).setDepth(20);
        const sledOriginMarker  = this.add.circle(sledX,  sledY,  5,
                                                  this.debugOrange, 0.8).setDepth(20);

        // create container and convert it to Matter
        this.player = this.add.container(200, 100,
            [sled, rider, physicsCircle, riderOriginMarker, sledOriginMarker]);

        // add a circular Matter body to the container
        const Bodies = Phaser.Physics.Matter.Matter.Bodies;
        const playerBody = Bodies.circle(0, 0, circleRadius, {
            restitution: 0.1,
            friction: 0.03,  // Reduced friction for better sliding
            density: 0.002
        });

        this.matter.add.gameObject(this.player);
        this.player.setExistingBody(playerBody)
                   .setFixedRotation(false)      // allow spins for tricks
                   .setPosition(200, 100);       // re‑centre after body attach

        // camera follow stays the same
        this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
        this.cameras.main.setFollowOffset(0, 100);

        // --------------------------------------------------------------------
        // TERRAIN  (now Matter static rectangles)
        // --------------------------------------------------------------------
        this.terrainGraphics = this.add.graphics();
        console.log(`Initial terrain generation. First segment from Y: ${this.lastTerrainY}`);

        for (let i = 0; i < 25; i++) {
            this.generateNextTerrainSegment(i === 0);
        }
        this.drawTerrain();
        console.log(`${this.terrainSegments.length} terrain segments generated.`);

        // --------------------------------------------------------------------
        // COLLISION EVENTS for slope angle + ground detection
        // --------------------------------------------------------------------
        this.matter.world.on('collisionstart', (event) => {
            for (const pair of event.pairs) {
                const { bodyA, bodyB } = pair;

                if (bodyA === this.player.body || bodyB === this.player.body) {
                    const other = (bodyA === this.player.body) ? bodyB : bodyA;

                    if (other.terrainAngle !== undefined) {
                        this.onGround          = true;
                        this.currentSlopeAngle = other.terrainAngle;
                    }
                }
            }
        });

        this.matter.world.on('collisionend', (event) => {
            for (const pair of event.pairs) {
                if (pair.bodyA === this.player.body || pair.bodyB === this.player.body) {
                    this.onGround = false;
                }
            }
        });

        // --------------------------------------------------------------------
        // DEBUG TEXT
        // --------------------------------------------------------------------
        this.debugText = this.add.text(10, 10, '',
            this.debugTextStyle).setScrollFactor(0).setDepth(100);

        console.log("GameScene setup complete (Matter edition).");
    }

    // ------------------------------------------------------------------------
    // PLAYER‑TERRAIN angle helper (called from collision handler if wanted)
    // ------------------------------------------------------------------------
    playerHitTerrain(terrainAngleRad) {
        // rotate player gently toward terrain angle on touchdown
        const targetDeg  = Phaser.Math.RadToDeg(terrainAngleRad);
        const currentDeg = this.player.angle;
        const diff       = targetDeg - currentDeg;

        if (Math.abs(diff) > 2) {
            this.player.setAngle(currentDeg + diff * 0.2);
        }
    }

    // ------------------------------------------------------------------------
    // TERRAIN GENERATION  (Matter static bodies replacing Arcade group)
    // ------------------------------------------------------------------------
    generateNextTerrainSegment(isFirstSegment = false) {
        const prevX = this.terrainStartX + (this.terrainSegments.length * this.segmentWidth);
        const prevY = this.lastTerrainY;

        // pick a new Y using the same rules
        let newY = prevY;
        if (isFirstSegment) {
            newY += Phaser.Math.Between(20, 40);
        } else {
            const r = Math.random();
            if      (r < 0.55) newY += Phaser.Math.Between(10,  40);
            else if (r < 0.75) newY += Phaser.Math.Between(40,  80);
            else if (r < 0.90) newY += Phaser.Math.Between(-20, 10);
            else               newY -= Phaser.Math.Between(30,  80);
        }
        newY = Phaser.Math.Clamp(newY, prevY - 80, prevY + 100);
        const segmentAngleRad = Math.atan2(newY - prevY, this.segmentWidth);

        const segment = {
            x1: prevX, y1: prevY,
            x2: prevX + this.segmentWidth, y2: newY,
            color: Math.random() < 0.5 ? this.neonBlue : this.neonPink,
            angle: segmentAngleRad
        };
        this.terrainSegments.push(segment);
        this.lastTerrainY = newY;

        // break the slope into sub‑rectangles for smooth collision (unchanged count)
        const subSegmentCount = 5;
        for (let i = 0; i < subSegmentCount; i++) {
            const t1 = i / subSegmentCount;
            const t2 = (i + 1) / subSegmentCount;

            const x1 = Phaser.Math.Linear(segment.x1, segment.x2, t1);
            const y1 = Phaser.Math.Linear(segment.y1, segment.y2, t1);
            const x2 = Phaser.Math.Linear(segment.x1, segment.x2, t2);
            const y2 = Phaser.Math.Linear(segment.y1, segment.y2, t2);

            const centerX   = (x1 + x2) / 2;
            const centerY   = (y1 + y2) / 2;
            const length    = Phaser.Math.Distance.Between(x1, y1, x2, y2);
            const thickness = 5;

            // create a static Matter rectangle (invisible, purely for collision)
            const body = this.matter.add.rectangle(
                centerX, centerY, length, thickness, {
                    isStatic: true,
                    angle   : Math.atan2(y2 - y1, x2 - x1),
                    friction: 0.01,
                    label   : 'terrain'
                }
            );

            body.terrainAngle = body.angle; // store for collision callback
        }
    }

    // ------------------------------------------------------------------------
    // draw neon rails (visual only – unchanged)
    // ------------------------------------------------------------------------
    drawTerrain() {
        this.terrainGraphics.clear();

        for (const seg of this.terrainSegments) {
            this.terrainGraphics.lineStyle(5, seg.color, 1).beginPath();
            this.terrainGraphics.moveTo(seg.x1, seg.y1);
            this.terrainGraphics.lineTo(seg.x2, seg.y2).strokePath();

            this.terrainGraphics.lineStyle(8, seg.color, 0.3).beginPath();
            this.terrainGraphics.moveTo(seg.x1, seg.y1);
            this.terrainGraphics.lineTo(seg.x2, seg.y2).strokePath();
        }
    }

    // ------------------------------------------------------------------------
    // manageTerrain (only the physics‑cleanup bits needed tweaking)
    // ------------------------------------------------------------------------
    manageTerrain() {
        const cam              = this.cameras.main;
        const lookAheadTrigger = this.player.x + cam.width * 1.5;

        const lastSeg   = this.terrainSegments[this.terrainSegments.length - 1];
        const lastX     = lastSeg ? lastSeg.x2 : this.terrainStartX;
        if (lastX < lookAheadTrigger) {
            this.generateNextTerrainSegment();
            this.drawTerrain();
        }

        // remove segments far behind
        const removeThresholdX = this.player.x - cam.width * 1.5;
        while (this.terrainSegments.length &&
               this.terrainSegments[0].x2 < removeThresholdX) {
            this.terrainSegments.shift();
        }
    }

    // ------------------------------------------------------------------------
    // UPDATE  (Arcade‑style controls translated to Matter)
    // ------------------------------------------------------------------------
    update(time, delta) {
        const Body = Phaser.Physics.Matter.Matter.Body;

        // --------------------------------------------------------------------
        // INPUT – spin + push left/right
        // --------------------------------------------------------------------
        const groundRotVel = 0.05;  // ~deg/s in rad Units
        const airRotVel    = 0.10;
        const pushForce    = 0.002; // tune to taste

        if (this.cursors.left.isDown) {
            Body.setAngularVelocity(this.player.body,
                this.onGround ? -groundRotVel : -airRotVel);

            Body.applyForce(this.player.body,
                this.player.body.position,
                { x: this.onGround ? -pushForce : -pushForce * 0.5, y: 0 });
        }
        else if (this.cursors.right.isDown) {
            Body.setAngularVelocity(this.player.body,
                this.onGround ? groundRotVel : airRotVel);

            Body.applyForce(this.player.body,
                this.player.body.position,
                { x: this.onGround ?  pushForce :  pushForce * 0.5, y: 0 });
        }
        else if (this.onGround) {
            Body.setAngularVelocity(this.player.body, 0);
            // gently align to slope
            this.playerHitTerrain(this.currentSlopeAngle);
        }

        // --------------------------------------------------------------------
        // JUMP
        // --------------------------------------------------------------------
        if ((this.cursors.up.isDown || this.cursors.space.isDown) && this.onGround) {
            Body.setVelocity(this.player.body,
                { x: this.player.body.velocity.x, y: -10 });
            this.onGround = false;
        }

        // --------------------------------------------------------------------
        // camera, terrain churn, fail states (unchanged)
        // --------------------------------------------------------------------
        this.manageTerrain();

        if (this.player.y > this.cameras.main.worldView.bottom + 800) {
            console.log("Player fell too far. Restarting.");
            this.scene.restart();
        }
        if (this.player.x < this.cameras.main.worldView.left - 400) {
            console.log("Player went too far left. Restarting.");
            this.scene.restart();
        }

        // --------------------------------------------------------------------
        // DEBUG HUD
        // --------------------------------------------------------------------
        if (this.debugText) {
            this.debugText.setText([
                `X: ${this.player.x.toFixed(0)},  Y: ${this.player.y.toFixed(0)}`,
                `Vx: ${this.player.body.velocity.x.toFixed(2)}  ` +
                `Vy: ${this.player.body.velocity.y.toFixed(2)}`,
                `Angle: ${Phaser.Math.RadToDeg(this.player.body.angle).toFixed(1)}`,
                `OnGround: ${this.onGround}`
            ]);
        }
    }
}

// export default GameScene;
