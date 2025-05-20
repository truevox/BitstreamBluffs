// js/tests/module-tests.js
// Basic tests for module integrity
// ------------------------------------------------------

/**
 * Simple test script to verify that modules are working correctly.
 * This provides basic console-based testing for the modular architecture.
 */

// Import the modules to test
import InputController from '../lib/InputController.js';
import TerrainManager from '../lib/TerrainManager.js';
import HudDisplay from '../lib/HudDisplay.js';
import CollectibleManager from '../lib/CollectibleManager.js';

class ModuleTestSuite {
    constructor() {
        this.tests = [];
        this.results = {
            total: 0,
            passed: 0,
            failed: 0,
        };
    }

    /**
     * Add a test to the suite
     * @param {string} name - Test name
     * @param {Function} testFn - Test function
     */
    addTest(name, testFn) {
        this.tests.push({ name, testFn });
    }

    /**
     * Run all tests in the suite
     */
    async runTests() {
        console.log('🧪 Starting module tests...');
        
        for (const test of this.tests) {
            this.results.total++;
            try {
                await test.testFn();
                console.log(`✅ PASS: ${test.name}`);
                this.results.passed++;
            } catch (error) {
                console.error(`❌ FAIL: ${test.name}`, error);
                this.results.failed++;
            }
        }
        
        this.printSummary();
    }

    /**
     * Print test results summary
     */
    printSummary() {
        console.log('\n--- Test Results Summary ---');
        console.log(`Total tests: ${this.results.total}`);
        console.log(`Passed: ${this.results.passed}`);
        console.log(`Failed: ${this.results.failed}`);
        
        if (this.results.failed === 0) {
            console.log('✨ All tests passed!');
        } else {
            console.error(`⚠️ ${this.results.failed} tests failed!`);
        }
    }
}

/**
 * Mock scene for testing
 */
class MockScene {
    constructor() {
        this.events = {
            on: () => {},
            off: () => {},
            emit: () => {},
        };
        this.add = {
            text: () => ({ setDepth: () => ({ setOrigin: () => ({ setAlpha: () => {} }) }) }),
            container: () => ({ add: () => {}, setDepth: () => {} }),
            graphics: () => ({ fillStyle: () => {}, fillRect: () => {}, lineStyle: () => {}, strokeRect: () => {} }),
        };
        this.cameras = {
            main: {
                width: 1000,
                height: 700,
            },
        };
        this.physics = {
            add: {
                rectangle: () => {},
            },
        };
        this.matter = {
            world: {
                on: () => {},
            },
        };
        this.tweens = {
            add: () => {},
        };
    }
}

// Create the test suite
const testSuite = new ModuleTestSuite();

// Test InputController module
testSuite.addTest('InputController module can be instantiated', () => {
    const mockScene = new MockScene();
    const inputController = new InputController(mockScene);
    if (!inputController) throw new Error('Failed to instantiate InputController');
});

// Test TerrainManager module
testSuite.addTest('TerrainManager module can be instantiated', () => {
    const mockScene = new MockScene();
    const terrainManager = new TerrainManager(mockScene);
    if (!terrainManager) throw new Error('Failed to instantiate TerrainManager');
});

// Test HudDisplay module
testSuite.addTest('HudDisplay module can be instantiated', () => {
    const mockScene = new MockScene();
    const hudDisplay = new HudDisplay(mockScene);
    if (!hudDisplay) throw new Error('Failed to instantiate HudDisplay');
});

// Test CollectibleManager module
testSuite.addTest('CollectibleManager module can be instantiated', () => {
    const mockScene = new MockScene();
    const terrainManager = new TerrainManager(mockScene);
    const collectibleManager = new CollectibleManager(mockScene, terrainManager);
    if (!collectibleManager) throw new Error('Failed to instantiate CollectibleManager');
});

// Run the tests
console.log('Module Tests for Bitstream Bluffs');
console.log('-------------------------------');
testSuite.runTests();

// Export the test suite for potential use in other test files
export default testSuite;
