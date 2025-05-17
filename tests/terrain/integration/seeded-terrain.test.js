/**
 * Integration tests for seeded terrain generation
 * Verifies that the same seed always produces the same terrain
 */
import { jest, describe, test, expect } from '@jest/globals';
import { initializeRandomWithSeed } from '../../../js/utils/seed-generator.js';

// Mock the physics config
jest.mock('../../../js/config/physics-config.js', () => ({
  terrain: {
    minSlopeAngle: 10,
    maxSlopeAngle: 45,
    smoothingFactor: 0.85,
    variationFrequency: 0.2,
    cliffThreshold: 70
  }
}));

// Simplified terrain generator for testing (based on the actual game's implementation)
function generateTestTerrain(seededRandom, segmentCount = 20) {
  const segments = [];
  let lastY = 500; // Starting Y position
  const segmentWidth = 100;
  
  for (let i = 0; i < segmentCount; i++) {
    // Use the seeded random function for terrain generation
    const r = seededRandom();
    
    // Calculate next Y position using same logic as in the game
    let newY = lastY;
    
    if (i === 0) {
      // First segment has fixed slope
      newY += 50; 
    } else {
      // Terrain variation based on seeded random
      if (r < 0.60) newY += Math.floor(r * 70) + 35;      // Moderate downslope
      else if (r < 0.85) newY += Math.floor(r * 50) + 70;  // Steep downslope
      else if (r < 0.95) newY += Math.floor(r * 40) - 15;  // Mild variation
      else newY -= Math.floor(r * 30) + 10;                // Occasional upslope
    }
    
    // Clamp to reasonable values
    newY = Math.max(lastY - 60, Math.min(lastY + 150, newY));
    
    // Create segment
    segments.push({
      x1: i * segmentWidth, 
      y1: lastY,
      x2: (i + 1) * segmentWidth, 
      y2: newY,
      // Color also uses seeded random
      color: seededRandom() < 0.5 ? 'blue' : 'pink'
    });
    
    lastY = newY;
  }
  
  return segments;
}

describe('Seeded Terrain Generation', () => {
  test('same seed always produces identical terrain', () => {
    const testSeed = 'bitstreambluffs-test-seed-2025';
    
    // Create two separate random generators with the same seed
    const seededRandom1 = initializeRandomWithSeed(testSeed);
    const seededRandom2 = initializeRandomWithSeed(testSeed);
    
    // Generate terrain with both random generators
    const terrain1 = generateTestTerrain(seededRandom1);
    const terrain2 = generateTestTerrain(seededRandom2);
    
    // They should be identical
    expect(terrain1).toEqual(terrain2);
    
    // Check a few specific segments
    expect(terrain1[5].y2).toBe(terrain2[5].y2);
    expect(terrain1[10].color).toBe(terrain2[10].color);
  });
  
  test('different seeds produce different terrain', () => {
    const seedA = 'bitstreambluffs-seed-A';
    const seedB = 'bitstreambluffs-seed-B';
    
    // Create two separate random generators with different seeds
    const seededRandomA = initializeRandomWithSeed(seedA);
    const seededRandomB = initializeRandomWithSeed(seedB);
    
    // Generate terrain with both random generators
    const terrainA = generateTestTerrain(seededRandomA);
    const terrainB = generateTestTerrain(seededRandomB);
    
    // They should be different (at least in some segments)
    let differences = 0;
    for (let i = 0; i < terrainA.length; i++) {
      if (terrainA[i].y2 !== terrainB[i].y2 || terrainA[i].color !== terrainB[i].color) {
        differences++;
      }
    }
    
    // With different seeds, we expect at least some differences
    expect(differences).toBeGreaterThan(0);
  });
  
  test('seeded terrain has reasonable slopes', () => {
    const testSeed = 'bitstreambluffs-test-seed-2025';
    const seededRandom = initializeRandomWithSeed(testSeed);
    const terrain = generateTestTerrain(seededRandom, 50); // Generate more segments for this test
    
    // Check that terrain generally goes downward (as it should in a downhill game)
    // Take the first and last points to see the general trend
    const firstY = terrain[0].y1;
    const lastY = terrain[terrain.length - 1].y2;
    
    // In a downhill game, the terrain should generally trend downward
    expect(lastY).toBeGreaterThan(firstY);
    
    // Calculate all slopes and check they're within reasonable bounds
    for (const segment of terrain) {
      const deltaX = segment.x2 - segment.x1;
      const deltaY = segment.y2 - segment.y1;
      const slopeAngleDeg = Math.atan2(Math.abs(deltaY), deltaX) * (180 / Math.PI);
      
      // Check that slope isn't too steep (game would be unplayable)
      expect(slopeAngleDeg).toBeLessThan(70);
    }
  });
});
