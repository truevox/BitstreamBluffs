/**
 * Luna W3 audit probe — does Game Over actually BUILD at this head?
 *
 * My round-2 note verified `shareableSeed()`'s behaviour and stopped there. The scene that calls it
 * is a different question, and this probe asks it directly: import the real module, put a minimal
 * Phaser stub in place, and run the scene's `create()` far enough to reach `_buildStats()`.
 *
 * If `shareableSeed` is not bound in the module's scope, this throws ReferenceError — which is what a
 * player would hit on the first frame of Game Over, not a cosmetic detail.
 */
const mod = await import('./src/scenes/GameOverScene.js');
const { GameOverScene } = mod;

// The smallest object that lets create() run until it touches a real renderer. Every method returns
// `this` or a harmless stub so chained calls survive; nothing here can mask a missing identifier,
// because identifier resolution happens before any of these methods are called.
const stub = () => new Proxy(function () {}, {
  get: (t, k) => {
    if (k === 'then') return undefined;
    if (k === 'getValue') return () => 0;
    return stub();
  },
  apply: () => stub(),
  construct: () => stub(),
});

const scene = Object.create(GameOverScene.prototype);
Object.assign(scene, {
  scene: { start: () => {}, stop: () => {} },
  add: stub(),
  tweens: { addCounter: () => stub(), add: () => stub() },
  time: { delayedCall: () => {} },
  input: { on: () => {}, keyboard: null },
  registry: { get: () => undefined, set: () => {} },
  events: { on: () => {}, off: () => {} },
  cameras: { main: stub() },
  sys: { game: stub(), settings: { data: {} } },
  rec: { seed: 'alpha', biomeMask: 31, score: 100, ledgerHash: 'deadbeef', distanceM: 100 },
  theme: null,
  alive: true,
});

// Only _buildStats() is under test: it is the function that renders the SHARE SEED line, and it is
// called unconditionally from create() for every single run.
try {
  scene._buildStats();
  console.log('RESULT PASS: _buildStats() completed');
  console.log('  (the missing-identifier theory is wrong — this head is fine)');
  process.exit(0);
} catch (e) {
  const missingImport = e instanceof ReferenceError && /shareableSeed/.test(e.message);
  console.log(`RESULT FAIL: _buildStats() threw ${e.constructor.name}: ${e.message}`);
  console.log(`  every finished run reaches this function from create().`);
  console.log(`  classification: ${missingImport
    ? 'UNBOUND IDENTIFIER — shareableSeed is called but never imported'
    : 'other failure; inspect before concluding'}`);
  process.exit(1);
}
