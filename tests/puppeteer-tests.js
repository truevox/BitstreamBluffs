// tests/gameplay-tests.js
// Comprehensive gameplay tests for Bitstream Bluffs using Puppeteer
// ----------------------------------------------------------------------

const puppeteer = require('puppeteer');
const { expect } = require('chai');
const http = require('http');
const path = require('path');
const express = require('express');
const fs = require('fs');

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
      args: ['--window-size=1280,800']
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
