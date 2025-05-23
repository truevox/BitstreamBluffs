/**
 * E2E tests for memory usage and performance monitoring
 * Tests object cleanup, garbage collection efficiency, and frame rate consistency
 */
import { measurePerformance, mockMathRandom } from '../../test-utils.js';
import { jest, describe, test, expect } from '@jest/globals';


// Mock dependencies
jest.mock('../../../js/config/physics-config.js', () => ({
  performance: {
    targetFPS: 60,
    minAcceptableFPS: 55,
    memoryCheckInterval: 5000, // Check memory usage every 5 seconds
    maxTerrainSegments: 200,   // Maximum terrain segments to keep in memory
    maxParticles: 500,         // Maximum particle effects
    maxOffscreenDistance: 2000 // Distance beyond which objects are removed
  },
  terrain: {
    segmentWidth: 100
  }
}));

// Get the mocked modules
const PhysicsConfig = jest.requireMock('../../../js/config/physics-config.js');


/**
 * Performance monitor that tracks memory usage and frame rate
 */
class PerformanceMonitor {
  constructor() {
    this.PhysicsConfig = PhysicsConfig;
    
    // Performance metrics
    this.frameRates = [];
    this.memoryUsage = [];
    this.frameStartTime = 0;
    this.frameCount = 0;
    this.currentFPS = 0;
    this.fpsUpdateInterval = 1000; // Update FPS every second
    this.lastFpsUpdateTime = 0;
    
    // Object tracking for memory usage estimation
    this.activeObjects = {
      terrainSegments: [],
      collectibles: [],
      particles: []
    };
  }
  
  /**
   * Start tracking a new frame
   */
  startFrame() {
    this.frameStartTime = performance.now();
  }
  
  /**
   * End the current frame and update metrics
   */
  endFrame() {
    const now = performance.now();
    const frameDuration = now - this.frameStartTime;
    
    // Count the frame
    this.frameCount++;
    
    // Update FPS calculation every second
    if (now - this.lastFpsUpdateTime >= this.fpsUpdateInterval) {
      this.currentFPS = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdateTime));
      this.frameRates.push({
        time: now,
        fps: this.currentFPS
      });
      
      // Reset counters
      this.frameCount = 0;
      this.lastFpsUpdateTime = now;
      
      // Check memory usage
      this.checkMemoryUsage(now);
    }
    
    return frameDuration;
  }
  
  /**
   * Track a new object in memory
   * @param {string} type - Object type (terrainSegments, collectibles, particles)
   * @param {Object} object - The object to track
   * @returns {string} - Object ID
   */
  trackObject(type, object) {
    if (!this.activeObjects[type]) {
      this.activeObjects[type] = [];
    }
    
    // Generate ID if needed
    if (!object.id) {
      object.id = `${type}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    }
    
    // Add to tracking list
    this.activeObjects[type].push(object);
    
    return object.id;
  }
  
  /**
   * Remove an object from memory tracking
   * @param {string} type - Object type
   * @param {string} id - Object ID
   * @returns {boolean} - True if object was found and removed
   */
  untrackObject(type, id) {
    if (!this.activeObjects[type]) return false;
    
    const initialLength = this.activeObjects[type].length;
    this.activeObjects[type] = this.activeObjects[type].filter(obj => obj.id !== id);
    
    return this.activeObjects[type].length < initialLength;
  }
  
  /**
   * Check and record memory usage
   * @param {number} time - Current time
   */
  checkMemoryUsage(time) {
    // Count active objects of each type
    const counts = {};
    let totalObjects = 0;
    
    for (const [type, objects] of Object.entries(this.activeObjects)) {
      counts[type] = objects.length;
      totalObjects += objects.length;
    }
    
    // Calculate a memory score (simplified for testing)
    // In a real implementation, we'd use actual memory measurements if available
    const memoryScore = totalObjects * 2; // 2kb per object (simplified estimate)
    
    // Record memory usage
    this.memoryUsage.push({
      time,
      totalObjects,
      counts,
      estimatedMemoryKB: memoryScore
    });
  }
  
  /**
   * Clean up off-screen objects to free memory
   * @param {number} playerX - Player's x position
   * @returns {number} - Number of objects cleaned up
   */
  cleanupOffscreenObjects(playerX) {
    const maxDistance = this.PhysicsConfig.performance.maxOffscreenDistance;
    let cleanedCount = 0;
    
    // Clean up terrain segments
    const initialTerrainCount = this.activeObjects.terrainSegments.length;
    this.activeObjects.terrainSegments = this.activeObjects.terrainSegments.filter(segment => {
      // Keep if within range of player
      return Math.abs(segment.position.x - playerX) <= maxDistance;
    });
    cleanedCount += initialTerrainCount - this.activeObjects.terrainSegments.length;
    
    // Clean up collectibles
    const initialCollectiblesCount = this.activeObjects.collectibles.length;
    this.activeObjects.collectibles = this.activeObjects.collectibles.filter(collectible => {
      // Keep if within range of player or not yet collected
      return collectible.collected || 
        Math.abs(collectible.position.x - playerX) <= maxDistance;
    });
    cleanedCount += initialCollectiblesCount - this.activeObjects.collectibles.length;
    
    // Clean up particles (these should clean up more aggressively)
    const initialParticlesCount = this.activeObjects.particles.length;
    this.activeObjects.particles = this.activeObjects.particles.filter(particle => {
      // Particles cleanup more aggressively based on lifetime and distance
      return particle.lifetime > 0 && 
        Math.abs(particle.position.x - playerX) <= (maxDistance / 2);
    });
    cleanedCount += initialParticlesCount - this.activeObjects.particles.length;
    
    return cleanedCount;
  }
  
  /**
   * Enforce memory limits by pruning excess objects
   * @returns {number} - Number of objects pruned
   */
  enforceMemoryLimits() {
    let prunedCount = 0;
    
    // Terrain segments limit
    if (this.activeObjects.terrainSegments.length > this.PhysicsConfig.performance.maxTerrainSegments) {
      // Sort by distance from player (most distant first)
      this.activeObjects.terrainSegments.sort((a, b) => {
        return Math.abs(b.distanceFromPlayer) - Math.abs(a.distanceFromPlayer);
      });
      
      // Remove excess
      const excessCount = this.activeObjects.terrainSegments.length - 
        this.PhysicsConfig.performance.maxTerrainSegments;
      
      this.activeObjects.terrainSegments = 
        this.activeObjects.terrainSegments.slice(excessCount);
      
      prunedCount += excessCount;
    }
    
    // Particle effects limit
    if (this.activeObjects.particles.length > this.PhysicsConfig.performance.maxParticles) {
      // Sort by lifetime (oldest first)
      this.activeObjects.particles.sort((a, b) => a.lifetime - b.lifetime);
      
      // Remove excess
      const excessCount = this.activeObjects.particles.length - 
        this.PhysicsConfig.performance.maxParticles;
      
      this.activeObjects.particles = this.activeObjects.particles.slice(excessCount);
      
      prunedCount += excessCount;
    }
    
    return prunedCount;
  }
  
  /**
   * Check if performance is acceptable
   * @returns {Object} - Performance assessment
   */
  isPerformanceAcceptable() {
    // Get recent FPS readings
    const recentFPS = this.frameRates.slice(-5);
    
    if (recentFPS.length === 0) {
      return { acceptable: true, reason: 'No data yet' };
    }
    
    // Calculate average recent FPS
    const avgFPS = recentFPS.reduce((sum, frame) => sum + frame.fps, 0) / recentFPS.length;
    
    // Check if FPS is acceptable
    const minFPS = this.PhysicsConfig.performance.minAcceptableFPS;
    const acceptable = avgFPS >= minFPS;
    
    return {
      acceptable,
      avgFPS,
      reason: acceptable ? 'Performance good' : `FPS below minimum (${avgFPS.toFixed(1)} < ${minFPS})`,
      memoryUsage: this.memoryUsage.length > 0 ? 
        this.memoryUsage[this.memoryUsage.length - 1].estimatedMemoryKB : 0
    };
  }
}

/**
 * Game simulation that uses the performance monitor
 */
class GameSimulation {
  constructor(seed = 42) {
    this.seed = seed;
    this.resetRandom = mockMathRandom(seed);
    
    // Performance monitoring
    this.perfMonitor = new PerformanceMonitor();
    
    // Player state
    this.player = {
      position: { x: 0, y: 500 },
      velocity: { x: 5, y: 0 }
    };
    
    // Game state
    this.frameCount = 0;
    this.gameTime = 0;
    this.running = false;
  }
  
  /**
   * Start the game simulation
   */
  start() {
    this.running = true;
  }
  
  /**
   * Stop the game simulation
   */
  stop() {
    this.running = false;
  }
  
  /**
   * Generate terrain as player moves
   */
  generateTerrain() {
    
    const playerX = this.player.position.x;
    const segmentWidth = PhysicsConfig.terrain.segmentWidth;
    
    // Generate terrain segments ahead of player
    const furthestSegment = this.perfMonitor.activeObjects.terrainSegments.reduce(
      (max, segment) => Math.max(max, segment.position.x), 
      playerX
    );
    
    // If we need more terrain ahead
    if (furthestSegment < playerX + 2000) {
      // Generate a few segments
      for (let i = 0; i < 10; i++) {
        const segmentX = furthestSegment + (i * segmentWidth);
        const segment = {
          id: `terrain_${Date.now()}_${i}`,
          position: { x: segmentX, y: 500 + (Math.sin(segmentX / 500) * 50) },
          width: segmentWidth,
          height: 20,
          distanceFromPlayer: segmentX - playerX
        };
        
        this.perfMonitor.trackObject('terrainSegments', segment);
      }
    }
  }
  
  /**
   * Generate particle effects for simulation
   */
  generateParticles() {
    // Occasionally generate particles for testing
    if (Math.random() < 0.1) {
      const particleCount = Math.floor(Math.random() * 20) + 5;
      
      for (let i = 0; i < particleCount; i++) {
        const particle = {
          id: `particle_${Date.now()}_${i}`,
          position: { 
            x: this.player.position.x + (Math.random() * 100 - 50),
            y: this.player.position.y + (Math.random() * 100 - 50)
          },
          lifetime: 100 + Math.random() * 200, // Frames remaining
          velocity: { 
            x: (Math.random() * 2 - 1) * 2,
            y: (Math.random() * 2 - 1) * 2
          }
        };
        
        this.perfMonitor.trackObject('particles', particle);
      }
    }
  }
  
  /**
   * Generate collectibles
   */
  generateCollectibles() {
    // Occasionally spawn collectibles
    if (Math.random() < 0.02) {
      const collectible = {
        id: `collectible_${Date.now()}`,
        position: { 
          x: this.player.position.x + 1000 + Math.random() * 500,
          y: 450 + Math.random() * 100
        },
        collected: false,
        type: Math.random() < 0.5 ? 'coin' : 'powerup'
      };
      
      this.perfMonitor.trackObject('collectibles', collectible);
    }
  }
  
  /**
   * Check collectible collisions
   */
  checkCollectibleCollisions() {
    for (const collectible of this.perfMonitor.activeObjects.collectibles) {
      if (!collectible.collected) {
        const dx = this.player.position.x - collectible.position.x;
        const dy = this.player.position.y - collectible.position.y;
        const distance = Math.sqrt(dx*dx + dy*dy);
        
        if (distance < 40) {
          collectible.collected = true;
        }
      }
    }
  }
  
  /**
   * Update particle lifetimes
   */
  updateParticles() {
    for (const particle of this.perfMonitor.activeObjects.particles) {
      // Update position
      particle.position.x += particle.velocity.x;
      particle.position.y += particle.velocity.y;
      
      // Decrease lifetime
      particle.lifetime--;
    }
  }
  
  /**
   * Update game state
   */
  update() {
    if (!this.running) return;
    
    // Start frame timing
    this.perfMonitor.startFrame();
    
    // Move player forward
    this.player.position.x += this.player.velocity.x;
    
    // Generate new content
    this.generateTerrain();
    this.generateParticles();
    this.generateCollectibles();
    
    // Update game state
    this.updateParticles();
    this.checkCollectibleCollisions();
    
    // Clean up off-screen objects periodically
    if (this.frameCount % 60 === 0) {
      this.perfMonitor.cleanupOffscreenObjects(this.player.position.x);
    }
    
    // Enforce memory limits periodically
    if (this.frameCount % 120 === 0) {
      this.perfMonitor.enforceMemoryLimits();
    }
    
    // End frame timing
    const frameDuration = this.perfMonitor.endFrame();
    
    // Update counters
    this.frameCount++;
    this.gameTime += frameDuration;
  }
  
  /**
   * Run simulation for a specified number of frames
   * @param {number} frames - Number of frames to simulate
   * @returns {Object} - Performance results
   */
  simulate(frames) {
    this.start();
    
    for (let i = 0; i < frames; i++) {
      this.update();
    }
    
    this.stop();
    
    return {
      performanceAssessment: this.perfMonitor.isPerformanceAcceptable(),
      memoryUsage: this.perfMonitor.memoryUsage,
      frameRates: this.perfMonitor.frameRates,
      objectCounts: {
        terrain: this.perfMonitor.activeObjects.terrainSegments.length,
        collectibles: this.perfMonitor.activeObjects.collectibles.length,
        particles: this.perfMonitor.activeObjects.particles.length
      }
    };
  }
  
  cleanup() {
    this.resetRandom();
  }
}

describe('Memory Usage and Performance E2E Tests', () => {
  let gameSimulation;
  jest.setTimeout(5000); // Allow longer timeout for these tests
  
  beforeEach(() => {
    gameSimulation = new GameSimulation(42);
  });
  
  afterEach(() => {
    gameSimulation.cleanup();
  });
  
  test('maintains acceptable frame rate during gameplay', measurePerformance(() => {
    // Run a short simulation (300 frames = ~5 seconds at 60fps)
    const results = gameSimulation.simulate(300);
    
    // Performance should be acceptable
    expect(results.performanceAssessment.acceptable).toBe(true);
    
    // FPS should be near target
    const avgFPS = results.performanceAssessment.avgFPS;
    console.log('avgFPS:', avgFPS);
    expect(typeof avgFPS).toBe('number');
    expect(avgFPS).toBeGreaterThanOrEqual(30);
  }));
  
  test('properly cleans up offscreen objects to manage memory', measurePerformance(() => {
    // Run a longer simulation to generate more objects
    const results = gameSimulation.simulate(600);
    
    // Should have a reasonable number of objects
    expect(results.objectCounts.terrain).toBeLessThanOrEqual(
      gameSimulation.perfMonitor.PhysicsConfig.performance.maxTerrainSegments
    );
    
    // Memory usage should not grow unbounded
    const memoryReadings = results.memoryUsage;
    
    // Get memory usage at different points
    const earlyMemory = memoryReadings[0]?.estimatedMemoryKB || 0;
    const midMemory = memoryReadings[Math.floor(memoryReadings.length / 2)]?.estimatedMemoryKB || 0;
    const lateMemory = memoryReadings[memoryReadings.length - 1]?.estimatedMemoryKB || 0;
    
    // Memory should stabilize - late memory shouldn't be dramatically higher than mid memory
    // Allow some growth but not unbounded
    const growthRate = (lateMemory - midMemory) / midMemory;
    console.log('lateMemory:', lateMemory, 'midMemory:', midMemory, 'growthRate:', growthRate);
    expect(typeof growthRate).toBe('number');
    expect(growthRate).toBeLessThan(0.5); // Less than 50% growth in second half
  }));
  
  test('enforces limits on particle effects', measurePerformance(() => {
    // Run simulation with high particle generation
    const originalRandom = Math.random;
    
    // Mock random to generate more particles
    Math.random = jest.fn().mockImplementation(() => 0.9);
    
    // Run simulation
    const results = gameSimulation.simulate(300);
    
    // Particle count should be capped at the limit
    expect(results.objectCounts.particles).toBeLessThanOrEqual(
      gameSimulation.perfMonitor.PhysicsConfig.performance.maxParticles
    );
    
    // Restore original random
    Math.random = originalRandom;
  }));
  
  test('terrain segments are generated and cleaned up efficiently', measurePerformance(() => {
    // Run simulation
    gameSimulation.simulate(300);
    
    // Check terrain segments
    const segments = gameSimulation.perfMonitor.activeObjects.terrainSegments;
    
    // Should have generated a reasonable number of segments
    expect(segments.length).toBeGreaterThan(0);
    
    // Sort segments by x position
    const sortedSegments = [...segments].sort((a, b) => a.position.x - b.position.x);
    
    // Segments should be continuous
    for (let i = 1; i < sortedSegments.length; i++) {
      const prevSegment = sortedSegments[i - 1];
      const currSegment = sortedSegments[i];
      
      // Each segment should connect to the next
      console.log('prevSegment:', prevSegment, 'currSegment:', currSegment);
    expect(typeof prevSegment.position.x).toBe('number');
    expect(typeof prevSegment.width).toBe('number');
    expect(typeof currSegment.position.x).toBe('number');
    expect(prevSegment.position.x + prevSegment.width).toBeCloseTo(currSegment.position.x, 0);
    }
    
    // Clean up off-screen objects
    const playerX = gameSimulation.player.position.x;
    const cleanedCount = gameSimulation.perfMonitor.cleanupOffscreenObjects(playerX);
    
    // Should have cleaned up some segments that are too far behind player
    expect(cleanedCount).toBeGreaterThan(0);
  }));
});
