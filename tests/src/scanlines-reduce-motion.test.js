/**
 * ui/Scanlines.js: the menu's rolling bright band must obey REDUCE MOTION immediately, not only when its
 * 7 s pass repeats (Copilot review on PR #32). Stubs a scene just far enough for addScanlines to run and
 * captures the tween config so the test can drive onUpdate mid-pass.
 */
import { addScanlines } from '../../src/ui/Scanlines.js';
import { REG } from '../../src/constants.js';

function makeImage() {
  const img = {
    visible: true,
    scene: true,
    setOrigin() { return img; },
    setDepth() { return img; },
    setAlpha() { return img; },
    setBlendMode() { return img; },
    setVisible(v) { img.visible = v; return img; },
    once() { return img; },
    destroy() { img.scene = null; },
  };
  return img;
}

function makeScene(settings) {
  const tweens = [];
  const scene = {
    registry: { get: (k) => (k === REG.SETTINGS ? settings : undefined) },
    textures: {
      exists: () => true,
      createCanvas: () => ({ context: null, refresh() {} }),
    },
    add: { image: () => makeImage() },
    tweens: { add: (cfg) => { tweens.push(cfg); return { remove() {} }; } },
  };
  return { scene, tweens };
}

describe('scanline roll band and reduce motion', () => {
  test('turning REDUCE MOTION on mid-pass hides the band on the next update, and off shows it again', () => {
    const settings = { reduceMotion: 'off' };
    const { scene, tweens } = makeScene(settings);
    const img = addScanlines(scene, 1, { roll: true });
    const band = img.band;
    expect(band).toBeTruthy();
    expect(band.visible).toBe(true);
    const cfg = tweens.find((t) => t.targets === band);
    expect(typeof cfg.onUpdate).toBe('function');

    settings.reduceMotion = 'on';
    cfg.onUpdate();
    expect(band.visible).toBe(false);

    settings.reduceMotion = 'off';
    cfg.onUpdate();
    expect(band.visible).toBe(true);
  });

  test('the band starts hidden when reduce motion is already on', () => {
    const { scene } = makeScene({ reduceMotion: 'on' });
    const img = addScanlines(scene, 1, { roll: true });
    expect(img.band.visible).toBe(false);
  });
});
