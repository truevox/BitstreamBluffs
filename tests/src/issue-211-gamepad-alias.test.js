/**
 * Issue #211: gamepad alias reachability.
 *
 * `GP_BINDINGS` binds two physical inputs to the same pad button:
 *   LB (button 4) and RSLeft (right stick axis 2 < -0.5)  -> pad 'heliLeft'
 *   RB (button 5) and RSRight (right stick axis 2 > 0.5) -> pad 'heliRight'
 * Every gamepad binding previously wrote the single source id 'gamepad', so releasing
 * one alias removed the source and cancelled the other alias that was still held.
 *
 * These assertions describe the required behaviour: each physical alias must keep the
 * logical button held until every alias bound to it is released.
 */
import { EventEmitter } from 'events';
import { InputRouter } from '../../src/systems/InputRouter.js';
import { defaultSettings } from '../../src/systems/SaveStore.js';
import { EVT } from '../../src/events.js';

const game = () => ({ events: new EventEmitter(), canvas: null, registry: { get: () => undefined } });

/** Fake W3C standard-mapping gamepad. buttons[0..16], axes [LSx, LSy, RSx, RSy]. */
function gamepad(over = {}) {
  return {
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    ...over,
  };
}

function hold(g, index, down = true) {
  g.buttons[index] = { pressed: down, value: down ? 1 : 0 };
}

function setup(layout = 'classic') {
  const g = game();
  const router = new InputRouter(g);
  const actions = [];
  g.events.on(EVT.INPUT_ACTION, (p) => actions.push(p));
  router.applySettings({ ...defaultSettings(), controlLayout: layout });
  g.events.emit(EVT.RUN_START);
  return { g, router, actions };
}

const key = (type, code) =>
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));

afterEach(() => {
  delete navigator.getGamepads;
  window.dispatchEvent(new Event('blur'));
});

describe('issue #211: LB and RSLeft share pad heliLeft', () => {
  test('a. LB alone drives heli counter-clockwise', () => {
    const { router } = setup();
    const gp = gamepad();
    navigator.getGamepads = () => [gp];
    hold(gp, 4);
    expect(router.poll().heli).toBe(-1);
    router.destroy();
  });

  test('b. RB alone drives heli clockwise', () => {
    const { router } = setup();
    const gp = gamepad();
    navigator.getGamepads = () => [gp];
    hold(gp, 5);
    expect(router.poll().heli).toBe(1);
    router.destroy();
  });

  test('c. releasing LB keeps the still-deflected right stick holding heliLeft', () => {
    const { router } = setup();
    const gp = gamepad();
    navigator.getGamepads = () => [gp];

    hold(gp, 4);
    expect(router.poll().heli).toBe(-1);

    gp.axes[2] = -1; // RSLeft
    expect(router.poll().heli).toBe(-1);

    hold(gp, 4, false); // release LB only; stick is still deflected
    expect(router.poll().heli).toBe(-1);

    gp.axes[2] = 0; // release the stick too
    expect(router.poll().heli).toBe(0);
    router.destroy();
  });

  test('d. releasing the right stick keeps the still-held LB holding heliLeft', () => {
    const { router } = setup();
    const gp = gamepad();
    navigator.getGamepads = () => [gp];

    hold(gp, 4);
    gp.axes[2] = -1;
    expect(router.poll().heli).toBe(-1);

    gp.axes[2] = 0; // release the stick first; LB is still held
    expect(router.poll().heli).toBe(-1);

    hold(gp, 4, false);
    expect(router.poll().heli).toBe(0);
    router.destroy();
  });

  test('e. losing the gamepad releases every gamepad-held button', () => {
    const { router } = setup();
    const gp = gamepad();
    navigator.getGamepads = () => [gp];

    hold(gp, 0); // A -> hop + confirm
    hold(gp, 4); // LB -> heliLeft
    gp.axes[2] = -1; // RSLeft -> heliLeft too
    const s = router.poll();
    expect(s.heli).toBe(-1);
    expect(s.hop).toBe(true);
    expect(s.pressed.confirm).toBe(true);

    navigator.getGamepads = () => [null];
    const gone = router.poll();
    expect(gone.heli).toBe(0);
    expect(gone.hop).toBe(false);
    // 'confirm' is edge-only in the pad state; assert its held set is empty after the disconnect.
    for (const name of Object.keys(router.pad.held)) {
      expect(router.pad.held[name].has('gamepad')).toBe(false);
    }
    router.destroy();
  });

  test('e. gamepaddisconnected also releases gamepad-held buttons', () => {
    const { router } = setup();
    const gp = gamepad();
    navigator.getGamepads = () => [gp];

    hold(gp, 5); // RB -> heliRight
    expect(router.poll().heli).toBe(1);
    expect(router.poll().pressed.hop).toBe(false);

    navigator.getGamepads = () => [null];
    window.dispatchEvent(new Event('gamepaddisconnected'));
    expect(router.poll().heli).toBe(0);
    router.destroy();
  });

  test('f. keyboard and gamepad holds of heliLeft are independent (gamepad release)', () => {
    const { router } = setup('classic');
    const gp = gamepad();
    navigator.getGamepads = () => [gp];

    key('keydown', 'ArrowLeft'); // keyboard holds heliLeft
    expect(router.poll().heli).toBe(-1);

    hold(gp, 4); // gamepad adds its own hold
    expect(router.poll().heli).toBe(-1);

    hold(gp, 4, false); // releasing gamepad must not cancel the keyboard hold
    expect(router.poll().heli).toBe(-1);

    key('keyup', 'ArrowLeft');
    expect(router.poll().heli).toBe(0);
    router.destroy();
  });

  test('f. keyboard and gamepad holds of heliLeft are independent (keyboard release)', () => {
    const { router } = setup('classic');
    const gp = gamepad();
    navigator.getGamepads = () => [gp];

    hold(gp, 4);
    expect(router.poll().heli).toBe(-1);

    key('keydown', 'ArrowLeft');
    expect(router.poll().heli).toBe(-1);

    key('keyup', 'ArrowLeft'); // releasing keyboard must not cancel the gamepad hold
    expect(router.poll().heli).toBe(-1);

    hold(gp, 4, false);
    expect(router.poll().heli).toBe(0);
    router.destroy();
  });

  test('gamepad writes pad state before emitting INPUT_ACTION (listener sees fresh state)', () => {
    const g = game();
    const router = new InputRouter(g);
    const observed = [];
    g.events.on(EVT.INPUT_ACTION, (p) => {
      if (p.action === 'hop') observed.push({ pressed: p.pressed, hop: router.pad.state.hop });
    });
    router.applySettings({ ...defaultSettings(), controlLayout: 'classic' });
    g.events.emit(EVT.RUN_START);
    const gp = gamepad();
    navigator.getGamepads = () => [gp];

    hold(gp, 0); // A -> hop + confirm
    router.poll();
    expect(observed).toContainEqual({ pressed: true, hop: true });

    hold(gp, 0, false);
    router.poll();
    expect(observed).toContainEqual({ pressed: false, hop: false });
    router.destroy();
  });

  test('gamepad INPUT_ACTION events keep source "gamepad"', () => {
    const { router, actions } = setup();
    const gp = gamepad();
    navigator.getGamepads = () => [gp];

    hold(gp, 9); // Start -> pause action
    router.poll();
    hold(gp, 9, false);
    router.poll();

    expect(actions.filter((a) => a.action === 'pause')).toEqual([
      { action: 'pause', pressed: true, source: 'gamepad' },
      { action: 'pause', pressed: false, source: 'gamepad' },
    ]);
    router.destroy();
  });
});
