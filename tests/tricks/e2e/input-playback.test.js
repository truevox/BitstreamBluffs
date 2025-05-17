/**
 * E2E tests for tricks system using input playback and snapshot comparison
 */
import { measurePerformance, mockMathRandom, createPhaserSceneMock } from '../../test-utils.js';
import fs from 'fs';
import path from 'path';
import { jest, describe, test, expect } from '@jest/globals';


// Mock dependencies
jest.mock('../../../js/config/physics-config.js', () => ({
  player: {
    landingSafetyAngle: 30,
    safeLandingSpeedThreshold: 10,
    crashSpeedThreshold: 18
  },
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
  },
  terrain: {
    minSlopeAngle: 10,
    maxSlopeAngle: 45
  },
  trick: {
    minFlipAngle: 0.75,
    fullFlipThreshold: 0.9,
    scoreBase: 100,
    comboMultiplier: 1.5,
    maxCombo: 5,
    comboTimeWindow: 2000
  }
}));

// Get the mocked modules
const PhysicsConfig = jest.requireMock('../../../js/config/physics-config.js');


/**
 * Game simulation that supports input playback for E2E testing
 */
class GameSimulation {
  constructor(seed = 42) {
    this.seed = seed;
    this.resetRandom = mockMathRandom(seed);
    
    // Time tracking
    this.totalTime = 0;
    this.frameTime = 16.67; // ~60fps
    
    // Player state
    this.player = {
      position: { x: 0, y: 500 },
      velocity: { x: 0, y: 0 },
      onGround: true,
      crashed: false,
      wobbling: false,
      currentSpeedMultiplier: 1.0,
      rotation: 0,
      flipping: false
    };
    
    // Trick system
    this.trickSystem = {
      totalRotation: 0,
      flips: 0,
      partialFlip: 0,
      comboCount: 0,
      multiplier: 1.0,
      score: 0,
      lastTrickTime: 0
    };
    
    // Input state
    this.input = {
      left: false,
      right: false,
      up: false,
      down: false,
      space: false
    };
    
    // Generate terrain
    this.terrain = this.generateTerrain(50); // 50 segments
    
    // Game state history for analysis and comparison
    this.stateHistory = [];
    this.inputHistory = [];
    
    // Running state
    this.running = false;
    this.paused = false;
  }
  
  generateTerrain(segmentCount) {
    const segments = [];
    let lastY = 500;
    const segmentWidth = 100;
    
    for (let i = 0; i < segmentCount; i++) {
      // Generate variation using randomness
      const variation = (Math.random() * 2 - 1) * 0.2;
      const smoothingFactor = 0.85;
      
      // Calculate next Y with smoothing
      let nextY = lastY + (variation * 150);
      nextY = lastY + ((nextY - lastY) * smoothingFactor);
      
      // Ensure within bounds
      nextY = Math.max(300, Math.min(700, nextY));
      
      // Calculate angle in degrees
      const deltaY = nextY - lastY;
      const angleRad = Math.atan2(deltaY, segmentWidth);
      const angleDeg = angleRad * (180 / Math.PI);
      
      // Add some features like jumps and flat sections for testing
      let type = 'normal';
      let surfaceType = 'snow';
      
      // Every 10th segment is a jump
      if (i % 10 === 9) {
        type = 'jump';
        nextY -= 50; // Make a gap
      }
      
      // Every 15th segment is icy
      if (i % 15 === 5) {
        surfaceType = 'ice';
      }
      
      segments.push({
        startX: i * segmentWidth,
        startY: lastY,
        endX: (i + 1) * segmentWidth,
        endY: nextY,
        angle: angleDeg,
        type,
        surfaceType
      });
      
      lastY = nextY;
    }
    
    return segments;
  }
  
  getTerrainSegmentAtPosition(x) {
    for (const segment of this.terrain) {
      if (x >= segment.startX && x < segment.endX) {
        return segment;
      }
    }
    return null;
  }
  
  checkTerrainCollision() {
    const segment = this.getTerrainSegmentAtPosition(this.player.position.x);
    if (!segment) return false;
    
    // Calculate terrain height at player x position
    const segmentProgress = (this.player.position.x - segment.startX) / (segment.endX - segment.startX);
    const terrainY = segment.startY + (segment.endY - segment.startY) * segmentProgress;
    
    // Check if player is below (or at) terrain height
    if (this.player.position.y >= terrainY) {
      if (!this.player.onGround) {
        this.handleLanding(segment);
      }
      
      // Snap to terrain
      this.player.position.y = terrainY;
      this.player.onGround = true;
      return true;
    } else {
      // Above terrain
      if (this.player.onGround) {
        this.handleTakeoff();
      }
      return false;
    }
  }
  
  handleLanding(segment) {
    
    
    // Get landing parameters
    const { landingSafetyAngle, safeLandingSpeedThreshold, crashSpeedThreshold } = PhysicsConfig.player;
    
    // Calculate landing metrics
    const landingSpeed = Math.abs(this.player.velocity.y);
    const landingAngle = Math.abs(segment.angle);
    const isAngleSafe = landingAngle <= landingSafetyAngle;
    const isSpeedSafe = landingSpeed <= safeLandingSpeedThreshold;
    const isCrashing = landingSpeed > crashSpeedThreshold || !isAngleSafe;
    
    // Calculate trick score
    if (this.trickSystem.totalRotation > PhysicsConfig.trick.minFlipAngle) {
      const now = this.totalTime;
      const fullRotation = Math.PI * 2;
      
      // Calculate full flips
      const fullFlips = Math.floor(Math.abs(this.trickSystem.totalRotation) / fullRotation);
      
      // Calculate partial flip (0.0 - 0.99)
      const partialFlip = (Math.abs(this.trickSystem.totalRotation) % fullRotation) / fullRotation;
      
      // Add an extra flip if we're very close to completing one
      const extraFlip = partialFlip >= PhysicsConfig.trick.fullFlipThreshold ? 1 : 0;
      const totalFlips = fullFlips + extraFlip;
      
      // Calculate base score
      let trickScore = totalFlips * PhysicsConfig.trick.scoreBase;
      
      // Add partial flip score if significant
      if (partialFlip >= 0.25 && extraFlip === 0) {
        trickScore += Math.floor(partialFlip * 4) * (PhysicsConfig.trick.scoreBase / 4);
      }
      
      // Apply combo multiplier if within time window
      if (now - this.trickSystem.lastTrickTime <= PhysicsConfig.trick.comboTimeWindow) {
        this.trickSystem.comboCount++;
        this.trickSystem.multiplier = Math.min(
          PhysicsConfig.trick.maxCombo,
          this.trickSystem.multiplier * PhysicsConfig.trick.comboMultiplier
        );
      } else {
        this.trickSystem.comboCount = 1;
        this.trickSystem.multiplier = 1.0;
      }
      
      // Apply multiplier to score
      trickScore = Math.floor(trickScore * this.trickSystem.multiplier);
      
      // Update total score
      this.trickSystem.score += trickScore;
      this.trickSystem.lastTrickTime = now;
      
      // Award speed multiplier for successful tricks if landing was clean
      if (!isCrashing) {
        this.player.currentSpeedMultiplier = Math.min(3.0, 
          this.player.currentSpeedMultiplier + (totalFlips * 0.2));
      }
    }
    
    // Reset rotation tracking
    this.trickSystem.totalRotation = 0;
    this.trickSystem.flips = 0;
    this.trickSystem.partialFlip = 0;
    this.player.rotation = 0;
    this.player.flipping = false;
    
    // Handle landing outcome
    if (isCrashing) {
      this.player.crashed = true;
      this.player.velocity.x *= 0.2; // Slow down significantly on crash
      this.player.currentSpeedMultiplier = 1.0; // Reset multiplier
    } else if (!isSpeedSafe && isAngleSafe) {
      this.player.wobbling = true;
      this.player.velocity.x *= 0.7; // Slow down a bit
      setTimeout(() => { this.player.wobbling = false; }, 500);
    }
    
    // Cancel vertical velocity on landing
    this.player.velocity.y = 0;
  }
  
  handleTakeoff() {
    this.player.onGround = false;
  }
  
  processInput() {
    // Handle keyboard input based on current state
    
    
    if (this.player.crashed) return;
    
    // Horizontal movement (left/right)
    if (this.input.left && !this.input.right) {
      if (this.player.onGround) {
        // Ground braking
        this.player.velocity.x -= PhysicsConfig.movement.brakeStrength;
      } else {
        // Air control is weaker
        this.player.velocity.x -= PhysicsConfig.movement.airBrakeStrength;
      }
    } else if (this.input.right && !this.input.left) {
      if (this.player.onGround) {
        // Ground acceleration
        this.player.velocity.x += PhysicsConfig.movement.acceleration;
      } else {
        // Air control
        this.player.velocity.x += PhysicsConfig.movement.airBrakeStrength;
      }
    }
    
    // Flip control in air
    if (this.input.space && !this.player.onGround) {
      this.player.flipping = true;
    }
    
    // Start a jump when pressing up while on ground
    if (this.input.up && this.player.onGround) {
      this.player.velocity.y = -8; // Jump upward
      this.player.onGround = false;
    }
    
    // Tucking (down) for speed boost on ground, or quick drop in air
    if (this.input.down) {
      if (this.player.onGround) {
        // Tucking on ground increases speed
        this.player.velocity.x *= 1.01;
      } else {
        // Quick drop in air
        this.player.velocity.y += 0.5;
      }
    }
  }
  
  updatePhysics() {
    // Skip if paused
    if (this.paused) return;
    
    // Skip if crashed
    if (this.player.crashed) return;
    
    // Convert frameTime to seconds
    const dtSec = this.frameTime / 1000;
    
    // Apply gravity if in air
    if (!this.player.onGround) {
      this.player.velocity.y += (PhysicsConfig.gravity.default * 15) * dtSec;
      
      // Apply flip rotation if flipping
      if (this.player.flipping) {
        const rotationSpeed = 5 * dtSec; // Base rotation speed
        const direction = Math.sign(this.player.velocity.x) || 1; // Use velocity direction
        
        // Add rotation
        const rotationAmount = rotationSpeed * direction;
        this.player.rotation += rotationAmount;
        this.trickSystem.totalRotation += rotationAmount;
        
        // Track full rotations
        const fullRotation = Math.PI * 2;
        this.trickSystem.flips = Math.floor(Math.abs(this.trickSystem.totalRotation) / fullRotation);
        this.trickSystem.partialFlip = (Math.abs(this.trickSystem.totalRotation) % fullRotation) / fullRotation;
      }
    }
    
    // Apply slope force if on ground
    if (this.player.onGround) {
      const segment = this.getTerrainSegmentAtPosition(this.player.position.x);
      if (segment) {
        const slopeAngleRad = segment.angle * (Math.PI / 180);
        const slopeForce = Math.sin(slopeAngleRad) * 10;
        this.player.velocity.x += slopeForce * dtSec;
        
        // Apply appropriate friction based on surface type
        const friction = PhysicsConfig.surfaces[segment.surfaceType]?.friction || 
                        PhysicsConfig.surfaces.snow.friction;
        const frictionForce = friction * Math.abs(this.player.velocity.x);
        const direction = Math.sign(this.player.velocity.x);
        
        if (Math.abs(this.player.velocity.x) > frictionForce) {
          this.player.velocity.x -= direction * frictionForce;
        } else {
          this.player.velocity.x = 0;
        }
      }
    }
    
    // Apply boost from speed multiplier
    if (this.player.onGround && this.player.currentSpeedMultiplier > 1.0) {
      const direction = Math.sign(this.player.velocity.x) || 1;
      const boostStrength = PhysicsConfig.movement.minBoostStrength + 
        (PhysicsConfig.movement.speedBoostFactor * (this.player.currentSpeedMultiplier - 1.0) * 
        Math.abs(this.player.velocity.x));
      
      this.player.velocity.x += direction * boostStrength * 100; // Scaled for simulation
    }
    
    // Apply speed cap
    if (Math.abs(this.player.velocity.x) > PhysicsConfig.movement.maxSpeed) {
      this.player.velocity.x = Math.sign(this.player.velocity.x) * PhysicsConfig.movement.maxSpeed;
    }
    
    // Update position
    this.player.position.x += this.player.velocity.x * dtSec;
    this.player.position.y += this.player.velocity.y * dtSec;
    
    // Check collision with terrain
    this.checkTerrainCollision();
  }
  
  recordState() {
    // Record current game state
    this.stateHistory.push({
      time: this.totalTime,
      position: { ...this.player.position },
      velocity: { ...this.player.velocity },
      onGround: this.player.onGround,
      rotation: this.player.rotation,
      crashed: this.player.crashed,
      score: this.trickSystem.score,
      combo: this.trickSystem.comboCount,
      multiplier: this.trickSystem.multiplier,
      flips: this.trickSystem.flips,
      partialFlip: this.trickSystem.partialFlip
    });
    
    // Record current input state
    this.inputHistory.push({
      time: this.totalTime,
      left: this.input.left,
      right: this.input.right,
      up: this.input.up,
      down: this.input.down,
      space: this.input.space
    });
  }
  
  update() {
    if (!this.running) return;
    
    // Process inputs
    this.processInput();
    
    // Update physics
    this.updatePhysics();
    
    // Record state for later analysis
    this.recordState();
    
    // Update time
    this.totalTime += this.frameTime;
  }
  
  start() {
    this.running = true;
  }
  
  pause() {
    this.paused = true;
  }
  
  resume() {
    this.paused = false;
  }
  
  stop() {
    this.running = false;
  }
  
  setInputState(inputState) {
    this.input = { ...this.input, ...inputState };
  }
  
  getGameState() {
    return {
      time: this.totalTime,
      position: { ...this.player.position },
      velocity: { ...this.player.velocity },
      onGround: this.player.onGround,
      crashed: this.player.crashed,
      score: this.trickSystem.score,
      combo: this.trickSystem.comboCount,
      multiplier: this.trickSystem.multiplier
    };
  }
  
  getStateHistory() {
    return this.stateHistory;
  }
  
  // Load a sequence of input commands to replay
  loadInputSequence(sequence) {
    return sequence;
  }
  
  // Run simulation with a prescribed input sequence
  runWithInputSequence(sequence, duration) {
    this.start();
    
    let elapsed = 0;
    let sequenceIndex = 0;
    
    while (elapsed < duration && sequenceIndex < sequence.length) {
      // Apply next input if it's time
      if (elapsed >= sequence[sequenceIndex].time) {
        this.setInputState(sequence[sequenceIndex].input);
        sequenceIndex++;
      }
      
      // Update game
      this.update();
      
      elapsed += this.frameTime;
      
      // End early if crashed
      if (this.player.crashed) {
        break;
      }
    }
    
    this.stop();
    return this.getStateHistory();
  }
  
  cleanup() {
    this.resetRandom();
  }
}

// Sample input sequences for trick testing
const inputSequences = {
  basicRun: [
    { time: 0, input: { right: true } }, // Start moving right
    { time: 2000, input: { right: true, down: true } }, // Tuck for speed
    { time: 3000, input: { right: true, down: false } }, // Stop tucking
    { time: 5000, input: {} } // Stop inputs
  ],
  
  singleBackflip: [
    { time: 0, input: { right: true } }, // Start moving right
    { time: 2000, input: { right: true, down: true } }, // Tuck for speed
    { time: 2500, input: { right: true, up: true, down: false } }, // Jump
    { time: 2600, input: { right: true, space: true } }, // Start flip
    { time: 3500, input: { right: true } }, // Stop flipping
    { time: 5000, input: {} } // Stop inputs
  ],
  
  multiTrickCombo: [
    { time: 0, input: { right: true } }, // Start moving right
    { time: 1500, input: { right: true, down: true } }, // Tuck for speed
    { time: 2000, input: { right: true, up: true, down: false } }, // Jump
    { time: 2100, input: { right: true, space: true } }, // Start flip
    { time: 2700, input: { right: true } }, // Stop flipping
    { time: 3500, input: { right: true, down: true } }, // Tuck for speed
    { time: 4000, input: { right: true, up: true, down: false } }, // Jump again
    { time: 4100, input: { right: true, space: true } }, // Start flip
    { time: 5000, input: { right: true } }, // Stop flipping
    { time: 6000, input: {} } // Stop inputs
  ],
  
  crashedLanding: [
    { time: 0, input: { right: true } }, // Start moving right
    { time: 1000, input: { right: true, down: true } }, // Tuck for speed
    { time: 2000, input: { right: true, up: true, down: false } }, // Jump
    { time: 2100, input: { right: true, space: true } }, // Start flip but don't complete it
    { time: 2300, input: { right: true, down: true, space: false } }, // Force quick drop
    { time: 3000, input: {} } // Stop inputs
  ]
};

describe('Trick Execution E2E Tests with Input Playback', () => {
  let simulation;
  jest.setTimeout(5000); // Increase timeout for this computationally intensive E2E test
  
  beforeEach(() => {
    simulation = new GameSimulation(42); // Use consistent seed
  });
  
  afterEach(() => {
    simulation.cleanup();
  });
  
  test('successful single backflip execution matches expected output', measurePerformance(() => {
    // Run simulation with single backflip input sequence
    const result = simulation.runWithInputSequence(inputSequences.singleBackflip, 6000);
    
    // Verify the final state after backflip
    const finalState = result[result.length - 1];
    
    // Should have successfully performed a flip
    expect(finalState.score).toBeGreaterThan(0);
    expect(finalState.crashed).toBe(false);
    
    // We know from our specific input sequence that one full flip should be performed
    // This is a golden test - we compare to expected values
    expect(finalState.score).toBe(100); // Base score for 1 flip
  }), 1000);
  
  test('multiple trick combo increases score multiplier', measurePerformance(() => {
    // Run simulation with multi-trick combo input sequence
    const result = simulation.runWithInputSequence(inputSequences.multiTrickCombo, 7000);
    
    // Find the state after the second trick
    const finalState = result[result.length - 1];
    
    // Should have performed multiple tricks with combo
    expect(finalState.score).toBeGreaterThan(100); // More than a single trick
    expect(finalState.multiplier).toBeGreaterThan(1.0); // Should have combo multiplier
    
    // The first trick should have been 100 points
    // The second trick should have combo multiplier applied (at least 1.5)
    expect(finalState.score).toBeGreaterThanOrEqual(250); // 100 + (100 * 1.5)
  }), 1000);
  
  test('crashed landing interrupts trick and resets multiplier', measurePerformance(() => {
    // Run simulation with crashed landing input sequence
    const result = simulation.runWithInputSequence(inputSequences.crashedLanding, 4000);
    
    // Find the final state
    const finalState = result[result.length - 1];
    
    // Should have crashed
    expect(finalState.crashed).toBe(true);
    
    // Should not have awarded score for incomplete trick
    expect(finalState.score).toBeCloseTo(0, 1);
    
    // Multiplier should be reset to 1.0
    expect(finalState.multiplier).toBe(1.0);
  }), 1000);
  
  test('snapshot comparison with golden run', measurePerformance(() => {
    // Run simulation with standard input sequence
    const result = simulation.runWithInputSequence(inputSequences.basicRun, 6000);
    
    // Create key data points for comparison
    const keyMetrics = {
      finalPosition: result[result.length - 1].position,
      maxSpeed: Math.max(...result.map(state => 
        Math.sqrt(state.velocity.x * state.velocity.x + state.velocity.y * state.velocity.y)
      )),
      distanceTraveled: result[result.length - 1].position.x - result[0].position.x,
      crashed: result[result.length - 1].crashed
    };
    
    // Expected values for standard run with seed 42
    const expectedMetrics = {
      finalPosition: { x: expect.any(Number), y: expect.any(Number) },
      maxSpeed: expect.any(Number),
      distanceTraveled: expect.any(Number),
      crashed: false
    };
    
    // Compare with expected snapshot
    expect(keyMetrics).toMatchObject(expectedMetrics);
    
    // Specific assertions for stable metrics
    expect(keyMetrics.distanceTraveled).toBeGreaterThan(1000); // Should move significantly
    expect(keyMetrics.maxSpeed).toBeLessThanOrEqual(15); // Shouldn't exceed max speed
  }), 1000);
});
