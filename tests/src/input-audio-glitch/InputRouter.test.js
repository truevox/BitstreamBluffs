import { EventEmitter } from 'events';
import { InputRouter } from '../../../src/systems/InputRouter.js';
import { EVT } from '../../../src/events.js';

function key(type, code, extra = {}) {
  const e = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...extra });
  window.dispatchEvent(e);
  return e;
}

function setup() {
  const game = { events: new EventEmitter(), canvas: null, registry: { get: () => undefined } };
  const router = new InputRouter(game);
  const actions = [];
  game.events.on(EVT.INPUT_ACTION, (p) => actions.push(p));
  return { game, router, actions };
}

describe('InputRouter keyboard', () => {
  test('maps doc 4.1 keys and emits INPUT_ACTION', () => {
    const { router, actions } = setup();
    key('keydown', 'KeyW');
    key('keydown', 'KeyA');
    key('keydown', 'Space');
    key('keydown', 'ShiftLeft');
    key('keydown', 'ArrowLeft');
    key('keydown', 'ArrowUp');
    key('keydown', 'KeyS');
    let s = router.poll();
    expect(s).toMatchObject({ push: true, tilt: -1, hop: true, reset: true, heli: -1, airBrake: true, brake: true });
    expect(s.pressed).toMatchObject({ hop: true, reset: true, airBrake: true, confirm: true, pause: false });
    expect(router.poll().pressed.hop).toBe(false);
    key('keydown', 'KeyD');
    expect(router.poll()).toMatchObject({ tuck: true, tilt: 0 });
    key('keydown', 'ArrowDown');
    key('keydown', 'Escape');
    s = router.poll();
    expect(s.parachute).toBe(true);
    expect(s.pressed).toMatchObject({ parachute: true, pause: true });
    key('keyup', 'KeyW');
    expect(router.poll().push).toBe(false);
    const names = actions.filter((a) => a.pressed).map((a) => a.action);
    expect(names).toEqual(expect.arrayContaining(['hop', 'confirm', 'reset', 'airBrake', 'pause', 'left', 'up', 'down', 'anyKey']));
    expect(actions.every((a) => a.source === 'keyboard')).toBe(true);
    router.destroy();
  });

  test('prevents default for space/arrows only, ignores ctrl combos and text fields', () => {
    const { router } = setup();
    expect(key('keydown', 'Space').defaultPrevented).toBe(true);
    expect(key('keydown', 'ArrowDown').defaultPrevented).toBe(true);
    expect(key('keydown', 'KeyW').defaultPrevented).toBe(false);
    key('keyup', 'Space');
    key('keyup', 'ArrowDown');
    expect(key('keydown', 'KeyW', { ctrlKey: true }).defaultPrevented).toBe(false);
    key('keyup', 'KeyW');
    const input = document.createElement('input');
    document.body.appendChild(input);
    const e = new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true });
    input.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(router.poll().hop).toBe(false);
    router.destroy();
  });

  test('both Shift keys: releasing one keeps reset held', () => {
    const { router } = setup();
    key('keydown', 'ShiftLeft');
    key('keydown', 'ShiftRight');
    key('keyup', 'ShiftLeft');
    expect(router.poll().reset).toBe(true);
    key('keyup', 'ShiftRight');
    expect(router.poll().reset).toBe(false);
    router.destroy();
  });

  test('blur releases held keys', () => {
    const { router } = setup();
    key('keydown', 'KeyW');
    window.dispatchEvent(new Event('blur'));
    expect(router.poll().push).toBe(false);
    router.destroy();
  });

  test('setEnabled(false) returns neutral state but still emits menu actions', () => {
    const { router, actions } = setup();
    router.setEnabled(false);
    key('keydown', 'KeyW');
    expect(router.poll().push).toBe(false);
    expect(actions.some((a) => a.action === 'up')).toBe(true);
    router.setEnabled(true);
    expect(router.poll().push).toBe(true);
    router.destroy();
  });

  test('destroy removes every listener', () => {
    const { game, router, actions } = setup();
    router.destroy();
    key('keydown', 'KeyW');
    expect(actions.length).toBe(0);
    expect(game.events.listenerCount('prestep')).toBe(0);
    expect(game.events.listenerCount(EVT.RUN_START)).toBe(0);
  });
});

describe('InputRouter gamepad', () => {
  afterEach(() => { delete navigator.getGamepads; });

  function pad(over = {}) {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    return { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, ...over };
  }

  test('stick tilt, RT push, A hop, Start pause, disconnect releases', () => {
    const { router, actions } = setup();
    const g = pad();
    navigator.getGamepads = () => [g];
    g.axes[0] = 0.05;
    expect(router.poll().tilt).toBe(0);
    g.axes[0] = -1;
    g.buttons[7] = { pressed: true, value: 1 };
    g.buttons[0] = { pressed: true, value: 1 };
    g.buttons[9] = { pressed: true, value: 1 };
    const s = router.poll();
    expect(s).toMatchObject({ tilt: -1, push: true, hop: true, lastSource: 'gamepad' });
    expect(s.pressed).toMatchObject({ hop: true, pause: true });
    expect(actions.some((a) => a.action === 'pause' && a.source === 'gamepad')).toBe(true);
    navigator.getGamepads = () => [null];
    const after = router.poll();
    expect(after.push).toBe(false);
    expect(after.tilt).toBe(0);
    router.destroy();
  });
});
