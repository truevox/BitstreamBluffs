/**
 * Tests for the StartScene functionality
 */
import { jest, describe, test, expect, beforeAll, afterAll } from '@jest/globals';

global.Phaser = { GameObjects: { Text: jest.fn() } };

// Mock Phaser
const mockScene = {
  add: {
    graphics: jest.fn(() => ({
      fillStyle: jest.fn().mockReturnThis(),
      fillRect: jest.fn().mockReturnThis(),
      lineStyle: jest.fn().mockReturnThis(),
      strokeRect: jest.fn().mockReturnThis(),
      fillRoundedRect: jest.fn().mockReturnThis(),
      lineBetween: jest.fn().mockReturnThis(),
      beginPath: jest.fn().mockReturnThis(),
      moveTo: jest.fn().mockReturnThis(),
      lineTo: jest.fn().mockReturnThis(),
      closePath: jest.fn().mockReturnThis(),
      fill: jest.fn().mockReturnThis(),
      strokePath: jest.fn().mockReturnThis()
    })),
    text: jest.fn(() => ({
      setOrigin: jest.fn().mockReturnThis(),
      setInteractive: jest.fn().mockReturnThis(),
      setScrollFactor: jest.fn().mockReturnThis(),
      setDepth: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      setText: jest.fn().mockReturnThis()
    })),
    rectangle: jest.fn(() => ({
      setStrokeStyle: jest.fn().mockReturnThis(),
      setInteractive: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis()
    })),
    circle: jest.fn(() => ({
      setStrokeStyle: jest.fn().mockReturnThis()
    }))
  },
  tweens: {
    add: jest.fn()
  },
  cameras: {
    main: {
      width: 1000,
      height: 700,
      fadeOut: jest.fn(),
      once: jest.fn().mockImplementation((event, callback) => callback())
    }
  },
  input: {
    keyboard: {
      on: jest.fn(),
      createCursorKeys: jest.fn()
    },
    gamepad: {
      on: jest.fn(),
      once: jest.fn(),
      total: 0
    }
  },
  scene: {
    start: jest.fn()
  },
  time: {
    delayedCall: jest.fn().mockImplementation((delay, callback) => callback())
  },
  copyTextToClipboard: jest.fn()
};

// Import the module and inject mocks
jest.mock('../../../js/utils/seed-generator.js', () => ({
  generateGameSeed: jest.fn().mockReturnValue('mocked-test-seed'),
  initializeRandomWithSeed: jest.fn().mockReturnValue(() => 0.5)
}));

// Get the mocked modules
const seedGeneratorModule = jest.requireMock('../../../js/utils/seed-generator.js');

// Import the StartScene after mocking dependencies
import StartScene from '../../../js/StartScene.js';

describe('StartScene', () => {
  let startScene;
  
  beforeAll(() => {
    // Mock the global clipboard API
    global.navigator = {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined)
      }
    };
    
    // Mock window
    global.window = {
      isSecureContext: true
    };
    
    // Mock document.execCommand for clipboard fallback
    global.document = {
      createElement: jest.fn().mockReturnValue({
        value: '',
        style: {},
        select: jest.fn(),
        focus: jest.fn()
      }),
      execCommand: jest.fn().mockReturnValue(true),
      body: {
        appendChild: jest.fn(),
        removeChild: jest.fn()
      }
    };
  });
  
  beforeEach(() => {
    // Create a fresh instance of StartScene for each test
    startScene = new StartScene();
    
    // Inject the mock methods to make tests work
    Object.setPrototypeOf(startScene, { ...Object.getPrototypeOf(startScene), ...mockScene });
    
    // Reset mock call counts
    jest.clearAllMocks();
  });
  
  test('constructor initializes correctly', () => {
    expect(startScene.key).toBe('StartScene');
    expect(startScene.seed).toBe('');
  });
  
  test('create() initializes the game with a seed', () => {
    // Call the create method
    startScene.create();
    
    // It should have generated a seed
    expect(seedGeneratorModule.generateGameSeed).toHaveBeenCalled();
    expect(startScene.seed).toBe('mocked-test-seed');
    
    // It should have stored the seed globally
    expect(global.window.gameSeed).toBe('mocked-test-seed');
  });
  
  test('startGame() transitions to GameScene', () => {
    // Call the create method first
    startScene.create();
    
    // Then call startGame
    startScene.startGame();
    
    // It should have triggered a camera fadeout
    expect(startScene.cameras.main.fadeOut).toHaveBeenCalled();
    
    // And started the GameScene
    expect(startScene.scene.start).toHaveBeenCalledWith('GameScene');
  });
  
  test('UI elements display the correct seed', () => {
    // Override the mock seed for this test
    seedGeneratorModule.generateGameSeed.mockReturnValueOnce('display-test-seed');
    
    // Call the create method
    startScene.create();
    
    // Check that the add.text was called with the proper seed
    expect(startScene.add.text).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.stringContaining('SEED: display-test-seed'),
      expect.any(Object)
    );
  });
  
  test('Clicking the seed copies it to clipboard', () => {
    // Create a spy for the copyTextToClipboard method
    const clipboardSpy = jest.spyOn(StartScene.prototype, 'copyTextToClipboard');
    
    // Call the create method
    startScene.create();
    
    // Extract the seed click handler
    const mockText = startScene.add.text.mock.results[5].value;
    const clickHandler = mockText.on.mock.calls.find(call => call[0] === 'pointerdown')?.[1];
    
    // Call the click handler if found
    if (clickHandler) {
      clickHandler();
      expect(clipboardSpy).toHaveBeenCalledWith('mocked-test-seed');
    } else {
      fail('Seed text click handler not found');
    }
  });
});
