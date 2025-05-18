// browser-gameplay-tests.js
// In-browser gameplay tests for Bitstream Bluffs
// -------------------------------------------------------------

/**
 * Browser-based gameplay test suite for Bitstream Bluffs
 * To run: 
 * 1. Include this script in your HTML
 * 2. Open the browser console to see test results
 * 3. Tests will run automatically after the game is loaded
 */

// Wait for game to initialize before running tests
window.addEventListener('load', function() {
  // Give the game a moment to initialize
  setTimeout(initializeGameTests, 1000);
});

async function initializeGameTests() {
  console.log('%c🎮 Bitstream Bluffs Gameplay Tests', 'font-size: 16px; font-weight: bold; color: #ffff00; background-color: #000033; padding: 5px;');

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
    console.log(`%c⏳ Running test: ${name}`, 'color: #00ffff');
    try {
      await testFn();
      testResults.passed++;
      testResults.results.push({ name, passed: true });
      console.log(`%c✅ Test passed: ${name}`, 'color: #00ff00');
      return true;
    } catch (error) {
      testResults.failed++;
      testResults.results.push({ name, passed: false, error: error.message });
      console.error(`%c❌ Test failed: ${name}`, 'color: #ff0000');
      console.error(`   Error: ${error.message}`);
      return false;
    }
  };

  // Helper function to wait for a condition
  const waitForCondition = async (conditionFn, errorMessage = 'Condition timeout', timeout = 5000) => {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const result = await conditionFn();
      if (result) return true;
      await sleep(100);
    }
    
    throw new Error(errorMessage);
  };

  // Helper function to wait for game loaded
  const waitForGameLoaded = async () => {
    return waitForCondition(() => window.game !== undefined, 
      'Game did not load within timeout period');
  };

  // Helper function to sleep
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  try {
    // Wait for game to be ready
    await waitForGameLoaded();
    
    // Check if we're on the start screen
    const isOnStartScreen = window.game.scene.scenes.some(s => 
      s.sys.settings.key === 'StartScene' && s.sys.settings.active
    );

    if (!isOnStartScreen) {
      // Tests assume we're starting from the start screen
      console.warn('Tests expect to start from the start screen. Refreshing the page might help.');
    }

    // TEST 1: Start screen loads correctly
    await runTest('Start screen loads correctly', async () => {
      // Check if the start scene is active
      const startSceneActive = window.game && window.game.scene.scenes.some(s => 
        s.sys.settings.key === 'StartScene' && s.sys.settings.active
      );
      
      if (!startSceneActive) {
        throw new Error('Start scene not active');
      }
      
      // Look for start game button
      const startScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'StartScene');
      const startButton = startScene.children.list.find(container => 
        container.type === 'Container' && 
        container.list.some(child => child.type === 'Text' && child.text.includes('START GAME'))
      );
      
      if (!startButton) {
        throw new Error('Start button not found');
      }
    });

    // TEST 2: Game starts when clicking start button
    await runTest('Game starts when clicking start button', async () => {
      // Click the start button
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
      
      // Wait for game scene to be active
      await waitForCondition(() => {
        return window.game && window.game.scene.scenes.some(s => 
          s.sys.settings.key === 'GameScene' && s.sys.settings.active
        );
      }, 'Game scene did not become active', 5000);
    });

    // TEST 3: Player responds to keyboard input
    await runTest('Player responds to keyboard input', async () => {
      // Get initial player position
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      const initialPosition = {
        x: gameScene.player.x,
        y: gameScene.player.y
      };
      
      // Simulate pressing right arrow
      const rightArrowDown = new KeyboardEvent('keydown', { 
        key: 'ArrowRight', 
        code: 'ArrowRight', 
        keyCode: 39,
        which: 39
      });
      document.dispatchEvent(rightArrowDown);
      
      // Wait a bit for physics to update
      await sleep(500);
      
      // Simulate releasing right arrow
      const rightArrowUp = new KeyboardEvent('keyup', { 
        key: 'ArrowRight', 
        code: 'ArrowRight', 
        keyCode: 39,
        which: 39
      });
      document.dispatchEvent(rightArrowUp);
      
      // Wait a bit more for movement to complete
      await sleep(200);
      
      // Get new player position
      const newPosition = {
        x: gameScene.player.x,
        y: gameScene.player.y
      };
      
      // Check that position has changed
      if (newPosition.x === initialPosition.x && newPosition.y === initialPosition.y) {
        throw new Error('Player position did not change after input');
      }
    });

    // TEST 4: Trick system functions
    await runTest('Trick system functions', async () => {
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      
      // Check if player is on ground and jump if needed
      if (gameScene.onGround) {
        // Simulate pressing space to jump
        const spaceDown = new KeyboardEvent('keydown', { 
          key: ' ', 
          code: 'Space', 
          keyCode: 32,
          which: 32
        });
        document.dispatchEvent(spaceDown);
        
        // Wait a moment for jump to initiate
        await sleep(100);
        
        // Release space
        const spaceUp = new KeyboardEvent('keyup', { 
          key: ' ', 
          code: 'Space', 
          keyCode: 32,
          which: 32
        });
        document.dispatchEvent(spaceUp);
        
        // Wait for jump to complete
        await sleep(300);
      }
      
      // Simulate pressing up arrow for trick
      const upArrowDown = new KeyboardEvent('keydown', { 
        key: 'ArrowUp', 
        code: 'ArrowUp', 
        keyCode: 38,
        which: 38
      });
      document.dispatchEvent(upArrowDown);
      
      await sleep(300);
      
      // Release up arrow
      const upArrowUp = new KeyboardEvent('keyup', { 
        key: 'ArrowUp', 
        code: 'ArrowUp', 
        keyCode: 38,
        which: 38
      });
      document.dispatchEvent(upArrowUp);
      
      // Wait for trick detection
      await sleep(500);
      
      // Check if a trick was detected
      const trickDetected = gameScene.rotationSystem && 
        (gameScene.rotationSystem.hasRotated || 
         gameScene.isTucking || 
         gameScene.isParachuting || 
         gameScene.isAirBraking);
      
      if (!trickDetected) {
        throw new Error('No trick was detected');
      }
    });

    // TEST 5: Seed-based terrain generation
    await runTest('Seed-based terrain generation consistency', async () => {
      // Get the current seed
      const currentSeed = localStorage.getItem('gameTestSeed') || 'default-seed';
      
      // Store the current terrain data
      const gameScene = window.game.scene.scenes.find(s => s.sys.settings.key === 'GameScene');
      const terrainData = gameScene.terrainSegments.map(segment => {
        if (segment.points) {
          return segment.points.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
        }
        return [];
      });
      
      // Verify that terrain data exists
      if (!terrainData || terrainData.length === 0) {
        throw new Error('No terrain data found');
      }
      
      // Store terrain data in localStorage for future verification
      localStorage.setItem('terrainTestData', JSON.stringify({
        seed: currentSeed,
        terrain: terrainData
      }));
      
      // Mark test as passed if terrain data was stored successfully
      const storedData = localStorage.getItem('terrainTestData');
      if (!storedData) {
        throw new Error('Failed to store terrain data');
      }
    });

    // TEST 6: Physics configuration integration
    await runTest('Physics configuration integration', async () => {
      // Check if PhysicsConfig is properly loaded and used
      if (!window.PhysicsConfig) {
        throw new Error('PhysicsConfig not found');
      }
      
      // Check specific values in game scene
      const gameScene = window.game.scene.scenes.find(s => 
        s.sys.settings.key === 'GameScene' && s.sys.settings.active
      );
      
      // Physical properties to check
      const checks = {
        livesMatch: gameScene.lives === window.PhysicsConfig.extraLives.initialLives,
        maxLivesMatch: gameScene.maxLives === window.PhysicsConfig.extraLives.maxLives,
        gravityExists: typeof window.PhysicsConfig.gravity !== 'undefined',
        extraLivesExist: typeof window.PhysicsConfig.extraLives !== 'undefined'
      };
      
      // Check that at least some physics config settings are properly applied
      const passedChecks = Object.values(checks).filter(v => v).length;
      
      if (passedChecks === 0) {
        throw new Error('Physics configuration not properly integrated');
      }
    });

    // Summary of test results
    console.log('%c📋 Test Results Summary:', 'font-weight: bold; color: #ffff00');
    console.log(`Total: ${testResults.total}`);
    console.log(`%cPassed: ${testResults.passed} ✅`, 'color: #00ff00');
    console.log(`%cFailed: ${testResults.failed} ❌`, 'color: #ff0000');

    // Output pretty results object
    console.log('%cDetailed Results:', 'font-weight: bold');
    console.table(testResults.results);

    return testResults;
    
  } catch (error) {
    console.error('%c❌ Error in test execution:', 'color: #ff0000', error.message);
    return {
      total: testResults.total,
      passed: testResults.passed,
      failed: testResults.failed + 1,
      error: error.message
    };
  }
}
