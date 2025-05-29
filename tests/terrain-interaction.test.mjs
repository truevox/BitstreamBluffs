// Terrain interaction tests for ModularGameScene (ESM/Phaser 3.90+)
// Uses Vitest/Jest ESM runner. Run with `npx vitest` or `node --test` if supported.
// --- Test environment patch for browser globals ---
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {};
}
if (!globalThis.window.location) {
  globalThis.window.location = { hostname: 'localhost' };
}
import { test, expect } from 'vitest';
import Phaser from '../tests/__mocks__/phaser.js';
import ModularGameScene from '../js/ModularGameScene.js';
// Patch the imported Phaser mock to ensure Physics is available
Phaser.Physics = {
  Matter: {
    Matter: {
      Body: {
        set: (body, prop, value) => { body[prop] = value; },
        applyForce: () => {}
      }
    }
  }
};
globalThis.Phaser = Phaser;
Phaser.Math = { RadToDeg: x => x * (180 / Math.PI) };

function makeMockSceneWithTerrain(colorFn) {
    // Minimal mock for player and terrain, tuned to match ModularGameScene.update() expectations
    const scene = new ModularGameScene();
    scene.cameras = { main: { worldView: { bottom: 1000 } } };
    scene.scene = { isActive: true };
    scene.player = {
        x: 100, y: 100,
        body: {
            friction: 0, frictionStatic: 0,
            velocity: { x: 0, y: 0 },
            position: { x: 100, y: 100 },
            force: { x: 0, y: 0 }
        },
        justTeleported: false
    };
    scene.onGround = true;
    scene.prevGroundState = true;
    scene.inputController = { isWalkMode: () => false, update: () => ({}) };
    scene.currentSlopeAngle = 0;
    scene.terrainTypeTimer = 0;
    scene.score = 0;
    // Mock particle emitters so update() logic doesn't throw
    const fakeEmitter = () => ({
        setPosition: () => {},
        setVisible: () => {},
        setAngle: () => {},
        start: () => {},
        stop: () => {},
        active: false,
    });
    scene.greenStreakEmitter = fakeEmitter();
    scene.blueBlingEmitter = fakeEmitter();
    scene.magentaFlickerEmitter = fakeEmitter();
    // Terrain segment covers player.x = 100
    const color = colorFn(scene);
    scene.terrain = {
        getTerrainSegments: () => [{ x: 0, endX: 200, color: color, angle: 0 }],
        update: () => {},
        getMinX: () => 0,
        getMaxX: () => 200,
        findTerrainHeightAt: () => 100,
    };
    scene.neonGreen = 0x00ff88;
    scene.neonBlue = 0x00ffff;
    scene.neonPink = 0xff00ff;
    scene.collectibles = { update: () => {} };
    scene.hud = { update: () => {} };
    scene.starfield = { update: () => {} };
    scene.lastTerrainType = null;
    scene.updateHud = () => {};
    scene.handleSleddingControls = () => {};
    scene.handleWalkingMode = () => {};
    // Patch for blue terrain test: enable awarding points
    scene.terrainTypeTimer = 0;
    return scene;
}

test('Green terrain applies correct friction', () => {
    const scene = makeMockSceneWithTerrain(scene => scene.neonGreen);
    scene.update(0, 16);
    // Debug output
    console.log('[TEST] green:', {
      friction: scene.player.body.friction,
      frictionStatic: scene.player.body.frictionStatic,
      neonGreen: scene.neonGreen,
      segmentColor: scene.terrain.getTerrainSegments()[0].color,
      eq: scene.neonGreen === scene.terrain.getTerrainSegments()[0].color
    });
    console.log('[TEST] player.body', scene.player.body);
    expect(scene.player.body.friction).toBeCloseTo(0.01);
    expect(scene.player.body.frictionStatic).toBeCloseTo(0.01);
});

test('Blue terrain applies correct friction and awards points', () => {
    const scene = makeMockSceneWithTerrain(scene => scene.neonBlue);
    // Simulate player at speed 6
    scene.player.body.velocity.x = 6;
    scene.player.body.velocity.y = 0;
    // Simulate 10 frames of 20ms each (200ms total)
    for (let i = 0; i < 10; i++) {
        scene.update(0, 20);
    }
    // Debug output
    console.log('[TEST] blue:', {
      friction: scene.player.body.friction,
      frictionStatic: scene.player.body.frictionStatic,
      neonBlue: scene.neonBlue,
      segmentColor: scene.terrain.getTerrainSegments()[0].color,
      eq: scene.terrain.getTerrainSegments()[0].color === scene.neonBlue,
      score: scene.score,
    });
    expect(scene.player.body.friction).toBeCloseTo(0.08);
    expect(scene.player.body.frictionStatic).toBeCloseTo(0.08);
    expect(scene.score).toBeGreaterThan(0);
});

test('Magenta terrain applies correct friction', () => {
    const scene = makeMockSceneWithTerrain(scene => scene.neonPink);
    scene.update(0, 16);
    // Debug output
    console.log('[TEST] magenta:', {
      friction: scene.player.body.friction,
      frictionStatic: scene.player.body.frictionStatic,
      neonPink: scene.neonPink,
      segmentColor: scene.terrain.getTerrainSegments()[0].color,
      eq: scene.neonPink === scene.terrain.getTerrainSegments()[0].color
    });
    console.log('[TEST] player.body', scene.player.body);
    expect(scene.player.body.friction).toBeCloseTo(0.28);
    expect(scene.player.body.frictionStatic).toBeCloseTo(0.28);
});

