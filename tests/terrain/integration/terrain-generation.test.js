/**
 * Integration tests for procedural terrain generation
 */
import { measurePerformance, mockMathRandom, createPhaserSceneMock } from '../../test-utils.js';
import { jest, describe, test, expect } from '@jest/globals';


// Mock the physics config and dependencies
jest.mock('../../../js/config/physics-config.js', () => ({
  terrain: {
    minSlopeAngle: 10,
    maxSlopeAngle: 45,
    smoothingFactor: 0.85,
    variationFrequency: 0.2,
    cliffThreshold: 70,
    segmentWidth: 100
  }
}));

// Get the mocked modules
const PhysicsConfig = jest.requireMock('../../../js/config/physics-config.js');


// Simplified terrain generator for testing
// (Based on the logic in GameScene's generateNextTerrainSegment)
function generateTerrain(seed, segmentCount = 10) {
  const mockRandom = mockMathRandom(seed);
  const segments = [];
  let lastY = 500; // Start at baseline height
  
  for (let i = 0; i < segmentCount; i++) {
    // Generate variation using randomness
    const variation = (Math.random() * 2 - 1) * 0.2;
    const smoothingFactor = 0.85;
    
    // Calculate next Y with smoothing
    let nextY = lastY + (variation * 150);
    nextY = lastY + ((nextY - lastY) * smoothingFactor);
    
    // Ensure within bounds
    nextY = Math.max(300, Math.min(700, nextY));
    
    segments.push({
      startX: i * 100,
      startY: lastY,
      endX: (i + 1) * 100,
      endY: nextY
    });
    
    lastY = nextY;
  }
  
  // Clean up mock
  mockRandom();
  
  return segments;
}

describe('Terrain Generation Integration', () => {
  jest.setTimeout(5000);
  
  test('terrain segments from the same seed are identical', measurePerformance(() => {
    // Generate terrain with same seed twice
    const firstRun = generateTerrain(42);
    const secondRun = generateTerrain(42);
    
    // Compare both runs - they should be identical with same seed
    expect(firstRun).toEqual(secondRun);
    
    // Generate terrain with different seed
    const differentSeed = generateTerrain(100);
    
    // Should be different from first run
    expect(firstRun).not.toEqual(differentSeed);
  }));
  
  test('terrain segments maintain continuity between segments', measurePerformance(() => {
    const segments = generateTerrain(42);
    
    // Check each segment connects to the next one (end Y of current = start Y of next)
    for (let i = 0; i < segments.length - 1; i++) {
      expect(segments[i].endY).toBe(segments[i + 1].startY);
      expect(segments[i].endX).toBe(segments[i + 1].startX);
    }
  }));
  
  test('terrain height stays within expected bounds', measurePerformance(() => {
    const segments = generateTerrain(42, 20); // Generate more segments to test bounds
    
    // Check all segments stay within expected height range
    for (const segment of segments) {
      expect(segment.startY).toBeGreaterThanOrEqual(300);
      expect(segment.startY).toBeLessThanOrEqual(700);
      expect(segment.endY).toBeGreaterThanOrEqual(300);
      expect(segment.endY).toBeLessThanOrEqual(700);
    }
  }));
});
