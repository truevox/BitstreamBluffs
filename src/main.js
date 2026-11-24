/**
 * Game boot + Phaser config. FOUNDATION-OWNED. Public signatures are a contract - do not change without
 * updating src/ARCHITECTURE.md.
 */
import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, TARGET_FPS } from './constants.js';
import { PreloadScene } from './scenes/PreloadScene.js';
import { TitleScene } from './scenes/TitleScene.js';
import { RunScene } from './scenes/RunScene.js';
import { UIScene } from './scenes/UIScene.js';
import { PauseScene } from './scenes/PauseScene.js';
import { GameOverScene } from './scenes/GameOverScene.js';
import { GlitchPipeline, GLITCH_PIPELINE_KEY } from './shaders/GlitchPipeline.js';

/** @type {Phaser.Types.Core.GameConfig} */
export const config = {
  type: Phaser.WEBGL, // WebGL mandatory (design doc section 3); no canvas fallback
  parent: 'game-container',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#05060f',
  pixelArt: true,
  roundPixels: true,
  powerPreference: 'high-performance',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  fps: { target: TARGET_FPS, forceSetTimeOut: false }, // no fps.limit: Phaser's limiter drops early rAF frames and stutters
  input: { gamepad: true },
  physics: {
    default: 'matter',
    matter: {
      gravity: { x: 0, y: 0.9 }, // 900 px/s^2 (scale 0.001 -> px/s^2 / 1000); see ARCHITECTURE.md section 7
      autoUpdate: false, // RunScene steps the world manually in <= 8 ms sub-steps (PhysicsTuner.stepWorld)
      debug: false,
    },
  },
  // Order only matters for the first scene; the rest are started by key.
  scene: [PreloadScene, TitleScene, RunScene, UIScene, PauseScene, GameOverScene],
  callbacks: {
    postBoot: (game) => {
      game.renderer.pipelines.addPostPipeline(GLITCH_PIPELINE_KEY, GlitchPipeline);
    },
  },
};

export const game = new Phaser.Game(config);
if (typeof window !== 'undefined') window.__bbGame = game; // handy for headless tests / debugging
