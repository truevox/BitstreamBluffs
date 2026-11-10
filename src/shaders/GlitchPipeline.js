/**
 * OWNER: input/audio/glitch engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Phaser 3.90 PostFX pipeline (RGB split + scanline wobble). Registered once in main.js postBoot under the name
 * GLITCH_PIPELINE_KEY. RunScene attaches it with `GlitchPipeline.install(this)` in create().
 */
import Phaser from 'phaser';
import fragShader from './glitch.frag?raw';

export const GLITCH_PIPELINE_KEY = 'GlitchPipeline';

export class GlitchPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  /** @param {Phaser.Game} game */
  constructor(game) {
    super({ game, name: GLITCH_PIPELINE_KEY, fragShader });
    /** 0..1 current glitch strength. */
    this.intensity = 0;
  }

  /** @returns {void} sets shader uniforms each frame. */
  onPreRender() {
    this.set1f('uIntensity', this.intensity);
    this.set1f('uTime', this.game.loop.time / 1000);
  }

  /**
   * Attach the pipeline to the scene's main camera and subscribe to EVT.GLITCH_START / GLITCH_END on game.events
   * (sets intensity for the event's duration). Unsubscribes automatically on scene shutdown.
   * @param {Phaser.Scene} scene
   * @returns {() => void} uninstall function.
   */
  static install(scene) {
    scene.cameras.main.setPostPipeline(GLITCH_PIPELINE_KEY);
    return () => scene.cameras.main.resetPostPipeline();
  }
}
