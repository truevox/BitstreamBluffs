// js/ModularGameScene.js
// Uses Phaser 3 with the built‑in Matter physics plugin.
// Implements a modular architecture for better maintainability.
// ------------------------------------------------------
// Allow logic-only tests to run in Node by providing a minimal Phaser mock if not present
if (typeof globalThis.Phaser === 'undefined') {
  globalThis.Phaser = { Scene: class {} };
}
// Always use globalThis.Phaser for physics calls (robust ESM/test compatibility)
const getPhaser = () => globalThis.Phaser;

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
import applyFlipImpulse from './flip-impulse.js';
import StarfieldParallax from './background/StarfieldParallax.js';

/**
 * Main modular game scene for Bitstream Bluffs.
 * Uses Phaser 3 with Matter physics and a modular architecture for maintainability.
 * Handles player, terrain, collectibles, HUD, and all core gameplay logic.
 *
 * @extends Phaser.Scene
 */
export default class ModularGameScene extends Phaser.Scene {
    /**
     * Constructs the ModularGameScene.
     * Initializes all core state, colors, and binds resize handler.
     */
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
        this.gameOverShown = false;
        // Subsystem modules
        this.inputController = null;
        this.terrain = null;
        this.hud = null;
        this.collectibles = null;
        // Player state
        this.player = null;
        this.onGround = false;
        this.currentSlopeAngle = 0;
        this.prevGroundState = false;
        // Game state
        this.score = 0;
        this.lives = PhysicsConfig.extraLives.initialLives;
        this.initialY = 0;
        // Colors
        this.neonYellow = 0xffff00;
        this.neonBlue = 0x00ffff;
        this.neonPink = 0xff00ff;
        this.neonGreen = 0x00ff88;
        this.neonRed = 0xff0000;
        // Terrain interaction state
        this.lastTerrainType = null; // Track which terrain type we're on
        this.terrainTypeTimer = 0; // For blue point accrual
        // Particle emitters
        this.greenStreakEmitter = null;
        this.blueBlingEmitter = null;
        this.magentaFlickerEmitter = null;
        // Trick state
        this.isTucking = false;
        this.isParachuting = false;
        this.isDragging = false;
        this.isAirBraking = false;
        this.parachuteEffectiveness = 1.0;
        // Rotation tracking system
        this.rotationSystem = null;
        this.currentSpeedMultiplier = 1.0;
        // Walking mode state
        this.sledDistance = 40;
        this.sledOriginalY = 0;
        this.riderOriginalY = 0;
        this.sledOriginalX = 0;
        // Bind methods
        this.handleResize = this.handleResize.bind(this);
    }
    
    /**
     * Preloads assets for the scene.
     * All assets should be loaded in PreloadScene; this is a stub for Phaser lifecycle.
     */
    preload() {
        console.log('ModularGameScene preload method started');
        this.load.image('extraLife', 'assets/pickups/extra-life.png');
        
        // Create a default particle texture
        const graphics = this.make.graphics({ x: 0, y: 0, add: false });
        graphics.fillStyle(0xffffff);
        graphics.fillCircle(8, 8, 8);
        graphics.generateTexture('particle', 16, 16);
    }


    
    
    /**
     * Creates and initializes the game scene, modules, and player.
     * Sets up starfield, input, physics, collision handlers, player, terrain, HUD, collectibles, and effects.
     * Binds resize event and prepares scene for gameplay.
     */
    create() {
        // Particle texture debug dot removed; confirmed working
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
            speeds: [-0.1, -0.2, -0.3], // Much slower parallax for true cosmic background feeling
            colors: [ // Vibrant palette for each layer, matching StartScene
                ['#ffe066', '#fffbe6', '#ffff00'], // yellow/white
                ['#00eaff', '#82f7ff', '#00ffff'], // cyan/blue
                ['#d500f9', '#ff57e6', '#ff00ff']  // magenta/pink
            ]
        });

        // Add a few static colored twinkling stars for extra vibrancy (like StartScene)
        const staticStarColors = [0xff00ff, 0x00ffff, 0xffff00];
        for (let i = 0; i < 40; i++) {
            const x = Phaser.Math.Between(0, width);
            const y = Phaser.Math.Between(0, height);
            const size = Phaser.Math.Between(1, 3);
            const color = Phaser.Math.RND.pick(staticStarColors);
            const star = this.add.circle(x, y, size, color, 0.8).setDepth(-99);
            if (Math.random() > 0.6) {
                this.tweens.add({
                    targets: star,
                    alpha: 0.3,
                    duration: Phaser.Math.Between(1000, 3000),
                    yoyo: true,
                    repeat: -1
                });
            }
        }

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

        // --- Terrain Particle Emitters Setup (FIXED) ---
        // Create independent particle emitters for each effect using correct Phaser 3.90+ syntax
        // Verify particle texture exists before creating emitters
        console.log('Particle texture exists:', this.textures.exists('particle'));
        if (this.textures.exists('particle')) {
            const texture = this.textures.get('particle');
            console.log('Particle texture dimensions:', texture.source[0].width, 'x', texture.source[0].height);
        }

        // --- DEBUG: Forced always-on test emitter at center ---
        this.testEmitter = this.add.particles(this.cameras.main.centerX, this.cameras.main.centerY, 'particle', {
            tint: [0xffffff],
            speed: { min: 100, max: 250 }, // Increased speed range for better dispersion
            angle: { min: 0, max: 360 },
            lifespan: 1200, // Longer lifespan to see spread better
            alpha: { start: 0.8, end: 0 },
            scale: { start: 0.8, end: 0.1 },
            quantity: 3, // More particles per emission
            frequency: 120, // Slightly less frequent to avoid overcrowding
            maxParticles: 50, // Allow more total particles
            emitZone: { // Add emission area for additional spread
                type: 'random',
                source: new Phaser.Geom.Circle(0, 0, 15) // 15px radius emission area
            },
            on: true // Start active for testing
        });
        console.log('[DEBUG] Forced test emitter created at center:', this.testEmitter);

        // Green: "Streak Jets" (lime-yellow, angled, fast, short-lived)
        this.greenStreakEmitter = this.add.particles(0, 0, 'particle', {
            tint: [0x00ff88, 0xffff00],
            speed: { min: 180, max: 320 },
            angle: { min: -10, max: 10 },
            lifespan: 180,
            alpha: { start: 0.7, end: 0 },
            scale: { start: 0.55, end: 0.1 },
            quantity: 1,
            frequency: 18,
            maxParticles: 40,
            on: false // Start inactive
        });

        // Blue: "Bling Sparks" (cyan-white, upward arcs, gravity-affected)
        this.blueBlingEmitter = this.add.particles(0, 0, 'particle', {
            tint: [0x00ffff, 0xffffff],
            speedY: { min: -120, max: -60 },
            speedX: { min: -30, max: 30 },
            gravityY: 60,
            lifespan: { min: 200, max: 420 },
            alpha: { start: 1, end: 0 },
            scale: { start: 0.5, end: 0.1 },
            rotate: { min: 0, max: 360 },
            quantity: 2,
            frequency: 60,
            maxParticles: 30,
            on: false // Start inactive
        });

        // Magenta: "Danger Flicker" (magenta-purple, chaotic, very short-lived)
        this.magentaFlickerEmitter = this.add.particles(0, 0, 'particle', {
            tint: [0xff00ff, 0x660066],
            speed: { min: 40, max: 120 },
            angle: { min: -40, max: 40 },
            lifespan: 80,
            alpha: { start: 1, end: 0 },
            scale: { start: 0.4, end: 0.01 },
            quantity: 2,
            frequency: 25,
            maxParticles: 30,
            on: false // Start inactive
        });

        console.log('[DEBUG] All particle emitters created:', {
            green: this.greenStreakEmitter,
            blue: this.blueBlingEmitter,
            magenta: this.magentaFlickerEmitter,
            test: this.testEmitter
        });

        // Set up the resize handler
        this.scale.on('resize', this.handleResize, this);
    }
    
    /**
     * Sets up collision event handlers for player, terrain, and collectibles.
     * Handles collision start/end for ground detection and extra life collection.
     */
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
                    // Check if we're transitioning from air to ground
                    const wasInAir = !this.onGround;
                    
                    this.onGround = true;
                    
                    // Calculate terrain angle for smooth movement
                    const terrainBody = bodyA.label === 'terrain' ? bodyA : bodyB;
                    if (terrainBody.vertices && terrainBody.vertices.length >= 2) {
                        // Use first two vertices to determine angle
                        const v1 = terrainBody.vertices[0];
                        const v2 = terrainBody.vertices[1];
                        this.currentSlopeAngle = Math.atan2(v2.y - v1.y, v2.x - v1.x);
                    }
                    
                    // Reset parachute effectiveness when landing
                    if (wasInAir) {
                        this.parachuteEffectiveness = 1.0;
                        console.log('Landing detected - parachute effectiveness reset to 1.0');
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
                // Do not immediately set onGround = false here.
                // We'll handle buffered ground detection in the update() loop for smoother gameplay.
            }
        });
    }
    
    /**
     * Creates the player character, sled, and rider.
     * Adds physics body, sets up camera follow, and stores references for tricks and walking mode.
     */
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
    
    /**
     * Initializes the terrain manager, sets seeded random, and generates initial terrain.
     * Draws terrain for the start of the game.
     */
    initializeTerrainManager() {
        // Create and initialize terrain manager
        this.terrain = new TerrainManager(this);
        this.terrain.setSeededRandom(this.seededRandom);
        this.terrain.init();
        
        // Generate initial terrain segments (init() already created the first one)
        for (let i = 0; i < 14; i++) {
            this.terrain.generateNextTerrainSegment(false); // All additional segments are NOT first
        }
        
        // Draw terrain
        this.terrain.drawTerrain();
    }
    
    /**
     * Initializes the HUD display system and sets the initial Y position.
     */
    initializeHudDisplay() {
        // Create and initialize HUD system
        this.hud = new HudDisplay(this);
        this.hud.init();
        this.hud.setInitialY(this.player.y);
    }
    
    /**
     * Initializes the collectible manager and sets up collectibles for the scene.
     */
    initializeCollectibleManager() {
        // Create and initialize collectible manager
        this.collectibles = new CollectibleManager(this, this.terrain);
        this.collectibles.init(PhysicsConfig);
    }
    
    /**
     * Initializes the explosion effects manager for player and sled explosions.
     */
    initializeExplosionEffects() {
        // Create and initialize explosion effects manager
        this.explosionEffects = new ExplosionEffects(this);
    }
    
    /**
     * Main update loop - runs player physics and game logic
     * Matches the physics implementation of the original GameScene
     */
    /**
     * Main update loop for the scene. Handles player physics, controls, terrain, collectibles, camera, and HUD.
     *
     * @param {number} time - Current time in ms since game start.
     * @param {number} delta - Time elapsed since last frame in ms.
     */
    update(time, delta) {
    console.log('[UPDATE ENTRY]', { time, delta, onGround: this.onGround, position: this.player?.body?.position, terrain: this.terrain?.getTerrainSegments?.() });
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

        // --- Buffered ground detection ---
        // --- Improved buffered ground detection with stickiness ---
        if (!this.onGround && this.terrain && this.player && this.player.body) {
            const cfg = PhysicsConfig;
            const px = this.player.x;
            const py = this.player.y;
            const segments = this.terrain.getTerrainSegments?.();
            if (segments && segments.length) {
                for (let i = 0; i < segments.length; i++) {
                    const seg = segments[i];
                    if (px >= seg.x && px <= seg.endX) {
                        // Linear interpolate terrain Y at px
                        const t = (px - seg.x) / (seg.endX - seg.x);
                        const terrainY = seg.y + t * (seg.endY - seg.y);
                        // Make buffer more forgiving (now 30px above, 40px below)
                        if (py >= terrainY - 30 && py <= terrainY + 40) {
                            this.onGround = true;
                            this.groundStickyFrames = 6; // Stay on ground for 6 frames after leaving
                            break;
                        }
                    }
                }
            }
        } else if (!this.onGround && this.groundStickyFrames > 0) {
            // Sticky ground: remain on ground for a few frames after leaving
            this.onGround = true;
            this.groundStickyFrames--;
        }
        
        const Body = getPhaser().Physics.Matter.Matter.Body;
        let deltaRotation = 0;
        
        // Apply a gentle downhill bias force when on ground to prevent sticking
        // Only apply when in sledding mode, matching original GameScene
        // Add safety check to prevent errors during scene transitions (like game over)
        if (this.onGround && this.inputController && this.player && this.player.body && !this.inputController.isWalkMode()) {
            // Apply a small force in the downhill direction based on the terrain slope, not player orientation
                const slopeAngleRad = this.currentSlopeAngle;
                const downhillForce = PhysicsConfig.movement.downhillBiasForce;
                // Always push down the hill: x = cos, y = sin (flip sign if needed)
                Body.applyForce(this.player.body,
                    this.player.body.position,
                    { 
                        x: Math.cos(slopeAngleRad) * downhillForce,
                        y: Math.sin(slopeAngleRad) * downhillForce
                    }); // Downhill bias uses terrain, not player rotation
            
            // Apply passive speed boost when on ground (same as original GameScene)
            this.applyPassiveSpeedBoost();
        }
        
        // --- TERRAIN INTERACTION & PARTICLE EFFECTS ---
        // Find the current terrain segment under the player
        let currentTerrainType = null;
        let currentTerrainAngle = 0;
        let segmentColor = null;
        const segments = this.terrain.getTerrainSegments();
        let currentSegment = null;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (this.player.x >= seg.x && this.player.x <= seg.endX) {
                segmentColor = seg.color;
                currentTerrainAngle = seg.angle;
                currentSegment = seg;
                
                // Debug: Show color comparison in detail
                console.log('[DEBUG] Found matching segment:', {
                    segColor: seg.color,
                    segColorHex: seg.color.toString(16),
                    neonGreen: this.neonGreen,
                    neonGreenHex: this.neonGreen.toString(16),
                    neonBlue: this.neonBlue,
                    neonBlueHex: this.neonBlue.toString(16), 
                    neonPink: this.neonPink,
                    neonPinkHex: this.neonPink.toString(16)
                });
                
                if (segmentColor === this.neonGreen) currentTerrainType = 'green';
                else if (segmentColor === this.neonBlue) currentTerrainType = 'blue';
                else if (segmentColor === this.neonPink) currentTerrainType = 'magenta';
                break;
            }
        }
        // --- DEBUG: Terrain detection ---
        console.log('[TERRAIN DETECTION]', {
            playerX: this.player.x,
            playerY: this.player.y,
            currentTerrainType,
            onGround: this.onGround,
            segmentColor: segmentColor,
            currentSegment
        });
        if (currentTerrainType === 'blue') {
            console.log('[TERRAIN SEGMENT - BLUE]', currentSegment);
        }
        // --- PHYSICS/POINTS EFFECTS ---
        // Only apply when on ground and not walking
        console.log('[FRICTION CHECK]', { onGround: this.onGround, walkMode: this.inputController.isWalkMode(), currentTerrainType });
        if (this.onGround && !this.inputController.isWalkMode() && currentTerrainType) {
            const Body = getPhaser().Physics.Matter.Matter.Body;
            if (currentTerrainType === 'green') {
                // Speed boost: reduce friction
                console.log('[GAMELOGIC] Setting friction to', 0.01);
                Body.set(this.player.body, 'friction', 0.01);
                console.log('[GAMELOGIC] Setting frictionStatic to', 0.01);
                Body.set(this.player.body, 'frictionStatic', 0.01);
                // No points
            } else if (currentTerrainType === 'blue') {
                // Normal friction
                console.log('[GAMELOGIC] Setting friction to', 0.08);
                Body.set(this.player.body, 'friction', 0.08);
                console.log('[GAMELOGIC] Setting frictionStatic to', 0.08);
                Body.set(this.player.body, 'frictionStatic', 0.08);
                // Award points every 100ms based on speed
                if (!this.terrainTypeTimer) this.terrainTypeTimer = 0;
                this.terrainTypeTimer += delta;
                const velocity = this.player.body.velocity;
                const playerSpeed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
                const base = playerSpeed - PhysicsConfig.blueSpeedThreshold;
                const gain = PhysicsConfig.bluePoints * Math.max(0, base);
                console.log('[BLUE POINTS CHECK]', {onGround: this.onGround, playerSpeed, blueSpeedThreshold: PhysicsConfig.blueSpeedThreshold, gain, delta, timer: this.terrainTypeTimer});
                if (this.terrainTypeTimer >= 100) {
                    if (gain > 0) {
                        this.score += gain;
                        console.log('[BLUE POINTS AWARDED]', {score: this.score, gain});
                    }
                    this.terrainTypeTimer -= 100;
                }
            } else if (currentTerrainType === 'magenta') {
                // Slowdown: increase friction
                console.log('[GAMELOGIC] Setting friction to', 0.28);
                Body.set(this.player.body, 'friction', 0.28);
                console.log('[GAMELOGIC] Setting frictionStatic to', 0.28);
                Body.set(this.player.body, 'frictionStatic', 0.28);
                // No points
            }
        } else {
            // Reset to default friction if not on terrain
            const Body = getPhaser().Physics.Matter.Matter.Body;
            console.log('[GAMELOGIC] Setting friction to', PhysicsConfig.player.friction);
            Body.set(this.player.body, 'friction', PhysicsConfig.player.friction);
            console.log('[GAMELOGIC] Setting frictionStatic to', PhysicsConfig.player.friction);
            Body.set(this.player.body, 'frictionStatic', PhysicsConfig.player.friction);
            this.terrainTypeTimer = 0;
        }

        // --- PARTICLE EMITTER ACTIVATION (FIXED) ---
        // Turn off all emitters first
        this.greenStreakEmitter.stop();
        this.blueBlingEmitter.stop();
        this.magentaFlickerEmitter.stop();

        // CRITICAL DEBUG: Show exact state every few frames
        if (this.time.now % 1000 < 50) { // Log every second approximately
            console.log('[CRITICAL DEBUG]', {
                onGround: this.onGround,
                currentTerrainType: currentTerrainType,
                segmentColor: segmentColor,
                neonGreen: this.neonGreen,
                neonBlue: this.neonBlue,
                neonPink: this.neonPink,
                segmentCount: segments.length,
                playerX: this.player.x,
                playerY: this.player.y
            });
            
            // Also show on screen for easy debugging
            if (!this.debugText) {
                this.debugText = this.add.text(10, 10, '', { 
                    fontSize: '16px', 
                    fill: '#ffffff',
                    backgroundColor: '#000000aa'
                }).setScrollFactor(0);
            }
            this.debugText.setText([
                `onGround: ${this.onGround}`,
                `terrainType: ${currentTerrainType}`,
                `segmentColor: ${segmentColor ? segmentColor.toString(16) : 'null'}`,
                `segments: ${segments.length}`,
                `playerY: ${Math.round(this.player.y)}`
            ].join('\n'));
        }

        // Activate the appropriate emitter based on terrain type
        if (currentTerrainType === 'green' && this.onGround) {
            this.greenStreakEmitter.setPosition(this.player.x, this.player.y + 18);
            // Update angle based on terrain slope
            this.greenStreakEmitter.setConfig({
                angle: { 
                    min: Phaser.Math.RadToDeg(currentTerrainAngle) - 10, 
                    max: Phaser.Math.RadToDeg(currentTerrainAngle) + 10 
                }
            });
            this.greenStreakEmitter.start();
            console.log('[DEBUG] Green emitter started at:', this.player.x, this.player.y + 18, 'onGround:', this.onGround);
        } else if (currentTerrainType === 'blue' && this.onGround) {
            this.blueBlingEmitter.setPosition(this.player.x, this.player.y + 10);
            this.blueBlingEmitter.start();
            console.log('[DEBUG] Blue emitter started at:', this.player.x, this.player.y + 10, 'onGround:', this.onGround);
        } else if (currentTerrainType === 'magenta' && this.onGround) {
            this.magentaFlickerEmitter.setPosition(this.player.x, this.player.y + 15);
            this.magentaFlickerEmitter.start();
            console.log('[DEBUG] Magenta emitter started at:', this.player.x, this.player.y + 15, 'onGround:', this.onGround);
        } else {
            console.log('[DEBUG] No emitter activated - TerrainType:', currentTerrainType, 'onGround:', this.onGround);
        }
        
        // Debug log for emitter activity
        const activeEmitters = [];
        if (this.greenStreakEmitter.on) activeEmitters.push('green');
        if (this.blueBlingEmitter.on) activeEmitters.push('blue');
        if (this.magentaFlickerEmitter.on) activeEmitters.push('magenta');
        if (activeEmitters.length > 0) {
            console.log('[DEBUG] Active particle emitters:', activeEmitters);
        }

        this.lastTerrainType = currentTerrainType;

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
        this.handleSleddingControls(input, delta);
        
        // Update terrain
        this.terrain.update(this.player.x);
        
        // Update collectibles
        this.collectibles.update(time, this.player.x);

        // --- Failsafe: Prevent player from falling through terrain ---
        // If the player sprite is ever below the terrain at the same x,
        // teleport the player directly above the terrain. This prevents rare physics bugs
        // where the player can tunnel through the ground due to high velocity or collision errors.

        // Confirm update loop is running
        if (this.player && this.player.body) {
            console.debug('[Update] Frame', performance.now(), 'Player y:', this.player.y, 'x:', this.player.x);
        }

        if (!this.terrain || !this.player || !this.player.body) {
            // Log which object is missing for debug purposes
            console.warn('[Failsafe] Skipped: terrain, player, or body missing.', {
                terrain: !!this.terrain,
                player: !!this.player,
                body: this.player ? !!this.player.body : 'n/a'
            });
            return;
        }

        // Optionally check terrain bounds if TerrainManager supports it
        const terrainMinX = this.terrain.getMinX?.();
        const terrainMaxX = this.terrain.getMaxX?.();
        if (terrainMinX !== undefined && terrainMaxX !== undefined &&
            (this.player.x < terrainMinX || this.player.x > terrainMaxX)) {
            console.warn('[Failsafe] Player x out of terrain bounds:', this.player.x, terrainMinX, terrainMaxX);
            // Optionally clamp or respawn, but for now just log
        }

        const terrainY = this.terrain.findTerrainHeightAt(this.player.x);
        if (typeof terrainY !== 'number' || isNaN(terrainY)) {
            console.warn('[Failsafe] No valid terrain at x:', this.player.x, 'Player y:', this.player.y);
            // Optionally: teleport to a safe spawn, or freeze player
            // this.respawnPlayer();
            return;
        }

        // Use a dynamic epsilon based on vertical speed
        const epsilon = Math.max(5, Math.abs(this.player.body.velocity.y) * 0.5); // Scales with speed
        if (this.player.y > terrainY + epsilon) {
            console.warn('[Failsafe] Large fall detected. Correcting position.', {
                playerY: this.player.y,
                terrainY,
                velocityY: this.player.body.velocity.y,
                epsilon
            });
            // Move player just above the terrain
            this.player.y = terrainY - 1;
            // Also move the physics body directly
            this.player.body.position.y = terrainY - 1;
            // Zero vertical velocity to prevent instant re-falling
            this.player.body.velocity.y = 0;
            // Clear any residual force
            this.player.body.force.y = 0;
            // Mark this frame as a teleport to avoid repeated physics issues
            this.player.justTeleported = true;
        }

        // --- Buffered ground detection logic ---
        // We want the player to remain "on ground" until they are more than 10px above the terrain.
        // This prevents minor bounces and physics jitter from causing unwanted airborne state.
        const groundBuffer = 10;
        if (this.player.y < terrainY - groundBuffer) {
            // Player is clearly airborne
            this.onGround = false;
        } else {
            // Player is within 10px above terrain, still considered on ground
            this.onGround = true;
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

    
    /**
     * Handles player controls and physics in walking mode.
     *
     * @param {Object} input - Current input state from InputController.
     */
    handleWalkingMode(input) {
        const Body = getPhaser().Physics.Matter.Matter.Body;
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
    /**
     * Applies a passive speed boost based on current speed.
     * Matches the physics from the original GameScene.
     * No longer affected by landing multipliers.
     */
    applyPassiveSpeedBoost() {
        const Body = getPhaser().Physics.Matter.Matter.Body;
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


    /**
     * Handles player controls and physics in sledding mode.
     * Processes rotation, tricks, braking, tucking, parachuting, and jumping.
     *
     * @param {Object} input - Current input state from InputController.
     * @param {number} delta - Time elapsed since last frame in ms.
     */
    handleSleddingControls(input, delta) {
        const Body = getPhaser().Physics.Matter.Matter.Body;
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
                    // Don't reset effectiveness when re-activating during the same jump
                    // Effectiveness only resets on landing
                    
                    // Debug log to check effectiveness when activating
                    console.log(`Parachute activated with effectiveness: ${this.parachuteEffectiveness.toFixed(2)}`);
                } 
                
                // Always decrease effectiveness while parachuting, regardless of how many times activated
                if (this.parachuteEffectiveness > 0) {
                    // Transition from 100% to 0% over exactly 1 second
                    const reductionRate = 1.0; // 100% reduction per second = 100% over 1 second
                    this.parachuteEffectiveness -= (delta / 1000) * reductionRate;
                    
                    // Clamp to minimum of 0 (no effect after 2 seconds)
                    this.parachuteEffectiveness = Math.max(0, this.parachuteEffectiveness);
                    
                    // Debug log to check if effectiveness is changing
                    console.log(`Parachute effectiveness: ${this.parachuteEffectiveness.toFixed(2)}`);
                }
                
                // Move the sled down for parachute visual - height based on effectiveness
                if (this.sled) {
                    // Scale visual effect with effectiveness
                    const offsetY = 15 * this.parachuteEffectiveness; 
                    this.sled.y = this.sledOriginalY + offsetY;
                }
                
                // Counter current velocity for slower falling - scaled by effectiveness
                const currentVelocity = this.player.body.velocity;
                // Calculate factor based on effectiveness (0.8 at full effectiveness, 1.0 at 0% effectiveness)
                // At 0% effectiveness, there should be no parachute effect (factor of 1.0)
                const effectiveFactor = Phaser.Math.Linear(1.0, 0.8, this.parachuteEffectiveness);
                
                // Only reduce downward velocity
                if (currentVelocity.y > 0) {
                    Body.setVelocity(this.player.body, {
                        x: currentVelocity.x,
                        y: currentVelocity.y * effectiveFactor
                    });
                }
                
                // Only apply forward drift if there's effectiveness left
                if (this.parachuteEffectiveness > 0) {
                    // Add slight forward drift - scaled by effectiveness
                    const baseDriftForce = 0.0005;
                    const effectiveDriftForce = baseDriftForce * this.parachuteEffectiveness;
                    Body.applyForce(this.player.body,
                        this.player.body.position,
                        { x: effectiveDriftForce, y: 0 });
                }
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
            // Scale jump height with speed: at or above minSpeedForMaxJump, use full jump; below, interpolate to minJumpVelocity
            const vx = this.player.body.velocity.x;
            const absSpeed = Math.abs(vx);
            const maxSpeed = PhysicsConfig.jump.minSpeedForMaxJump;
            const maxJump = PhysicsConfig.jump.jumpVelocity;
            const minJump = PhysicsConfig.jump.minJumpVelocity;
            // Linear interpolation for jump velocity based on current speed
            let jumpVel = maxJump;
            if (absSpeed < maxSpeed) {
                // Lerp from minJump to maxJump as speed increases
                const t = absSpeed / maxSpeed;
                jumpVel = minJump + (maxJump - minJump) * t;
            }
            // We scale jump height to reward speed: slow = lower jump, fast = full jump
            Body.setVelocity(this.player.body, {
                x: vx,
                y: jumpVel
            });
            this.onGround = false;
            this.hud.showToast('Jump!', 1000);


            // Reset speed multiplier on jump - important physics detail from GameScene
            this.currentSpeedMultiplier = 1.0;
        }
        

        
        // Track rotations for flips
        // (Removed invalid update call; all valid updates above use full state object)

    }
    
    /**
     * Called when a flip or partial flip landing is detected.
     * Applies a one-time velocity impulse and awards points.
     *
     * @param {number} fullFlips - Number of full flips completed.
     * @param {number} partialFlip - Fractional part of a flip (0.0–1.0).
     */
    onFlipComplete(fullFlips, partialFlip) {
    // Flip landing: reward with a single, instantaneous velocity impulse (see flip-impulse.js)
    // No lingering multipliers or sticky buffs—boost is one-and-done.
    
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
        
        // Apply a one-time spring-like impulse for flip landing (see flip-impulse.js)
        // This is a single, non-sticky reward: no lingering speed multiplier.
        applyFlipImpulse(this.player, fullFlips, partialFlip);
        this.currentSpeedMultiplier = 1.0; // Always reset after landing reward!
        
        // Update score and show toast
        this.score += points;
        if (points > 0) {
            this.hud.showToast(message, 2000);
        }
    }
    
    /**
     * Handles collection of an extra life collectible.
     * Increments lives or awards points if at max lives.
     *
     * @param {MatterJS.BodyType} colliderBody - The body of the collected extra life.
     * @returns {boolean} True if collected, false otherwise.
     */
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
    /**
     * Rotates the player to align with the terrain angle.
     * This is crucial for making the player "hug" the terrain.
     *
     * @param {number} terrainAngleRad - The angle of the terrain in radians.
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
    /**
     * Handles player crashes due to bad landings.
     * Uses a life if available, otherwise triggers game over.
     * Matches the original GameScene implementation.
     */
    handleCrash() {
        // Reset player velocity on crash
        const Body = getPhaser().Physics.Matter.Matter.Body;
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
    
    /**
     * Updates the HUD display with player stats, score, and lives.
     */
    updateHud() {
        if (!this.player || !this.hud) return;
        
        // Calculate speed
        const velocity = this.player.body.velocity;
        const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
        
        // Update HUD elements (show integer score only)
        this.hud.update(this.player, Math.floor(this.score), speed, this.lives, PhysicsConfig.extraLives.maxLives);
    }
    

    
    /**
     * Handles resizing of the game window and updates HUD layout.
     *
     * @param {Phaser.Structs.Size} gameSize - The new game size.
     */
    handleResize(gameSize) {
        const { width, height } = gameSize;
        
        // Resize HUD elements through the HUD manager
        if (this.hud) {
            this.hud.handleResize(gameSize);
        }
    }
    
    /**
     * Cleans up resources when the scene is shutdown.
     */
    shutdown() {
        // Clean up resources when scene is shutdown
        this.cleanupBeforeRestart();
    }
    
    /**
     * Cleans up all modules, listeners, and state before restarting or exiting the scene.
     */
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
