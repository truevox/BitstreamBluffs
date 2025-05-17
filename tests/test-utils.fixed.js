/**
 * Test utility functions for Bitstream Bluffs
 */
import { jest } from '@jest/globals';

// Performance measurement utilities
export const PERFORMANCE_THRESHOLD_MS = 500;

/**
 * Measures test execution time and logs a warning if it exceeds the threshold
 * @param {Function} testFn - The test function to run
 * @returns {Function} - Jest test wrapper that logs a warning if threshold is exceeded
 */
export const measurePerformance = (testFn) => {
  return async (...args) => {
    const startTime = performance.now();
    await testFn(...args);
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    // Log a warning instead of failing the test
    if (duration > PERFORMANCE_THRESHOLD_MS) {
      console.warn(`Test exceeded performance threshold: ${duration.toFixed(2)}ms > ${PERFORMANCE_THRESHOLD_MS}ms`);
    }
  };
};

/**
 * Creates a seeded pseudo-random number generator
 * @param {number} seed - The seed for the PRNG
 * @returns {Function} - A predictable random function
 */
export const createSeededRNG = (seed = 1) => {
  let currentSeed = seed;
  
  return () => {
    currentSeed = (currentSeed * 9301 + 49297) % 233280;
    return currentSeed / 233280;
  };
};

/**
 * Mocks Math.random with a seeded version for deterministic tests
 * @param {number} seed - The seed to use
 * @returns {Function} - A cleanup function to restore original Math.random
 */
export const mockMathRandom = (seed = 1) => {
  const originalRandom = Math.random;
  const seededRandom = createSeededRNG(seed);
  Math.random = jest.fn().mockImplementation(seededRandom);
  
  return () => {
    Math.random = originalRandom;
  };
};

/**
 * Creates a minimal Phaser scene mock for testing
 * @returns {Object} - A minimal mock of the Phaser.Scene object
 */
export const createPhaserSceneMock = () => {
  return {
    add: {
      graphics: jest.fn().mockReturnValue({
        fillStyle: jest.fn().mockReturnThis(),
        fillRect: jest.fn().mockReturnThis(),
        generateTexture: jest.fn(),
        lineStyle: jest.fn().mockReturnThis(),
        lineBetween: jest.fn().mockReturnThis(),
        strokeRect: jest.fn().mockReturnThis(),
        fillCircle: jest.fn().mockReturnThis(),
        strokeCircle: jest.fn().mockReturnThis(),
        fillTriangle: jest.fn().mockReturnThis(),
      }),
      image: jest.fn().mockReturnValue({
        setPosition: jest.fn().mockReturnThis(),
        setOrigin: jest.fn().mockReturnThis(),
        setScale: jest.fn().mockReturnThis(),
        setAlpha: jest.fn().mockReturnThis(),
      }),
      text: jest.fn().mockReturnValue({
        setPosition: jest.fn().mockReturnThis(),
        setOrigin: jest.fn().mockReturnThis(),
        setText: jest.fn().mockReturnThis(),
      }),
    },
    make: {
      graphics: jest.fn().mockReturnValue({
        fillStyle: jest.fn().mockReturnThis(),
        fillRect: jest.fn().mockReturnThis(),
        generateTexture: jest.fn(),
        lineStyle: jest.fn().mockReturnThis(),
        lineBetween: jest.fn().mockReturnThis(),
        strokeRect: jest.fn().mockReturnThis(),
        fillCircle: jest.fn().mockReturnThis(),
        strokeCircle: jest.fn().mockReturnThis(),
        fillTriangle: jest.fn().mockReturnThis(),
      }),
    },
    physics: {
      matter: {
        add: {
          rectangle: jest.fn().mockReturnValue({
            setStatic: jest.fn().mockReturnThis(),
            setCollisionGroup: jest.fn().mockReturnThis(),
          }),
          image: jest.fn().mockReturnValue({
            setFriction: jest.fn().mockReturnThis(),
            setFrictionAir: jest.fn().mockReturnThis(),
            setFixedRotation: jest.fn().mockReturnThis(),
            setPosition: jest.fn().mockReturnThis(),
            setVelocity: jest.fn().mockReturnThis(),
            setBody: jest.fn().mockReturnThis(),
          }),
        },
        world: {
          on: jest.fn(),
          setBounds: jest.fn(),
        },
        Matter: {
          Body: {
            applyForce: jest.fn(),
            setVelocity: jest.fn(),
            setAngularVelocity: jest.fn(),
          },
          Bodies: {
            rectangle: jest.fn(),
            circle: jest.fn(),
          },
        },
      },
    },
    events: {
      on: jest.fn(),
      emit: jest.fn(),
    },
    load: {
      image: jest.fn(),
      on: jest.fn(),
    },
    cameras: {
      main: {
        setBounds: jest.fn(),
        startFollow: jest.fn(),
      },
    },
    time: {
      delayedCall: jest.fn().mockImplementation((delay, callback) => {
        setTimeout(callback, 0); // Execute immediately for tests
        return { remove: jest.fn() };
      }),
    },
    tweens: {
      add: jest.fn().mockImplementation(config => {
        if (config.onComplete) {
          setTimeout(config.onComplete, 0);
        }
        return { remove: jest.fn() };
      }),
    },
    input: {
      keyboard: {
        createCursorKeys: jest.fn().mockReturnValue({
          up: { isDown: false },
          down: { isDown: false },
          left: { isDown: false },
          right: { isDown: false },
          space: { isDown: false },
        }),
      },
    },
  };
};
