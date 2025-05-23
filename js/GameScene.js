// js/GameScene.js
// README
// THIS IS A LEGACY FILE - DO NOT UPDATE - IT WILL EVENTUALLY BE REMOVED
// ------------------------------------------------------

// Import physics configuration
import PhysicsConfig from './config/physics-config.js';
import Manette from './Manette.js';
import RotationSystem from './utils/RotationSystem.js';
import configLoader from './config/config-loader.js';
import { initializeRandomWithSeed } from './utils/seed-generator.js';

/**
 * @deprecated LEGACY: Original Bitstream Bluffs game scene. DO NOT UPDATE. Will be removed.
 * Uses Phaser 3 with Matter physics. Replaced by ModularGameScene.
 *
 * @extends Phaser.Scene
 */
export default class GameScene extends Phaser.Scene {
    constructor() {
        super({ 
            key: 'GameScene',
            physics: {
                matter: {
                    gravity: { y: 1 },
                    debug: false // Always disable debug visualization 
                }
            }
        });
        
        // Game state flags
        this.gameOverShown = false; // Track if game over has been shown during this run
        
        // Bind methods to ensure 'this' context is preserved
        this.safePreUpdate = this.safePreUpdate.bind(this);
        this.manageExtraLives = this.manageExtraLives.bind(this);
        this.cleanupOffscreenCollectibles = this.cleanupOffscreenCollectibles.bind(this);
        this.handleResize = this.handleResize.bind(this);

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

        // Only UI elements specifically requested are initialized

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
        this.riderOriginalY    = 0;       // to track original rider position
        // UI elements
        this.speedText = null;        // Top left - Speed display
        this.altitudeDropText = null; // Top left - Altitude drop display
        this.pointsText = null;       // Top middle - Points display
        this.livesDisplay = null;     // Top right - Lives triangles container
        this.toastContainer = null;   // Bottom - Toast messages for tricks
        this.initialY = 0;           // Track initial Y position at start of run for altitude drop
        
        // --- extra lives system -----------------------------------------------
        this.lives              = PhysicsConfig.extraLives.initialLives;  // start with configured initial lives
        this.maxLives           = PhysicsConfig.extraLives.maxLives;      // maximum number of lives
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
        console.log('Scene create method started - initializing game');
        
        // Initialize with the seed from StartScene if available
        if (window.gameSeed) {
            console.log('Using game seed:', window.gameSeed);
            // Create a seeded random function
            this.seededRandom = initializeRandomWithSeed(window.gameSeed);
        } else {
            console.warn('No game seed found, using default Math.random');
            // Fallback to standard Math.random
            this.seededRandom = Math.random;
        }
        // Reset core game variables to prevent issues on restart
        this.lives = PhysicsConfig.extraLives.initialLives;
        this.lastTerrainY = 500; // Reset terrain starting point
        this.terrainSegments = [];
        this.gameOverShown = false; // Reset game over flag on scene create
        
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
        
        // Store the original rider position for mode transitions
        this.riderOriginalY = riderY;

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
        
        // Store a reference to the sled and rider for easier access
        this.sled = sled;
        this.rider = rider;

        // No debug visualization as per UI requirements

        // create container and convert it to Matter
        this.player = this.add.container(200, 100,
            [sled, rider]);

        // Set initial sled visibility based on walk mode
        if (this.manette && this.manette.walkMode) {
            sled.visible = false; // Hide sled initially if in walking mode
        }

        // add a circular Matter body to the container
        const Bodies = Phaser.Physics.Matter.Matter.Bodies;
        const playerBody = Bodies.circle(0, 0, circleRadius, {
            restitution: PhysicsConfig.player.restitution,
            friction: PhysicsConfig.player.friction,       // Friction from config
            frictionAir: PhysicsConfig.player.frictionAir, // Air friction from config
            density: PhysicsConfig.player.density          // Density from config
        });

        this.matter.add.gameObject(this.player);
        this.player.setExistingBody(playerBody)
                   .setFixedRotation(false)      // allow spins for tricks
                   .setPosition(200, 100);       // re‑centre after body attach

        // camera follow stays the same
        this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
        this.cameras.main.setFollowOffset(0, 100);
        
        // Initialize UI elements
        
        // Top left - Speed display
        this.speedText = this.add.text(
            10, 10, 
            'Speed: 0.00', 
            {
                font: '18px Arial',
                fill: '#00ffff',  // Neon blue
                stroke: '#000000',
                strokeThickness: 4
            }
        ).setScrollFactor(0).setDepth(100);
        
        // Top left - Altitude drop display (below speed)
        this.altitudeDropText = this.add.text(
            10, 40, 
            'Altitude Drop: 0.00', 
            {
                font: '18px Arial',
                fill: '#00ffff',  // Neon blue
                stroke: '#000000',
                strokeThickness: 4
            }
        ).setScrollFactor(0).setDepth(100);
        
        // Top middle - Points display
        this.pointsText = this.add.text(
            this.cameras.main.width / 2, 10, 
            'Points: 0', 
            {
                font: '20px Arial',
                fill: '#ff00ff',  // Neon pink
                stroke: '#000000',
                strokeThickness: 4
            }
        ).setScrollFactor(0).setDepth(100).setOrigin(0.5, 0); // Center horizontally
        
        // Top right - Lives as yellow triangles
        this.livesDisplay = this.add.graphics().setScrollFactor(0).setDepth(100);
        // Position in the top-right corner with some padding
        this.livesDisplay.x = this.cameras.main.width - 100;
        this.livesDisplay.y = 20;
        
        // Bottom - Toast container for trick announcements
        this.toastContainer = this.add.container(0, 0).setScrollFactor(0).setDepth(100);

        // Initialize time-based variables for extra life spawning
        this.lastLifeCollectTime = this.time.now;
        this.nextLifeAvailableTime = this.time.now + Phaser.Math.Between(2000, 5000); // Initial spawn between 2-5 seconds

        // --------------------------------------------------------------------
        // TERRAIN  (now Matter static rectangles)
        // --------------------------------------------------------------------
        this.terrainGraphics = this.add.graphics();
        console.log(`Initial terrain generation. First segment from Y: ${this.lastTerrainY}`);

        // Generate initial terrain - ensure we have a solid platform to start on
        for (let i = 0; i < 25; i++) {
            this.generateNextTerrainSegment(i === 0);
        }
        this.drawTerrain();
        console.log(`${this.terrainSegments.length} terrain segments generated.`);
        
        // Verify player position is above terrain
        if (this.terrainSegments.length > 0) {
            const firstSegment = this.terrainSegments[0];
            // Ensure player is positioned correctly above the first terrain segment
            const playerY = firstSegment.y1 - 50; // Position above the terrain with padding
            console.log(`Positioning player at Y: ${playerY}, terrain at Y: ${firstSegment.y1}`);
            this.player.setPosition(200, playerY);
        } else {
            console.warn('No terrain segments available for initial player positioning');
        }

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
        // Initialize our toast system for trick announcements
        this.initToastSystem();
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
                    
                    // Force player into walking mode when they lose a life
                    if (!this.manette.walkMode) {
                        this.manette.walkMode = true;
                        // Hide the sled when entering walk mode
                        if (this.sled) {
                            this.sled.visible = false;
                        }
                        this.showToast('Walking Mode Activated', 2000);
                        console.log('Forced into walking mode after losing a life');
                    }
                    
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
                } else if (!this.gameOverShown) {
                    // No lives left and game over hasn't been shown yet
                    console.log('No lives left, preparing to restart scene...');
                    this.gameOverShown = true; // Mark as shown to prevent multiple displays
                    
                    // Create explosion effect for the player and sled
                    this.createPlayerExplosionEffect();
                    
                    // Show game over feedback before restarting, centered on player
                    const gameOverText = this.add.text(
                        this.player.x,
                        this.player.y - 100, // Position above player
                        'GAME OVER', 
                        {
                            fontFamily: '"Press Start 2P"',
                            fontSize: '28px',
                            fill: '#ff0000',
                            stroke: '#000000',
                            strokeThickness: 4
                        }
                    ).setDepth(100).setOrigin(0.5);
                    
                    // Add flash effect centered on player
                    const flashRect = this.add.rectangle(
                        this.player.x,
                        this.player.y,
                        this.cameras.main.width,
                        this.cameras.main.height,
                        0xff0000, 0.4
                    ).setDepth(90);
                    
                    // Make effects follow the player
                    this.tweens.add({
                        targets: [gameOverText, flashRect],
                        alpha: { from: 1, to: 0.7, yoyo: true, repeat: 3 },
                        duration: 300
                    });
                    
                    this.time.delayedCall(1500, () => {
                        // Proper cleanup before returning to start screen
                        this.cleanupBeforeRestart();
                        // Go back to StartScene instead of restarting
                        this.scene.start('StartScene');
                    });
                }
            },
            onWobble: () => {
                console.log('Wobble landing!');
                // Reduce speed on wobble
                const Body = Phaser.Physics.Matter.Matter.Body;
                const currentVel = this.player.body.velocity;
                Body.setVelocity(this.player.body, {
                    x: currentVel.x * PhysicsConfig.tricks.wobbleLandingSpeedFactor, 
                    y: currentVel.y 
                });
                this.currentSpeedMultiplier = 1.0;
            },
            onFlipComplete: (fullFlips, partialFlip) => {
                console.log(`Flip complete! ${fullFlips} + ${partialFlip.toFixed(2)}`);
                
                // Show a toast notification for completed flips
                if (fullFlips > 0 || partialFlip > 0.25) {
                    let message = '';
                    
                    if (fullFlips > 0) {
                        // Full flip message
                        message = `${fullFlips}x Flip`;
                        if (fullFlips > 1) message += 's';
                        
                        // Add partial if significant
                        if (partialFlip > 0.25) {
                            message += ` + ${(partialFlip * 360).toFixed(0)}°`;
                        }
                    } else if (partialFlip > 0.25) {
                        // Only partial rotation
                        message = `${(partialFlip * 360).toFixed(0)}° Rotation`;
                    }
                    
                    // Show the toast
                    this.showToast(message);
                }
            }
        });

        // No debug HUD as per UI requirements
        
        // Apply a passive boost to maintain momentum when a speed multiplier is active
        this.time.addEvent({
            delay: 100, // execute 10 times per second
            callback: this.applyPassiveSpeedBoost,
            callbackScope: this,
            loop: true
        });

        console.log("GameScene setup complete (Matter edition).");

        // Set up the resize handler
        this.game.events.on('resize', this.handleResize, this);
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
            this.player.setAngle(currentDeg + diff * PhysicsConfig.rotation.slopeAlignmentFactor);
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
            // Use seeded random if available, otherwise fallback to Math.random
            const r = this.seededRandom ? this.seededRandom() : Math.random();
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
            // Use seeded random for color selection
            color: (this.seededRandom ? this.seededRandom() : Math.random()) < 0.5 ? this.neonBlue : this.neonPink,
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
        
        // Apply a gentle downhill bias force when on ground to prevent sticking
        if (this.onGround && !this.manette.walkMode && this.player.body) {
            // Determine direction from player angle
            const playerAngleRad = this.player.rotation;
            // Apply a small force in the downhill direction
            const downhillForce = PhysicsConfig.movement.downhillBiasForce;
            Body.applyForce(this.player.body,
                this.player.body.position,
                { 
                    x: Math.sin(playerAngleRad) * downhillForce,
                    y: Math.cos(playerAngleRad) * downhillForce 
                });
        }
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
                // Reset sled position for walk mode and hide it
                if (this.player && this.sled) {
                    this.sled.visible = false; // Hide the sled in walking mode
                    this.sled.x = -this.sledDistance; // Position behind player
                }
                
                // Move the rider down in walking mode based on config
                if (this.rider) {
                    this.rider.y = this.riderOriginalY + PhysicsConfig.walkMode.riderYOffset; // Move down by configured amount
                }
            } else {
                // Just switched back to sled mode
                console.log('Entered sled mode');
                // Reset sled position for sled mode and show it
                if (this.player && this.sled) {
                    this.sled.visible = true; // Show the sled in sledding mode
                    this.sled.x = this.sledOriginalX; // Restore original position
                    this.sled.y = this.sledOriginalY; // Ensure correct Y position
                }
                
                // Move the rider back to original position in sledding mode
                if (this.rider) {
                    this.rider.y = this.riderOriginalY; // Reset to original Y position
                }
            }
            // Force immediate HUD update
            this.updateHudText();
        }

        // Detect transitions between ground and air states
        const groundStateChanged = this.prevGroundState !== this.onGround;
        if (groundStateChanged) {
            // ...
            // Cancel any active tricks when transitioning between ground/air
            if (this.isTucking || this.isParachuting || this.isDragging || this.isAirBraking) {
                this.isTucking = false;
                this.isParachuting = false;
                this.isDragging = false;
                this.isAirBraking = false;
                
                // Reset sled position if we were doing a trick that moved it
                if (this.player && this.player.getChildren) {
                    // Use our direct sled reference
                    if (this.sled) {
                        this.sled.y = this.sledOriginalY;
                        this.sled.x = this.sledOriginalX;
                        this.sled.visible = !this.manette.walkMode; // Show sled only in sledding mode
                    }
                }
            }
            // Update previous state for next frame
            this.prevGroundState = this.onGround;
        }

        // --------------------------------------------------------------------
        // INPUT – rotation control using Manette
        // --------------------------------------------------------------------
        const groundRotVel = PhysicsConfig.rotation.groundRotationVel; // Ground rotation velocity
        const airRotVel    = PhysicsConfig.rotation.airRotationVel;    // Air rotation velocity
        const pushForce    = PhysicsConfig.movement.pushForce;         // Push force for movement

        // Original left/right controls for pushing and rotating on ground
        if (this.cursors.left.isDown) {
            // Only apply rotation on ground (not in air)
            if (this.onGround) {
                Body.setAngularVelocity(this.player.body, -groundRotVel);
            }

            // Apply force with speed multiplier when on ground
            const leftForce = this.onGround ? 
                -pushForce * this.currentSpeedMultiplier : // Apply multiplier on ground
                -pushForce * PhysicsConfig.movement.airPushMultiplier; // Reduced in air by configured multiplier
                
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
                pushForce * PhysicsConfig.movement.airPushMultiplier; // Reduced in air by configured multiplier
                
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
                    { x: this.player.body.velocity.x, y: PhysicsConfig.jump.walkJumpVelocity }); // Walk mode jump
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
                if (!this.isTucking) {
                    this.isTucking = true;
                    this.showToast('Speed Boost!', 1500);
                }
                
                // Apply additional forward force while tucking
                // Use the current speed multiplier for added boost when landing tricks
                const tuckBoostForce = 0.003 * this.currentSpeedMultiplier; 
                Body.applyForce(this.player.body,
                    this.player.body.position,
                    { x: tuckBoostForce, y: 0 });
            } else {
                // PARACHUTE TRICK - in air
                if (!this.isParachuting) {
                    this.isParachuting = true;
                    this.showToast('Parachute!', 1500);
                }
                
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
                if (!this.isDragging) {
                    this.isDragging = true;
                    this.showToast('Dragging!', 1500);
                }
                
                // Apply backward force to slow down
                const dragForce = 0.1; // Slows speed slightly - tune to taste
                Body.applyForce(this.player.body,
                    this.player.body.position,
                    { x: -dragForce, y: 0 });
            } else {
                // AIRBRAKE TRICK - in air for dramatic speed reduction
                if (!this.isAirBraking) {
                    this.isAirBraking = true;
                    this.showToast('Air Brake!', 1500);
                }
                
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
                { x: this.player.body.velocity.x, y: PhysicsConfig.jump.jumpVelocity });
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
        
        // HUD is now managed by updateHudText method
        // No debug HUD is displayed
    }
    
    // Helper method to update the HUD text
    updateHudText() {
        if (!this.player || !this.player.body) return;
        
        // Get player speed (absolute value of x velocity)
        const speed = Math.abs(this.player.body.velocity.x).toFixed(2);
        
        // Set initial Y position if not set yet
        if (this.initialY === 0) {
            this.initialY = this.player.y;
        }
        
        // Calculate total altitude drop from start of run
        const currentY = this.player.y;
        const totalAltitudeDrop = Math.max(0, (currentY - this.initialY)).toFixed(2);
        
        // Update speed text
        if (this.speedText) {
            this.speedText.setText(`Speed: ${speed}`);
        }
        
        // Update altitude drop text
        if (this.altitudeDropText) {
            this.altitudeDropText.setText(`Altitude Drop: ${totalAltitudeDrop}`);
        }
        
        // Update points (placeholder for now)
        if (this.pointsText) {
            this.pointsText.setText('Points: 0');
        }
        
        // Update lives display
        this.updateLivesDisplay();
    }
    
    // Helper method to update the lives display with yellow triangles
    updateLivesDisplay() {
        if (!this.livesDisplay) return;
        
        // Clear previous lives display
        this.livesDisplay.clear();
        
        // Get player's current rotation
        const playerRotation = this.player ? this.player.rotation : 0;
        
        // Draw one triangle per life
        const triangleSize = 15;
        const spacing = triangleSize * 2;
        
        for (let i = 0; i < this.lives; i++) {
            // Position each triangle with proper spacing
            const x = i * spacing;
            const y = 0;
            
            // Draw a yellow triangle that mimics the player's rotation
            this.livesDisplay.fillStyle(this.neonYellow, 1);
            this.livesDisplay.beginPath();
            
            // Create triangle points (pointing right by default)
            const points = [
                { x: 0, y: -triangleSize/2 },    // Top point
                { x: triangleSize, y: 0 },        // Right point
                { x: 0, y: triangleSize/2 }       // Bottom point
            ];
            
            // Apply rotation that matches the player
            const rotatedPoints = points.map(point => {
                const rotX = point.x * Math.cos(playerRotation) - point.y * Math.sin(playerRotation);
                const rotY = point.x * Math.sin(playerRotation) + point.y * Math.cos(playerRotation);
                return { x: rotX + x, y: rotY + y };
            });
            
            // Draw the triangle
            this.livesDisplay.moveTo(rotatedPoints[0].x, rotatedPoints[0].y);
            this.livesDisplay.lineTo(rotatedPoints[1].x, rotatedPoints[1].y);
            this.livesDisplay.lineTo(rotatedPoints[2].x, rotatedPoints[2].y);
            this.livesDisplay.closePath();
            this.livesDisplay.fillPath();
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
                // Next life available between min and max time from config
                const nextDelay = Phaser.Math.Between(
                    PhysicsConfig.extraLives.minTimeToNextLife, 
                    PhysicsConfig.extraLives.maxTimeToNextLife
                );
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
                           this.lives < PhysicsConfig.extraLives.maxLives;
                           
            if (canSpawn) {
                // Only spawn with a 20% chance each cycle - prevents too many spawns
                if (Math.random() < 0.2) {
                    console.log('Spawning new extra life collectible');
                    this.spawnExtraLife();
                    // Update next available time regardless of successful spawn
                    this.nextLifeAvailableTime = currentTime + Phaser.Math.Between(
                        PhysicsConfig.extraLives.minTimeToNextLife, 
                        PhysicsConfig.extraLives.maxTimeToNextLife
                    );
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
    
    // Helper to find terrain height at a given X position
    findTerrainHeightAt(xPos) {
        if (!this.terrainSegments || this.terrainSegments.length === 0) {
            return 500; // Default height if no terrain
        }
        
        // Find the terrain segment that contains this X position
        for (let i = 0; i < this.terrainSegments.length; i++) {
            const segment = this.terrainSegments[i];
            if (xPos >= segment.x1 && xPos <= segment.x2) {
                // Found the segment, now interpolate Y based on X position
                const ratio = (xPos - segment.x1) / (segment.x2 - segment.x1);
                const terrainHeight = Phaser.Math.Linear(segment.y1, segment.y2, ratio);
                return terrainHeight;
            }
        }
        
        // If we're beyond the last segment, use the last segment's end point
        const lastSegment = this.terrainSegments[this.terrainSegments.length - 1];
        return lastSegment.y2;
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
            const spawnX = playerPos.x + PhysicsConfig.extraLives.spawnDistance; // Distance from config
            
            // Find the terrain height directly below the spawn point
            const terrainHeight = this.findTerrainHeightAt(spawnX);
            
            // Calculate player sprite height (approximated from player body + sled height)
            const playerSpriteHeight = 50; // Player body height from create() method
            
            // Position powerup above terrain but not too high (less than 7 player sprite heights)
            const maxHeightAboveTerrain = playerSpriteHeight * 6; // Less than 7 sprite heights
            const minHeightAboveTerrain = playerSpriteHeight * 2; // At least 2 sprite heights for safety
            
            // Random height between min and max, but ensure it's at a reasonable height
            const heightAboveTerrain = Phaser.Math.Between(minHeightAboveTerrain, maxHeightAboveTerrain);
            const spawnY = terrainHeight - heightAboveTerrain; // Subtract because Y increases downward
            
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
            
            // Create a STATIC circular collision area that won't be affected by gravity
            const collider = this.matter.add.circle(spawnX, spawnY, PhysicsConfig.extraLives.collectibleRadius, {
                isSensor: true,
                isExtraLife: true,
                label: 'extraLife',
                isStatic: true, // Make it static so it doesn't fall
            });
            
            // Store references to link the sprite and physics body
            lifeCollectible.collider = collider;
            collider.gameObject = lifeCollectible;
            
            // Store original Y position for hover animation
            lifeCollectible.originalY = spawnY;
            
            // Set basic properties
            lifeCollectible.isExtraLife = true;
            
            // Add to our tracking array
            if (!this.lifeCollectibles) {
                this.lifeCollectibles = [];
            }
            this.lifeCollectibles.push(lifeCollectible);
            
            // Calculate hover distance (approximately 3 sprite widths)
            const spriteWidth = PhysicsConfig.extraLives.collectibleRadius * 2;
            const hoverDistance = spriteWidth * 3; // 3 sprite widths as requested
            
            // Instead of tweening the physics body directly (which can cause issues),
            // We'll use a tween on a dummy object and update manually
            const hoverController = { y: 0 };
            
            // Add hover animation with tweens
            this.tweens.add({
                targets: hoverController,
                y: 1,                      // Normalize from 0 to 1 for easier math
                duration: 2000,            // 2 seconds for one direction
                ease: 'Sine.easeInOut',    // Smooth sine wave motion
                yoyo: true,                // Makes it go back down
                repeat: -1,                // Repeat indefinitely
                onUpdate: () => {
                    if (collider && !collider.isStatic) {
                        // If somehow the body became non-static, make it static again
                        this.matter.body.setStatic(collider, true);
                    }
                    
                    if (collider && collider.position && !lifeCollectible.destroyed) {
                        // Calculate Y position based on sine wave (0-1 normalized value)
                        const offset = Math.sin(hoverController.y * Math.PI) * hoverDistance;
                        
                        // Update the static body position directly
                        this.matter.body.setPosition(collider, {
                            x: collider.position.x,
                            y: spawnY - offset
                        });
                        
                        // Update sprite to match collider
                        lifeCollectible.x = collider.position.x;
                        lifeCollectible.y = collider.position.y;
                    }
                }
            });
            
            console.log(`Spawned powerup at X: ${spawnX}, Y: ${spawnY} (${heightAboveTerrain}px above terrain)`);
            return lifeCollectible;
        } catch (error) {
            console.error('Error spawning extra life:', error);
            return null;
        }
    }
    
}

// Helper to create the extraLife texture
GameScene.prototype.createExtraLifeTexture = function() {
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
        
        // Apply a small minimum boost regardless of speed
        const minBoost = PhysicsConfig.movement.minBoostStrength;
        const direction = Math.sign(velocity.x) || 1; // Default to right if no movement
        
        // Add the minimum boost to keep things moving
        Body.applyForce(this.player.body,
            this.player.body.position,
            { x: direction * minBoost, y: 0 });
        
        // Additional boost based on multiplier if moving fast enough
        if (Math.abs(velocity.x) > PhysicsConfig.movement.speedBoostThreshold && this.currentSpeedMultiplier > 1.0) {
            const boostStrength = PhysicsConfig.movement.speedBoostFactor * (this.currentSpeedMultiplier - 1.0) * Math.abs(velocity.x);
            
            // Apply a larger force when we have a speed multiplier
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
        
        // Apply a minimum boost to keep the player moving even at base speed
        const minBoostStrength = 0.00015; // Small minimum boost
        
        // Direction of movement
        const direction = Math.sign(velocity.x); // -1 for left, 1 for right
        
        // If we have a speed multiplier, apply a stronger boost
        if (Math.abs(velocity.x) > 0.3 && this.currentSpeedMultiplier > 1.0) {
            // Scale boost by current speed and multiplier value
            const multiplierBoost = 0.00025 * (this.currentSpeedMultiplier - 1.0) * Math.abs(velocity.x);
            
            // Apply the boost
            Body.applyForce(this.player.body,
                this.player.body.position,
                { x: direction * (minBoostStrength + multiplierBoost), y: 0 });
        } else if (Math.abs(velocity.x) > 0.1) {
            // Even without a multiplier, apply the minimum boost
            Body.applyForce(this.player.body,
                this.player.body.position,
                { x: direction * minBoostStrength, y: 0 });
        }
    }
};

// Handle window resizing
GameScene.prototype.handleResize = function({ width, height }) {
    // Skip if cameras aren't initialized yet
    if (!this.cameras || !this.cameras.main) return;
    
    console.log(`Handling resize: ${width}x${height}`);
    
    // Adjust camera bounds
    this.cameras.main.setSize(width, height);
    
    // Adjust camera bounds to follow player with appropriate padding
    const worldBounds = this.physics.world.bounds;
    if (this.player && this.player.body) {
        // Ensure camera follows the player properly with the new dimensions
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
        
        // Set appropriate deadzone based on screen size
        const horizontalDeadzone = width * 0.3;
        const verticalDeadzone = height * 0.3;
        this.cameras.main.setDeadzone(horizontalDeadzone, verticalDeadzone);
    }
    
    // Reposition UI elements if they exist
    if (this.speedText) {
        this.speedText.setPosition(10, 10);
    }
    
    if (this.altitudeDropText) {
        this.altitudeDropText.setPosition(10, 40);
    }
    
    if (this.pointsText) {
        this.pointsText.setPosition(width / 2, 10);
        this.pointsText.setOrigin(0.5, 0); // Center horizontally
    }
    
    if (this.livesDisplay) {
        this.livesDisplay.x = width - 100;
        this.livesDisplay.y = 20;
    }
    
    if (this.toastContainer) {
        // Reposition toast container at bottom center
        this.positionToastContainer();
    }
    
    // No debug text to position
    
    // Redraw terrain if needed
    this.drawTerrain();
};

// Helper to properly clean up before scene restart
GameScene.prototype.cleanupBeforeRestart = function() {
    console.log('Cleaning up before scene restart...');
    
    // Clear any existing timers and tweens
    this.time.removeAllEvents();
    this.tweens.killAll();
    
    // Properly destroy terrain physics bodies to prevent memory leaks
    if (this.terrainSegments) {
        this.terrainSegments.forEach(segment => {
            if (segment.bodies) {
                segment.bodies.forEach(body => {
                    if (body && body.gameObject) {
                        body.gameObject.destroy();
                    } else if (body) {
                        // If there's no gameObject, manually remove the body
                        this.matter.world.remove(body);
                    }
                });
            }
        });
        
        // Clear the array
        this.terrainSegments = [];
    }
    
    // Clean up any collectibles
    if (this.lifeCollectibles) {
        this.lifeCollectibles.forEach(collectible => {
            if (collectible && collectible.destroy) {
                collectible.destroy();
            }
        });
        this.lifeCollectibles = [];
    }
    
    // Clean up any other physics bodies
    if (this.player && this.player.body) {
        // Make sure the player body is properly removed
        this.matter.world.remove(this.player.body);
    }
    
    // Clean up graphics
    if (this.terrainGraphics) {
        this.terrainGraphics.clear();
    }
    
    console.log('Cleanup complete');
};

// Initialize the toast system for trick announcements
GameScene.prototype.initToastSystem = function() {
    // Create a container for toast messages at the bottom of the screen
    if (!this.toastContainer) {
        this.toastContainer = this.add.container(0, 0).setScrollFactor(0).setDepth(100);
    }
    
    // Position the toast container
    this.positionToastContainer();
};

// Create explosion effect for player and sled when game over occurs
GameScene.prototype.createPlayerExplosionEffect = function() {
    if (!this.player || !this.player.getAll) {
        console.warn('Cannot create explosion effect - player not available');
        return;
    }
    
    try {
        // Get the player's current position
        const playerX = this.player.x;
        const playerY = this.player.y;
        
        // Get the children components (sled and rider)
        const children = this.player.getAll();
        if (!children || children.length < 2) {
            console.warn('Cannot create explosion effect - player components not available');
            return;
        }
        
        // Get the sled (first child) and rider (second child)
        const sled = children[0];
        const rider = children[1];
        
        // Hide the original container but NOT the components
        this.player.visible = false;
        
        // Create clones of the original rider and sled at the correct world positions
        // We need to create new objects because the originals are tied to the container
        const riderWorldPos = this.player.getLocalPoint(rider.x, rider.y);
        const sledWorldPos = this.player.getLocalPoint(sled.x, sled.y);
        
        // Create new triangle for the rider that matches the original
        const riderClone = this.add.triangle(
            playerX + rider.x, 
            playerY + rider.y,
            0, -rider.height/2,
            -rider.width/2, rider.height/2,
            rider.width/2, rider.height/2,
            0xffff00 // Neon yellow
        );
        riderClone.setRotation(this.player.rotation);
        riderClone.setDepth(60);
        
        // Create new rectangle for the sled that matches the original
        const sledClone = this.add.rectangle(
            playerX + sled.x,
            playerY + sled.y,
            sled.width,
            sled.height,
            0xff0000 // Neon red
        );
        sledClone.setRotation(this.player.rotation);
        sledClone.setDepth(60);
        
        // Add smaller particle effects for added drama
        this.createExplosionParticles(playerX, playerY, 0xff0000, { width: 20, height: 10 });
        this.createExplosionParticles(playerX, playerY - 20, 0xffff00, { width: 15, height: 15 });
        
        // Make the rider blast upward and spin
        this.tweens.add({
            targets: riderClone,
            x: playerX + (Math.random() > 0.5 ? 150 : -150),
            y: playerY - 200 - Math.random() * 100,
            rotation: riderClone.rotation + (Math.random() > 0.5 ? 8 : -8),
            alpha: 0,
            scaleX: 0.5,
            scaleY: 0.5,
            duration: 1500,
            ease: 'Power2',
            onComplete: () => {
                riderClone.destroy();
            }
        });
        
        // Make the sled blast in a different direction and spin
        this.tweens.add({
            targets: sledClone,
            x: playerX + (Math.random() > 0.5 ? -120 : 120),
            y: playerY + 100 + Math.random() * 80,
            rotation: sledClone.rotation + (Math.random() > 0.5 ? 6 : -6),
            alpha: 0,
            scaleX: 0.7,
            scaleY: 0.7,
            duration: 1500,
            ease: 'Power2',
            onComplete: () => {
                sledClone.destroy();
            }
        });
        
        // Add a shockwave effect
        const shockwave = this.add.circle(playerX, playerY, 10, 0xffffff, 0.4);
        shockwave.setDepth(50);
        
        this.tweens.add({
            targets: shockwave,
            radius: 250,
            alpha: 0,
            duration: 800,
            ease: 'Power2',
            onComplete: () => {
                shockwave.destroy();
            }
        });
    } catch (error) {
        console.error('Error creating explosion effect:', error);
    }
};

// Helper to create particle explosion effect
GameScene.prototype.createExplosionParticles = function(x, y, color, size) {
    const particleCount = 20;
    const particles = [];
    
    for (let i = 0; i < particleCount; i++) {
        // Create particle shapes - mix of triangles and rectangles
        let particle;
        
        if (Math.random() > 0.5) {
            // Triangle particles
            particle = this.add.triangle(
                x, y,
                0, -5,
                -5, 5,
                5, 5,
                color
            );
        } else {
            // Rectangle particles
            const width = Math.random() * (size.width / 2) + 3;
            const height = Math.random() * (size.height / 2) + 3;
            particle = this.add.rectangle(x, y, width, height, color);
        }
        
        // Random rotation
        particle.rotation = Math.random() * Math.PI * 2;
        particle.setDepth(60);
        particles.push(particle);
        
        // Calculate random velocity
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 4;
        const velocityX = Math.cos(angle) * speed;
        const velocityY = Math.sin(angle) * speed;
        
        // Animate the particle
        this.tweens.add({
            targets: particle,
            x: x + velocityX * 100,
            y: y + velocityY * 100,
            scaleX: 0,
            scaleY: 0,
            rotation: particle.rotation + (Math.random() > 0.5 ? 5 : -5),
            alpha: 0,
            duration: 800 + Math.random() * 400,
            onComplete: () => {
                particle.destroy();
            }
        });
    }
};

// Helper to position the toast container at the bottom center of the screen
GameScene.prototype.positionToastContainer = function() {
    if (!this.toastContainer) return;
    
    // Position at bottom center
    this.toastContainer.x = this.cameras.main.width / 2;
    this.toastContainer.y = this.cameras.main.height - 100;
};

// Show a toast message for tricks and rotations
GameScene.prototype.showToast = function(message, duration = 2000) {
    if (!this.toastContainer) return;
    
    // Create toast text
    const toast = this.add.text(0, 0, message, {
        font: '24px Arial',
        fill: '#ffff00', // Neon yellow for visibility
        stroke: '#000000',
        strokeThickness: 4,
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: { x: 15, y: 10 }
    }).setOrigin(0.5, 0);
    
    // Add to container
    this.toastContainer.add(toast);
    
    // Shift existing toasts upward
    const toasts = this.toastContainer.getAll();
    for (let i = 0; i < toasts.length - 1; i++) {
        toasts[i].y -= toast.height + 10;
    }
    
    // Fade in and out animation
    this.tweens.add({
        targets: toast,
        alpha: { from: 0, to: 1 },
        duration: 300,
        ease: 'Power2',
        onComplete: () => {
            // Start fading out after a delay
            this.time.delayedCall(duration, () => {
                this.tweens.add({
                    targets: toast,
                    alpha: 0,
                    y: toast.y - 30,
                    duration: 500,
                    ease: 'Power2',
                    onComplete: () => {
                        // Remove from container when done
                        this.toastContainer.remove(toast, true);
                        toast.destroy();
                    }
                });
            });
        }
    });
};

// GameScene is now properly exported as ES module
