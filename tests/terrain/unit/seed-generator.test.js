/**
 * Unit tests for seed generation and deterministic terrain
 */
import { jest, describe, test, expect } from '@jest/globals';
import { generateGameSeed, initializeRandomWithSeed } from '../../../js/utils/seed-generator.js';

// Mock window.crypto for testing SHA-256 implementation
const mockDigest = jest.fn();
const mockSubtle = { digest: mockDigest };
const mockCrypto = { subtle: mockSubtle };

// Mock the global objects that may not exist in test environment
global.TextEncoder = global.TextEncoder || class TextEncoder {
  encode(str) {
    const arr = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      arr[i] = str.charCodeAt(i);
    }
    return arr;
  }
};

// Store original objects to restore after tests
const originalCrypto = global.crypto;
const originalIsSecureContext = global.isSecureContext;

describe('Seed Generator Module', () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockDigest.mockReset();
    
    // Set up crypto mock for SHA-256 testing
    global.crypto = mockCrypto;
    global.isSecureContext = true;
    
    // Mock the crypto.subtle.digest to return predictable values
    mockDigest.mockImplementation((algorithm, data) => {
      return Promise.resolve(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 
                                         17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]));
    });
    
    // Mock console methods to avoid noise in test output
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  
  afterEach(() => {
    // Restore original objects after each test
    global.crypto = originalCrypto;
    global.isSecureContext = originalIsSecureContext;
    
    // Restore console methods
    jest.restoreAllMocks();
  });
  
  describe('generateGameSeed()', () => {
    test('should generate a hexadecimal string', () => {
      const seed = generateGameSeed();
      expect(typeof seed).toBe('string');
      expect(seed).toMatch(/^[0-9a-f]+$/);
    });
    
    test('should generate different seeds on multiple calls', () => {
      const seed1 = generateGameSeed();
      
      // Mock delay between calls
      jest.advanceTimersByTime(100);
      
      const seed2 = generateGameSeed();
      expect(seed1).not.toBe(seed2);
    });
    
    test('should try to use SHA-256 in secure contexts', () => {
      global.isSecureContext = true;
      generateGameSeed();
      expect(mockDigest).toHaveBeenCalled();
      expect(mockDigest.mock.calls[0][0]).toBe('SHA-256');
    });
    
    test('should fallback to FNV-1a when not in secure context', () => {
      global.isSecureContext = false;
      const seed = generateGameSeed();
      expect(mockDigest).not.toHaveBeenCalled();
      expect(seed).toMatch(/^[0-9a-f]+$/);
    });
  });
  
  describe('initializeRandomWithSeed()', () => {
    test('should return a function', () => {
      const random = initializeRandomWithSeed('test-seed');
      expect(typeof random).toBe('function');
    });
    
    test('seeded random function should return a number between 0 and 1', () => {
      const random = initializeRandomWithSeed('test-seed');
      const value = random();
      expect(typeof value).toBe('number');
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    });
    
    test('should produce the same sequence for the same seed', () => {
      const random1 = initializeRandomWithSeed('deterministic-test');
      const random2 = initializeRandomWithSeed('deterministic-test');
      
      // Generate a sequence of 10 random numbers from each PRNG
      const sequence1 = Array.from({ length: 10 }, () => random1());
      const sequence2 = Array.from({ length: 10 }, () => random2());
      
      // They should be identical
      expect(sequence1).toEqual(sequence2);
    });
    
    test('should produce different sequences for different seeds', () => {
      const random1 = initializeRandomWithSeed('seed-one');
      const random2 = initializeRandomWithSeed('seed-two');
      
      // Generate a random number from each PRNG
      const value1 = random1();
      const value2 = random2();
      
      // They should be different with very high probability
      expect(value1).not.toBe(value2);
    });
  });
});
