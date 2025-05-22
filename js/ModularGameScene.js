// js/ModularGameScene.js
// Uses Phaser 3 with the built‑in Matter physics plugin.
// Implements a modular architecture for better maintainability.
// ------------------------------------------------------

// Import physics configuration
import PhysicsConfig from './config/physics-config.js';
import RotationSystem from './utils/RotationSystem.js';
import configLoader from './config/config-loader.js';
import { initializeRandomWithSeed } from './utils/seed-generator.js';
import HudDisplay from './lib/HudDisplay.js';
import InputController from './lib/InputController.js';
import TerrainManager from './lib/TerrainManager.js';
import CollectibleManager from './lib/CollectibleManager.js';
import ExplosionEffects from './utils/ExplosionEffects.js';
import StarfieldParallax from './background/StarfieldParallax.js';

export default class ModularGameScene extends Phaser.Scene {
    constructor() {
        super({ 
            key: 'ModularGameScene',
            physics: {
                matter: {
                    gravity: { y: 1 },
                    debug: false // Always disable debug visualization 
                }
            }
        });
        
        // Game state flags
        this.gameOverShown = false; // Track if game over has been shown during this run
        
        // Subsystem modules
        this.inputController = null; // Handles all input processing
        this.terrain = null;         // Manages terrain generation and physics
        this.hud = null;             // Handles UI elements and display
        this.collectibles = null;    // Manages collectible items like extra lives
        
        // Player state
        this.player = null;
        this.onGround = false;   // updated from collision events
        this.currentSlopeAngle = 0; // rad
        this.prevGroundState = false; // to detect ground/air transitions
        
        // Game state
        this.score = 0;
        this.lives = PhysicsConfig.extraLives.initialLives;
        this.initialY = 0; // Track initial Y position at start of run for altitude drop
        
        // Colors
        this.neonYellow = 0xffff00;
        this.neonBlue = 0x00ffff;
        this.neonPink = 0xff00ff;
        this.neonRed = 0xff0000;
        
        // Trick state
        this.isTucking = false;      // for ground speed boost
        this.isParachuting = false;  // for air trick
        this.isDragging = false;     // for ground drag
        this.isAirBraking = false;   // for air brake trick
        
        // Rotation tracking system (for flips and tricks)
        this.rotationSystem = null;     // will be initialized in create()
        this.currentSpeedMultiplier = 1.0; // default speed multiplier
        
        // Walking mode state
        this.sledDistance = 40;      // distance between player and sled when walking
        this.sledOriginalY = 0;      // to track original sled position
        this.riderOriginalY = 0;     // to track original rider position
        this.sledOriginalX = 0;      // to track original sled X position
        
        // Bind methods to ensure 'this' context is preserved
        this.handleResize = this.handleResize.bind(this);
    }
    
    preload() {
        console.log('ModularGameScene preload method started');
        
        // No additional assets needed for this scene specifically
        // All assets should be loaded in PreloadScene
    }
    
    create() {
        console.log('ModularGameScene create method started - initializing game');
        
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
        
        // Reset core game variables
        this.lives = PhysicsConfig.extraLives.initialLives;
        this.gameOverShown = false;
        this.score = 0;
        
        // Add player-following parallax starfield background (always behind everything else)
        const { width, height } = this.cameras.main;
        console.log(`Creating player-following starfield with dimensions ${width}x${height}`);
        this.starfield = new StarfieldParallax(this, { 
            width, 
            height, 
            depth: -100,            // Ensure it's behind everything
            density: 2.0,          // Higher density for more stars
            cellSize: 800,         // Size of each cell in pixels
            sizes: [3, 5, 7],      // Larger stars for better visibility
            visibleBuffer: 3,      // Extra cells beyond visible area to prevent pop-in
            speeds: [-0.1, -0.2, -0.3] // Much slower parallax for true cosmic background feeling
        });

        // Setup world
        this.cameras.main.setBackgroundColor('#000000');
        
        // Initialize the InputController module
        this.inputController = new InputController(this);
        
        // Configure physics
        // No world boundaries - allowing free movement
        // This matches the original GameScene which removed setBounds call
        // to eliminate the walls that were blocking player movement
        this.matter.world.setGravity(0, PhysicsConfig.physics.gravityY);
        
        // Initialize rotation system with proper callbacks for landing evaluations
        this.rotationSystem = new RotationSystem({
            onCleanLanding: (_speedMultiplier) => {
                // Clean landings no longer boost speed; multiplier always 1.0
                this.currentSpeedMultiplier = 1.0;
                // We log for analytics/debug but do not apply a multiplier
                console.log('Clean landing! No speed boost applied.');
            },
            onCrash: () => {
                console.log('Crashed!');
                // Handle the crash - implementation below
                this.handleCrash();
            },
            onWobble: () => {
                console.log('Wobble landing!'); // No toast for wobbles
            }
        });
        
        // Set up collision detection
        this.setupCollisionHandlers();
        
        // Create player character
        this.createPlayer();
        
        // Initialize modules
        this.initializeTerrainManager();
        this.initializeHudDisplay();
        this.initializeCollectibleManager();
        this.initializeExplosionEffects();
        
        // Set up the resize handler
        this.scale.on('resize', this.handleResize, this);
    }
    
    setupCollisionHandlers() {
        // Set up collision event handling for player
        this.matter.world.on('collisionstart', (event) => {
            const pairs = event.pairs;
            
            for (let i = 0; i < pairs.length; i++) {
                const bodyA = pairs[i].bodyA;
                const bodyB = pairs[i].bodyB;
                
                // Check if player collided with terrain
                if ((bodyA === this.player.body && bodyB.label === 'terrain') ||
                    (bodyB === this.player.body && bodyA.label === 'terrain')) {
                    this.onGround = true;
                    
                    // Calculate terrain angle for smooth movement
                    const terrainBody = bodyA.label === 'terrain' ? bodyA : bodyB;
                    if (terrainBody.vertices && terrainBody.vertices.length >= 2) {
                        // Use first two vertices to determine angle
                        const v1 = terrainBody.vertices[0];
                        const v2 = terrainBody.vertices[1];
                        this.currentSlopeAngle = Math.atan2(v2.y - v1.y, v2.x - v1.x);
                    }
                }
                
                // Check if player collided with extra life
                if ((bodyA === this.player.body && bodyB.label === 'extraLife') ||
                    (bodyB === this.player.body && bodyA.label === 'extraLife')) {
                    const lifeBody = bodyA.label === 'extraLife' ? bodyA : bodyB;
                    this.collectExtraLife(lifeBody);
                }
            }
        });
        
        // Handle end of collision - using a simpler approach similar to GameScene
        this.matter.world.on('collisionend', (event) => {
            const pairs = event.pairs;
            
            for (let i = 0; i < pairs.length; i++) {
                const pair = pairs[i];
                
                // Check if player left the ground
                if (pair.bodyA === this.player.body || pair.bodyB === this.player.body) {
                    // Simply set onGround to false when any collision with the player ends
                    // This is a simplification that works well enough for gameplay
                    this.onGround = false;
                }
            }
        });
    }
    
    createPlayer() {
        // Player character dimensions
        const playerBodyWidth = 30;
        const playerBodyHeight = 50;
        const sledHeight = 15;
        const riderHeight = playerBodyHeight - sledHeight;
        const circleRadius = Math.max(playerBodyWidth, sledHeight) / 1.5;
        
        // Create rider (triangle)
        const riderX = 12; // DO NOT TOUCH
        const riderY = -sledHeight - (riderHeight - 120 / 2); // DO NOT TOUCH
        const rider = this.add.triangle(
            riderX, riderY,
            0, -riderHeight / 2,
            -playerBodyWidth / 2, riderHeight / 2,
            playerBodyWidth / 2, riderHeight / 2,
            this.neonYellow
        );
        
        // Store the original rider position for mode transitions
        this.riderOriginalY = riderY;
        
        // Create sled (rectangle)
        const sledX = 0;
        const sledY = (playerBodyHeight / 2) - (sledHeight / 2);
        const sled = this.add.rectangle(
            sledX, sledY,
            playerBodyWidth + 10,
            sledHeight,
            this.neonRed
        );
        
        // Store the original sled position for the tricks
        this.sledOriginalY = sledY;
        this.sledOriginalX = sledX;
        
        // Store references to the sled and rider
        this.sled = sled;
        this.rider = rider;
        
        // Create player container and add physics
        this.player = this.add.container(200, 100, [sled, rider]);
        
        // Add a circular Matter body to the container
        const Bodies = Phaser.Physics.Matter.Matter.Bodies;
        const playerBody = Bodies.circle(0, 0, circleRadius, {
            restitution: PhysicsConfig.player.restitution,
            friction: PhysicsConfig.player.friction,
            frictionAir: PhysicsConfig.player.frictionAir,
            density: PhysicsConfig.player.density
        });
        
        this.matter.add.gameObject(this.player);
        this.player.setExistingBody(playerBody)
            .setFixedRotation(false)      // allow spins for tricks
            .setPosition(200, 100);       // re‑centre after body attach
        
        // Camera follow setup
        this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
        this.cameras.main.setFollowOffset(0, 100);
    }
    
    initializeTerrainManager() {
        // Create and initialize terrain manager
        this.terrain = new TerrainManager(this);
        this.terrain.setSeededRandom(this.seededRandom);
        this.terrain.init();
        
        // Generate initial terrain segments
        for (let i = 0; i < 15; i++) {
            this.terrain.generateNextTerrainSegment(i === 0);
        }
        
        // Draw terrain
        this.terrain.drawTerrain();
    }
    
    initializeHudDisplay() {
        // Create and initialize HUD system
        this.hud = new HudDisplay(this);
        this.hud.init();
        this.hud.setInitialY(this.player.y);
    }
    
    initializeCollectibleManager() {
        // Create and initialize collectible manager
        this.collectibles = new CollectibleManager(this, this.terrain);
        this.collectibles.init(PhysicsConfig);
    }
    
    initializeExplosionEffects() {
        // Create and initialize explosion effects manager
        this.explosionEffects = new ExplosionEffects(this);
    }
    
    /**
     * Main update loop - runs player physics and game logic
     * Matches the physics implementation of the original GameScene
     */
    update(time, delta) {
        // Update the parallax starfield to follow player position
        if (this.starfield && this.cameras && this.cameras.main && this.player) {
            this.starfield.update(this.cameras.main, this.player);
        }
        // Comprehensive safety check - if we're missing any critical objects, don't proceed with update
        // This is important for clean scene transitions, especially during game over
        if (!this.scene || !this.scene.isActive || !this.player || !this.player.body || 
            !this.inputController || this.gameOverShown) {
            return;
        }
        
        const Body = Phaser.Physics.Matter.Matter.Body;
        let deltaRotation = 0;
        
        // Apply a gentle downhill bias force when on ground to prevent sticking
        // Only apply when in sledding mode, matching original GameScene
        // Add safety check to prevent errors during scene transitions (like game over)
        if (this.onGround && this.inputController && this.player && this.player.body && !this.inputController.isWalkMode()) {
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
            
            // Apply passive speed boost when on ground (same as original GameScene)
            this.applyPassiveSpeedBoost();
        }
        
        // Update input controller
        const input = this.inputController.update();
        
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
                if (this.sled) {
                    this.sled.y = this.sledOriginalY;
                    this.sled.x = this.sledOriginalX;
                }
            }
            // Cancel all movement/rotation actions (WASD) on any ground/air transition
            if (this.inputController && this.inputController.manette) {
                const actions = this.inputController.manette.actions;
                actions.rotateCounterClockwise = false;
                actions.rotateClockwise = false;
                actions.trickAction = false;
                actions.brakeAction = false;
            }
            // Land flips/tricks when transitioning from air to ground
            if (this.onGround && !this.prevGroundState) {
                const flipData = this.rotationSystem.getFlipStats();
                if (flipData.fullFlips > 0 || flipData.partialFlip > 0.5) {
                    this.onFlipComplete(flipData.fullFlips, flipData.partialFlip);
                }
                // Reset rotation tracking - no need to call reset() as the RotationSystem handles this internally
            }
            // Update previous state for next frame
            this.prevGroundState = this.onGround;
        }
        
        // Handle walking mode if active
        if (this.inputController.isWalkMode()) {
            this.handleWalkingMode(input);
            return; // Skip other controls when in walk mode
        }
        
        // Handle standard sledding controls
        this.handleSleddingControls(input);
        
        // Update terrain
        this.terrain.update(this.player.x);
        
        // Update collectibles
        this.collectibles.update(time, this.player.x);

        // --- Failsafe: Prevent player from falling through terrain ---
        // If the player sprite is ever below the terrain at the same x,
        // teleport the player directly above the terrain. This prevents rare physics bugs
        // where the player can tunnel through the ground due to high velocity or collision errors.
        if (this.terrain && this.player && this.player.body) {
            const terrainY = this.terrain.findTerrainHeightAt(this.player.x);
            if (this.player.y > terrainY + 5) { // Allow a small epsilon for collision tolerance
                // Move player just above the terrain
                this.player.y = terrainY - 1;
                // Also move the physics body directly
                this.player.body.position.y = terrainY - 1;
                // Zero vertical velocity to prevent instant re-falling
                this.player.body.velocity.y = 0;
                // Optionally, you could also reset forces here if needed
            }
        }
        
        // Game over conditions
        if (this.player.y > this.cameras.main.worldView.bottom + 800) {
            console.log("Player fell too far. Restarting.");
            this.scene.restart();
        }
        if (this.player.x < this.cameras.main.worldView.left - 400) {
            console.log("Player went too far left. Restarting.");
            this.scene.restart();
        }
        
        // --- Camera follow clamp logic ---
        // Never let the camera center fall more than 400px in X or 200px in Y from the player
        const cam = this.cameras.main;
        const cameraCenterX = cam.scrollX + cam.width / 2;
        const cameraCenterY = cam.scrollY + cam.height / 2;
        const maxLagX = 400;
        const maxLagY = 200;
        if (this.player.x - cameraCenterX > maxLagX) {
            cam.scrollX = this.player.x - maxLagX - cam.width / 2;
        }
        if (this.player.x - cameraCenterX < -maxLagX) {
            cam.scrollX = this.player.x + maxLagX - cam.width / 2;
        }
        if (this.player.y - cameraCenterY > maxLagY) {
            cam.scrollY = this.player.y - maxLagY - cam.height / 2;
        }
        if (this.player.y - cameraCenterY < -maxLagY) {
            cam.scrollY = this.player.y + maxLagY - cam.height / 2;
        }

        // Update HUD
        this.updateHud();
    }
    
    handleWalkingMode(input) {
        const Body = Phaser.Physics.Matter.Matter.Body;
        const walkSpeed = 1.5; // Constant walking speed
        
        // Reset velocities for more precise control
        Body.setVelocity(this.player.body, {
            x: 0,
            y: this.player.body.velocity.y // Keep vertical velocity for gravity
        });
        
        // Move left/right with A/D keys
        if (input.left) {
            Body.translate(this.player.body, { x: -walkSpeed, y: 0 });
        }
        if (input.right) {
            Body.translate(this.player.body, { x: walkSpeed, y: 0 });
        }
        
        // W/S don't do anything in walking mode (handled by InputController)
        
        // Walking jump (small)
        if (input.jump && this.onGround) {
            Body.setVelocity(this.player.body, { 
                x: this.player.body.velocity.x, 
                y: PhysicsConfig.jump.walkJumpVelocity 
            });
            this.onGround = false;
            this.hud.showToast('Small Jump', 500);
        }
        
        // Make the player upright when walking
        Body.setAngle(this.player.body, 0);
        Body.setAngularVelocity(this.player.body, 0);
        
        // Position sled behind player if available
        if (this.sled) {
            this.sled.visible = false;
            this.sled.x = this.player.x - this.sledDistance;
            if (this.onGround) {
                this.sled.y = this.sledOriginalY;
            }
        }
        
        // Make rider visible in walking mode
        if (this.rider) {
            this.rider.visible = true;
        }
    }
    
    /**
     * Applies a passive speed boost based on current speed
     * Matches the physics from the original GameScene
     */
    applyPassiveSpeedBoost() {
        const Body = Phaser.Physics.Matter.Matter.Body;
        const currentVelocity = this.player.body.velocity;
        // Always use a speed multiplier of 1.0; clean landings do not affect speed
        this.currentSpeedMultiplier = 1.0;
        // Only apply the minimum constant boost when on ground
        const minBoostForce = PhysicsConfig.movement.minBoostStrength;
        // No additional speed boost from landing multipliers
        const totalBoostForce = minBoostForce;
        // The force is applied in the direction of current movement
        const forceDirection = currentVelocity.x >= 0 ? 1 : -1;
        Body.applyForce(this.player.body,
            this.player.body.position,
            { x: forceDirection * totalBoostForce, y: 0 });
    } // Clean landings no longer boost speed; see llm-notes.md for rationale.


    handleSleddingControls(input) {
        const Body = Phaser.Physics.Matter.Matter.Body;
        const groundRotVel = PhysicsConfig.rotation.groundRotationVel;
        const airRotVel = PhysicsConfig.rotation.airRotationVel;
        const pushForce = PhysicsConfig.movement.pushForce;
        let deltaRotation = 0;
        
        // -----------------------------------------------------------------
        // W/S KEYS - ROTATION CONTROLS
        // -----------------------------------------------------------------
        if (!this.onGround) {
            // W key for counter-clockwise rotation in air
            if (input.rotateCounterClockwise) {
                Body.setAngularVelocity(this.player.body, -airRotVel);
                deltaRotation = -Phaser.Math.RadToDeg(airRotVel);
            }
            // S key for clockwise rotation in air
            else if (input.rotateClockwise) {
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
        else {
            Body.setAngularVelocity(this.player.body, 0);
            
            // Rotate player to match terrain angle - critical for hugging the terrain
            this.playerHitTerrain(this.currentSlopeAngle);
            
            // Update rotation system with current ground state
            const currentAngleDeg = Phaser.Math.RadToDeg(this.player.body.angle);
            this.rotationSystem.update({
                grounded: this.onGround,
                currentAngle: currentAngleDeg,
                deltaRotation: 0
            });
        }
        
        // -----------------------------------------------------------------
        // A KEY - BRAKE/DRAG (exact match to GameScene implementation)
        // -----------------------------------------------------------------
        if (input.brakeAction) {
            if (this.onGround) {
                // DRAGGING - on ground for slight speed reduction
                if (!this.isDragging) {
                    this.isDragging = true;
                    // No toast for dragging
                }
                
                // Apply backward force to slow down
                const dragForce = 0.1; // Slows speed slightly - matching GameScene
                Body.applyForce(this.player.body,
                    this.player.body.position,
                    { x: -dragForce, y: 0 });
            } 
            else {
                // AIRBRAKE TRICK - in air for dramatic speed reduction
                if (!this.isAirBraking) {
                    this.isAirBraking = true;
                    // No toast for air brake
                }
                
                // Move the sled behind the player for airbrake visual
                if (this.sled) {
                    // Move sled backwards behind the player
                    this.sled.x = -30; // Move sled behind player (matching GameScene)
                }
                
                // Dramatically reduce horizontal velocity while airbraking (80% reduction per second)
                // Calculate the delta reduction based on frame rate
                const currentVelocity = this.player.body.velocity;
                const reductionRate = 1.2; // 80% reduction per second (matching GameScene)
                const frameReduction = reductionRate / 60; // Assuming 60fps, adjust per frame
                
                // Apply reduction as new velocity, not a force
                const newXVel = currentVelocity.x * (1 - frameReduction);
                
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
                if (this.sled) {
                    this.sled.x = this.sledOriginalX; // Reset sled horizontal position
                }
            }
        }
        
        // -----------------------------------------------------------------
        // D KEY - TUCK/PARACHUTE (exact match to GameScene implementation)
        // -----------------------------------------------------------------
        if (input.trickAction) {
            if (this.onGround) {
                // TUCKING - on ground for speed boost
                if (!this.isTucking) {
                    this.isTucking = true;
                    // No toast for tucking
                }
                
                // Apply significant forward force for speed boost
                const tuckBoostFactor = 0.004; // Slightly stronger than default (matching GameScene)
                const tuckBoostForce = tuckBoostFactor * this.currentSpeedMultiplier;
                
                Body.applyForce(this.player.body,
                    this.player.body.position,
                    { x: tuckBoostForce, y: 0 });
                    
                // Apply visual change for tucking
                if (this.rider) {
                    this.rider.y = this.riderOriginalY + 5; // move rider down slightly
                }
            }
            else {
                // PARACHUTE TRICK - in air for slowed falling
                if (!this.isParachuting) {
                    this.isParachuting = true;
                    // No toast for parachute
                }
                
                // Move the sled down for parachute visual
                if (this.sled) {
                    this.sled.y = this.sledOriginalY + 15; // Move sled down slightly
                }
                
                // Counter current velocity for slower falling
                const currentVelocity = this.player.body.velocity;
                const parachuteFactor = 0.8; // 20% reduction in falling speed (matching GameScene)
                
                // Only reduce downward velocity
                if (currentVelocity.y > 0) {
                    Body.setVelocity(this.player.body, {
                        x: currentVelocity.x,
                        y: currentVelocity.y * parachuteFactor
                    });
                }
                
                // Add slight forward drift
                const driftForce = 0.0005;
                Body.applyForce(this.player.body,
                    this.player.body.position,
                    { x: driftForce, y: 0 });
            }
        }
        else {
            // Reset trick states when button released
            if (this.isTucking) {
                this.isTucking = false;
                
                // Reset rider position
                if (this.rider) {
                    this.rider.y = this.riderOriginalY;
                }
            }
            
            if (this.isParachuting) {
                this.isParachuting = false;
                
                // Reset sled position
                if (this.sled) {
                    this.sled.y = this.sledOriginalY;
                }
            }
        }
        
        // -----------------------------------------------------------------
        // SPACE - JUMP (matches original GameScene implementation)
        // -----------------------------------------------------------------
        if (input.jump && this.onGround) {
            // Use the correct constant from PhysicsConfig
            // Note: Original uses negative value, so we maintain that convention
            Body.setVelocity(this.player.body, {
                x: this.player.body.velocity.x,
                y: PhysicsConfig.jump.jumpVelocity // This matches GameScene
            });
            this.onGround = false;
            this.hud.showToast('Jump!', 1000);


            // Reset speed multiplier on jump - important physics detail from GameScene
            this.currentSpeedMultiplier = 1.0;
        }
        

        
        // Track rotations for flips
        if (!this.onGround) {
            this.rotationSystem.update(this.player.rotation);
        }
    }
    
    onFlipComplete(fullFlips, partialFlip) {
        if (fullFlips === 0 && partialFlip < 0.5) {
            return; // No significant rotation
        }
        
        let points = 0;
        let message = '';
        
        // Award points based on rotation amount
        if (fullFlips >= 2) {
            points = 1000 * fullFlips;
            message = `DOUBLE FLIP! +${points}`;
        } else if (fullFlips >= 1) {
            points = 500;
            message = `FLIP! +${points}`;
        } else if (partialFlip >= 0.5) {
            points = 100;
            message = `Half Flip! +${points}`;
        }
        
        // Apply speed boost based on trick complexity
        const speedMultiplier = 1 + (fullFlips * 0.2) + (partialFlip * 0.1);
        this.currentSpeedMultiplier = Math.min(2.0, speedMultiplier);
        
        // Update score and show toast
        this.score += points;
        if (points > 0) {
            this.hud.showToast(message, 2000);
        }
    }
    
    collectExtraLife(colliderBody) {
        // Delegate to collectible manager
        const success = this.collectibles.collectExtraLife(colliderBody, () => {
            // Life collected callback
            if (this.lives < PhysicsConfig.extraLives.maxLives) {
                this.lives++;
                this.hud.showToast('Extra Life!', 2000);
                this.hud.updateLivesDisplay(this.lives, PhysicsConfig.extraLives.maxLives);
            } else {
                // Already at max lives, give points instead
                const pointsForExtraLife = 1000;
                this.score += pointsForExtraLife;
                this.hud.showToast(`Max Lives! +${pointsForExtraLife} points`, 2000);
            }
        });
        
        return success;
    }
    
    /**
     * Rotates the player to align with the terrain angle
     * This is crucial for making the player "hug" the terrain
     * @param {number} terrainAngleRad - The angle of the terrain in radians
     */
    playerHitTerrain(terrainAngleRad) {
        // Rotate player gently toward terrain angle on touchdown
        const targetDeg = Phaser.Math.RadToDeg(terrainAngleRad);
        const currentDeg = this.player.angle;
        const diff = targetDeg - currentDeg;

        // Only adjust if difference is significant
        if (Math.abs(diff) > 2) {
            // Use slopeAlignmentFactor to make the rotation smooth
            this.player.setAngle(currentDeg + diff * PhysicsConfig.rotation.slopeAlignmentFactor);
        }
    }
    
    /**
     * Handle player crashes due to bad landings
     * Matches the original GameScene implementation
     */
    handleCrash() {
        // Reset player velocity on crash
        const Body = Phaser.Physics.Matter.Matter.Body;
        Body.setVelocity(this.player.body, { x: 0, y: 0 });
        
        // Use a life if available, otherwise trigger game over
        if (this.lives > 0) {
            this.lives--;
            
            // Force player into walking mode when they lose a life
            if (!this.inputController.isWalkMode()) {
                // Call isWalkMode on the inputController instead of accessing manette directly
                this.inputController.setWalkMode(true);
                
                // Hide the sled when entering walk mode
                if (this.sled) {
                    this.sled.visible = false;
                }
                
                this.hud.showToast('Walking Mode Activated', 2000);
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
            
            // Provide temporary invincibility and a small kick to get moving again
            this.time.delayedCall(500, () => {
                Body.setVelocity(this.player.body, { x: 2, y: -1 }); 
            });
        } else if (!this.gameOverShown) {
            // No lives left and game over hasn't been shown yet
            console.log('No lives left, game over...');
            this.gameOverShown = true; // Mark as shown to prevent multiple displays
            
            // Create explosion effect for the player and sled using our effects module
            if (this.explosionEffects) {
                this.explosionEffects.createPlayerExplosion(this.player);
            }
            
            // Show game over feedback before restarting
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
            ).setDepth(99);
            
            // Make effects follow the player with a pulsing animation
            this.tweens.add({
                targets: [gameOverText, flashRect],
                alpha: { from: 1, to: 0.7, yoyo: true, repeat: 3 },
                duration: 300
            });
            
            // Return to StartScene after a delay
            this.time.delayedCall(1500, () => {
                // Proper cleanup before returning to start screen
                this.cleanupBeforeRestart();
                // Go back to StartScene instead of restarting
                this.scene.start('StartScene');
            });
        }
    }
    
    updateHud() {
        if (!this.player || !this.hud) return;
        
        // Calculate speed
        const velocity = this.player.body.velocity;
        const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
        
        // Update HUD elements
        this.hud.update(this.player, this.score, speed, this.lives, PhysicsConfig.extraLives.maxLives);
    }
    

    
    handleResize(gameSize) {
        const { width, height } = gameSize;
        
        // Resize HUD elements through the HUD manager
        if (this.hud) {
            this.hud.handleResize(gameSize);
        }
    }
    
    shutdown() {
        // Clean up resources when scene is shutdown
        this.cleanupBeforeRestart();
    }
    
    cleanupBeforeRestart() {
        // Remove resize event listener
        this.scale.off('resize', this.handleResize, this);
        
        // Clean up modules
        if (this.inputController) {
            this.inputController.destroy();
            this.inputController = null;
        }
        
        if (this.terrain) {
            this.terrain.destroy();
            this.terrain = null;
        }
        
        if (this.hud) {
            this.hud.destroy();
            this.hud = null;
        }
        
        if (this.collectibles) {
            this.collectibles.destroy();
            this.collectibles = null;
        }
        
        // Clean up rotation system
        if (this.rotationSystem) {
            this.rotationSystem = null;
        }
    }
}
