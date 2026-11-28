/**
 * Marvin decision 7: in the open Game Over shop Enter / pad A buy, so retry needs keys of its own. MenuInput
 * gains an OPT-IN `retry` action (`{ retryAction: true }`, used only by GameOverScene):
 *   - keyboard Space fires 'retry' FIRST, then its usual 'confirm' (InputRouter sends Space as 'hop' +
 *     'confirm'; Enter as 'confirm' only, so a keyboard-sourced 'hop' is always Space);
 *   - pad RB (button 5, free in both MenuInput and the menu half of InputRouter) fires 'retry'.
 * Pad A also arrives as 'hop', but from source 'gamepad', so it stays a plain 'confirm' (buy).
 * Without the option nothing changes, so TitleScene and PauseScene never see the new action.
 *
 * Driven through the real constructor and both input paths (InputRouter events and Phaser keydown), not by
 * reading the source.
 */
import { jest } from '@jest/globals';

jest.unstable_mockModule('phaser', () => ({ default: { Scenes: { Events: { UPDATE: 'update' } } } }));
const { MenuInput } = await import('../../src/ui/MenuInput.js');
const { EVT } = await import('../../src/events.js');

/** A tiny emitter with on/off/once/emit, enough for game.events, scene.events and the keyboard plugin. */
function emitter() {
  const m = new Map();
  return {
    on(e, f) { if (!m.has(e)) m.set(e, new Set()); m.get(e).add(f); return this; },
    once(e, f) { return this.on(e, f); },
    off(e, f) { if (m.has(e)) m.get(e).delete(f); return this; },
    emit(e, ...a) { for (const f of [...(m.get(e) || [])]) f(...a); },
  };
}

let pads = [];
beforeAll(() => {
  Object.defineProperty(window.navigator, 'getGamepads', { configurable: true, value: () => pads });
});
afterEach(() => { pads = []; });

function rig(opts) {
  const gameEvents = emitter();
  const keyboard = emitter();
  const sceneEvents = emitter();
  const scene = {
    game: { events: gameEvents, registry: { get: () => null } },
    input: { keyboard, on() {}, off() {} },
    events: sceneEvents,
  };
  const got = [];
  const mi = new MenuInput(scene, (a, src) => got.push(`${a}:${src}`), opts);
  return {
    got, mi,
    router: (action, source = 'keyboard') => gameEvents.emit(EVT.INPUT_ACTION, { action, pressed: true, source }),
    key: (key) => keyboard.emit('keydown', { key, repeat: false }),
    frame: () => sceneEvents.emit('update', 0, 16),
  };
}

const pad = (pressed) => [{ connected: true, axes: [0, 0], buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })) }];

describe('retryAction: true (Game Over)', () => {
  test('Space through InputRouter fires retry, then confirm; the router\'s own confirm twin is deduped', () => {
    const r = rig({ retryAction: true });
    r.router('hop'); r.router('confirm');
    expect(r.got).toEqual(['retry:keyboard', 'confirm:keyboard']);
  });

  test('Enter through InputRouter is confirm only', () => {
    const r = rig({ retryAction: true });
    r.router('confirm');
    expect(r.got).toEqual(['confirm:keyboard']);
  });

  test('pad A through InputRouter is confirm only (it buys)', () => {
    const r = rig({ retryAction: true });
    r.router('hop', 'gamepad'); r.router('confirm', 'gamepad');
    expect(r.got).toEqual(['confirm:gamepad']);
  });

  test('Space and Enter through Phaser\'s keyboard (no router) behave the same', () => {
    const r = rig({ retryAction: true });
    r.key(' ');
    expect(r.got).toEqual(['retry:keyboard', 'confirm:keyboard']);
    const e = rig({ retryAction: true });
    e.key('Enter');
    expect(e.got).toEqual(['confirm:keyboard']);
  });

  test('pad RB fires retry once per press; pad A from the poll stays confirm', () => {
    const r = rig({ retryAction: true });
    pads = pad([5]); r.frame(); r.frame();
    expect(r.got).toEqual(['retry:gamepad']);
    const a = rig({ retryAction: true });
    pads = pad([0]); a.frame();
    expect(a.got).toEqual(['confirm:gamepad']);
  });

  test('Game Over keyboard R and gamepad RT use the same explicit REPORT action', () => {
    const r=rig({retryAction:true});
    r.key('r');
    expect(r.got).toEqual(['report:keyboard']);
    const p=rig({retryAction:true});
    pads=pad([7]);p.frame();p.frame();
    expect(p.got).toEqual(['report:gamepad']);
    pads=[]; // fresh press: initialize Title with RT UP, then press it
    const title=rig();pads=pad([7]);title.frame();
    expect(title.got).toEqual([]);
  });

  test('Game Over keyboard L and gamepad Select/View open personal ranks, but Title ignores pad Select', () => {
    const k=rig({retryAction:true}); k.key('l');
    expect(k.got).toEqual(['localranks:keyboard']);
    const g=rig({retryAction:true}); pads=pad([8]);g.frame();g.frame();
    expect(g.got).toEqual(['localranks:gamepad']);
    const menu=rig(); pads=pad([8]);menu.frame();
    expect(menu.got).toEqual([]);
  });

  test('while text entry owns the keyboard, Space does not fire retry through the router', () => {
    const r = rig({ retryAction: true });
    r.mi.rawKeyHandler = () => true;
    r.router('hop'); r.router('confirm');
    expect(r.got).toEqual([]);
  });
});

describe('without the option nothing changes (Title, Pause)', () => {
  test('Space is confirm only, and RB does nothing', () => {
    const r = rig();
    r.router('hop'); r.router('confirm'); r.key(' ');
    expect(r.got).toEqual(['confirm:keyboard']);
    const p = rig();
    pads = pad([5]); p.frame();
    expect(p.got).toEqual([]);
  });
});
