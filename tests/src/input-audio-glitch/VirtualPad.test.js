import { VirtualPad, emptyPadState } from '../../../src/systems/VirtualPad.js';

describe('VirtualPad', () => {
  test('starts neutral', () => {
    expect(new VirtualPad().poll()).toEqual(emptyPadState());
  });

  test('A/D tilt, both = tuck with zero tilt', () => {
    const p = new VirtualPad();
    p.setButton('tiltBack', true, 'keyboard');
    expect(p.poll().tilt).toBe(-1);
    p.setButton('tiltForward', true, 'keyboard');
    const s = p.poll();
    expect(s.tuck).toBe(true);
    expect(s.tilt).toBe(0);
    p.setButton('tiltBack', false, 'keyboard');
    expect(p.poll().tilt).toBe(1);
    expect(p.poll().tuck).toBe(false);
  });

  test('pressed edges fire once and survive a press/release between polls', () => {
    const p = new VirtualPad();
    p.setButton('hop', true, 'keyboard');
    p.setButton('hop', false, 'keyboard');
    const a = p.poll();
    expect(a.hop).toBe(false);
    expect(a.pressed.hop).toBe(true);
    expect(p.poll().pressed.hop).toBe(false);
    p.setButton('hop', true, 'keyboard');
    p.setButton('hop', true, 'touch'); // second source is not a new edge
    expect(p.poll().pressed.hop).toBe(true);
    expect(p.poll().pressed.hop).toBe(false);
  });

  test('sources are independent: keyboard release does not cancel a touch hold', () => {
    const p = new VirtualPad();
    p.setButton('push', true, 'touch');
    p.setButton('push', true, 'keyboard');
    p.setButton('push', false, 'keyboard');
    expect(p.poll().push).toBe(true);
    expect(p.state.lastSource).toBe('keyboard');
    p.setButton('push', false, 'touch');
    expect(p.poll().push).toBe(false);
  });

  test('heli axis', () => {
    const p = new VirtualPad();
    p.setButton('heliLeft', true, 'keyboard');
    expect(p.poll().heli).toBe(-1);
    p.setButton('heliRight', true, 'keyboard');
    expect(p.poll().heli).toBe(0);
    p.setButton('heliLeft', false, 'keyboard');
    expect(p.poll().heli).toBe(1);
  });

  test('analog tilt: dead-zone, overrides digital, rescaled, clamped', () => {
    const p = new VirtualPad();
    p.setTilt(0.1);
    expect(p.poll().tilt).toBe(0);
    p.setButton('tiltBack', true, 'keyboard');
    p.setTilt(0.1);
    expect(p.poll().tilt).toBe(-1); // inside dead-zone: digital wins
    p.setTilt(1);
    expect(p.poll().tilt).toBe(1);
    p.setTilt(0.575);
    expect(p.poll().tilt).toBeCloseTo(0.5, 5);
    p.setTilt(5);
    expect(p.poll().tilt).toBe(1);
    expect(p.poll().lastSource).toBe('gamepad');
  });

  test('largest analog source wins; releaseSource clears gamepad', () => {
    const p = new VirtualPad();
    p.setTilt(0.5, 'gamepad');
    p.setTilt(-1, 'device');
    expect(p.poll().tilt).toBe(-1);
    p.releaseSource('touch');
    expect(p.poll().tilt).toBeGreaterThan(0);
    p.releaseSource('gamepad');
    expect(p.poll().tilt).toBe(0);
  });

  test('unknown buttons ignored; destroy resets', () => {
    const p = new VirtualPad();
    p.setButton('nope', true, 'keyboard');
    p.setButton('brake', true, 'keyboard');
    p.destroy();
    expect(p.poll()).toEqual(emptyPadState());
  });

  test('touch overlay mounts, shows only in run context, buttons drive the pad', () => {
    const p = new VirtualPad();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    p.mountTouchOverlay(parent, { touchOverlay: 'on', touchRotate90: false });
    const root = parent.querySelector('.bb-touch-overlay');
    expect(root).not.toBeNull();
    expect(root.style.display).toBe('none');
    p.setOverlayContext(true);
    expect(root.style.display).toBe('block');
    expect(root.querySelectorAll('[data-btn]').length).toBe(12);
    // drive the overlay directly (jsdom has no elementFromPoint layout)
    p.overlay._assign(1, 'hop');
    p.overlay._assign(2, 'tiltBack');
    p.overlay._assign(3, 'tiltForward');
    const s = p.poll();
    expect(s.hop).toBe(true);
    expect(s.pressed.hop).toBe(true);
    expect(s.tuck).toBe(true);
    expect(s.lastSource).toBe('touch');
    p.setOverlayContext(false); // hiding releases everything
    expect(p.poll().hop).toBe(false);
    p.destroy();
    expect(parent.querySelector('.bb-touch-overlay')).toBeNull();
  });

  test('overlay mode off never shows; auto hidden without touch', () => {
    const p = new VirtualPad();
    const parent = document.createElement('div');
    p.mountTouchOverlay(parent, { touchOverlay: 'off' });
    p.setOverlayContext(true);
    expect(p.overlay.isVisible()).toBe(false);
    p.destroy();
  });
});
