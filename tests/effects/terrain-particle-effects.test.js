// tests/effects/terrain-particle-effects.test.js
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import ModularGameScene from '../../js/ModularGameScene.js';

// Mock Phaser's Scene and other dependencies
jest.mock('../../js/lib/TerrainManager.js');
jest.mock('../../js/lib/InputController.js');
jest.mock('../../js/lib/HudDisplay.js');
jest.mock('../../js/lib/CollectibleManager.js');
jest.mock('../../js/utils/ExplosionEffects.js');
jest.mock('../../js/background/StarfieldParallax.js');
jest.mock('../../js/config/physics-config.js', () => ({
    player: {
        restitution: 0.1,
        friction: 0.08,
        frictionAir: 0.01,
        density: 0.001
    },
    jump: {
        jumpVelocity: -10,
        minJumpVelocity: -5,
        walkJumpVelocity: -7,
        minSpeedForMaxJump: 10,
    },
    rotation: {
        slopeAlignmentFactor: 0.1,
        groundRotationVel: 0.1,
        airRotationVel: 0.05,
    },
    movement: {
        downhillBiasForce: 0.0005,
        pushForce: 0.001,
        minBoostStrength: 0.0002,
    },
    extraLives: {
        initialLives: 3,
        maxLives: 5,
    },
    blueSpeedThreshold: 5,
    bluePoints: 10,
    terrain: { // Add terrain colors to mock
        colors: {
            neonGreen: 0x00ff88,
            neonBlue: 0x00ffff,
            neonPink: 0xff00ff,
        }
    }
}));


// Mock the global Phaser object
global.Phaser = {
    Scene: class {
        constructor(config) {
            this.sys = { events: { on: jest.fn(), off: jest.fn() } };
            this.cameras = { main: { centerX: 0, centerY: 0, worldView: { bottom: 1000, left: -500 }, setBackgroundColor: jest.fn(), startFollow: jest.fn(), setFollowOffset: jest.fn(), scrollX:0, scrollY:0, width: 800, height: 600 } };
            this.add = {
                particles: jest.fn((config) => ({
                    setPosition: jest.fn(),
                    setAngle: jest.fn(),
                    setVisible: jest.fn(),
                    active: false, // Mocked property
                    visible: false, // Mocked property
                    setDepth: jest.fn().mockReturnThis(), // Mock setDepth for chaining
                    stop: jest.fn() // Mock stop if called during cleanup
                })),
                triangle: jest.fn().mockReturnThis(),
                rectangle: jest.fn().mockReturnThis(),
                container: jest.fn().mockImplementation(() => ({
                    setExistingBody: jest.fn().mockReturnThis(),
                    setFixedRotation: jest.fn().mockReturnThis(),
                    setPosition: jest.fn().mockReturnThis(),
                    setDepth: jest.fn().mockReturnThis(),
                    add: jest.fn(),
                    body: { // Mock player body
                        position: { x: 0, y: 0 },
                        velocity: { x: 0, y: 0 },
                        angle: 0,
                        force: {x:0, y:0}
                    }
                })),
                circle: jest.fn().mockReturnThis(), // Mock circle for static stars
                text: jest.fn().mockImplementation(() => ({ // Mock text for game over
                    setDepth: jest.fn().mockReturnThis(),
                    setOrigin: jest.fn().mockReturnThis(),
                })),
            };
            this.make = { graphics: jest.fn(() => ({ fillStyle: jest.fn(), fillCircle: jest.fn(), generateTexture: jest.fn() })) };
            this.matter = {
                world: {
                    on: jest.fn(),
                    off: jest.fn(),
                    setGravity: jest.fn(),
                },
                add: {
                    gameObject: jest.fn().mockReturnThis()
                },
                Matter: { // Mock Matter.Body and Matter.Bodies
                    Body: {
                        set: jest.fn(),
                        applyForce: jest.fn(),
                        setVelocity: jest.fn(),
                        setAngle: jest.fn(),
                        setAngularVelocity: jest.fn(),
                        translate: jest.fn(),
                    },
                    Bodies: {
                        circle: jest.fn().mockReturnValue({ label: 'playerBody' })
                    }
                }
            };
            this.load = { image: jest.fn() };
            this.scale = { on: jest.fn(), off: jest.fn() };
            this.time = { delayedCall: jest.fn((delay, callback) => callback()) }; // Execute delayed calls immediately for tests
            this.scene = { restart: jest.fn(), start: jest.fn(), isActive: true }; // Mock scene methods
            this.input = { keyboard: { addKey: jest.fn(() => ({ isDown: false })) } }; // Mock input
            this.tweens = { add: jest.fn() }; // Mock tweens

            // Mock scene properties that ModularGameScene constructor accesses
            this.neonYellow = 0xffff00;
            this.neonBlue = 0x00ffff;
            this.neonPink = 0xff00ff;
            this.neonGreen = 0x00ff88;
            this.neonRed = 0xff0000;
        }
    },
    Math: { // Mock Phaser.Math
        Between: jest.fn((min, max) => (min + max) / 2),
        RadToDeg: jest.fn(rad => rad * (180 / Math.PI)),
        DegToRad: jest.fn(deg => deg * (Math.PI / 180)),
        Linear: jest.fn((v0, v1, t) => v0 + (v1 - v0) * t),
        RND: { pick: jest.fn(arr => arr[0]) } // Mock RND.pick
    },
    // Mock any other Phaser specifics if needed
    Physics: {
        Matter: {
            Matter: { // Nested Matter for Body and Bodies
                 Body: {
                        set: jest.fn(),
                        applyForce: jest.fn(),
                        setVelocity: jest.fn(),
                        setAngle: jest.fn(),
                        setAngularVelocity: jest.fn(),
                        translate: jest.fn(),
                    },
                Bodies: {
                    circle: jest.fn().mockReturnValue({ label: 'playerBody' })
                }
            }
        }
    }
};


describe('Terrain Particle Effects', () => {
    let scene;

    beforeEach(() => {
        // Reset mocks for ModularGameScene's constructor dependencies if they are stateful
        // For example, if TerrainManager was retaining state between tests.
        // Here we are creating a new scene for each test, so internal state is fresh.

        scene = new ModularGameScene();

        // Mock player object and its properties after scene instantiation
        scene.player = {
            x: 100,
            y: 100,
            body: { // Ensure player.body and its properties are mocked
                position: { x: 100, y: 100 },
                velocity: { x: 0, y: 0 },
                angle: 0,
                force: {x:0, y:0}
            },
            angle: 0, // player.angle is used directly in some places
        };
        
        // Mock TerrainManager methods used in update loop
        scene.terrain = {
            getTerrainSegments: jest.fn().mockReturnValue([]), // Default to no segments
            update: jest.fn(),
            findTerrainHeightAt: jest.fn().mockReturnValue(100), // Default terrain height
            getMinX: jest.fn().mockReturnValue(0),
            getMaxX: jest.fn().mockReturnValue(1000),
        };
        
        // Mock InputController methods
        scene.inputController = {
            update: jest.fn().mockReturnValue({}), // Default to no input
            isWalkMode: jest.fn().mockReturnValue(false), // Default to not walking
            manette: { actions: {} } // Mock manette actions
        };

        // Mock HUD
        scene.hud = {
            update: jest.fn(),
            showToast: jest.fn(),
            setInitialY: jest.fn(),
            updateLivesDisplay: jest.fn()
        };
        
        // Mock Collectibles
        scene.collectibles = {
            update: jest.fn()
        };

        // Mock Starfield
        scene.starfield = {
            update: jest.fn()
        };

        // Mock RotationSystem
        scene.rotationSystem = {
            update: jest.fn(),
            getFlipStats: jest.fn().mockReturnValue({ fullFlips: 0, partialFlip: 0 }),
            reset: jest.fn()
        };


        // Call create manually since it's not called by the Scene constructor mock
        // This is important for initializing emitters
        scene.create();

        // Assign mocked emitters after scene.create() has run
        // ModularGameScene's create method calls this.add.particles, which returns our mock
        // We need to ensure these are the exact mocks that will be asserted on.
        // The jest.fn().mockImplementation in the Phaser mock for add.particles ensures
        // that distinct mock objects are created for each emitter. We retrieve them here.
        // Order of calls in ModularGameScene.create for this.add.particles:
        // 1. (Optional testEmitter - commented out)
        // 2. greenStreakEmitter
        // 3. blueBlingEmitter
        // 4. magentaFlickerEmitter

        // If testEmitter was active, indices would shift.
        // Assuming testEmitter is commented out as per previous subtask:
        expect(scene.add.particles).toHaveBeenCalledTimes(3); // green, blue, magenta
        
        // Retrieve the mocked emitters based on the order of creation
        const createdEmitters = scene.add.particles.mock.results;
        scene.greenStreakEmitter = createdEmitters[0].value;
        scene.blueBlingEmitter = createdEmitters[1].value;
        scene.magentaFlickerEmitter = createdEmitters[2].value;

        // Reset calls from create() so we only count calls from update()
        scene.greenStreakEmitter.setPosition.mockClear();
        scene.greenStreakEmitter.setVisible.mockClear();
        scene.blueBlingEmitter.setPosition.mockClear();
        scene.blueBlingEmitter.setVisible.mockClear();
        scene.magentaFlickerEmitter.setPosition.mockClear();
        scene.magentaFlickerEmitter.setVisible.mockClear();

    });

    const simulateTerrain = (terrainType, terrainAngle = 0) => {
        let color;
        switch (terrainType) {
            case 'green':
                color = scene.neonGreen; // Use the scene's color value
                break;
            case 'blue':
                color = scene.neonBlue;
                break;
            case 'magenta':
                color = scene.neonPink;
                break;
            default:
                color = 0xffffff; // Default white for other terrain
        }
        scene.terrain.getTerrainSegments.mockReturnValue([
            { x: 50, endX: 150, color: color, angle: terrainAngle, y: 100, endY: 100 } // Mock segment under player
        ]);
    };

    test('greenStreakEmitter is active and visible on green terrain when player is on ground', () => {
        scene.onGround = true;
        simulateTerrain('green', 0.1); // Simulate green terrain with a slight angle
        scene.currentSlopeAngle = 0.1; // Set currentSlopeAngle directly

        scene.update(0, 16); // Call update method (time, delta)

        expect(scene.greenStreakEmitter.setPosition).toHaveBeenCalledWith(scene.player.x, scene.player.y + 10);
        expect(scene.greenStreakEmitter.setAngle).toHaveBeenCalled(); // Angle calculation is complex, just check it's called
        expect(scene.greenStreakEmitter.setVisible).toHaveBeenCalledWith(true);
        expect(scene.greenStreakEmitter.active).toBe(true);

        expect(scene.blueBlingEmitter.setVisible).toHaveBeenCalledWith(false);
        expect(scene.blueBlingEmitter.active).toBe(false);
        expect(scene.magentaFlickerEmitter.setVisible).toHaveBeenCalledWith(false);
        expect(scene.magentaFlickerEmitter.active).toBe(false);
    });

    test('blueBlingEmitter is active and visible on blue terrain when player is on ground', () => {
        scene.onGround = true;
        simulateTerrain('blue');
        scene.currentSlopeAngle = 0;

        scene.update(0, 16);

        expect(scene.blueBlingEmitter.setPosition).toHaveBeenCalledWith(scene.player.x, scene.player.y + 10);
        expect(scene.blueBlingEmitter.setVisible).toHaveBeenCalledWith(true);
        expect(scene.blueBlingEmitter.active).toBe(true);

        expect(scene.greenStreakEmitter.setVisible).toHaveBeenCalledWith(false);
        expect(scene.greenStreakEmitter.active).toBe(false);
        expect(scene.magentaFlickerEmitter.setVisible).toHaveBeenCalledWith(false);
        expect(scene.magentaFlickerEmitter.active).toBe(false);
    });

    test('magentaFlickerEmitter is active and visible on magenta terrain when player is on ground', () => {
        scene.onGround = true;
        simulateTerrain('magenta');
        scene.currentSlopeAngle = 0;

        scene.update(0, 16);

        expect(scene.magentaFlickerEmitter.setPosition).toHaveBeenCalledWith(scene.player.x, scene.player.y + 10);
        expect(scene.magentaFlickerEmitter.setVisible).toHaveBeenCalledWith(true);
        expect(scene.magentaFlickerEmitter.active).toBe(true);

        expect(scene.greenStreakEmitter.setVisible).toHaveBeenCalledWith(false);
        expect(scene.greenStreakEmitter.active).toBe(false);
        expect(scene.blueBlingEmitter.setVisible).toHaveBeenCalledWith(false);
        expect(scene.blueBlingEmitter.active).toBe(false);
    });

    test('all terrain particle emitters are inactive and invisible when player is airborne', () => {
        scene.onGround = false; // Player is airborne
        simulateTerrain('green'); // Current terrain type doesn't matter if airborne
        scene.currentSlopeAngle = 0;


        scene.update(0, 16);

        expect(scene.greenStreakEmitter.setVisible).toHaveBeenCalledWith(false);
        expect(scene.greenStreakEmitter.active).toBe(false);
        expect(scene.blueBlingEmitter.setVisible).toHaveBeenCalledWith(false);
        expect(scene.blueBlingEmitter.active).toBe(false);
        expect(scene.magentaFlickerEmitter.setVisible).toHaveBeenCalledWith(false);
        expect(scene.magentaFlickerEmitter.active).toBe(false);
    });

    test('all terrain particle emitters are inactive and invisible on default terrain when player is on ground', () => {
        scene.onGround = true;
        simulateTerrain('default'); // Simulate terrain without a specific particle effect
        scene.currentSlopeAngle = 0;

        scene.update(0, 16);

        expect(scene.greenStreakEmitter.setVisible).toHaveBeenCalledWith(false);
        expect(scene.greenStreakEmitter.active).toBe(false);
        expect(scene.blueBlingEmitter.setVisible).toHaveBeenCalledWith(false);
        expect(scene.blueBlingEmitter.active).toBe(false);
        expect(scene.magentaFlickerEmitter.setVisible).toHaveBeenCalledWith(false);
        expect(scene.magentaFlickerEmitter.active).toBe(false);
    });
});

// Helper to ensure console logs/warns from ModularGameScene don't clutter test output
beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
    console.log.mockRestore();
    console.warn.mockRestore();
    console.debug.mockRestore();
});
