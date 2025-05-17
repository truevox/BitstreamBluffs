/**
 * Unit tests for trick detection system
 */
import { measurePerformance } from '../../test-utils.js';
import { jest, describe, test, expect } from '@jest/globals';

// Mock dependencies
jest.mock('../../../js/config/physics-config.js', () => ({
  trick: {
    minFlipAngle: 0.75, // Minimum rotation to count as partial flip (in radians)
    fullFlipThreshold: 0.99, // Increased threshold to prevent partial flips from counting as full (was 0.9)
    scoreBase: 100, // Base score for a trick
    comboMultiplier: 1.5, // Multiplier for combos
    maxCombo: 5 // Maximum combo multiplier
  }
}));

// Get the mocked modules
const PhysicsConfig = jest.requireMock('../../../js/config/physics-config.js');

// Create mock rotation tracker system for testing
class RotationTracker {
  constructor() {
    this.totalRotation = 0;
    this.airborne = false;
    this.lastResetTime = 0;
    this.trickHistory = [];
  }
  
  reset() {
    this.totalRotation = 0;
    this.lastResetTime = Date.now();
  }
  
  // Set player as airborne to start tracking rotation
  setAirborne(isAirborne) {
    const wasAirborne = this.airborne;
    this.airborne = isAirborne;
    
    // Reset rotation when landing
    if (wasAirborne && !isAirborne) {
      this.trickComplete();
    }
    
    // Reset rotation when taking off
    if (!wasAirborne && isAirborne) {
      this.reset();
    }
    
    return wasAirborne !== isAirborne; // Return true if state changed
  }
  
  // Add rotation (positive = clockwise, negative = counter-clockwise)
  addRotation(angleRadians) {
    if (!this.airborne) return 0;
    
    this.totalRotation += angleRadians;
    return this.totalRotation;
  }
  
  // Get number of complete flips
  getFullFlips() {
    const fullFlipThreshold = PhysicsConfig.trick.fullFlipThreshold || 0.99;
    
    // Calculate full flips (positive or negative)
    const fullFlips = Math.floor(Math.abs(this.totalRotation) / (Math.PI * 2));
    
    // Calculate partial flip progress
    const partialFlip = (Math.abs(this.totalRotation) % (Math.PI * 2)) / (Math.PI * 2);
    
    // Add an additional flip if we're close enough to completion
    const extraFlip = partialFlip >= fullFlipThreshold ? 1 : 0;
    
    return fullFlips + extraFlip;
  }
  
  // Get partial flip progress (0.0 to 0.99)
  getPartialFlip() {
    const fullRotation = Math.PI * 2;
    const partialFlipValue = (Math.abs(this.totalRotation) % fullRotation) / fullRotation;
    return partialFlipValue;
  }
  
  // Check if current rotation qualifies as a trick
  hasTrick() {
    const minFlipAngle = PhysicsConfig.trick.minFlipAngle || 0.75;
    
    return Math.abs(this.totalRotation) >= minFlipAngle;
  }
  
  // Record completed trick
  trickComplete() {
    if (this.hasTrick()) {
      const fullFlips = this.getFullFlips();
      const partialFlip = this.getPartialFlip();
      const direction = this.totalRotation >= 0 ? 'clockwise' : 'counter-clockwise';
      
      this.trickHistory.push({
        fullFlips,
        partialFlip,
        direction,
        timestamp: Date.now()
      });
      
      this.reset();
      return { fullFlips, partialFlip, direction };
    }
    
    this.reset();
    return null;
  }
  
  // Calculate score for the current trick or trick history
  calculateScore() {
    const baseScore = PhysicsConfig.trick.scoreBase || 100;
    const comboMultiplier = PhysicsConfig.trick.comboMultiplier || 1.5;
    const maxCombo = PhysicsConfig.trick.maxCombo || 5;
    
    let totalScore = 0;
    let currentMultiplier = 1.0;
    
    for (let i = 0; i < this.trickHistory.length; i++) {
      const trick = this.trickHistory[i];
      
      // Base score for full flips
      const flipScore = trick.fullFlips * baseScore;
      
      // Score for partial flip (if significant)
      const partialScore = trick.partialFlip >= 0.25 ? 
        Math.floor(trick.partialFlip * 4) * (baseScore / 4) : 0;
      
      // Apply combo multiplier
      const comboScore = (flipScore + partialScore) * currentMultiplier;
      totalScore += comboScore;
      
      // Increase multiplier for next trick (up to max)
      currentMultiplier = Math.min(currentMultiplier * comboMultiplier, maxCombo);
    }
    
    return Math.floor(totalScore);
  }
}

// Initialize for testing
let rotationTracker;

describe('Trick Detection System', () => {
  // Set up jest timeout for performance testing
  jest.setTimeout(5000);
  
  // Set up a fresh tracker before each test
  beforeEach(() => {
    rotationTracker = new RotationTracker();
  });
  
  test('initializes with zero rotation and not airborne', measurePerformance(() => {
    expect(rotationTracker.totalRotation).toBeCloseTo(0, 1);
    expect(rotationTracker.airborne).toBe(false);
    expect(rotationTracker.trickHistory.length).toBeCloseTo(0, 1);
  }));
  
  test('correctly tracks airborne state changes', measurePerformance(() => {
    // Check initial state
    expect(rotationTracker.airborne).toBe(false);
    
    // Change to airborne
    const stateChanged1 = rotationTracker.setAirborne(true);
    expect(stateChanged1).toBe(true);
    expect(rotationTracker.airborne).toBe(true);
    
    // No change when setting to same state
    const stateChanged2 = rotationTracker.setAirborne(true);
    expect(stateChanged2).toBe(false);
    
    // Change back to grounded
    const stateChanged3 = rotationTracker.setAirborne(false);
    expect(stateChanged3).toBe(true);
    expect(rotationTracker.airborne).toBe(false);
  }));
  
  test('tracks rotation angle correctly', measurePerformance(() => {
    // Set airborne to start tracking
    rotationTracker.setAirborne(true);
    
    // Add some rotation (clockwise)
    rotationTracker.addRotation(Math.PI / 2); // 90 degrees
    expect(rotationTracker.totalRotation).toBeCloseTo(Math.PI / 2);
    
    // Add more rotation
    rotationTracker.addRotation(Math.PI / 2); // Another 90 degrees
    expect(rotationTracker.totalRotation).toBeCloseTo(Math.PI); // 180 degrees total
    
    // Add counter-clockwise rotation
    rotationTracker.addRotation(-Math.PI / 4); // -45 degrees
    expect(rotationTracker.totalRotation).toBeCloseTo(Math.PI * 0.75); // 135 degrees total
  }));
  
  test('detects full flips correctly', measurePerformance(() => {
    rotationTracker.setAirborne(true);
    
    // No flips initially
    expect(rotationTracker.getFullFlips()).toBe(0);
    
    // Add almost one full rotation
    rotationTracker.addRotation(1.9 * Math.PI); // Just shy of a full flip
    expect(rotationTracker.getFullFlips()).toBe(0);
    
    // Complete the rotation to get a full flip
    rotationTracker.addRotation(0.2 * Math.PI);
    expect(rotationTracker.getFullFlips()).toBe(1);
    
    // Add more rotation for multiple flips
    rotationTracker.addRotation(2 * Math.PI * 2.5); // 2.5 more flips
    expect(rotationTracker.getFullFlips()).toBe(3); // Should be 3 full flips total
  }));
  
  test('calculates partial flip progress', measurePerformance(() => {
    rotationTracker.setAirborne(true);
    
    // No rotation initially
    expect(rotationTracker.getPartialFlip()).toBeCloseTo(0);
    
    // Add 1/4 rotation
    rotationTracker.addRotation(Math.PI / 2);
    expect(rotationTracker.getPartialFlip()).toBeCloseTo(0.25);
    
    // Add to half rotation
    rotationTracker.addRotation(Math.PI / 2);
    expect(rotationTracker.getPartialFlip()).toBeCloseTo(0.5);
    
    // Add to 3/4 rotation
    rotationTracker.addRotation(Math.PI / 2);
    expect(rotationTracker.getPartialFlip()).toBeCloseTo(0.75);
    
    // Complete full rotation and start next one
    rotationTracker.addRotation(Math.PI / 2);
    expect(rotationTracker.getPartialFlip()).toBeCloseTo(0);
    
    // Start next rotation
    rotationTracker.addRotation(Math.PI / 4);
    expect(rotationTracker.getPartialFlip()).toBeCloseTo(0.125);
  }));
  
  test('resets rotation counter on landing', measurePerformance(() => {
    // Start in air
    rotationTracker.setAirborne(true);
    
    // Add rotation
    rotationTracker.addRotation(Math.PI);
    expect(rotationTracker.totalRotation).toBeCloseTo(Math.PI);
    
    // Land (should trigger trickComplete and reset)
    rotationTracker.setAirborne(false);
    expect(rotationTracker.totalRotation).toBeCloseTo(0);
    
    // Should have recorded the trick
    expect(rotationTracker.trickHistory.length).toBe(1);
    expect(rotationTracker.trickHistory[0].fullFlips).toBeCloseTo(0, 1);
    expect(rotationTracker.trickHistory[0].partialFlip).toBeCloseTo(0.5);
  }));
  
  test('identifies valid tricks based on minimum rotation', measurePerformance(() => {
    rotationTracker.setAirborne(true);
    
    // Small rotation (not enough for a trick)
    rotationTracker.addRotation(0.2);
    expect(rotationTracker.hasTrick()).toBe(false);
    
    // Add more rotation to reach minimum
    rotationTracker.addRotation(0.6);
    expect(rotationTracker.hasTrick()).toBe(true);
    
    // Complete trick
    const trickResult = rotationTracker.trickComplete();
    expect(trickResult).not.toBeNull();
    expect(trickResult.fullFlips).toBeCloseTo(0, 1);
    expect(trickResult.partialFlip).toBeCloseTo(0.13, 1); // ~13% of a flip
  }));
});
