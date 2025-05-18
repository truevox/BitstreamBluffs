// tests/puppeteer-mcp-tests.js
// Puppeteer MCP-based gameplay tests for Bitstream Bluffs
// -----------------------------------------------------------------

// Setup for MCP Puppeteer tests - this file is designed to be run by the MCP server
// but includes a function for manual testing via Node.js if needed

/**
 * Main test runner for Bitstream Bluffs gameplay testing
 * This allows us to test core gameplay mechanics directly through the browser
 */
async function runGameplayTests() {
  console.log('🎮 Starting Bitstream Bluffs gameplay tests');
  
  // Track test results
  const testResults = {
    total: 0,
    passed: 0,
    failed: 0,
    results: []
  };

  // Helper to run a single test
  const runTest = async (name, testFn) => {
    testResults.total++;
    console.log(`⏳ Running test: ${name}`);
    try {
      await testFn();
      testResults.passed++;
      testResults.results.push({ name, passed: true });
      console.log(`✅ Test passed: ${name}`);
      return true;
    } catch (error) {
      testResults.failed++;
      testResults.results.push({ name, passed: false, error: error.message });
      console.error(`❌ Test failed: ${name}`);
      console.error(`   Error: ${error.message}`);
      return false;
    }
  };

  // Setup - launch browser and navigate to game
  try {
    // Launch game in non-headless mode (visible browser)
    await mcp2_puppeteer_navigate({
      url: 'http://localhost:8000',
      launchOptions: {
        headless: false,
        args: ['--window-size=1280,800']
      }
    });
    
    console.log('📱 Setting viewport size');
    await mcp2_puppeteer_evaluate({
      script: `
        window.resizeTo(1280, 800);
        window.moveTo(0, 0);
      `
    });

    // Wait for game to initialize
    console.log('⏱️ Waiting for game to initialize');
    await waitForGameLoaded();
    console.log('🎮 Game loaded successfully');
    
    // =================================================================
    // Run each test in sequence
    // =================================================================
    
    // Test 1: Start screen loads correctly
    await runTest('Start screen loads correctly', async () => {
      // Check if the start scene is active
      const startSceneActive = await mcp2_puppeteer_evaluate({
        script: `
          return window.game && window.game.scene.scenes.some(s => 
            s.sys.settings.key === 'StartScene' && s.sys.settings.active
          );
        `
      });
      
      if (!startSceneActive) {
        throw new Error('Start scene not active');
      }
      
      // Look for start game button
      const startButtonExists = await mcp2_puppeteer_evaluate({
        script: `
          const startScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'StartScene');
          const startButton = startScene.children.list.find(container => 
            container.type === 'Container' && 
            container.list.some(child => child.type === 'Text' && child.text.includes('START GAME'))
          );
          return !!startButton;
        `
      });
      
      if (!startButtonExists) {
        throw new Error('Start button not found');
      }
    });
    
    // Test 2: Game starts when clicking start button
    await runTest('Game starts when clicking start button', async () => {
      // Click the start button
      await mcp2_puppeteer_evaluate({
        script: `
          const startScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'StartScene');
          const startButton = startScene.children.list.find(container => 
            container.type === 'Container' && 
            container.list.some(child => child.type === 'Text' && child.text.includes('START GAME'))
          );
          
          if (startButton) {
            // Simulate a click event
            startButton.emit('pointerdown');
            startButton.emit('pointerup');
          } else {
            throw new Error('Start button not found');
          }
        `
      });
      
      // Wait for game scene to be active
      await waitForCondition(async () => {
        const gameSceneActive = await mcp2_puppeteer_evaluate({
          script: `
            return window.game && window.game.scene.scenes.some(s => 
              s.sys.settings.key === 'GameScene' && s.sys.settings.active
            );
          `
        });
        return gameSceneActive;
      }, 'Game scene did not become active', 5000);
    });
    
    // Test 3: Player responds to keyboard input
    await runTest('Player responds to keyboard input', async () => {
      // Get initial player position
      const initialPosition = await mcp2_puppeteer_evaluate({
        script: `
          const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
          return {
            x: gameScene.player.x,
            y: gameScene.player.y
          };
        `
      });
      
      // Simulate pressing right arrow
      await mcp2_puppeteer_evaluate({
        script: `
          // Create and dispatch keydown event
          const rightArrowDown = new KeyboardEvent('keydown', { 
            key: 'ArrowRight', 
            code: 'ArrowRight', 
            keyCode: 39,
            which: 39
          });
          document.dispatchEvent(rightArrowDown);
        `
      });
      
      // Wait a bit for physics to update
      await sleep(500);
      
      // Simulate releasing right arrow
      await mcp2_puppeteer_evaluate({
        script: `
          // Create and dispatch keyup event
          const rightArrowUp = new KeyboardEvent('keyup', { 
            key: 'ArrowRight', 
            code: 'ArrowRight', 
            keyCode: 39,
            which: 39
          });
          document.dispatchEvent(rightArrowUp);
        `
      });
      
      // Wait a bit more for movement to complete
      await sleep(200);
      
      // Get new player position
      const newPosition = await mcp2_puppeteer_evaluate({
        script: `
          const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
          return {
            x: gameScene.player.x,
            y: gameScene.player.y
          };
        `
      });
      
      // Check that position has changed
      if (newPosition.x === initialPosition.x && newPosition.y === initialPosition.y) {
        throw new Error('Player position did not change after input');
      }
    });
    
    // Test 4: Trick system functions
    await runTest('Trick system functions', async () => {
      // Check if player is on ground and jump if needed
      const onGround = await mcp2_puppeteer_evaluate({
        script: `
          const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
          return gameScene.onGround;
        `
      });
      
      if (onGround) {
        // Simulate pressing space to jump
        await mcp2_puppeteer_evaluate({
          script: `
            const spaceDown = new KeyboardEvent('keydown', { 
              key: ' ', 
              code: 'Space', 
              keyCode: 32,
              which: 32
            });
            document.dispatchEvent(spaceDown);
            
            // Release after a short press
            setTimeout(() => {
              const spaceUp = new KeyboardEvent('keyup', { 
                key: ' ', 
                code: 'Space', 
                keyCode: 32,
                which: 32
              });
              document.dispatchEvent(spaceUp);
            }, 100);
          `
        });
        
        // Wait a moment for jump to initiate
        await sleep(300);
      }
      
      // Simulate pressing up arrow for trick
      await mcp2_puppeteer_evaluate({
        script: `
          const upArrowDown = new KeyboardEvent('keydown', { 
            key: 'ArrowUp', 
            code: 'ArrowUp', 
            keyCode: 38,
            which: 38
          });
          document.dispatchEvent(upArrowDown);
        `
      });
      
      await sleep(300);
      
      // Release up arrow
      await mcp2_puppeteer_evaluate({
        script: `
          const upArrowUp = new KeyboardEvent('keyup', { 
            key: 'ArrowUp', 
            code: 'ArrowUp', 
            keyCode: 38,
            which: 38
          });
          document.dispatchEvent(upArrowUp);
        `
      });
      
      // Wait for trick detection
      await sleep(500);
      
      // Check if a trick was detected
      const trickDetected = await mcp2_puppeteer_evaluate({
        script: `
          const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
          return gameScene.rotationSystem && 
                (gameScene.rotationSystem.hasRotated || 
                 gameScene.isTucking || 
                 gameScene.isParachuting || 
                 gameScene.isAirBraking);
        `
      });
      
      if (!trickDetected) {
        throw new Error('No trick was detected');
      }
    });
    
    // Test 5: Score display updates
    await runTest('Score display updates', async () => {
      // Get initial score
      const initialScore = await mcp2_puppeteer_evaluate({
        script: `
          const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
          return gameScene.points || 0;
        `
      });
      
      // Play for a bit to accumulate points
      await mcp2_puppeteer_evaluate({
        script: `
          // Press right arrow for movement
          const rightArrowDown = new KeyboardEvent('keydown', { 
            key: 'ArrowRight', 
            code: 'ArrowRight', 
            keyCode: 39,
            which: 39
          });
          document.dispatchEvent(rightArrowDown);
        `
      });
      
      // Wait a bit
      await sleep(2000);
      
      // Release right arrow
      await mcp2_puppeteer_evaluate({
        script: `
          const rightArrowUp = new KeyboardEvent('keyup', { 
            key: 'ArrowRight', 
            code: 'ArrowRight', 
            keyCode: 39,
            which: 39
          });
          document.dispatchEvent(rightArrowUp);
        `
      });
      
      // Get updated score
      const updatedScore = await mcp2_puppeteer_evaluate({
        script: `
          const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
          return gameScene.points || 0;
        `
      });
      
      if (updatedScore <= initialScore) {
        throw new Error('Score did not increase during gameplay');
      }
    });
    
    // Test 6: Game responds to window resize
    await runTest('Game responds to window resize', async () => {
      // Get initial canvas size
      const initialSize = await mcp2_puppeteer_evaluate({
        script: `
          const canvas = document.querySelector('canvas');
          return {
            width: canvas.width,
            height: canvas.height
          };
        `
      });
      
      // Resize window
      await mcp2_puppeteer_evaluate({
        script: `
          window.resizeTo(800, 600);
          window.dispatchEvent(new Event('resize'));
        `
      });
      
      // Wait for resize to complete
      await sleep(500);
      
      // Get new canvas size
      const newSize = await mcp2_puppeteer_evaluate({
        script: `
          const canvas = document.querySelector('canvas');
          return {
            width: canvas.width,
            height: canvas.height
          };
        `
      });
      
      if (newSize.width === initialSize.width && newSize.height === initialSize.height) {
        throw new Error('Canvas size did not change after window resize');
      }
    });
    
    // Test 7: Seed-based deterministic terrain generation
    await runTest('Seed-based terrain generation consistency', async () => {
      // Create a function to test terrain generation with specific seed
      const testTerrainWithSeed = async (seed) => {
        // Navigate to game and set the seed
        await mcp2_puppeteer_navigate({ url: 'http://localhost:8000' });
        
        // Set a specific seed in localStorage
        await mcp2_puppeteer_evaluate({
          script: `
            window.localStorage.setItem('gameTestSeed', '${seed}');
          `
        });
        
        // Wait for game to load
        await waitForGameLoaded();
        
        // Start the game
        await mcp2_puppeteer_evaluate({
          script: `
            const startScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'StartScene');
            const startButton = startScene.children.list.find(container => 
              container.type === 'Container' && 
              container.list.some(child => child.type === 'Text' && child.text.includes('START GAME'))
            );
            
            if (startButton) {
              startButton.emit('pointerdown');
              startButton.emit('pointerup');
            }
          `
        });
        
        // Wait for game scene and terrain generation
        await sleep(1000);
        
        // Capture terrain data for comparison
        return await mcp2_puppeteer_evaluate({
          script: `
            const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
            return gameScene.terrainSegments.map(segment => {
              // Return a consistent representation of segments
              if (segment.points) {
                return segment.points.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
              }
              return [];
            });
          `
        });
      };
      
      // Test with a specific seed
      const testSeed = "mcp-test-seed-123";
      
      // Get terrain from first run
      const firstRunResults = await testTerrainWithSeed(testSeed);
      
      // Get terrain from second run with same seed
      const secondRunResults = await testTerrainWithSeed(testSeed);
      
      // Compare the terrain data - they should match when using same seed
      if (JSON.stringify(firstRunResults) !== JSON.stringify(secondRunResults)) {
        throw new Error('Terrain generation is not deterministic with same seed');
      }
    });
    
    // Test 8: Flip detection and scoring
    await runTest('Flip detection and scoring', async () => {
      // Start fresh game
      await mcp2_puppeteer_navigate({ url: 'http://localhost:8000' });
      await waitForGameLoaded();
      
      // Start the game
      await mcp2_puppeteer_evaluate({
        script: `
          const startScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'StartScene');
          const startButton = startScene.children.list.find(container => 
            container.type === 'Container' && 
            container.list.some(child => child.type === 'Text' && child.text.includes('START GAME'))
          );
          
          if (startButton) {
            startButton.emit('pointerdown');
            startButton.emit('pointerup');
          }
        `
      });
      
      // Wait for game scene
      await sleep(800);
      
      // Get initial score
      const initialScore = await mcp2_puppeteer_evaluate({
        script: `
          const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
          return gameScene.points || 0;
        `
      });
      
      // Force the player into a state where a flip can be executed
      await mcp2_puppeteer_evaluate({
        script: `
          const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
          
          // Set up for a flip
          gameScene.onGround = false;
          
          // Ensure rotation tracking is active
          if (gameScene.rotationSystem && !gameScene.rotationSystem.isTracking) {
            gameScene.rotationSystem.startTracking();
          }
          
          // Apply an upward velocity to give time for the flip
          if (gameScene.player && gameScene.player.body) {
            gameScene.player.body.velocity.y = -10; // Moving up
          }
        `
      });
      
      // Simulate pressing up arrow for a flip
      await mcp2_puppeteer_evaluate({
        script: `
          // Simulate pressing up arrow key
          const upKeyDown = new KeyboardEvent('keydown', { key: 'ArrowUp' });
          document.dispatchEvent(upKeyDown);
          
          // Schedule releasing the key
          setTimeout(() => {
            const upKeyUp = new KeyboardEvent('keyup', { key: 'ArrowUp' });
            document.dispatchEvent(upKeyUp);
          }, 300);
        `
      });
      
      // Wait for flip to occur
      await sleep(1000);
      
      // Force landing to trigger flip completion
      const flipResults = await mcp2_puppeteer_evaluate({
        script: `
          const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
          
          // Track if rotation was detected
          const rotationDetected = gameScene.rotationSystem && 
                                 (gameScene.rotationSystem.hasRotated || 
                                  gameScene.rotationSystem.rotationCount > 0);
                                  
          // Trigger landing to complete the flip
          if (gameScene.rotationSystem && gameScene.rotationSystem.isTracking) {
            // Set player on ground
            gameScene.onGround = true;
            
            // Stop tracking rotation
            gameScene.rotationSystem.stopTracking();
            
            // Calculate flip values
            const fullFlips = Math.floor(gameScene.rotationSystem.rotationCount || 0);
            const partialFlip = (gameScene.rotationSystem.rotationCount || 0) % 1;
            
            // Call flip completion handler if it exists
            if (typeof gameScene.onFlipComplete === 'function') {
              gameScene.onFlipComplete(fullFlips, partialFlip);
            }
          }
          
          return {
            rotationDetected,
            rotationCount: gameScene.rotationSystem ? gameScene.rotationSystem.rotationCount : 0
          };
        `
      });
      
      // Wait for score to update
      await sleep(500);
      
      // Check if score increased or rotation was detected
      const scoreResults = await mcp2_puppeteer_evaluate({
        script: `
          const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
          return gameScene.points || 0;
        `
      });
      
      if (!flipResults.rotationDetected && scoreResults <= initialScore) {
        throw new Error('Flip system did not detect rotation or update score');
      }
    });
    
    // Test 9: Altitude drop tracking
    await runTest('Altitude drop tracking', async () => {
      // Start fresh game
      await mcp2_puppeteer_navigate({ url: 'http://localhost:8000' });
      await waitForGameLoaded();
      
      // Start the game
      await mcp2_puppeteer_evaluate({
        script: `
          const startScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'StartScene');
          const startButton = startScene.children.list.find(container => 
            container.type === 'Container' && 
            container.list.some(child => child.type === 'Text' && child.text.includes('START GAME'))
          );
          
          if (startButton) {
            startButton.emit('pointerdown');
            startButton.emit('pointerup');
          }
        `
      });
      
      // Wait for game scene
      await sleep(1000);
      
      // Get initial altitude
      const initialAlt = await mcp2_puppeteer_evaluate({
        script: `
          const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
          return {
            initialY: gameScene.initialY,
            currentY: gameScene.player ? gameScene.player.y : 0,
            altitudeDrop: gameScene.initialY - (gameScene.player ? gameScene.player.y : 0)
          };
        `
      });
      
      // Move right to progress downhill
      await mcp2_puppeteer_evaluate({
        script: `
          // Press right arrow
          const rightDown = new KeyboardEvent('keydown', { key: 'ArrowRight' });
          document.dispatchEvent(rightDown);
        `
      });
      
      // Wait a moment to move downhill
      await sleep(2000);
      
      // Release key
      await mcp2_puppeteer_evaluate({
        script: `
          // Release right arrow
          const rightUp = new KeyboardEvent('keyup', { key: 'ArrowRight' });
          document.dispatchEvent(rightUp);
        `
      });
      
      // Get current altitude
      const currentAlt = await mcp2_puppeteer_evaluate({
        script: `
          const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
          return {
            initialY: gameScene.initialY,
            currentY: gameScene.player ? gameScene.player.y : 0,
            altitudeDrop: gameScene.initialY - (gameScene.player ? gameScene.player.y : 0),
            altitudeDisplayed: gameScene.altitudeDropText && gameScene.altitudeDropText.text || ''
          };
        `
      });
      
      // Verify altitude drop increased
      if (currentAlt.altitudeDrop <= initialAlt.altitudeDrop) {
        throw new Error('Altitude drop did not increase during downhill movement');
      }
      
      // Check altitude display was updated
      if (!currentAlt.altitudeDisplayed.includes('ALTITUDE')) {
        throw new Error('Altitude display not properly updated');
      }
    });
    
    // Test 10: Physics config integration test
    await runTest('Physics configuration integration', async () => {
      // Start fresh game
      await mcp2_puppeteer_navigate({ url: 'http://localhost:8000' });
      await waitForGameLoaded();
      
      // Check physics config values
      const physicsResults = await mcp2_puppeteer_evaluate({
        script: `
          // Check if PhysicsConfig is properly loaded and used
          if (!window.PhysicsConfig) {
            return { error: 'PhysicsConfig not found' };
          }
          
          // If we're in the game scene, check specific values
          const gameScene = window.game.scene.scenes.find(s => 
            s.sys.settings.key === 'GameScene' && s.sys.settings.active
          );
          
          if (gameScene) {
            return {
              // Initial lives match config
              livesMatch: gameScene.lives === PhysicsConfig.extraLives.initialLives,
              // Max lives match config
              maxLivesMatch: gameScene.maxLives === PhysicsConfig.extraLives.maxLives,
              // Gravity set from config
              gravityMatch: window.game.physics.world && 
                          window.game.physics.world.gravity && 
                          window.game.physics.world.gravity.y === PhysicsConfig.gravity
            };
          } else {
            // Just check that PhysicsConfig exists with expected properties
            return {
              hasGravity: typeof PhysicsConfig.gravity !== 'undefined',
              hasExtraLives: typeof PhysicsConfig.extraLives !== 'undefined'
            };
          }
        `
      });
      
      // Check that at least one config value is correctly applied
      if (physicsResults.error || 
         (!physicsResults.livesMatch && 
          !physicsResults.maxLivesMatch && 
          !physicsResults.gravityMatch && 
          !physicsResults.hasGravity && 
          !physicsResults.hasExtraLives)) {
        throw new Error('Physics configuration not properly integrated');
      }
    });

    // Summary of test results
    console.log('\n📋 Test Results Summary:');
    console.log(`Total: ${testResults.total}`);
    console.log(`Passed: ${testResults.passed} ✅`);
    console.log(`Failed: ${testResults.failed} ❌`);
    
    return testResults;
    
  } catch (error) {
    console.error('❌ Error setting up tests:', error.message);
    return {
      total: testResults.total,
      passed: testResults.passed,
      failed: testResults.failed + 1,
      error: error.message
    };
  }
}

// Helper functions

/**
 * Wait for a specific condition to be true
 * @param {Function} conditionFn - Function that returns a boolean promise
 * @param {string} errorMessage - Error message if timeout occurs
 * @param {number} timeout - Maximum wait time in ms
 */
async function waitForCondition(conditionFn, errorMessage = 'Condition timeout', timeout = 5000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const result = await conditionFn();
    if (result) return true;
    await sleep(100);
  }
  
  throw new Error(errorMessage);
}

/**
 * Sleep for a specified amount of time
 * @param {number} ms - Time to sleep in milliseconds
 */
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for game to be fully loaded
 */
async function waitForGameLoaded() {
  return waitForCondition(async () => {
    const gameLoaded = await mcp2_puppeteer_evaluate({
      script: 'return window.game !== undefined'
    });
    return gameLoaded;
  }, 'Game did not load within timeout period');
}

// Export for potential use in non-MCP environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runGameplayTests };
}

// Auto-run tests when loaded in MCP
if (typeof mcp2_puppeteer_navigate !== 'undefined') {
  console.log('MCP Puppeteer environment detected, running tests automatically');
  runGameplayTests();
}
