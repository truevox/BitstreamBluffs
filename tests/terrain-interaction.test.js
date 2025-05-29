// Terrain interaction tests for ModularGameScene
// Uses Jest-style syntax (can be run with Jest or Vitest)
// These are logic tests, not rendering tests, and mock Phaser as needed.

const Phaser = require('phaser');
const ModularGameScene = require('../js/ModularGameScene.js').default;

function makeMockSceneWithTerrain(terrainColor) {
    // Minimal mock for player and terrain
    const scene = new ModularGameScene();
    scene.player = { x: 100, y: 100, body: { friction: 0, frictionStatic: 0 } };
    scene.onGround = true;
    scene.inputController = { isWalkMode: () => false, update: () => ({}) };
    scene.currentSlopeAngle = 0;
    scene.terrainTypeTimer = 0;
    scene.score = 0;
    scene.terrain = {
        getTerrainSegments: () => [{ x: 0, endX: 200, color: terrainColor, angle: 0 }],
        update: () => {},
        getMinX: () => 0,
        getMaxX: () => 200,
    };
    scene.neonGreen = 0x00ff88;
    scene.neonBlue = 0x00ffff;
    scene.neonPink = 0xff00ff;
    scene.inputController = { isWalkMode: () => false, update: () => ({}) };
    scene.collectibles = { update: () => {} };
    scene.hud = { update: () => {} };
    scene.cameras = { main: { width: 800, height: 600 } };
    scene.starfield = { update: () => {} };
    scene.lastTerrainType = null;
    scene.prevGroundState = true;
    scene.updateHud = () => {};
    scene.handleSleddingControls = () => {};
    scene.handleWalkingMode = () => {};
    return scene;
}

test('Green terrain applies correct friction', () => {
    const scene = makeMockSceneWithTerrain(0x00ff88); // neonGreen
    scene.update(0, 16);
    expect(scene.player.body.friction).toBeCloseTo(0.01);
    expect(scene.player.body.frictionStatic).toBeCloseTo(0.01);
});

test('Blue terrain applies correct friction and awards points', () => {
    const scene = makeMockSceneWithTerrain(0x00ffff); // neonBlue
    scene.update(0, 1000); // 1 second elapsed
    expect(scene.player.body.friction).toBeCloseTo(0.08);
    expect(scene.player.body.frictionStatic).toBeCloseTo(0.08);
    expect(scene.score).toBeGreaterThan(0);
});

test('Magenta terrain applies correct friction', () => {
    const scene = makeMockSceneWithTerrain(0xff00ff); // neonPink
    scene.update(0, 16);
    expect(scene.player.body.friction).toBeCloseTo(0.28);
    expect(scene.player.body.frictionStatic).toBeCloseTo(0.28);
});
