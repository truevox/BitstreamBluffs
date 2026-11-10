/**
 * OWNER: input/audio/glitch engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Phaser 3.90 PostFX pipeline: RGB split, scanline wobble / horizontal tearing, block displacement, colour
 * inversion flicker and an always-on faint scanline/CRT layer (see glitch.frag). Registered once in main.js postBoot
 * under the name GLITCH_PIPELINE_KEY. RunScene attaches it with `GlitchPipeline.install(this)` in create().
 * Driven by EVT.GLITCH_START / GLITCH_END on game.events (payload kind/intensity/durationMs; the seed-bound block
 * pattern comes from the hex tag in the event id, e.g. 'g12-3fa9'). The glitch also expires on its own after
 * durationMs (+ a small grace), so a pause mid-glitch can never leave the screen glitched.
 * Reduced effects: when settings.screenShake === false the shader runs in "safe" mode (weaker, no inversion).
 * WebGL only.
 */
import Phaser from 'phaser';
import fragShader from './glitch.frag?raw';
import { EVT } from '../events.js';
import { REG } from '../constants.js';

export const GLITCH_PIPELINE_KEY = 'GlitchPipeline';

/** Shader kind ids (must match glitch.frag). */
const KIND_ID = { rgbSplit: 1, scanlineWobble: 2, stutter: 3, dropout: 4, static: 5 };

/** @param {string} id @returns {number} 0..1 seed-bound pattern value from the event id. */
export function patternFromId(id) {
  const s = String(id || '');
  const m = /-([0-9a-f]{1,8})$/i.exec(s);
  if (m) return (parseInt(m[1], 16) % 65536) / 65536;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return (h % 65536) / 65536;
}

export class GlitchPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  /** @param {Phaser.Game} game */
  constructor(game) {
    super({ game, name: GLITCH_PIPELINE_KEY, fragShader });
    /** 0..1 current glitch strength (read by the shader; normally driven by the active event). */
    this.intensity = 0;
    /** Always-on CRT layer strength 0..1. */
    this.crt = 1;
    /** @type {{id:string, kind:number, seed:number, start:number, duration:number, intensity:number}|null} */
    this.active = null;
    /** Force reduced-effects mode regardless of settings (tests / debug). */
    this.forceSafe = false;
  }

  /** Begin a glitch from an event payload. @param {import('../events.js').GlitchStartPayload} p @returns {void} */
  startEvent(p) {
    if (!p) return;
    this.active = {
      id: p.id,
      kind: KIND_ID[p.kind] || 1,
      seed: patternFromId(p.id),
      start: this.game.loop.time,
      duration: Math.max(30, Number(p.durationMs) || 100),
      intensity: Math.max(0, Math.min(1, p.intensity == null ? 0.7 : p.intensity)),
    };
  }

  /** @param {string} [id] @returns {void} */
  endEvent(id) {
    if (!this.active || (id && this.active.id !== id)) return;
    this.active = null;
    this.intensity = 0;
  }

  /** @returns {void} sets shader uniforms each frame. */
  onPreRender() {
    const a = this.active;
    let kind = 0;
    let seed = 0;
    if (a) {
      const el = this.game.loop.time - a.start;
      if (el > a.duration + 60) {
        this.active = null;
        this.intensity = 0;
      } else {
        const attack = Math.min(1, el / 16);
        const release = el > a.duration ? Math.max(0, 1 - (el - a.duration) / 60) : 1;
        // slight deterministic flicker inside the event so it is not a flat wash
        const flick = 0.82 + 0.18 * Math.sin(el * 0.11 + a.seed * 40);
        this.intensity = a.intensity * attack * release * flick;
        kind = a.kind;
        seed = a.seed;
      }
    }
    let safe = this.forceSafe ? 1 : 0;
    try {
      const s = this.game.registry.get(REG.SETTINGS);
      if (s && s.screenShake === false) safe = 1;
    } catch (e) { /* no registry yet */ }
    this.set1f('uIntensity', this.active || this.intensity > 0 ? this.intensity : 0);
    this.set1f('uTime', this.game.loop.time / 1000);
    this.set1f('uKind', kind);
    this.set1f('uSeed', seed);
    this.set1f('uSafe', safe);
    this.set1f('uCrt', this.crt);
    if (!this._bg) {
      const c = this.game.config.backgroundColor;
      this._bg = c && c.red !== undefined ? [c.redGL, c.greenGL, c.blueGL] : [0.02, 0.024, 0.06];
    }
    this.set3f('uBg', this._bg[0], this._bg[1], this._bg[2]);
  }

  /**
   * Attach the pipeline to the scene's main camera and subscribe to EVT.GLITCH_START / GLITCH_END on game.events
   * (sets intensity for the event's duration). Unsubscribes automatically on scene shutdown.
   * @param {Phaser.Scene} scene
   * @returns {() => void} uninstall function.
   */
  static install(scene) {
    const cam = scene.cameras.main;
    const game = scene.game;
    cam.setPostPipeline(GLITCH_PIPELINE_KEY);
    const find = () => {
      const r = cam.getPostPipeline(GLITCH_PIPELINE_KEY);
      return Array.isArray(r) ? r[0] : r;
    };
    const onStart = (p) => { const pl = find(); if (pl && pl.startEvent) pl.startEvent(p); };
    const onEnd = (p) => { const pl = find(); if (pl && pl.endEvent) pl.endEvent(p && p.id); };
    game.events.on(EVT.GLITCH_START, onStart);
    game.events.on(EVT.GLITCH_END, onEnd);
    let done = false;
    const uninstall = () => {
      if (done) return;
      done = true;
      game.events.off(EVT.GLITCH_START, onStart);
      game.events.off(EVT.GLITCH_END, onEnd);
      scene.events.off('shutdown', uninstall);
      scene.events.off('destroy', uninstall);
      try { cam.resetPostPipeline(); } catch (e) { /* camera already destroyed */ }
    };
    scene.events.once('shutdown', uninstall);
    scene.events.once('destroy', uninstall);
    return uninstall;
  }
}
