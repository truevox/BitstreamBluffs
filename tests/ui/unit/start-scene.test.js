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

// Patch: Mock canvas context for Phaser in headless (jsdom) environments
// Hardened canvas mocking for Phaser in jsdom/CI
const ensureCanvasContextStub = el => {
  el.getContext = () => ({
    fillStyle: '',
    fillRect: () => {},
    getImageData: () => ({ data: [] }),
    putImageData: () => {},
    getContextAttributes: () => ({}),
    clearRect: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    fill: () => {},
    arc: () => {},
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    setLineDash: () => {},
    drawImage: () => {},
    measureText: () => ({ width: 100 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createPattern: () => ({}),
    createRadialGradient: () => ({ addColorStop: () => {} })
  });
  return el;
};

let origCreateElement;
beforeAll(() => {
  origCreateElement = global.document.createElement;
  global.document.createElement = function (tag, ...args) {
    const el = origCreateElement.call(this, tag, ...args);
    if (tag === 'canvas') {
      return ensureCanvasContextStub(el);
    }
    return el;
  };
});

beforeEach(() => {
  // Re-apply the patch in case document is reset by other test code
  global.document.createElement = function (tag, ...args) {
    const el = origCreateElement.call(this, tag, ...args);
    if (tag === 'canvas') {
      return ensureCanvasContextStub(el);
    }
    return el;
  };
});

// Defensive: If getContext is called and returns null, throw a clear error
HTMLCanvasElement.prototype.getContext = HTMLCanvasElement.prototype.getContext || function () {
  throw new Error('Canvas getContext returned null! Harden the canvas mock in tests/ui/unit/start-scene.test.js');
};

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

});
