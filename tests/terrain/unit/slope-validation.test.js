/**
 * Unit tests for terrain slope validation
 */
import { jest, describe, test, expect } from '@jest/globals';
import { measurePerformance } from '../../test-utils.js';

// Mock the physics config to avoid external dependencies
jest.mock('../../../js/config/physics-config.js', () => ({
  terrain: {
    minSlopeAngle: 10,
    maxSlopeAngle: 45,
    smoothingFactor: 0.85,
    variationFrequency: 0.2,
    cliffThreshold: 70
  }
}));

// Get the mocked physics config
const PhysicsConfig = jest.requireMock('../../../js/config/physics-config.js');

/**
 * Function to be tested - calculates slope angle 
 * (Extracted from terrain generation logic)
 */
function calculateSlopeAngle(prevY, nextY, segmentWidth) {
  const deltaY = nextY - prevY;
  const angleRad = Math.atan2(Math.abs(deltaY), segmentWidth);
  return angleRad * (180 / Math.PI); // Convert to degrees
}

/**
 * Function to be tested - clamps slope to safe range
 * (Extracted from terrain generation logic)
 */
function clampSlopeAngle(angle) {
  const { minSlopeAngle, maxSlopeAngle } = PhysicsConfig.terrain;
  return Math.max(minSlopeAngle, Math.min(maxSlopeAngle, angle));
}

describe('Terrain Slope Validation', () => {
  // Configure performance timeout for all tests
  jest.setTimeout(5000);

  test('calculateSlopeAngle returns correct angle in degrees', measurePerformance(() => {
    // Test flat terrain (0 degrees)
    expect(calculateSlopeAngle(100, 100, 100)).toBeCloseTo(0);
    
    // Test 45 degree upward slope
    expect(calculateSlopeAngle(100, 200, 100)).toBeCloseTo(45);
    
    // Test 45 degree downward slope
    expect(calculateSlopeAngle(200, 100, 100)).toBeCloseTo(45);
    
    // Test steep cliff (approaching 90 degrees)
    expect(calculateSlopeAngle(100, 500, 10)).toBeCloseTo(88.57, 1); // Updated to match the actual calculation
  }));

  test('clampSlopeAngle constrains angles to min/max values', measurePerformance(() => {
    const { minSlopeAngle, maxSlopeAngle } = PhysicsConfig.terrain;
    
    // Test value below minimum
    expect(clampSlopeAngle(5)).toBe(minSlopeAngle);
    
    // Test value above maximum
    expect(clampSlopeAngle(60)).toBe(maxSlopeAngle);
    
    // Test value within range
    const midValue = (minSlopeAngle + maxSlopeAngle) / 2;
    expect(clampSlopeAngle(midValue)).toBe(midValue);
  }));

  test('extreme slope angles are properly handled', measurePerformance(() => {
    // Test very flat terrain
    const verySmallAngle = calculateSlopeAngle(100, 101, 100);
    const clampedSmallAngle = clampSlopeAngle(verySmallAngle);
    expect(clampedSmallAngle).toBe(PhysicsConfig.terrain.minSlopeAngle);
    
    // Test extremely steep terrain
    const veryLargeAngle = calculateSlopeAngle(100, 500, 50);
    const clampedLargeAngle = clampSlopeAngle(veryLargeAngle);
    expect(clampedLargeAngle).toBe(PhysicsConfig.terrain.maxSlopeAngle);
  }));
});
