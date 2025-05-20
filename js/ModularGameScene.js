// js/ModularGameScene.js
// Uses Phaser 3 with the built‑in Matter physics plugin.
// Implements a modular architecture for better maintainability.
// ------------------------------------------------------

// Import physics configuration
import PhysicsConfig from './config/physics-config.js';
import RotationSystem from './utils/RotationSystem.js';
import configLoader from './config/config-loader.js';
import { initializeRandomWithSeed } from './utils/seed-generator.js';

// Import modular subsystems
import InputController from './lib/InputController.js';
import TerrainManager from './lib/TerrainManager.js';
import HudDisplay from './lib/HudDisplay.js';
import CollectibleManager from './lib/CollectibleManager.js';

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
        
        // Setup world
        this.cameras.main.setBackgroundColor('#000000');
        
        // Initialize the InputController module
        this.inputController = new InputController(this);
        
        // Configure physics
        this.matter.world.setBounds(-50, 0, this.scale.width + 100, this.scale.height * 2);
        this.matter.world.setGravity(0, PhysicsConfig.physics.gravityY);
        this.rotationSystem = new RotationSystem(this.matter.world.localWorld);
        
        // Set up collision detection
        this.setupCollisionHandlers();
        
        // Create player character
        this.createPlayer();
        
        // Initialize modules
        this.initializeTerrainManager();
        this.initializeHudDisplay();
        this.initializeCollectibleManager();
        
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
    
    update(time, delta) {
        // Safety check - if we're missing critical objects, don't proceed with update
        if (!this.scene || !this.scene.isActive || !this.player || !this.player.body) {
            return;
        }
        
        const Body = Phaser.Physics.Matter.Matter.Body;
        
        // Calculate rotation delta for flip tracking
        const prevAngle = this.player.body.angle;
        const currentAngleDeg = Phaser.Math.RadToDeg(prevAngle);
        const deltaRotation = delta * 0.01; // Calculate rotation change for this frame
        
        // Always update rotation system with current state
        this.rotationSystem.update({
            grounded: this.onGround,
            currentAngle: currentAngleDeg,
            deltaRotation: this.onGround ? 0 : deltaRotation // Only track rotation in air
        });
        
        // Apply a gentle downhill bias force when on ground to prevent sticking
        if (this.onGround && this.player.body) {
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
            
            // Land flips/tricks when transitioning from air to ground
            if (this.onGround && !this.prevGroundState) {
                const flipData = this.rotationSystem.getFlipStats();
                if (flipData.fullFlips > 0 || flipData.partialFlip > 0.5) {
                    this.onFlipComplete(flipData.fullFlips, flipData.partialFlip);
                }
                // Reset rotation tracking - no need to call reset() as the RotationSystem handles this in handleLanding()
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
        
        // Game over conditions
        if (this.player.y > this.cameras.main.worldView.bottom + 800) {
            console.log("Player fell too far. Restarting.");
            this.scene.restart();
        }
        if (this.player.x < this.cameras.main.worldView.left - 400) {
            console.log("Player went too far left. Restarting.");
            this.scene.restart();
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
            
            // Update rotation system with current ground state
            const currentAngleDeg = Phaser.Math.RadToDeg(this.player.body.angle);
            this.rotationSystem.update({
                grounded: this.onGround,
                currentAngle: currentAngleDeg,
                deltaRotation: 0
            });
        }
        
        // -----------------------------------------------------------------
        // A KEY - BRAKE/DRAG
        // -----------------------------------------------------------------
        if (input.brakeAction) {
            if (this.onGround) {
                // On ground: drag legs to slow down
                const brakeForce = -this.player.body.velocity.x * 0.03;
                Body.applyForce(this.player.body, 
                    this.player.body.position, 
                    { x: brakeForce, y: 0 });
                    
                if (Math.abs(this.player.body.velocity.x) > 1) {
                    this.hud.showToast('Braking!', 500);
                }
            } 
            else {
                // In air: air brake (slow horizontal, small vertical boost)
                const airBrakeForceX = -this.player.body.velocity.x * 0.02;
                const airBrakeForceY = -0.001; // Small upward force
                
                Body.applyForce(this.player.body,
                    this.player.body.position,
                    { x: airBrakeForceX, y: airBrakeForceY });
                    
                this.hud.showToast('Air Brake!', 500);
            }
        }
        
        // -----------------------------------------------------------------
        // D KEY - TUCK/PARACHUTE
        // -----------------------------------------------------------------
        if (input.trickAction) {
            if (this.onGround) {
                // On ground: tuck for speed boost
                if (!this.isTucking) {
                    this.isTucking = true;
                    this.hud.showToast('Speed Boost!', 1000);
                }
                
                // Apply boost force
                const tuckBoostForce = 0.003 * this.currentSpeedMultiplier;
                Body.applyForce(this.player.body,
                    this.player.body.position,
                    { x: tuckBoostForce, y: 0 });
                    
                // Apply visual offset if tucking
                if (this.rider) {
                    this.rider.y = this.riderOriginalY + 5;
                }
            }
            else {
                // In air: parachute effect (slower falling, float further)
                const parachuteForceY = this.player.body.velocity.y * 0.01; // Counter current fall
                const parachuteForceX = 0.001; // Small forward push
                
                Body.applyForce(this.player.body,
                    this.player.body.position,
                    { x: parachuteForceX, y: parachuteForceY });
                    
                this.hud.showToast('Parachute!', 500);
            }
        }
        else if (this.isTucking && this.onGround) {
            // Reset tuck state when not pressing D
            this.isTucking = false;
            if (this.rider) {
                this.rider.y = this.riderOriginalY;
            }
        }
        
        // -----------------------------------------------------------------
        // SPACE - JUMP
        // -----------------------------------------------------------------
        if (input.jump && this.onGround) {
            const jumpVelocity = PhysicsConfig.jump.jumpVelocity;
            Body.setVelocity(this.player.body, {
                x: this.player.body.velocity.x,
                y: jumpVelocity
            });
            this.onGround = false;
            this.hud.showToast('Jump!', 1000);
            
            // Reset speed multiplier on jump
            this.currentSpeedMultiplier = 1.0;
        }
        
        // Tuck for speed boost (on ground)
        if (input.tuck && this.onGround) {
            if (!this.isTucking) {
                this.isTucking = true;
                this.hud.showToast('Speed Boost!', 1500);
            }
            
            // Apply boost force
            const tuckBoostForce = 0.003 * this.currentSpeedMultiplier;
            Body.applyForce(this.player.body,
                this.player.body.position,
                { x: tuckBoostForce, y: 0 });
                
            // Apply visual offset if tucking
            if (this.rider) {
                this.rider.y = this.riderOriginalY + 5;
            }
        } else if (this.isTucking) {
            this.isTucking = false;
            // Reset rider position
            if (this.rider) {
                this.rider.y = this.riderOriginalY;
            }
        }
        
        // Parachute trick (in air)
        if (input.parachute && !this.onGround) {
            if (!this.isParachuting) {
                this.isParachuting = true;
                this.hud.showToast('Parachute!', 1500);
            }
            
            // Move sled up for visual effect
            if (this.sled) {
                this.sled.y = this.sledOriginalY - (50 * 1.25); // Move up 1.25x player height
            }
            
            // Apply upward force to slow descent
            Body.applyForce(this.player.body,
                this.player.body.position,
                { x: 0, y: -0.1 });
                
            // Preserve horizontal velocity
            const currentVelocity = this.player.body.velocity;
            Body.setVelocity(this.player.body, {
                x: currentVelocity.x * 1.01, // Almost no horizontal drag
                y: currentVelocity.y
            });
        } else if (this.isParachuting) {
            this.isParachuting = false;
            // Reset sled position
            if (this.sled) {
                this.sled.y = this.sledOriginalY;
            }
        }
        
        // Drag/brake (on ground)
        if (input.drag && this.onGround) {
            if (!this.isDragging) {
                this.isDragging = true;
                this.hud.showToast('Dragging!', 1500);
            }
            
            // Apply backward force to slow down
            const dragForce = 0.1;
            Body.applyForce(this.player.body,
                this.player.body.position,
                { x: -dragForce, y: 0 });
        } else {
            this.isDragging = false;
        }
        
        // Air brake (in air)
        if (input.airBrake && !this.onGround) {
            if (!this.isAirBraking) {
                this.isAirBraking = true;
                this.hud.showToast('Air Brake!', 1500);
            }
            
            // Move sled for visual effect
            if (this.sled) {
                this.sled.x = -30; // Move sled behind player
            }
            
            // Apply strong air resistance
            const airBrakeForce = this.player.body.velocity.x * 0.05;
            Body.applyForce(this.player.body,
                this.player.body.position,
                { x: -airBrakeForce, y: 0 });
        } else if (this.isAirBraking) {
            this.isAirBraking = false;
            // Reset sled position
            if (this.sled) {
                this.sled.x = this.sledOriginalX;
            }
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
