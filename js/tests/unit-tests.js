// js/tests/unit-tests.js
// Unit tests for individual modules
// ------------------------------------------------------

/**
 * @fileoverview Comprehensive unit tests for all module components.
 * This file provides test cases for each individual module to ensure
 * they function correctly in isolation.
 */

// Import modules to test
import InputController from '../lib/InputController.js';
import TerrainManager from '../lib/TerrainManager.js';
import HudDisplay from '../lib/HudDisplay.js';
import CollectibleManager from '../lib/CollectibleManager.js';
import PhysicsConfig from '../config/physics-config.js';

/**
 * Unit test framework for Bitstream Bluffs modules
 */
class UnitTestFramework {
    constructor() {
        this.tests = [];
        this.results = {
            total: 0,
            passed: 0,
            failed: 0,
            moduleResults: {},
        };
        
        // Initialize module result tracking
        ['InputController', 'TerrainManager', 'HudDisplay', 'CollectibleManager'].forEach(module => {
            this.results.moduleResults[module] = {
                total: 0,
                passed: 0,
                failed: 0
            };
        });
    }
    
    /**
     * Add a test to the framework
     * @param {string} module - Module being tested
     * @param {string} name - Test name
     * @param {Function} testFn - Test function
     */
    addTest(module, name, testFn) {
        this.tests.push({ module, name, testFn });
    }
    
    /**
     * Run all tests in the framework
     */
    async runTests() {
        console.log('🧪 Starting unit tests...');
        
        for (const test of this.tests) {
            this.results.total++;
            this.results.moduleResults[test.module].total++;
            
            try {
                await test.testFn();
                console.log(`✅ PASS: [${test.module}] ${test.name}`);
                this.results.passed++;
                this.results.moduleResults[test.module].passed++;
            } catch (error) {
                console.error(`❌ FAIL: [${test.module}] ${test.name}`, error);
                this.results.failed++;
                this.results.moduleResults[test.module].failed++;
            }
        }
        
        this.printSummary();
    }
    
    /**
     * Print test results summary
     */
    printSummary() {
        console.log('\n=== Test Results Summary ===');
        console.log(`Total tests: ${this.results.total}`);
        console.log(`Passed: ${this.results.passed}`);
        console.log(`Failed: ${this.results.failed}`);
        
        console.log('\n=== Results by Module ===');
        Object.entries(this.results.moduleResults).forEach(([module, stats]) => {
            if (stats.total > 0) {
                const passRate = Math.round((stats.passed / stats.total) * 100);
                console.log(`${module}: ${stats.passed}/${stats.total} passed (${passRate}%)`);
            }
        });
        
        if (this.results.failed === 0) {
            console.log('\n✨ All tests passed!');
        } else {
            console.error(`\n⚠️ ${this.results.failed} tests failed!`);
        }
    }
}

/**
 * Creates a mock Phaser scene for testing
 * @returns {Object} A mock scene object
 */
function createMockScene() {
    return {
        // Basic scene properties
        add: {
            text: () => ({ 
                setScrollFactor: () => ({ 
                    setDepth: () => ({ 
                        setOrigin: () => ({ 
                            setAlpha: () => ({}) 
                        }) 
                    }) 
                }),
                setText: () => ({}),
                destroy: () => ({})
            }),
            container: () => ({ 
                add: () => ({}), 
                setScrollFactor: () => ({ 
                    setDepth: () => ({}) 
                }),
                setPosition: () => ({}),
                removeAll: () => ({}),
                destroy: () => ({})
            }),
            graphics: () => ({ 
                fillStyle: () => ({}),
                fillRect: () => ({}),
                lineStyle: () => ({}),
                strokeRect: () => ({}),
                lineBetween: () => ({}),
                beginPath: () => ({}),
                moveTo: () => ({}),
                lineTo: () => ({}),
                closePath: () => ({}),
                strokePath: () => ({}),
                fillPath: () => ({}),
                clear: () => ({}),
                destroy: () => ({})
            }),
            circle: () => ({
                setDepth: () => ({}),
                destroy: () => ({})
            }),
            triangle: () => ({
                setDepth: () => ({}),
                destroy: () => ({})
            }),
            rectangle: () => ({
                setDepth: () => ({}),
                destroy: () => ({})
            })
        },
        input: {
            keyboard: {
                createCursorKeys: () => ({
                    left: { isDown: false },
                    right: { isDown: false },
                    up: { isDown: false },
                    down: { isDown: false },
                    space: { isDown: false }
                }),
                addKey: () => ({ isDown: false }),
                checkDown: () => false
            },
            gamepad: {
                total: 0,
                on: () => ({}),
                once: () => ({})
            }
        },
        matter: {
            add: {
                rectangle: () => ({ body: { id: 'mock-body-id' } }),
                fromVertices: () => ({ body: { id: 'mock-body-id' } })
            },
            world: {
                on: () => ({}),
                remove: () => ({})
            }
        },
        physics: {
            add: {
                rectangle: () => ({})
            }
        },
        cameras: {
            main: {
                width: 1000,
                height: 700,
                scrollX: 0
            }
        },
        events: {
            on: () => ({}),
            off: () => ({}),
            emit: () => ({})
        },
        scale: {
            on: () => ({}),
            off: () => ({})
        },
        tweens: {
            add: () => ({})
        },
        time: {
            now: 1000,
            delayedCall: (delay, callback) => {
                if (callback) setTimeout(callback, 1);
                return { remove: () => ({}) };
            }
        },
        textures: {
            exists: () => false,
            get: () => ({})
        },
        make: {
            graphics: () => ({
                fillStyle: () => ({}),
                lineStyle: () => ({}),
                beginPath: () => ({}),
                moveTo: () => ({}),
                lineTo: () => ({}),
                closePath: () => ({}),
                fillPath: () => ({}),
                strokePath: () => ({}),
                generateTexture: () => ({}),
                destroy: () => ({})
            })
        },
        // Random helper for terrain generation testing
        seededRandom: () => Math.random()
    };
}

// Create test framework
const unitTests = new UnitTestFramework();

// --- InputController Tests ---

unitTests.addTest('InputController', 'should initialize with scene', () => {
    const mockScene = createMockScene();
    const controller = new InputController(mockScene);
    
    if (!controller) throw new Error('Failed to create InputController');
    if (!controller.scene) throw new Error('InputController failed to store scene reference');
});

unitTests.addTest('InputController', 'should map actions correctly', () => {
    const mockScene = createMockScene();
    const controller = new InputController(mockScene);
    
    // Verify manette exists after initialization
    if (!controller.manette) throw new Error('Manette not initialized');
});

unitTests.addTest('InputController', 'should update input state', () => {
    const mockScene = createMockScene();
    const controller = new InputController(mockScene);
    
    // This should run without error
    const state = controller.update();
    
    // Verify state object structure
    if (typeof state !== 'object') throw new Error('Update should return state object');
    if (typeof state.left !== 'boolean') throw new Error('State missing left property');
    if (typeof state.right !== 'boolean') throw new Error('State missing right property');
    if (typeof state.jump !== 'boolean') throw new Error('State missing jump property');
});

unitTests.addTest('InputController', 'should clean up resources on destroy', () => {
    const mockScene = createMockScene();
    const controller = new InputController(mockScene);
    
    controller.destroy();
    
    // Verify proper cleanup
    if (controller.manette) throw new Error('Manette not cleaned up');
    if (controller.scene) throw new Error('Scene reference not cleaned up');
});

// --- TerrainManager Tests ---

unitTests.addTest('TerrainManager', 'should initialize with scene', () => {
    const mockScene = createMockScene();
    const terrainManager = new TerrainManager(mockScene);
    
    if (!terrainManager) throw new Error('Failed to create TerrainManager');
    if (!terrainManager.scene) throw new Error('TerrainManager failed to store scene reference');
});

unitTests.addTest('TerrainManager', 'should initialize terrain segments', () => {
    const mockScene = createMockScene();
    const terrainManager = new TerrainManager(mockScene);
    terrainManager.init();
    
    // Verify terrain initialization
    if (!terrainManager.terrainGraphics) throw new Error('TerrainGraphics not initialized');
    if (!terrainManager.terrainSegments || !terrainManager.terrainSegments.length) {
        throw new Error('Initial terrain segments not created');
    }
});

unitTests.addTest('TerrainManager', 'should generate terrain segments', () => {
    const mockScene = createMockScene();
    const terrainManager = new TerrainManager(mockScene);
    terrainManager.init();
    
    const initialCount = terrainManager.terrainSegments.length;
    terrainManager.generateNextTerrainSegment();
    
    // Verify new segment creation
    if (terrainManager.terrainSegments.length !== initialCount + 1) {
        throw new Error('Failed to generate next terrain segment');
    }
});

unitTests.addTest('TerrainManager', 'should find terrain height at position', () => {
    const mockScene = createMockScene();
    const terrainManager = new TerrainManager(mockScene);
    terrainManager.init();
    
    // Test height finding
    const height = terrainManager.findTerrainHeightAt(0);
    
    // Just verify it returns a number
    if (typeof height !== 'number') throw new Error('findTerrainHeightAt should return a number');
});

unitTests.addTest('TerrainManager', 'should clean up resources on destroy', () => {
    const mockScene = createMockScene();
    const terrainManager = new TerrainManager(mockScene);
    terrainManager.init();
    
    terrainManager.destroy();
    
    // Verify proper cleanup
    if (terrainManager.terrainGraphics) throw new Error('TerrainGraphics not cleaned up');
    if (terrainManager.scene) throw new Error('Scene reference not cleaned up');
});

// --- HudDisplay Tests ---

unitTests.addTest('HudDisplay', 'should initialize with scene', () => {
    const mockScene = createMockScene();
    const hudDisplay = new HudDisplay(mockScene);
    
    if (!hudDisplay) throw new Error('Failed to create HudDisplay');
    if (!hudDisplay.scene) throw new Error('HudDisplay failed to store scene reference');
});

unitTests.addTest('HudDisplay', 'should initialize UI elements', () => {
    const mockScene = createMockScene();
    const hudDisplay = new HudDisplay(mockScene);
    hudDisplay.init();
    
    // Verify HUD initialization
    if (!hudDisplay.speedText) throw new Error('Speed text not initialized');
    if (!hudDisplay.pointsText) throw new Error('Points text not initialized');
    if (!hudDisplay.livesDisplay) throw new Error('Lives display not initialized');
    if (!hudDisplay.toastContainer) throw new Error('Toast container not initialized');
});

unitTests.addTest('HudDisplay', 'should update HUD elements', () => {
    const mockScene = createMockScene();
    const hudDisplay = new HudDisplay(mockScene);
    hudDisplay.init();
    
    // Set initial Y position
    hudDisplay.setInitialY(0);
    
    // This should run without error
    hudDisplay.update({ x: 0, y: 100 }, 1000, 50, 3, 5);
});

unitTests.addTest('HudDisplay', 'should show toast messages', () => {
    const mockScene = createMockScene();
    const hudDisplay = new HudDisplay(mockScene);
    hudDisplay.init();
    
    // This should run without error
    hudDisplay.showToast('Test Toast', 100);
});

unitTests.addTest('HudDisplay', 'should clean up resources on destroy', () => {
    const mockScene = createMockScene();
    const hudDisplay = new HudDisplay(mockScene);
    hudDisplay.init();
    
    hudDisplay.destroy();
    
    // Verify proper cleanup
    if (hudDisplay.scene) throw new Error('Scene reference not cleaned up');
});

// --- CollectibleManager Tests ---

unitTests.addTest('CollectibleManager', 'should initialize with scene and terrain manager', () => {
    const mockScene = createMockScene();
    const terrainManager = new TerrainManager(mockScene);
    const collectibleManager = new CollectibleManager(mockScene, terrainManager);
    
    if (!collectibleManager) throw new Error('Failed to create CollectibleManager');
    if (!collectibleManager.scene) throw new Error('CollectibleManager failed to store scene reference');
    if (!collectibleManager.terrainManager) throw new Error('CollectibleManager failed to store terrainManager reference');
});

unitTests.addTest('CollectibleManager', 'should initialize with physics config', () => {
    const mockScene = createMockScene();
    const terrainManager = new TerrainManager(mockScene);
    const collectibleManager = new CollectibleManager(mockScene, terrainManager);
    collectibleManager.init(PhysicsConfig);
    
    // Verify physics config initialization
    if (!collectibleManager.physicsConfig) throw new Error('Physics config not initialized');
});

unitTests.addTest('CollectibleManager', 'should manage extra lives collection', () => {
    const mockScene = createMockScene();
    const terrainManager = new TerrainManager(mockScene);
    const collectibleManager = new CollectibleManager(mockScene, terrainManager);
    collectibleManager.init(PhysicsConfig);
    
    // This should run without error
    collectibleManager.update(1000, 0);
    
    // Test collection with mock collider
    const mockCollider = { id: 'mock-collider' };
    
    // Add a fake extra life to the array
    collectibleManager.extraLives.push({
        body: { id: 'mock-body-id' },
        sprite: {
            x: 0, 
            y: 0, 
            active: true,
            destroy: () => {}
        }
    });
    
    // Test collection - since our mock doesn't match, it should return false but not error
    try {
        collectibleManager.collectExtraLife(mockCollider, () => {});
    } catch (err) {
        throw new Error('collectExtraLife should handle non-matching collider gracefully');
    }
});

unitTests.addTest('CollectibleManager', 'should clean up resources on destroy', () => {
    const mockScene = createMockScene();
    const terrainManager = new TerrainManager(mockScene);
    const collectibleManager = new CollectibleManager(mockScene, terrainManager);
    collectibleManager.init(PhysicsConfig);
    
    collectibleManager.destroy();
    
    // Verify proper cleanup
    if (collectibleManager.scene) throw new Error('Scene reference not cleaned up');
    if (collectibleManager.terrainManager) throw new Error('TerrainManager reference not cleaned up');
    if (collectibleManager.physicsConfig) throw new Error('PhysicsConfig reference not cleaned up');
});

// Run all unit tests
console.log('Bitstream Bluffs Module Unit Tests');
console.log('--------------------------------');
unitTests.runTests();

// Export for potential use in other test files
export default unitTests;
