// js/GameScene.js
// Uses Phaser 3 with the built‑in Matter physics plugin.
// ------------------------------------------------------

class GameScene extends Phaser.Scene {
    constructor() {
        super({ 
            key: 'GameScene',
            physics: {
                matter: {
                    gravity: { y: 1 },
                    debug: configLoader.isDebuggingEnabled()
                }
            }
        });
        
        // Bind methods to ensure 'this' context is preserved
        this.safePreUpdate = this.safePreUpdate.bind(this);
        this.manageExtraLives = this.manageExtraLives.bind(this);
        this.cleanupOffscreenCollectibles = this.cleanupOffscreenCollectibles.bind(this);

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
        
        // --- trick state ----------------------------------------------------
        this.isTucking          = false;   // for ground speed boost
        this.isParachuting      = false;   // for air trick
        this.isDragging         = false;   // for ground drag
        this.isAirBraking       = false;   // for air brake trick
        this.prevGroundState    = false;   // to detect ground/air transitions
        this.sledOriginalY      = 0;       // to track original sled position
        this.sledOriginalX      = 0;       // to track original sled X position
        
        // --- rotation and flip tracking system --------------------------------
        this.rotationSystem     = null;     // will be initialized in create()
        this.currentSpeedMultiplier = 1.0;  // default speed multiplier
        
        // --- walking mode state -----------------------------------------------
        this.sledDistance       = 40;      // distance between player and sled when walking
        // HUD text for player mode (WALKING/SLEDDING)
        this.hudText = null;
        
        // --- extra lives system -----------------------------------------------
        this.lives              = 1;       // start with one extra life
        this.maxLives           = 3;       // maximum number of lives
        this.lastLifeCollectTime = 0;     // to track time between life pickups
        this.nextLifeAvailableTime = 0;   // earliest time next life can appear
        this.lifeCollectibles  = [];      // array to store life collectible objects
        this.livesText          = null;    // text object for displaying lives
    }

    preload() {
        // Try to load life collectible image
        this.load.image('extraLife', 'assets/extraLife.png');
        
        // Handle missing image error
        this.load.on('filecomplete', (key) => {
            if (key === 'extraLife') {
                console.log('Extra life image loaded successfully');
            }
        });
        
        this.load.on('loaderror', (file) => {
            if (file.key === 'extraLife') {
                console.warn('Failed to load extraLife image, creating a fallback');
                // Create a fallback texture
                const graphics = this.make.graphics({x: 0, y: 0, add: false});
                graphics.fillStyle(0xff00ff, 1); // Neon pink
                graphics.lineStyle(4, 0xffffff, 1); // White border
                graphics.fillCircle(32, 32, 25);
                graphics.strokeCircle(32, 32, 25);
                // Add a heart shape
                graphics.fillStyle(0xffffff, 1);
                graphics.fillCircle(24, 24, 8);
                graphics.fillCircle(40, 24, 8);
                graphics.fillTriangle(16, 30, 48, 30, 32, 45);
                
                // Generate a texture from the graphics object
                graphics.generateTexture('extraLife', 64, 64);
            }
        });
    }

    create() {
        // No local walk mode state; always use this.manette.walkMode
        // --------------------------------------------------------------------
        // world + input setup (unchanged)
        // --------------------------------------------------------------------
        this.cameras.main.setBackgroundColor('#000000');
        this.manette = new Manette(this);                 // ⬅ still works
        this.cursors = this.input.keyboard.createCursorKeys();
        
        // Add an update listener that runs before the main update to clean up any dead objects
        this.events.on('preupdate', this.safePreUpdate, this);

        // No world boundaries - allowing free movement
        // We removed the setBounds call to eliminate the walls
        // that were blocking player movement

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
        
        // Store the original sled position for the tricks
        this.sledOriginalY = sledY;
        this.sledOriginalX = sledX;

        // Physics circle visualization - only visible in debug mode
        const physicsCircle = this.add.circle(0, sledY - 5, circleRadius)
                                      .setStrokeStyle(1, 0x00ff00, 0.3);

        // Debug markers - only visible when debug mode is enabled
        const riderOriginMarker = this.add.circle(riderX, riderY, 5,
                                                  this.debugGreen, 0.8).setDepth(20);
        const sledOriginMarker  = this.add.circle(sledX,  sledY,  5,
                                                  this.debugOrange, 0.8).setDepth(20);
        
        // Set visibility of debug markers based on debug mode
        const debugEnabled = configLoader.isDebuggingEnabled();
        riderOriginMarker.visible = debugEnabled;
        sledOriginMarker.visible = debugEnabled;
        physicsCircle.visible = debugEnabled;

        // create container and convert it to Matter
        this.player = this.add.container(200, 100,
            [sled, rider, physicsCircle, riderOriginMarker, sledOriginMarker]);

        // add a circular Matter body to the container
        const Bodies = Phaser.Physics.Matter.Matter.Bodies;
        const playerBody = Bodies.circle(0, 0, circleRadius, {
            restitution: 0.1,
            friction: 0.000003,  // Reduced friction for better sliding
            density: 0.2
        });

        this.matter.add.gameObject(this.player);
        this.player.setExistingBody(playerBody)
                   .setFixedRotation(false)      // allow spins for tricks
                   .setPosition(200, 100);       // re‑centre after body attach

        // camera follow stays the same
        this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
        this.cameras.main.setFollowOffset(0, 100);
        
        // Initialize the lives display (top right corner)
        this.livesText = this.add.text(
            this.cameras.main.width - 120, 10, 
            `LIVES: ${this.lives}`, 
            {
                font: '18px Arial',
                fill: '#ff00ff',  // Use neon pink to match game style
                stroke: '#000000',
                strokeThickness: 4
            }
        ).setScrollFactor(0).setDepth(100);

        // Initialize time-based variables for extra life spawning
        this.lastLifeCollectTime = this.time.now;
        this.nextLifeAvailableTime = this.time.now + Phaser.Math.Between(2000, 5000); // Initial spawn between 2-5 seconds

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
                    
                    // Check if player collided with an extra life collectible
                    if (other.isExtraLife) {
                        // Pass the physics body directly, not the gameObject
                        this.collectExtraLife(other);
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
        // HUD TEXT (always visible, top left)
        // --------------------------------------------------------------------
        this.hudText = this.add.text(10, 70, '', {
            font: '24px monospace',
            fill: '#ffff00',
            stroke: '#000000',
            strokeThickness: 5,
            padding: { left: 10, right: 10, top: 5, bottom: 5 },
            backgroundColor: 'rgba(0,0,0,0.75)'
        }).setScrollFactor(0).setDepth(101);
        
        // Set initial HUD text
        this.updateHudText();
        
        // --------------------------------------------------------------------
        // ROTATION SYSTEM - For flip tracking and landing evaluation
        // --------------------------------------------------------------------
        this.rotationSystem = new RotationSystem({
            onCleanLanding: (speedMultiplier) => {
                this.currentSpeedMultiplier = speedMultiplier;
                console.log(`Clean landing! Speed multiplier: ${speedMultiplier.toFixed(2)}x`);
            },
            onCrash: () => {
                console.log('Crashed!');
                // Reset player velocity on crash
                const Body = Phaser.Physics.Matter.Matter.Body;
                Body.setVelocity(this.player.body, { x: 0, y: 0 });
                
                // Use a life if available, otherwise restart
                if (this.lives > 0) {
                    this.lives--;
                    this.updateLivesDisplay();
                    
                    // Flash the screen red to indicate a life lost
                    const flashRect = this.add.rectangle(
                        this.cameras.main.worldView.centerX,
                        this.cameras.main.worldView.centerY,
                        this.cameras.main.width,
                        this.cameras.main.height,
                        0xff0000, 0.4
                    ).setScrollFactor(0).setDepth(90);
                    
                    // Fade out and remove the flash
                    this.tweens.add({
                        targets: flashRect,
                        alpha: 0,
                        duration: 300,
                        onComplete: () => {
                            flashRect.destroy();
                        }
                    });
                    
                    // Provide temporary invincibility
                    this.time.delayedCall(500, () => {
                        // Just reset position slightly and continue
                        Body.setVelocity(this.player.body, { x: 2, y: -1 }); // Small kick to get moving again
                    });
                } else {
                    // No lives left, restart the scene after a short delay
                    this.time.delayedCall(500, () => {
                        this.scene.restart();
                    });
                }
            },
            onWobble: () => {
                console.log('Wobble landing!');
                // Reduce speed on wobble
                const Body = Phaser.Physics.Matter.Matter.Body;
                const currentVel = this.player.body.velocity;
                Body.setVelocity(this.player.body, { 
                    x: currentVel.x * 0.7, 
                    y: currentVel.y 
                });
                this.currentSpeedMultiplier = 0.8;
            },
            onFlipComplete: (fullFlips, partialFlip) => {
                console.log(`Flip complete! ${fullFlips} + ${partialFlip.toFixed(2)}`);
                // Could trigger visual effects here
            }
        });

        // --------------------------------------------------------------------
        // DEBUG TEXT
        // --------------------------------------------------------------------
        this.debugText = this.add.text(10, 10, '',
            this.debugTextStyle).setScrollFactor(0).setDepth(100);
        
        // Apply a passive boost to maintain momentum when a speed multiplier is active
        this.time.addEvent({
            delay: 100, // execute 10 times per second
            callback: this.applyPassiveSpeedBoost,
            callbackScope: this,
            loop: true
        });

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
        // Get previous endpoint from last segment instead of calculating based on array length
        const prevSegment = this.terrainSegments[this.terrainSegments.length - 1];
        const prevX = prevSegment ? prevSegment.x2 : this.terrainStartX;
        const prevY = this.lastTerrainY;

        // pick a new Y using steeper slope values
        let newY = prevY;
        if (isFirstSegment) {
            newY += Phaser.Math.Between(40, 70); // Steeper initial descent
        } else {
            const r = Math.random();
            // Increased probability and magnitude of downward slopes
            if      (r < 0.60) newY += Phaser.Math.Between(35,  70);  // Moderate downslope (more common)
            else if (r < 0.85) newY += Phaser.Math.Between(70, 120);  // Steep downslope (more common)
            else if (r < 0.95) newY += Phaser.Math.Between(-15, 25);  // Mild variation for interest
            else               newY -= Phaser.Math.Between(10,  40);  // Occasional small upslope (less common/less steep)
        }
        newY = Phaser.Math.Clamp(newY, prevY - 60, prevY + 150); // Allow steeper descents
        const segmentAngleRad = Math.atan2(newY - prevY, this.segmentWidth);

        const segment = {
            x1: prevX, y1: prevY,
            x2: prevX + this.segmentWidth, y2: newY,
            color: Math.random() < 0.5 ? this.neonBlue : this.neonPink,
            angle: segmentAngleRad,
            bodies: [] // Track associated physics bodies for later cleanup
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
                    label   : 'terrain',
                    segmentId: this.terrainSegments.length - 1 // Associate with segment for cleanup
                }
            );

            body.terrainAngle = body.angle; // store for collision callback
            segment.bodies.push(body); // Store reference to body for cleanup
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
    // manageTerrain (with proper physics body cleanup)
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
        
        // Track segments to be removed
        const segmentsToRemove = [];
        
        // Identify segments to remove
        let i = 0;
        while (i < this.terrainSegments.length && 
               this.terrainSegments[i].x2 < removeThresholdX) {
            segmentsToRemove.push(this.terrainSegments[i]);
            i++;
        }
        
        // Remove the identified segments
        if (segmentsToRemove.length > 0) {
            // Remove physics bodies for each segment
            segmentsToRemove.forEach(segment => {
                if (segment.bodies) {
                    segment.bodies.forEach(body => {
                        this.matter.world.remove(body);
                    });
                }
            });
            
            // Remove visual segments
            this.terrainSegments.splice(0, segmentsToRemove.length);
        }
    }

    // Safe pre-update that runs before the main update cycle
    // This will clean up any objects that need to be removed
    safePreUpdate() {
        try {
            // Make sure our collectibles array is valid
            if (!this.lifeCollectibles) {
                this.lifeCollectibles = [];
            }
            
            // Filter out any invalid collectibles
            this.lifeCollectibles = this.lifeCollectibles.filter(item => {
                return item && !item.destroyed && !item.isBeingDestroyed;
            });
        } catch (error) {
            console.error('Error in safePreUpdate:', error);
        }
    }
    
    // ------------------------------------------------------------------------
    // UPDATE  (Arcade‑style controls translated to Matter)
    // ------------------------------------------------------------------------
    update(time, delta) {
        // Safety check - if we're missing critical objects, don't proceed with update
        if (!this.scene || !this.scene.isActive || !this.player || !this.player.body) {
            return;
        }
        
        const Body = Phaser.Physics.Matter.Matter.Body;
        
        // Update our Manette input controller
        this.manette.update();

        // Handle walk mode transitions (use only this.manette.walkMode)
        if (this.manette.isActionActive('toggleWalkMode')) {
            if (this.manette.walkMode) {
                // Just switched to walk mode
                console.log('Entered walk mode');
                this.isTucking = false;
                this.isParachuting = false;
                this.isDragging = false;
                this.isAirBraking = false;
                // Reset sled position for walk mode
                if (this.player && this.player.getChildren) {
                    const sled = this.player.getChildren()[1];
                    if (sled) {
                        sled.y = this.sledOriginalY;
                        sled.x = -this.sledDistance; // Position sled behind player
                    }
                }
                // Force immediate HUD update
                this.updateHudText();
            } else {
                // Just switched back to sled mode
                console.log('Entered sled mode');
                // Reset sled position for sled mode
                if (this.player && this.player.getChildren) {
                    const sled = this.player.getChildren()[1];
                    if (sled) {
                        sled.y = this.sledOriginalY;
                        sled.x = this.sledOriginalX;
                    }
                }
                // Force immediate HUD update
                this.updateHudText();
            }
        }

        // Detect transitions between ground and air states
        const groundStateChanged = this.prevGroundState !== this.onGround;
        if (groundStateChanged) {
            // Cancel any active tricks when transitioning between ground/air
            if (this.isTucking || this.isParachuting || this.isDragging || this.isAirBraking) {
                this.isTucking = false;
                this.isParachuting = false;
                this.isDragging = false;
                this.isAirBraking = false;
                
                // Reset sled position if we were doing a trick that moved it
                if (this.player && this.player.getChildren) {
                    const sled = this.player.getChildren()[1]; // The sled is the second child
                    if (sled) {
                        sled.y = this.sledOriginalY;
                        sled.x = this.sledOriginalX;
                    }
                }
            }
            // Update previous state for next frame
            this.prevGroundState = this.onGround;
        }

        // --------------------------------------------------------------------
        // INPUT – rotation control using Manette
        // --------------------------------------------------------------------
        const groundRotVel = 0.05;  // ~deg/s in rad Units
        const airRotVel    = 0.10;
        const pushForce    = 0.002; // tune to taste

        // Original left/right controls for pushing and rotating on ground
        if (this.cursors.left.isDown) {
            // Only apply rotation on ground (not in air)
            if (this.onGround) {
                Body.setAngularVelocity(this.player.body, -groundRotVel);
            }

            // Apply force with speed multiplier when on ground
            const leftForce = this.onGround ? 
                -pushForce * this.currentSpeedMultiplier : // Apply multiplier on ground
                -pushForce * 0.5;                        // Reduced in air (no multiplier)
                
            Body.applyForce(this.player.body,
                this.player.body.position,
                { x: leftForce, y: 0 });
        }
        else if (this.cursors.right.isDown) {
            // Only apply rotation on ground (not in air)
            if (this.onGround) {
                Body.setAngularVelocity(this.player.body, groundRotVel);
            }

            // Apply force with speed multiplier when on ground
            const rightForce = this.onGround ? 
                pushForce * this.currentSpeedMultiplier : // Apply multiplier on ground
                pushForce * 0.5;                        // Reduced in air (no multiplier)
                
            Body.applyForce(this.player.body,
                this.player.body.position,
                { x: rightForce, y: 0 });
        }
        
        // --------------------------------------------------------------------
        // WALKING MODE - Tab or L1 toggles between walking and sledding
        // --------------------------------------------------------------------
        if (this.manette.isWalkMode()) {
            // We're in walking mode
            const walkSpeed = 1.5; // Constant walking speed
            
            // Reset velocities for more precise control
            Body.setVelocity(this.player.body, {
                x: 0,
                y: this.player.body.velocity.y // Keep vertical velocity for gravity
            });
            
            // Move left with A key or left stick
            if (this.manette.isActionActive('walkLeft')) {
                Body.translate(this.player.body, { x: -walkSpeed, y: 0 });
            }
            
            // Move right with D key or right stick
            if (this.manette.isActionActive('walkRight')) {
                Body.translate(this.player.body, { x: walkSpeed, y: 0 });
            }
            
            // Tiny jump in walk mode
            if (this.manette.isActionActive('jump') && this.onGround) {
                Body.setVelocity(this.player.body,
                    { x: this.player.body.velocity.x, y: -3 }); // Smaller jump
                this.onGround = false;
            }
            
            // Make the player upright when walking
            const targetAngle = 0; // Upright
            Body.setAngle(this.player.body, targetAngle);
            Body.setAngularVelocity(this.player.body, 0);
            
            // Make the sled follow the player on an invisible string
            if (this.player && this.player.getChildren) {
                const sled = this.player.getChildren()[1]; // The sled is the second child
                if (sled) {
                    // Position the sled behind the player with a slight lag effect
                    sled.x = -this.sledDistance;
                    
                    // If on ground, make sled stay on ground, otherwise let it follow player's Y
                    if (this.onGround) {
                        sled.y = this.sledOriginalY;
                    }
                }
            }
            
            // Skip other control handlers when in walk mode
            return;
        }
        
        // --------------------------------------------------------------------
        // TRICK ACTION - D key/right on left stick (normal sled mode)
        // --------------------------------------------------------------------
        // Handle tuck or parachute trick based on ground state
        if (this.manette.isActionActive('trickAction')) {
            if (this.onGround) {
                // TUCKING - on ground for speed boost
                this.isTucking = true;
                
                // Apply additional forward force while tucking
                // Use the current speed multiplier for added boost when landing tricks
                const tuckBoostForce = 0.003 * this.currentSpeedMultiplier; 
                Body.applyForce(this.player.body,
                    this.player.body.position,
                    { x: tuckBoostForce, y: 0 });
            } else {
                // PARACHUTE TRICK - in air
                this.isParachuting = true;
                
                // Move the sled up for parachute trick visual
                if (this.player && this.player.getChildren) {
                    const playerHeight = 50; // Use same value as in create()
                    const sled = this.player.getChildren()[1]; // The sled is the second child
                    if (sled) {
                        // Move sled 1.25 player-heights up
                        sled.y = this.sledOriginalY - (playerHeight * 1.25);
                    }
                }
                
                // Reduce gravity effect while parachuting
                Body.applyForce(this.player.body,
                    this.player.body.position,
                    { x: 0, y: -0.1 }); // Small upward force to simulate floating
                
                // Preserve horizontal velocity
                const currentVelocity = this.player.body.velocity;
                const horizontalPreservation = 1.01; // Almost no horizontal drag
                Body.setVelocity(this.player.body, {
                    x: currentVelocity.x * horizontalPreservation,
                    y: currentVelocity.y
                });
            }
        } else {
            // Reset trick states when button released
            if (this.isTucking) {
                this.isTucking = false;
            }
            
            if (this.isParachuting) {
                this.isParachuting = false;
                
                // Reset sled position
                if (this.player && this.player.getChildren) {
                    const sled = this.player.getChildren()[1]; // The sled is the second child
                    if (sled) {
                        sled.y = this.sledOriginalY;
                    }
                }
            }
        }
        
        // --------------------------------------------------------------------
        // BRAKE ACTION - A key/left on left stick
        // --------------------------------------------------------------------
        // Handle drag or airbrake based on ground state
        if (this.manette.isActionActive('brakeAction')) {
            if (this.onGround) {
                // DRAGGING - on ground for slight speed reduction
                this.isDragging = true;
                
                // Apply backward force to slow down
                const dragForce = 0.1; // Slows speed slightly - tune to taste
                Body.applyForce(this.player.body,
                    this.player.body.position,
                    { x: -dragForce, y: 0 });
            } else {
                // AIRBRAKE TRICK - in air for dramatic speed reduction
                this.isAirBraking = true;
                
                // Move the sled behind the player for airbrake visual
                if (this.player && this.player.getChildren) {
                    const playerWidth = 30; // Use same value as in create()
                    const sled = this.player.getChildren()[1]; // The sled is the second child
                    if (sled) {
                        // Move sled backwards behind the player
                        sled.x = -playerWidth; // Move sled behind player
                    }
                }
                
                // Dramatically reduce horizontal velocity while airbraking (80% reduction per second)
                // Calculate the delta reduction based on frame rate
                const currentVelocity = this.player.body.velocity;
                const reductionRate = 1.2; // 80% reduction per second
                const frameReduction = reductionRate / 60; // Assuming 60fps, adjust per frame
                
                // Calculate new velocity with reduction, but keep a minimum speed
                const minSpeed = 0.1; // Minimum speed to maintain
                let newXVel = currentVelocity.x * (1 - frameReduction);
                
                // Ensure we don't drop below minimum speed in either direction
                if (Math.abs(newXVel) < minSpeed) {
                    newXVel = minSpeed * Math.sign(currentVelocity.x);
                }
                
                Body.setVelocity(this.player.body, {
                    x: newXVel,
                    y: currentVelocity.y
                });
            }
        } else {
            // Reset brake states when button released
            if (this.isDragging) {
                this.isDragging = false;
            }
            
            if (this.isAirBraking) {
                this.isAirBraking = false;
                
                // Reset sled position
                if (this.player && this.player.getChildren) {
                    const sled = this.player.getChildren()[1]; // The sled is the second child
                    if (sled) {
                        sled.x = this.sledOriginalX; // Reset sled horizontal position
                    }
                }
            }
        }
        
        // For air rotation, check input state and apply or reset rotation accordingly
        if (!this.onGround) {
            let deltaRotation = 0;
            
            // W key/left-stick up for counter-clockwise rotation in air
            if (this.manette.isActionActive('rotateCounterClockwise')) {
                Body.setAngularVelocity(this.player.body, -airRotVel);
                deltaRotation = -Phaser.Math.RadToDeg(airRotVel);
            }
            // S key/left-stick down for clockwise rotation in air
            else if (this.manette.isActionActive('rotateClockwise')) {
                Body.setAngularVelocity(this.player.body, airRotVel);
                deltaRotation = Phaser.Math.RadToDeg(airRotVel);
            }
            // If neither rotation key is pressed, stop rotation immediately
            else {
                Body.setAngularVelocity(this.player.body, 0);
            }
            
            // Update rotation system with current state
            const currentAngleDeg = Phaser.Math.RadToDeg(this.player.body.angle);
            this.rotationSystem.update({
                grounded: this.onGround,
                currentAngle: currentAngleDeg,
                deltaRotation: deltaRotation
            });
        }
        // When on ground, reset angular velocity and align to slope
        else if (this.onGround) {
            Body.setAngularVelocity(this.player.body, 0);
            // gently align to slope
            this.playerHitTerrain(this.currentSlopeAngle);
            
            // Update rotation system with current ground state
            const currentAngleDeg = Phaser.Math.RadToDeg(this.player.body.angle);
            this.rotationSystem.update({
                grounded: this.onGround,
                currentAngle: currentAngleDeg,
                deltaRotation: 0
            });
        }

        // --------------------------------------------------------------------
        // JUMP - using space bar only via Manette
        // --------------------------------------------------------------------
        if (this.manette.isActionActive('jump') && this.onGround) {
            Body.setVelocity(this.player.body,
                { x: this.player.body.velocity.x, y: -10 });
            this.onGround = false;
            
            // Reset speed multiplier on jump
            this.currentSpeedMultiplier = 1.0;
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
        // Update HUD every frame
        // --------------------------------------------------------------------
        this.updateHudText();
        
        // --------------------------------------------------------------------
        // Extra life spawning logic - only if we have a valid player
        // --------------------------------------------------------------------
        try {
            if (this.player && this.player.body && this.player.body.position) {
                this.manageExtraLives(time);
            }
        } catch (error) {
            console.error('Error managing extra lives:', error);
        }
        
        // --------------------------------------------------------------------
        // DEBUG HUD
        // --------------------------------------------------------------------
        if (this.debugText) {
            this.debugText.setText([
                `X: ${this.player.x.toFixed(0)},  Y: ${this.player.y.toFixed(0)}`,
                `Vx: ${this.player.body.velocity.x.toFixed(2)}  ` +
                `Vy: ${this.player.body.velocity.y.toFixed(2)}`,
                `Speed: ${Math.abs(this.player.body.velocity.x).toFixed(2)} (${this.currentSpeedMultiplier.toFixed(2)}x)`,
                `Angle: ${Phaser.Math.RadToDeg(this.player.body.angle).toFixed(1)}`,
                `OnGround: ${this.onGround}`,
                `Mode: ${this.manette.walkMode ? 'WALKING' : 'SLEDDING'}`,
                `Tucking: ${this.isTucking}, Parachuting: ${this.isParachuting}`,
                `Dragging: ${this.isDragging}, AirBraking: ${this.isAirBraking}`
            ]);
        }
    }
    
    // Helper method to update the HUD text
    updateHudText() {
        if (this.hudText) {
            const mode = this.manette ? (this.manette.walkMode ? 'WALKING' : 'SLEDDING') : 'UNKNOWN';
            
            // Add flip stats to HUD when in the air
            let hudContent = `MODE: ${mode}`;
            
            // Always show the speed multiplier in sledding mode, for better feedback
            if (!this.manette.walkMode) {
                hudContent += `\nSPEED MULT: ${this.currentSpeedMultiplier.toFixed(2)}x`;
                
                // Add flip stats only when in the air
                if (!this.onGround && this.rotationSystem) {
                    const flipStats = this.rotationSystem.getFlipStats();
                    hudContent += `\nFLIPS: ${flipStats.fullFlips} + ${flipStats.partialFlip.toFixed(2)}`;
                }
            }
            
            this.hudText.setText(hudContent);
        }
    }
    
    // Helper method to update the lives display
    updateLivesDisplay() {
        if (this.livesText) {
            this.livesText.setText(`LIVES: ${this.lives}`);
        }
    }
    
    // Helper to collect an extra life - COMPLETELY REWRITTEN
    collectExtraLife(collider) {
        // Check if the collider is valid
        if (!collider) {
            console.warn('Attempted to collect invalid life object');
            return;
        }
        
        // Find the sprite object associated with this collider
        let sprite = null;
        let collectibleIndex = -1;
        
        // First safely find the sprite and index in our array
        try {
            if (collider.gameObject) {
                sprite = collider.gameObject;
            } else {
                // If there's no direct reference, try to find it in our array
                for (let i = 0; i < this.lifeCollectibles.length; i++) {
                    const item = this.lifeCollectibles[i];
                    if (item && item.collider === collider) {
                        sprite = item;
                        collectibleIndex = i;
                        break;
                    }
                }
            }
        } catch (error) {
            console.error('Error finding sprite for collectible:', error);
        }
        
        // Only collect if we're not at max lives
        if (this.lives < this.maxLives) {
            // Increase lives count
            this.lives++;
            this.updateLivesDisplay();
            
            try {
                // Get position for effect
                let effectX = this.player.x;
                let effectY = this.player.y;
                
                // Use sprite position if available
                if (sprite && typeof sprite.x !== 'undefined') {
                    effectX = sprite.x;
                    effectY = sprite.y;
                } 
                // Or use collider position if available
                else if (collider.position) {
                    effectX = collider.position.x;
                    effectY = collider.position.y;
                }
                
                // Visual feedback for collecting a life
                const collectEffect = this.add.circle(
                    effectX, effectY, 30, 0xffff00, 0.7
                );
                
                // Simple animation for collection effect
                this.tweens.add({
                    targets: collectEffect,
                    scale: 2,
                    alpha: 0,
                    duration: 300,
                    onComplete: () => {
                        if (collectEffect && !collectEffect.destroyed) {
                            collectEffect.destroy();
                        }
                    }
                });
                
                // Update timing variables
                this.lastLifeCollectTime = this.time.now;
                // Next life available between 30 seconds and 2 minutes
                const nextDelay = Phaser.Math.Between(30000, 120000);
                this.nextLifeAvailableTime = this.time.now + nextDelay;
                
                // Safe cleanup of the physics body
                if (this.matter && this.matter.world && collider) {
                    try {
                        this.matter.world.remove(collider);
                    } catch (e) {
                        console.warn('Error removing collider:', e);
                    }
                }
                
                // Safe removal from our array
                if (collectibleIndex >= 0) {
                    this.lifeCollectibles.splice(collectibleIndex, 1);
                } else {
                    this.lifeCollectibles = this.lifeCollectibles.filter(item => {
                        return item !== sprite && item.collider !== collider;
                    });
                }
                
                // Finally destroy the sprite object if it exists
                if (sprite && !sprite.destroyed) {
                    try {
                        sprite.destroy();
                    } catch (e) {
                        console.warn('Error destroying sprite:', e);
                    }
                }
                
                console.log('Successfully collected extra life. Lives:', this.lives);
            } catch (error) {
                console.error('Error in collectExtraLife:', error);
            }
        }
    }
    
    // Helper to manage extra life collectibles - SIMPLIFIED
    manageExtraLives(currentTime) {
        // Multiple safety checks to avoid crashing
        if (!this.scene || !this.scene.isActive || !this.scene.isActive()) {
            return; // Exit if the scene isn't active
        }
        
        if (!this.player || !this.player.body || !this.player.body.position) {
            return; // Exit early if player doesn't exist or isn't initialized
        }
        
        try {
            // Initialize the collectibles array if needed
            if (!this.lifeCollectibles) {
                this.lifeCollectibles = [];
            }
            
            // Clean up off-screen collectibles (safely)
            this.cleanupOffscreenCollectibles();
            
            // Only spawn if conditions are all met
            const canSpawn = currentTime > this.nextLifeAvailableTime && 
                           Array.isArray(this.lifeCollectibles) && 
                           this.lifeCollectibles.length < 2 && 
                           this.lives < this.maxLives;
                           
            if (canSpawn) {
                // Only spawn with a 20% chance each cycle - prevents too many spawns
                if (Math.random() < 0.2) {
                    console.log('Spawning new extra life collectible');
                    this.spawnExtraLife();
                    // Update next available time regardless of successful spawn
                    this.nextLifeAvailableTime = currentTime + Phaser.Math.Between(30000, 120000);
                }
            }
        } catch (error) {
            console.error('Error in manageExtraLives:', error);
            // Reset collectibles array if there was an error
            this.lifeCollectibles = [];
        }
    }
    
    // Helper to clean up off-screen collectibles - COMPLETELY REWRITTEN FOR SAFETY
    cleanupOffscreenCollectibles() {
        if (!this.cameras || !this.cameras.main || !this.player) {
            return; // Exit if cameras or player aren't initialized
        }
        
        // Reset the array if it's not valid
        if (!this.lifeCollectibles || !Array.isArray(this.lifeCollectibles)) {
            this.lifeCollectibles = []; 
            return;
        }
        
        try {
            // Instead of checking positions which might cause errors,
            // we'll simply remove collectibles that have been around too long
            const maxDistance = 3000; // Maximum distance from player in any direction
            const playerPos = this.player.body ? this.player.body.position : { x: 0, y: 0 };
            
            // Create a new filtered array instead of modifying the existing one
            const newCollectibles = [];
            
            // Process each collectible safely
            for (let i = 0; i < this.lifeCollectibles.length; i++) {
                const collectible = this.lifeCollectibles[i];
                
                // Skip invalid collectibles
                if (!collectible || collectible.destroyed || collectible.isBeingDestroyed) {
                    continue;
                }
                
                // Safe distance check - if we can't get position, remove it
                let keepCollectible = true;
                try {
                    // Only attempt to check position if the object exists and has these properties
                    if (collectible.body && collectible.body.position) {
                        const dx = collectible.body.position.x - playerPos.x;
                        const dy = collectible.body.position.y - playerPos.y;
                        const distanceSquared = dx * dx + dy * dy;
                        
                        // Remove if too far from player
                        if (distanceSquared > maxDistance * maxDistance) {
                            keepCollectible = false;
                        }
                    } else if (collectible.x !== undefined && collectible.y !== undefined) {
                        // Fallback to direct x/y if they exist
                        const dx = collectible.x - playerPos.x;
                        const dy = collectible.y - playerPos.y;
                        const distanceSquared = dx * dx + dy * dy;
                        
                        // Remove if too far from player
                        if (distanceSquared > maxDistance * maxDistance) {
                            keepCollectible = false;
                        }
                    } else {
                        // No valid position properties, remove it
                        keepCollectible = false;
                    }
                } catch (e) {
                    // If any error occurs while checking position, remove the collectible
                    keepCollectible = false;
                }
                
                // Process the collectible
                if (keepCollectible) {
                    newCollectibles.push(collectible);
                } else {
                    // Safely remove the collectible
                    try {
                        // Remove physics body if it exists
                        if (collectible.body && this.matter && this.matter.world) {
                            this.matter.world.remove(collectible.body);
                        }
                        
                        // Mark as being destroyed to prevent other code from using it
                        collectible.isBeingDestroyed = true;
                        
                        // Kill any tweens associated with this object
                        if (this.tweens) {
                            this.tweens.killTweensOf(collectible);
                        }
                        
                        // Finally destroy the object
                        collectible.destroy();
                    } catch (destroyError) {
                        console.warn('Error safely destroying collectible:', destroyError);
                    }
                }
            }
            
            // Replace the old array with our new filtered array
            this.lifeCollectibles = newCollectibles;
        } catch (error) {
            console.error('Error in cleanupOffscreenCollectibles:', error);
            // Reset the array to be safe
            this.lifeCollectibles = [];
        }
    }
    
    // Helper to spawn an extra life collectible - COMPLETELY REWRITTEN
    spawnExtraLife() {
        // Make sure player exists and has a valid position
        if (!this.player || !this.player.body || !this.player.body.position) {
            console.warn('Cannot spawn extra life: player position is invalid');
            return null;
        }
        
        try {
            // Get player position safely
            const playerPos = this.player.body.position;
            
            // Calculate a safe position in front of the player
            // Use a simple offset rather than calculating exact positions
            const spawnX = playerPos.x + 600; // Always 600px ahead
            const spawnY = playerPos.y;       // Same level as player
            
            // Create our fallback texture if needed
            if (!this.textures.exists('extraLife')) {
                this.createExtraLifeTexture();
            }
            
            // Create static sprite instead of physics object - MUCH SAFER
            const lifeCollectible = this.add.sprite(spawnX, spawnY, 'extraLife');
            
            // Scale to appropriate size
            lifeCollectible.setScale(0.5);
            
            // Set depth to ensure it appears above terrain
            lifeCollectible.setDepth(10);
            
            // Add simple circular collision area
            const collider = this.matter.add.circle(spawnX, spawnY, 20, {
                isSensor: true,
                isExtraLife: true,
                label: 'extraLife'
            });
            
            // Store references to link the sprite and physics body
            lifeCollectible.collider = collider;
            collider.gameObject = lifeCollectible;
            
            // No tweens! Just set basic properties
            lifeCollectible.isExtraLife = true;
            
            // Add to our tracking array
            if (!this.lifeCollectibles) {
                this.lifeCollectibles = [];
            }
            this.lifeCollectibles.push(lifeCollectible);
            
            // Add an update listener to this specific collectible
            this.events.on('update', () => {
                // If the sprite still exists, update its position to match the collider
                if (lifeCollectible && !lifeCollectible.destroyed && collider && collider.position) {
                    try {
                        lifeCollectible.x = collider.position.x;
                        lifeCollectible.y = collider.position.y;
                    } catch (e) {
                        // If there's an error, we'll handle cleanup in the next cycle
                    }
                }
            });
            
            console.log('Successfully spawned extra life collectible');
            return lifeCollectible;
        } catch (error) {
            console.error('Error spawning extra life:', error);
            return null;
        }
    }
    
    // Helper to create the extraLife texture
    createExtraLifeTexture() {
        try {
            // Create a fallback texture
            const graphics = this.make.graphics({x: 0, y: 0, add: false});
            graphics.fillStyle(0xff00ff, 1); // Neon pink
            graphics.lineStyle(4, 0xffffff, 1); // White border
            graphics.fillCircle(32, 32, 25);
            graphics.strokeCircle(32, 32, 25);
            // Add a heart shape
            graphics.fillStyle(0xffffff, 1);
            graphics.fillCircle(24, 24, 8);
            graphics.fillCircle(40, 24, 8);
            graphics.fillTriangle(16, 30, 48, 30, 32, 45);
            
            // Generate a texture from the graphics object
            graphics.generateTexture('extraLife', 64, 64);
            console.log('Created fallback extraLife texture');
        } catch (error) {
            console.error('Error creating extraLife texture:', error);
        }
    }
}

/**
 * Helper method to apply a passive speed boost based on the current multiplier.
 * This makes the speed boost from landing tricks feel more impactful.
 */
GameScene.prototype.applyPassiveSpeedBoost = function() {
    // Only apply when on ground, not in walking mode, and player is moving
    if (this.onGround && !this.manette.walkMode && this.player && this.player.body) {
        const Body = Phaser.Physics.Matter.Matter.Body;
        const velocity = this.player.body.velocity;
        
        // Only apply boost when moving at a decent speed and multiplier is above base
        if (Math.abs(velocity.x) > 0.5 && this.currentSpeedMultiplier > 1.0) {
            const direction = Math.sign(velocity.x); // -1 for left, 1 for right
            const boostStrength = 0.0003 * (this.currentSpeedMultiplier - 1.0) * Math.abs(velocity.x);
            
            // Apply a small force in the direction of movement
            Body.applyForce(this.player.body,
                this.player.body.position,
                { x: direction * boostStrength, y: 0 });
        }
    }
};

/**
 * Helper method to apply a passive speed boost based on the current multiplier.
 * This makes the speed boost from landing tricks feel more impactful.
 */
GameScene.prototype.applyPassiveSpeedBoost = function() {
    // Only apply when on ground, not in walking mode, and player is moving
    if (this.onGround && !this.manette.walkMode && this.player && this.player.body) {
        const Body = Phaser.Physics.Matter.Matter.Body;
        const velocity = this.player.body.velocity;
        
        // Only apply boost when moving at a decent speed and multiplier is above base
        if (Math.abs(velocity.x) > 0.5 && this.currentSpeedMultiplier > 1.0) {
            const direction = Math.sign(velocity.x); // -1 for left, 1 for right
            // Scale boost by current speed and multiplier value
            const boostStrength = 0.0002 * (this.currentSpeedMultiplier - 1.0) * Math.abs(velocity.x);
            
            // We debounce here to prevent event flooding during trick chaining
            Body.applyForce(this.player.body,
                this.player.body.position,
                { x: direction * boostStrength, y: 0 });
        }
    }
};

// Class is globally available through script tag loading
