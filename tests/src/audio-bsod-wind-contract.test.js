import { jest } from '@jest/globals';
import { EventEmitter } from 'events';
import { AudioSynth } from '../../src/systems/AudioSynth.js';
import { EVT } from '../../src/events.js';

const makeAudio = () => {
  const events = new EventEmitter();
  const a = new AudioSynth({ events });
  const param = () => ({ setTargetAtTime: jest.fn() });
  a.nodes = {
    master: { gain: param() }, musicBus: { gain: param() }, sfxBus: { gain: param() },
    windGain: { gain: param() }, windFilter: { frequency: param() },
    musicFilter: { frequency: param() }, musicSrc: { gain: param() },
  };
  a.ctx = { currentTime: 10, close: jest.fn() };
  a.settings = { windEnabled: true, windVolume: 1 };
  a._stemMusic.setSpeed = jest.fn();
  return { a, events, gain: a.nodes.windGain.gain.setTargetAtTime };
};
const state = (overrides = {}) => ({
  active: true, gapPx: 400, wallSpeedPxS: 300,
  worldTailwindPxS: 850, sledVelocityXPxS: 100,
  relativeAirX: 750, proximity01: 0.7,
  timeToImpactMs: 1200, atmosphereDensity: 1, ...overrides,
});

describe('authoritative BSOD wind signal consumed read-only', () => {
  test('positive and negative relative airflow have the same loudness', () => {
    const { a, events, gain } = makeAudio();
    events.emit(EVT.BSOD_STATE_CHANGED, state({ relativeAirX: 750 }));
    const positive = gain.mock.lastCall[0];
    events.emit(EVT.BSOD_STATE_CHANGED, state({ relativeAirX: -750 }));
    expect(positive).toBeGreaterThan(0);
    expect(gain.mock.lastCall[0]).toBeCloseTo(positive);
    a.destroy();
  });
  test('velocity matching is silent even at maximum danger; speed still drives music', () => {
    const { a, events, gain } = makeAudio();
    events.emit(EVT.BSOD_STATE_CHANGED, state({ relativeAirX: 0, proximity01: 1 }));
    expect(gain.mock.lastCall[0]).toBe(0);
    expect(a._bsodDanger01).toBe(1);
    a._ready = () => true;
    const count = gain.mock.calls.length;
    a.setSpeed(950);
    expect(a._stemMusic.setSpeed).toHaveBeenCalledWith(950);
    expect(a._speedIntensity).toBeCloseTo(0.95);
    expect(gain).toHaveBeenCalledTimes(count);
    a.destroy();
  });

  test('wind mute, wind slider and pause affect audio only', () => {
    const { a, events, gain } = makeAudio();
    events.emit(EVT.BSOD_STATE_CHANGED, state());
    const loud = gain.mock.lastCall[0];
    a.settings.windVolume = 0.5;
    a._applyWindFromBsod();
    expect(gain.mock.lastCall[0]).toBeCloseTo(loud * 0.5);
    a.settings.windEnabled = false;
    a._applyWindFromBsod();
    expect(gain.mock.lastCall[0]).toBe(0);
    expect(a._bsodDanger01).toBe(0.7);
    a.settings.windEnabled = true;
    a._setPaused(true);
    expect(gain.mock.lastCall[0]).toBe(0);
    a._setPaused(false);
    expect(gain.mock.lastCall[0]).toBeCloseTo(loud * 0.5);
    a.destroy();
  });
  test('vacuum and inactive snapshots explicitly silence wind without silencing danger', () => {
    const { a, events, gain } = makeAudio();
    events.emit(EVT.BSOD_STATE_CHANGED, state({
      atmosphereDensity: 0, worldTailwindPxS: 0, relativeAirX: 0, proximity01: 1,
    }));
    expect(gain.mock.lastCall[0]).toBe(0);
    expect(a._bsodDanger01).toBe(1);
    events.emit(EVT.BSOD_STATE_CHANGED, state({
      atmosphereDensity: 0.25, relativeAirX: 1000,
    }));
    expect(gain.mock.lastCall[0]).toBeCloseTo(0.055);
    events.emit(EVT.BSOD_STATE_CHANGED, { active: false });
    expect(gain.mock.lastCall[0]).toBe(0);
    expect(a._bsodDanger01).toBe(0);
    a.destroy();
  });

  test('run end and abort reset state; listener cleanup is complete', () => {
    const { a, events, gain } = makeAudio();
    a.stopMusic = jest.fn();
    events.emit(EVT.BSOD_STATE_CHANGED, state());
    events.emit(EVT.RUN_END, {});
    expect(gain.mock.lastCall[0]).toBe(0);
    expect(a._bsodDanger01).toBe(0);
    events.emit(EVT.BSOD_STATE_CHANGED, state());
    events.emit(EVT.RUN_ABORT, {});
    expect(gain.mock.lastCall[0]).toBe(0);
    a.destroy();
    expect(events.listenerCount(EVT.BSOD_STATE_CHANGED)).toBe(0);
  });
  test('headless subscription, invalid numeric state and source event are safe', () => {
    const game = { events: new EventEmitter() };
    const a = new AudioSynth(game);
    expect(() => game.events.emit(EVT.BSOD_STATE_CHANGED,
      state({ relativeAirX: NaN, atmosphereDensity: Infinity, proximity01: NaN })))
      .not.toThrow();
    expect(a._windRelativePxS).toBe(0);
    expect(a._bsodDanger01).toBe(0);
    expect(() => game.events.emit(EVT.BSOD_STATE_CHANGED, null)).not.toThrow();
    a.destroy();
    expect(game.events.listenerCount(EVT.BSOD_STATE_CHANGED)).toBe(0);
  });
  test('settings event actually toggles environmental wind with music disabled', () => {
    const { a, events, gain } = makeAudio();
    events.emit(EVT.BSOD_STATE_CHANGED, state());
    const makeSettings = (windEnabled) => ({
      masterVolume: 1, musicVolume: 0, sfxVolume: 0,
      windVolume: 0.6, windEnabled,
      musicEnabledSongs: { '01_FEsxYVStla4': false,
        '03_WRBGQUqD54U': false, '31_FYImnz5-hXs': false,
        '33_local-one-more-run-bitstream-bluffs': false },
    });
    events.emit(EVT.SETTINGS_CHANGED, { settings: makeSettings(false) });
    expect(a.settings.windEnabled).toBe(false);
    expect(gain.mock.lastCall[0]).toBe(0);
    events.emit(EVT.SETTINGS_CHANGED, { settings: makeSettings(true) });
    expect(a.settings.windEnabled).toBe(true);
    expect(gain.mock.lastCall[0]).toBeGreaterThan(0);
    a.destroy();
  });
});
