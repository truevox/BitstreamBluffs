/**
 * Issue #211: gameplay-input reachability matrix (issue #211 leaf, NOT full parity).
 *
 * Documents, at runtime, which pad buttons every supported physical input can actually reach.
 * Derived from the real code paths:
 *   - KEYMAP + ControlLayouts.layoutButton (keyboard, per control layout)
 *   - GP_BINDINGS (standard-mapping gamepad)
 *   - TOUCH_CLUSTERS + touchButtonFor (touch overlay, classic vs trick deck)
 *
 * Reachability is observed through VirtualPad's per-button held sets (the single source of truth
 * InputRouter writes to), so a raw pad name is "mapped" only when a real input holds it.
 * See docs/controls/issue-211-input-reachability.md for the human-readable table.
 */
import { EventEmitter } from 'events';
import { InputRouter } from '../../src/systems/InputRouter.js';
import { VirtualPad, HELD_NAMES } from '../../src/systems/VirtualPad.js';
import { TRICK_KEYS_RIGHT, TRICK_KEYS_LEFT } from '../../src/systems/ControlLayouts.js';
import { TOUCH_CLUSTERS, touchButtonFor } from '../../src/systems/TouchOverlay.js';
import { defaultSettings } from '../../src/systems/SaveStore.js';
import { EVT } from '../../src/events.js';

const game = () => ({ events: new EventEmitter(), canvas: null, registry: { get: () => undefined } });
const key = (type, code) =>
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));

const heldNames = (router) => HELD_NAMES.filter((n) => router.pad.held[n].size > 0);
const sorted = (a) => [...a].sort();

function routerFor(layout) {
  const g = game();
  const router = new InputRouter(g);
  router.applySettings({ ...defaultSettings(), controlLayout: layout });
  g.events.emit(EVT.RUN_START);
  return router;
}

function gamepad(over = {}) {
  return {
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    ...over,
  };
}

afterEach(() => {
  delete navigator.getGamepads;
  window.dispatchEvent(new Event('blur'));
});

// --------------------------------------------------------------------------------------------- keyboard

describe('issue #211 matrix: keyboard per control layout', () => {
  const CASES = [
    {
      layout: 'classic',
      expected: {
        KeyW: ['push'], KeyA: ['tiltBack'], KeyD: ['tiltForward'], KeyS: ['brake'],
        Space: ['confirm', 'hop'], ShiftLeft: ['reset'], ShiftRight: ['reset'],
        ArrowLeft: ['heliLeft'], ArrowRight: ['heliRight'], ArrowUp: ['airBrake'],
        ArrowDown: ['parachute'], Escape: ['pause'], Enter: ['confirm'],
        NumpadEnter: ['confirm'], Backspace: [],
      },
    },
    {
      layout: 'tricksRight',
      expected: {
        KeyW: ['parachute'], KeyA: ['airBrake'], KeyS: ['divebomb'], KeyD: ['tuck'],
        ArrowUp: ['tiltForward'], ArrowDown: ['tiltBack'], ArrowRight: ['heliRight'],
        ArrowLeft: ['corkscrew'],
        Space: ['confirm', 'hop'], ShiftLeft: ['reset'], Escape: ['pause'], Enter: ['confirm'],
      },
    },
    {
      layout: 'tricksLeft',
      expected: {
        KeyW: ['tiltForward'], KeyS: ['tiltBack'], KeyD: ['heliRight'], KeyA: ['corkscrew'],
        ArrowUp: ['parachute'], ArrowLeft: ['airBrake'], ArrowDown: ['divebomb'],
        ArrowRight: ['tuck'],
        Space: ['confirm', 'hop'], ShiftLeft: ['reset'], Escape: ['pause'], Enter: ['confirm'],
      },
    },
  ];

  for (const { layout, expected } of CASES) {
    test(`${layout}: every key reaches exactly its documented pad buttons`, () => {
      const router = routerFor(layout);
      for (const [code, want] of Object.entries(expected)) {
        key('keydown', code);
        expect(sorted(heldNames(router))).toEqual(sorted(want));
        key('keyup', code);
        expect(heldNames(router)).toEqual([]);
      }
      router.destroy();
    });
  }

  test('trick layouts do NOT reach push, brake or heliLeft on the keyboard', () => {
    for (const layout of ['tricksRight', 'tricksLeft']) {
      const router = routerFor(layout);
      const reachable = new Set();
      for (const e of [...Object.keys(TRICK_KEYS_RIGHT), ...Object.keys(TRICK_KEYS_LEFT),
        'Space', 'ShiftLeft', 'Escape', 'Enter']) {
        key('keydown', e);
        heldNames(router).forEach((n) => reachable.add(n));
        key('keyup', e);
      }
      expect(reachable.has('push')).toBe(false);
      expect(reachable.has('brake')).toBe(false);
      expect(reachable.has('heliLeft')).toBe(false);
      router.destroy();
    }
  });

  test('classic keyboard cannot reach divebomb or corkscrew', () => {
    const router = routerFor('classic');
    const reachable = new Set();
    for (const e of ['KeyW', 'KeyA', 'KeyD', 'KeyS', 'Space', 'ShiftLeft', 'ShiftRight',
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape', 'Enter', 'NumpadEnter']) {
      key('keydown', e);
      heldNames(router).forEach((n) => reachable.add(n));
      key('keyup', e);
    }
    expect(reachable.has('divebomb')).toBe(false);
    expect(reachable.has('corkscrew')).toBe(false);
    router.destroy();
  });
});

// ---------------------------------------------------------------------------------------------- gamepad

describe('issue #211 matrix: standard gamepad', () => {
  test('each physical gamepad input reaches exactly its bound pad buttons', () => {
    const router = routerFor('classic');
    const gp = gamepad();
    navigator.getGamepads = () => [gp];
    const cases = [
      ['A', (p) => { p.buttons[0] = { pressed: true, value: 1 }; }, ['confirm', 'hop']],
      ['B', (p) => { p.buttons[1] = { pressed: true, value: 1 }; }, ['brake']],
      ['X', (p) => { p.buttons[2] = { pressed: true, value: 1 }; }, ['airBrake']],
      ['Y', (p) => { p.buttons[3] = { pressed: true, value: 1 }; }, ['parachute']],
      ['LB', (p) => { p.buttons[4] = { pressed: true, value: 1 }; }, ['heliLeft']],
      ['RB', (p) => { p.buttons[5] = { pressed: true, value: 1 }; }, ['heliRight']],
      ['LT', (p) => { p.buttons[6] = { pressed: true, value: 1 }; }, ['tuck']],
      ['RT', (p) => { p.buttons[7] = { pressed: true, value: 1 }; }, ['push']],
      ['Back', (p) => { p.buttons[8] = { pressed: true, value: 1 }; }, ['reset']],
      ['Start', (p) => { p.buttons[9] = { pressed: true, value: 1 }; }, ['pause']],
      ['DLeft', (p) => { p.buttons[14] = { pressed: true, value: 1 }; }, ['tiltBack']],
      ['DRight', (p) => { p.buttons[15] = { pressed: true, value: 1 }; }, ['tiltForward']],
      ['RSLeft', (p) => { p.axes[2] = -1; }, ['heliLeft']],
      ['RSRight', (p) => { p.axes[2] = 1; }, ['heliRight']],
    ];
    for (const [, press, want] of cases) {
      const fresh = gamepad();
      navigator.getGamepads = () => [fresh];
      router.poll(); // sync to neutral
      press(fresh);
      router.poll();
      expect(sorted(heldNames(router))).toEqual(sorted(want));
    }
    router.destroy();
  });

  test('d-pad and left-stick directions emit menu actions without a pad button', () => {
    const g = game();
    const router = new InputRouter(g);
    const acts = [];
    g.events.on(EVT.INPUT_ACTION, (a) => acts.push(a));
    const gp = gamepad();
    navigator.getGamepads = () => [gp];
    gp.buttons[12] = { pressed: true, value: 1 }; // DUp
    gp.axes[0] = -1; // LSLeft
    router.poll();
    expect(heldNames(router)).toEqual([]);
    expect(acts.filter((a) => a.pressed).map((a) => a.action)).toEqual(
      expect.arrayContaining(['up', 'left']));
    router.destroy();
  });

  test('gamepad cannot reach divebomb, corkscrew or heli on a stick other than the right stick', () => {
    const router = routerFor('classic');
    const gp = gamepad();
    navigator.getGamepads = () => [gp];
    const reachable = new Set();
    // every button index and both stick axes
    for (let i = 0; i < 17; i++) {
      const fresh = gamepad();
      navigator.getGamepads = () => [fresh];
      fresh.buttons[i] = { pressed: true, value: 1 };
      router.poll();
      heldNames(router).forEach((n) => reachable.add(n));
    }
    for (const [idx, v] of [[0, -1], [0, 1], [1, -1], [1, 1], [3, -1], [3, 1]]) {
      const fresh = gamepad();
      navigator.getGamepads = () => [fresh];
      fresh.axes[idx] = v;
      router.poll();
      heldNames(router).forEach((n) => reachable.add(n));
    }
    expect(reachable.has('divebomb')).toBe(false);
    expect(reachable.has('corkscrew')).toBe(false);
    // heli only comes from LB/RB and the right-stick X axis (axes[2]).
    expect(reachable.has('heliLeft')).toBe(true);
    expect(reachable.has('heliRight')).toBe(true);
    router.destroy();
  });
});

// ------------------------------------------------------------------------------------------------ touch

describe('issue #211 matrix: touch overlay', () => {
  const mount = (layout) => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const pad = new VirtualPad();
    pad.mountTouchOverlay(parent, { touchOverlay: 'on', controlLayout: layout });
    pad.setOverlayContext(true);
    const names = () => [...pad.overlay.root.querySelectorAll('[data-btn]')].map((e) => e.dataset.btn);
    const tap = (name) => { pad.overlay._assign(1, name); pad.overlay._assign(1, null); };
    return { pad, parent, names, tap };
  };

  test('classic overlay reaches classic buttons, not divebomb/corkscrew/confirm', () => {
    const { pad, parent, names, tap } = mount('classic');
    const reachable = new Set();
    for (const n of names()) {
      pad.overlay._assign(1, n);
      heldNames({ pad }).forEach((x) => reachable.add(x));
      pad.overlay._assign(1, null);
    }
    for (const n of ['push', 'brake', 'tuck', 'tiltBack', 'tiltForward', 'heliLeft',
      'heliRight', 'airBrake', 'parachute', 'hop', 'reset', 'pause']) {
      expect(reachable.has(n)).toBe(true);
    }
    expect(reachable.has('divebomb')).toBe(false);
    expect(reachable.has('corkscrew')).toBe(false);
    expect(reachable.has('confirm')).toBe(false);
    tap('hop');
    pad.destroy();
    parent.remove();
  });

  test('trick-deck overlay swaps push->divebomb and heliLeft->corkscrew', () => {
    const { pad, parent, names } = mount('tricksRight');
    const reachable = new Set(names());
    expect(reachable.has('divebomb')).toBe(true);
    expect(reachable.has('corkscrew')).toBe(true);
    expect(reachable.has('push')).toBe(false);
    expect(reachable.has('heliLeft')).toBe(false);
    // and every advertised button really drives the pad
    for (const n of names()) {
      pad.overlay._assign(1, n);
      expect(pad.held[n].size).toBeGreaterThan(0);
      pad.overlay._assign(1, null);
    }
    pad.destroy();
    parent.remove();
  });

  test('touchButtonFor is the single swap source both DOM and legend use', () => {
    expect(touchButtonFor({ name: 'push' }, 'trickDeck').name).toBe('divebomb');
    expect(touchButtonFor({ name: 'heliLeft' }, 'trickDeck').name).toBe('corkscrew');
    expect(touchButtonFor({ name: 'push' }, 'classic').name).toBe('push');
    expect(touchButtonFor({ name: 'heliLeft' }, 'classic').name).toBe('heliLeft');
    // cluster membership pins the spatial buttons the matrix describes
    expect(TOUCH_CLUSTERS.RIGHT.map((b) => b.name)).toEqual(
      expect.arrayContaining(['heliLeft', 'heliRight', 'push', 'hop', 'parachute', 'airBrake']));
    expect(TOUCH_CLUSTERS.TOP.map((b) => b.name)).toEqual(['reset', 'pause']);
  });
});
