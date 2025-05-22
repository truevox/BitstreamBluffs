// js/tests/module-tests.js
// Basic tests for module integrity
// ------------------------------------------------------

/**
 * Simple test script to verify that modules are working correctly.
 * This provides basic console-based testing for the modular architecture.
 */

// Import the modules to test
// Removed InputController import (js/systems removed)
// Removed TerrainManager import (js/systems removed)
// Removed HudDisplay import (js/systems removed)
// Removed CollectibleManager import (js/systems removed)

/**
 * Simple test suite for verifying module integrity and basic functionality.
 */
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
    /**
     * Adds a test to the suite.
     * @param {string} name - Test name.
     * @param {Function} testFn - Test function.
     */
    addTest(name, testFn) {
        this.tests.push({ name, testFn });
    }

    /**
     * Run all tests in the suite
     */
    /**
     * Runs all tests in the suite and prints results to the console.
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
    /**
     * Prints a summary of test results to the console.
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
/**
 * Mock scene for testing Phaser modules and UI logic.
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


// Run the tests
console.log('Module Tests for Bitstream Bluffs');
console.log('-------------------------------');
testSuite.runTests();

// Export the test suite for potential use in other test files
export default testSuite;
