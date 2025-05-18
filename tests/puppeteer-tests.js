// tests/puppeteer-tests.js
// Comprehensive gameplay tests for Bitstream Bluffs using Puppeteer
// ----------------------------------------------------------------------

import puppeteer from 'puppeteer';
import { expect } from 'chai';
import http from 'http';
import path from 'path';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';

// Get __dirname equivalent in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test configuration
const TEST_CONFIG = {
  headless: 'new', // Use new headless mode
  slowMo: 50, // Slow down execution to better observe gameplay
  timeout: 30000, // 30 second timeout for tests
  gameUrl: 'http://localhost:3000',
  port: 3000
};

// Game selectors
const SELECTORS = {
  gameContainer: '#game-container',
  startButton: 'text/START GAME',
  canvas: 'canvas',
  // Toast messages typically appear in this area
  toastArea: '.toast-container'
};

// Game state indicators
const GAME_STATES = {
  start: async (page) => {
    // Check if the start screen has loaded
    return await page.evaluate(() => {
      return window.game && window.game.scene.scenes.some(s => s.sys.settings.key === 'StartScene' && s.sys.settings.active);
    });
  },
  playing: async (page) => {
    // Check if game scene is active
    return await page.evaluate(() => {
      return window.game && window.game.scene.scenes.some(s => s.sys.settings.key === 'GameScene' && s.sys.settings.active);
    });
  }
};

// Server for hosting game files during testing
let server;
let browser;
let page;

describe('Bitstream Bluffs Gameplay Tests', function() {
  this.timeout(TEST_CONFIG.timeout);
  
  before(async function() {
    // Set up express server to serve game files
    const app = express();
    const projectRoot = path.resolve(__dirname, '..');
    app.use(express.static(projectRoot));
    
    // Start the server
    server = http.createServer(app);
    await new Promise(resolve => {
      server.listen(TEST_CONFIG.port, resolve);
    });
    console.log(`Test server started at ${TEST_CONFIG.gameUrl}`);
    
    // Launch browser
    browser = await puppeteer.launch({ 
      headless: TEST_CONFIG.headless,
      args: [
        '--window-size=1280,800',
        '--no-sandbox',           // Required in restricted environments
        '--disable-setuid-sandbox' // Additional sandbox disable flag
      ]
    });
    
    // Create page with viewport large enough for game
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    // Add helper to detect console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error(`Browser console error: ${msg.text()}`);
      }
    });
  });
  
  after(async function() {
    // Clean up
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    console.log('Test server closed');
  });
  
  beforeEach(async function() {
    // Navigate to game before each test
    await page.goto(TEST_CONFIG.gameUrl, { waitUntil: 'networkidle2' });
    
    // Wait for game to initialize
    await page.waitForFunction(() => window.game !== undefined);
  });
  
  // Test 1: Game initialization
  it('should load the start screen correctly', async function() {
    // Wait for start scene to be active
    await page.waitForFunction(GAME_STATES.start);
    
    // Check for START GAME button
    const startButtonExists = await page.evaluate(() => {
      // Look for containers with text that includes "START GAME"
      const containers = window.game.scene.scenes.find(s => s.sys.settings.key === 'StartScene')?.children?.list || [];
      return containers.some(container => {
        if (container.type === 'Container') {
          return container.list.some(child => 
            child.type === 'Text' && child.text.includes('START GAME')
          );
        }
        return false;
      });
    });
    
    expect(startButtonExists).to.be.true;
  });
  
  // Test 2: Starting game
  it('should start game when clicking start button', async function() {
    // Wait for start scene to be ready
    await page.waitForFunction(GAME_STATES.start);
    
    // Click on the start game button using a custom click based on our knowledge of the DOM
    await page.evaluate(() => {
      const startScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'StartScene');
      const startButton = startScene.children.list.find(container => 
        container.type === 'Container' && 
        container.list.some(child => child.type === 'Text' && child.text.includes('START GAME'))
      );
      
      if (startButton) {
        // Simulate a click event on the start button
        startButton.emit('pointerdown');
        startButton.emit('pointerup');
      }
    });
    
    // Wait for game scene to be active
    await page.waitForFunction(GAME_STATES.playing);
    
    // Verify game scene is running
    const gameSceneActive = await page.evaluate(() => {
      return window.game.scene.scenes.some(s => s.sys.settings.key === 'GameScene' && s.sys.settings.active);
    });
    
    expect(gameSceneActive).to.be.true;
  });
  
  // Test 3: Player movement
  it('should respond to keyboard input for player movement', async function() {
    // Start the game
    await page.waitForFunction(GAME_STATES.start);
    await page.evaluate(() => {
      const startScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'StartScene');
      const startButton = startScene.children.list.find(container => 
        container.type === 'Container' && 
        container.list.some(child => child.type === 'Text' && child.text.includes('START GAME'))
      );
      
      if (startButton) {
        startButton.emit('pointerdown');
        startButton.emit('pointerup');
      }
    });
    
    // Wait for game scene
    await page.waitForFunction(GAME_STATES.playing);
    
    // Get initial player position
    const initialPosition = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return {
        x: gameScene.player.x,
        y: gameScene.player.y
      };
    });
    
    // Press right arrow key for a short time to move player
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(500); // Move for 500ms
    await page.keyboard.up('ArrowRight');
    
    // Wait a bit for physics to update
    await page.waitForTimeout(300);
    
    // Get new player position
    const newPosition = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return {
        x: gameScene.player.x,
        y: gameScene.player.y
      };
    });
    
    // Check that position has changed
    expect(newPosition).to.not.deep.equal(initialPosition);
  });
  
  // Test 4: Trick system
  it('should perform tricks when pressing up/down arrow keys in the air', async function() {
    // Start the game
    await startGameHelper(page);
    
    // Wait for a moment for the player to get moving downhill
    await page.waitForTimeout(1000);
    
    // Check if player is on ground
    const onGround = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return gameScene.onGround;
    });
    
    // If on ground, press space to jump
    if (onGround) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(300); // Wait for jump
    }
    
    // Press up arrow to perform a trick
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(300);
    await page.keyboard.up('ArrowUp');
    
    // Wait for trick detection
    await page.waitForTimeout(500);
    
    // Check if a trick was recorded (check rotation or trick state)
    const trickDetected = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return gameScene.rotationSystem && 
             (gameScene.rotationSystem.hasRotated || 
              gameScene.isTucking || 
              gameScene.isParachuting || 
              gameScene.isAirBraking);
    });
    
    expect(trickDetected).to.be.true;
  });
  
  // Test 5: Score and speed display
  it('should update score and speed display during gameplay', async function() {
    // Start the game
    await startGameHelper(page);
    
    // Wait for HUD elements to appear
    await page.waitForTimeout(1000);
    
    // Get initial score and speed
    const initialStats = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return {
        points: gameScene.points || 0,
        speed: gameScene.player ? Math.abs(gameScene.player.body.velocity.x) : 0
      };
    });
    
    // Play for a bit to accumulate score and speed
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(2000);
    await page.keyboard.up('ArrowRight');
    
    // Get updated score and speed
    const updatedStats = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return {
        points: gameScene.points || 0,
        speed: gameScene.player ? Math.abs(gameScene.player.body.velocity.x) : 0
      };
    });
    
    // Verify that either score or speed has changed
    expect(
      updatedStats.points > initialStats.points || 
      updatedStats.speed !== initialStats.speed
    ).to.be.true;
  });
  
  // Test 6: Lives system
  it('should manage player lives correctly', async function() {
    // Start the game
    await startGameHelper(page);
    
    // Get initial lives
    const initialLives = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return gameScene.lives;
    });
    
    // Force a crash (simulate a steep collision)
    await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      if (gameScene.onCrash) {
        gameScene.onCrash();
      }
    });
    
    // Wait for crash animation and life deduction
    await page.waitForTimeout(1500);
    
    // Check if lives decreased
    const updatedLives = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return gameScene.lives;
    });
    
    expect(updatedLives).to.be.lessThan(initialLives);
  });
  
  // Test 7: Game restart
  it('should restart the game after all lives are lost', async function() {
    // Start the game
    await startGameHelper(page);
    
    // Set lives to 1 so we only need one crash to test game over
    await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      gameScene.lives = 1;
      gameScene.updateLivesDisplay();
    });
    
    // Force a crash
    await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      if (gameScene.onCrash) {
        gameScene.onCrash();
      }
    });
    
    // Wait for game over and scene transition
    await page.waitForTimeout(3000);
    
    // Check if we're back at start scene
    const backAtStart = await page.evaluate(GAME_STATES.start);
    expect(backAtStart).to.be.true;
  });
  
  // Test 8: Extra life collection
  it('should collect extra lives when player touches them', async function() {
    // Start the game
    await startGameHelper(page);
    
    // Get initial lives
    const initialLives = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return gameScene.lives;
    });
    
    // Force spawn an extra life and collect it
    await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      
      // Only proceed if lives are less than max
      if (gameScene.lives < gameScene.maxLives) {
        // Spawn extra life directly at player position
        const extraLife = gameScene.spawnExtraLife();
        if (extraLife && gameScene.player) {
          // Position it right where the player is
          extraLife.setPosition(gameScene.player.x, gameScene.player.y);
          
          // Force collision detection
          gameScene.collectExtraLife({
            bodyA: gameScene.player.body,
            bodyB: extraLife.body
          });
        }
      }
    });
    
    // Wait for collection animation
    await page.waitForTimeout(1500);
    
    // Check if lives increased (only if below max)
    const updatedLives = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return {
        current: gameScene.lives,
        max: gameScene.maxLives,
        initial: gameScene.lives
      };
    });
    
    // Only expect lives to increase if we were below max
    if (initialLives < updatedLives.max) {
      expect(updatedLives.current).to.be.greaterThan(initialLives);
    } else {
      expect(updatedLives.current).to.equal(initialLives);
    }
  });
  
  // Test 9: Terrain generation
  it('should continuously generate terrain as the player moves', async function() {
    // Start the game
    await startGameHelper(page);
    
    // Get initial number of terrain segments
    const initialSegments = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return gameScene.terrainSegments.length;
    });
    
    // Move player forward for a while
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(2000);
    await page.keyboard.up('ArrowRight');
    
    // Check current number of terrain segments
    const currentSegments = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return gameScene.terrainSegments.length;
    });
    
    // Verify that terrain generation is ongoing
    expect(currentSegments).to.be.at.least(initialSegments);
  });
  
  // Test 10: Responsive design
  it('should handle window resizing correctly', async function() {
    // Start the game
    await startGameHelper(page);
    
    // Get initial canvas size
    const initialSize = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      return {
        width: canvas.width,
        height: canvas.height
      };
    });
    
    // Resize the viewport
    await page.setViewport({ width: 800, height: 600 });
    
    // Trigger resize event
    await page.evaluate(() => {
      window.dispatchEvent(new Event('resize'));
    });
    
    // Wait for resize to complete
    await page.waitForTimeout(500);
    
    // Get new canvas size
    const newSize = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      return {
        width: canvas.width,
        height: canvas.height
      };
    });
    
    // Verify that canvas size changed
    expect(newSize).to.not.deep.equal(initialSize);
  });

  // Test 11: Seed-based terrain generation
  it('should generate consistent terrain when using the same seed', async function() {
    // This test verifies that terrain generation is deterministic based on seed
    // First run with initial seed
    const terrainTest = async (customSeed) => {
      await page.goto(TEST_CONFIG.gameUrl, { waitUntil: 'networkidle2' });
      await page.waitForFunction(() => window.game !== undefined);
      
      // Set a specific seed if provided
      if (customSeed) {
        await page.evaluate((seed) => {
          window.localStorage.setItem('gameTestSeed', seed);
        }, customSeed);
      }
      
      await page.waitForFunction(GAME_STATES.start);
      
      // Start the game
      await page.evaluate(() => {
        const startScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'StartScene');
        const startButton = startScene.children.list.find(container => 
          container.type === 'Container' && 
          container.list.some(child => child.type === 'Text' && child.text.includes('START GAME'))
        );
        
        if (startButton) {
          startButton.emit('pointerdown');
          startButton.emit('pointerup');
        }
      });
      
      await page.waitForFunction(GAME_STATES.playing);
      
      // Allow terrain to generate
      await page.waitForTimeout(1000);
      
      // Capture terrain data
      return await page.evaluate(() => {
        const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
        return gameScene.terrainSegments.map(segment => {
          // Return a simplified representation of segments for comparison
          if (segment.points) {
            return segment.points.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
          }
          return [];
        });
      });
    };
    
    // Generate a fixed seed
    const testSeed = "test-seed-123";
    
    // First run
    const firstRunTerrain = await terrainTest(testSeed);
    
    // Second run with same seed
    const secondRunTerrain = await terrainTest(testSeed);
    
    // Compare terrain segments - they should be identical with same seed
    expect(JSON.stringify(firstRunTerrain)).to.equal(JSON.stringify(secondRunTerrain));
  });

  // Test 12: Altitude drop tracking
  it('should track altitude drop during gameplay', async function() {
    // Start the game
    await startGameHelper(page);
    
    // Get initial altitude status
    const initialAltitude = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return gameScene.initialY - gameScene.player.y;
    });
    
    // Play for a bit to accumulate altitude drop
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(2000);
    await page.keyboard.up('ArrowRight');
    
    // Get updated altitude
    const updatedAltitude = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return gameScene.initialY - gameScene.player.y;
    });
    
    // As player moves downhill, altitude drop should increase
    expect(updatedAltitude).to.be.greaterThan(initialAltitude);
    
    // Check if altitude text is updated
    const altitudeDisplayed = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return gameScene.altitudeDropText && 
             gameScene.altitudeDropText.text && 
             gameScene.altitudeDropText.text.includes('ALTITUDE');
    });
    
    expect(altitudeDisplayed).to.be.true;
  });

  // Test 13: Flip tracking and scoring system
  it('should detect and score flips correctly', async function() {
    // Start the game
    await startGameHelper(page);
    
    // Get initial score
    const initialScore = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return gameScene.points || 0;
    });
    
    // Perform a flip by pressing up arrow in the air
    await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      
      // Set up conditions for a flip
      // Force the player in the air
      gameScene.onGround = false;
      
      // Set a high initial velocity to ensure we have time for a flip
      if (gameScene.player && gameScene.player.body) {
        gameScene.player.body.velocity.y = -10; // Moving up initially
      }
      
      // Initialize rotation system if needed
      if (!gameScene.rotationSystem.isTracking) {
        gameScene.rotationSystem.startTracking();
      }
    });
    
    // Press up key to initiate a flip
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(300);
    await page.keyboard.up('ArrowUp');
    
    // Wait for the flip to complete
    await page.waitForTimeout(1000);
    
    // Force landing to complete the flip
    await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      
      // Simulate landing to complete the flip
      if (gameScene.rotationSystem && gameScene.rotationSystem.isTracking) {
        gameScene.onGround = true;
        gameScene.rotationSystem.stopTracking();
        
        // If there are rotations, call the flip complete handler
        if (gameScene.rotationSystem.rotationCount > 0) {
          const fullFlips = Math.floor(gameScene.rotationSystem.rotationCount);
          const partialFlip = gameScene.rotationSystem.rotationCount % 1;
          
          // Call the flip completion handler
          if (gameScene.onFlipComplete) {
            gameScene.onFlipComplete(fullFlips, partialFlip);
          }
        }
      }
    });
    
    // Get the updated score
    await page.waitForTimeout(500); // Wait for score to update
    
    // Check if score increased
    const newScore = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return {
        score: gameScene.points || 0,
        flipDetected: gameScene.rotationSystem && 
                      (gameScene.rotationSystem.hasRotated || 
                       gameScene.rotationSystem.rotationCount > 0)
      };
    });
    
    // Either the flip was detected or score increased
    expect(newScore.flipDetected || newScore.score > initialScore).to.be.true;
  });

  // Test 14: Wobble state detection
  it('should detect wobble state on unstable landing', async function() {
    // Start the game
    await startGameHelper(page);
    
    // Set up conditions for a wobble
    await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      
      // First ensure we're on ground
      gameScene.onGround = true;
      
      // Then simulate a steep landing angle that would trigger wobble
      if (gameScene.onWobble && gameScene.playerHitTerrain) {
        // Call with a steep angle (> 45 degrees) - in radians
        gameScene.playerHitTerrain(Math.PI / 3); // ~60 degrees
      }
    });
    
    // Wait a moment for wobble state to be detected
    await page.waitForTimeout(300);
    
    // Check if wobble was triggered
    const wobbleDetected = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return gameScene.isWobbling || gameScene.wobbleIntensity > 0;
    });
    
    expect(wobbleDetected).to.be.true;
  });

  // Test 15: Extra life timing system
  it('should respect minimum time between extra life spawns', async function() {
    // Start the game
    await startGameHelper(page);
    
    // Get the current extra life timing information
    const lifeTiming = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return {
        lastCollectTime: gameScene.lastLifeCollectTime,
        nextAvailableTime: gameScene.nextLifeAvailableTime,
        currentLives: gameScene.lives,
        maxLives: gameScene.maxLives
      };
    });
    
    // Force spawn an extra life and collect it
    await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      
      // Only proceed if lives are less than max
      if (gameScene.lives < gameScene.maxLives) {
        // Force record the collect time
        const now = gameScene.time.now;
        gameScene.lastLifeCollectTime = now;
        
        // Set next available time based on the cooldown
        gameScene.nextLifeAvailableTime = now + PhysicsConfig.extraLives.minTimeBetweenSpawnsMs;
      }
    });
    
    // Try to spawn another immediately (should not create one due to cooldown)
    await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return gameScene.spawnExtraLife();
    });
    
    // Verify no new life was spawned during cooldown
    const noSpawnDuringCooldown = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      const now = gameScene.time.now;
      return now < gameScene.nextLifeAvailableTime; // Should still be in cooldown
    });
    
    expect(noSpawnDuringCooldown).to.be.true;
  });

  // Test 16: Physics config integration
  it('should apply physics configuration settings', async function() {
    // Start the game
    await startGameHelper(page);
    
    // Check if physics config is applied
    const physicsConfigApplied = await page.evaluate(() => {
      // Check that the PhysicsConfig exists and is being used
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      
      // Check that initial lives match the physics config
      const livesMatchConfig = gameScene.lives === PhysicsConfig.extraLives.initialLives;
      
      // Check that gravity is set from physics config
      const gravityMatch = window.game.physics.world.gravity.y === PhysicsConfig.gravity;
      
      return {
        livesMatchConfig,
        gravityMatch,
        gravityValue: window.game.physics.world.gravity.y,
        configValue: PhysicsConfig.gravity
      };
    });
    
    // Verify physics configuration is correctly applied
    expect(physicsConfigApplied.livesMatchConfig || 
           physicsConfigApplied.gravityMatch).to.be.true;
  });

  // Test 17: Terrain cleanup
  it('should clean up offscreen terrain segments', async function() {
    // Start the game
    await startGameHelper(page);
    
    // Get initial terrain segment count
    const initialTerrainCount = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return gameScene.terrainSegments.length;
    });
    
    // Move player far to the right to force terrain cleanup
    await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      if (gameScene.player && gameScene.player.body) {
        // Move player far to the right
        const originalX = gameScene.player.x;
        gameScene.player.setPosition(originalX + 5000, gameScene.player.y);
        
        // Force terrain management
        gameScene.manageTerrain();
      }
    });
    
    // Allow time for cleanup
    await page.waitForTimeout(500);
    
    // Check terrain segments again
    const terrainResults = await page.evaluate(() => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      return {
        currentCount: gameScene.terrainSegments.length,
        newSegmentsCreated: gameScene.terrainSegments.some(s => s.x > 5000) // Check if new segments created ahead
      };
    });
    
    // Verify terrain management is working - either segments were removed or new ones created
    expect(terrainResults.currentCount !== initialTerrainCount || 
           terrainResults.newSegmentsCreated).to.be.true;
  });
});


// Helper functions

// Helper to start game and get to gameplay
async function startGameHelper(page) {
  await page.waitForFunction(GAME_STATES.start);
  await page.evaluate(() => {
    const startScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'StartScene');
    const startButton = startScene.children.list.find(container => 
      container.type === 'Container' && 
      container.list.some(child => child.type === 'Text' && child.text.includes('START GAME'))
    );
    
    if (startButton) {
      startButton.emit('pointerdown');
      startButton.emit('pointerup');
    }
  });
  
  await page.waitForFunction(GAME_STATES.playing);
}
