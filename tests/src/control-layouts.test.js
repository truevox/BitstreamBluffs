import { CONTROL_LAYOUTS, DEFAULT_CONTROL_LAYOUT, layoutButton, normalizeControlLayout } from '../../src/systems/ControlLayouts.js';
import { defaultSettings, sanitizeSettings } from '../../src/systems/SaveStore.js';
import { InputRouter } from '../../src/systems/InputRouter.js';
import { VirtualPad } from '../../src/systems/VirtualPad.js';
import { EVT } from '../../src/events.js';
import { EventEmitter } from 'events';

const game = () => ({ events: new EventEmitter(), canvas: null, registry: { get: () => undefined } });
const press = (code, type='keydown') => window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true,cancelable:true}));

describe('Trick Deck layouts and settings', () => {
  test('defaults to Tricks Right while Classic remains selectable', () => {
    expect(DEFAULT_CONTROL_LAYOUT).toBe(CONTROL_LAYOUTS.TRICKS_RIGHT);
    expect(defaultSettings().controlLayout).toBe('tricksRight');
    expect(sanitizeSettings({controlLayout:'tricksLeft'}).controlLayout).toBe('tricksLeft');
    expect(sanitizeSettings({controlLayout:'classic'}).controlLayout).toBe('classic');
    expect(normalizeControlLayout('garbage')).toBe('tricksRight');
    expect(layoutButton('classic','KeyW')).toBeUndefined();
  });
  test('corkscrew owns the open trick key in both orientations', () => {
    expect(layoutButton('tricksRight','ArrowLeft')).toBe('corkscrew');
    expect(layoutButton('tricksLeft','KeyA')).toBe('corkscrew');
  });
  test('right-side tricks, left-side practical controls in a live run', () => {
    const g=game(), router=new InputRouter(g), actions=[];
    g.events.on(EVT.INPUT_ACTION, x=>actions.push(x));
    router.applySettings({...defaultSettings(),controlLayout:'tricksRight'});
    g.events.emit(EVT.RUN_START);
    press('KeyW');press('KeyA');press('KeyS');press('KeyD');
    press('ArrowLeft');press('ArrowRight');press('ArrowUp');
    const p=router.poll();
    expect(p).toMatchObject({
      parachute:true,airBrake:true,divebomb:true,tuck:true,corkscrew:true,
      tilt:1,heli:1,push:false,
    });
    expect(actions.filter(x=>x.pressed).map(x=>x.action)).toEqual(expect.arrayContaining(['up','left','down','right']));
    press('KeyS','keyup');press('ArrowLeft','keyup');
    expect(router.poll()).toMatchObject({divebomb:false,corkscrew:false});
    router.destroy();
  });
  test('switching layouts releases stale held buttons and leaves logical menu directions intact', () => {
    const g=game(), router=new InputRouter(g), actions=[];
    g.events.on(EVT.INPUT_ACTION, x=>actions.push(x));
    router.applySettings({...defaultSettings(),controlLayout:'tricksRight'});
    g.events.emit(EVT.RUN_START);
    press('KeyW');
    expect(router.poll().parachute).toBe(true);
    router.applySettings({...defaultSettings(),controlLayout:'tricksLeft'});
    expect(router.poll().parachute).toBe(false);
    press('KeyW');
    expect(router.poll().tilt).toBe(1);
    router.destroy();
  });
  test('touch overlay replaces dead controls in Trick Deck and restores Classic buttons', () => {
    const pad=new VirtualPad();
    pad.mountTouchOverlay(document.body, { touchOverlay:'on', controlLayout:'tricksRight' });
    pad.setOverlayContext(true);
    const all = () => [...pad.overlay.root.querySelectorAll('[data-btn]')].map(x=>x.dataset.btn);
    expect(all()).toEqual(expect.arrayContaining(['corkscrew','divebomb','parachute','airBrake']));
    expect(all()).not.toContain('push');
    pad.mountTouchOverlay(document.body, { touchOverlay:'on', controlLayout:'classic' });
    expect(all()).toEqual(expect.arrayContaining(['push','heliLeft']));
    expect(all()).not.toContain('corkscrew');
    pad.destroy();
  });
  test('classic preserves W push, S brake, arrow heli and parachute', () => {
    const g=game(), router=new InputRouter(g);
    router.applySettings({...defaultSettings(),controlLayout:'classic'});
    g.events.emit(EVT.RUN_START);
    press('KeyW');press('KeyS');press('ArrowLeft');press('ArrowDown');
    const p=router.poll();
    expect(p).toMatchObject({push:true,brake:true,heli:-1,parachute:true,corkscrew:false});
    router.destroy();
  });
});
