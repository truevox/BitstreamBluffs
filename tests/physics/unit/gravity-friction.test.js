/**
 * Unit tests for physics gravity and friction calculations
 */
import { measurePerformance, createPhaserSceneMock } from '../../test-utils.js';

// Mock dependencies
jest.mock('../../../js/config/physics-config.js', () => ({
  gravity: {
    default: 1,
    airControl: 0.3,
  },
  surfaces: {
    snow: { friction: 0.05 },
    ice: { friction: 0.01 },
    powder: { friction: 0.08 }
  },
  movement: {
    maxSpeed: 15,
    acceleration: 0.2,
    brakeStrength: 0.4,
    airBrakeStrength: 0.15,
    minBoostStrength: 0.00015,
    speedBoostFactor: 0.00025,
    speedBoostThreshold: 0.3
  }
}));

// Functions to test gravity and friction calculations
function calculateGravityForce(onGround, slopeAngleDegrees) {
  // Convert slope angle to radians for calculations
  const slopeAngleRad = slopeAngleDegrees * (Math.PI / 180);
  
  // Base gravity
  const baseGravity = { x: 0, y: 1 };
  
  if (onGround) {
    // On the ground: gravity is affected by slope
    // Project gravity along the slope for x component
    const gravityAlongSlope = Math.sin(slopeAngleRad) * baseGravity.y;
    return {
      x: gravityAlongSlope,
      y: baseGravity.y
    };
  } else {
    // In the air: normal gravity
    return baseGravity;
  }
}

function lookupFriction(surfaceType) {
  // Import from the mocked physics config
  const PhysicsConfig = require('../../../js/config/physics-config.js');
  
  // Get friction value from config, default to snow if not found
  const surface = PhysicsConfig.surfaces[surfaceType] || PhysicsConfig.surfaces.snow;
  return surface.friction;
}

describe('Physics Gravity and Friction Unit Tests', () => {
  jest.setTimeout(500);
  
  describe('Gravity Calculations', () => {
    test('gravity on flat ground has no horizontal component', measurePerformance(() => {
      const force = calculateGravityForce(true, 0);
      expect(force.x).toBeCloseTo(0);
      expect(force.y).toBeCloseTo(1);
    }));
    
    test('gravity on slopes has appropriate horizontal component', measurePerformance(() => {
      // 30 degree slope
      const force30deg = calculateGravityForce(true, 30);
      expect(force30deg.x).toBeCloseTo(0.5, 2); // sin(30°) = 0.5
      expect(force30deg.y).toBeCloseTo(1);
      
      // 45 degree slope
      const force45deg = calculateGravityForce(true, 45);
      expect(force45deg.x).toBeCloseTo(0.7071, 3); // sin(45°) ≈ 0.7071
      expect(force45deg.y).toBeCloseTo(1);
      
      // Negative slope (going uphill would have negative x component)
      const forceNeg20 = calculateGravityForce(true, -20);
      expect(forceNeg20.x).toBeCloseTo(-0.342, 3); // sin(-20°) ≈ -0.342
      expect(forceNeg20.y).toBeCloseTo(1);
    }));
    
    test('gravity in air is unaffected by slope', measurePerformance(() => {
      // Should be the same regardless of the "slope" underneath
      const force0 = calculateGravityForce(false, 0);
      const force30 = calculateGravityForce(false, 30);
      
      expect(force0.x).toBeCloseTo(0);
      expect(force0.y).toBeCloseTo(1);
      
      expect(force30.x).toBeCloseTo(0);
      expect(force30.y).toBeCloseTo(1);
    }));
  });
  
  describe('Surface Friction Lookups', () => {
    test('returns correct friction values for different surfaces', measurePerformance(() => {
      expect(lookupFriction('snow')).toBe(0.05);
      expect(lookupFriction('ice')).toBe(0.01);
      expect(lookupFriction('powder')).toBe(0.08);
    }));
    
    test('defaults to snow friction for unknown surfaces', measurePerformance(() => {
      expect(lookupFriction('unknown')).toBe(0.05);
      expect(lookupFriction('water')).toBe(0.05);
    }));
    
    test('ice has lower friction than snow', measurePerformance(() => {
      const iceFriction = lookupFriction('ice');
      const snowFriction = lookupFriction('snow');
      
      expect(iceFriction).toBeLessThan(snowFriction);
    }));
    
    test('powder has higher friction than snow', measurePerformance(() => {
      const powderFriction = lookupFriction('powder');
      const snowFriction = lookupFriction('snow');
      
      expect(powderFriction).toBeGreaterThan(snowFriction);
    }));
  });
});
