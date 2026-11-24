import { EventEmitter } from 'events';
import { AudioSynth, SFX } from '../../../src/systems/AudioSynth.js';
import { EVT } from '../../../src/events.js';

describe('AudioSynth without WebAudio', () => {
  test('every public method is a silent no-op and never throws', () => {
    const game = { events: new EventEmitter() };
    const a = new AudioSynth(game);
    expect(() => {
      a.unlock();
      SFX.forEach((n) => a.playSfx(n, { pitch: 1.2, volume: 0.5 }));
      a.playSfx('nope');
      a.startMusic('seed');
      a.stopMusic();
      a.duckMusic(100);
      a.glitch('static', 100, 0.9);
      a.setSpeed(500);
      a.setIntensity(0.5);
      a.applySettings({ masterVolume: 0.5, musicVolume: 1, sfxVolume: 0 });
      a.applySettings(undefined);
    }).not.toThrow();
    expect(a.ctx).toBeNull();
  });

  test('handles every subscribed event and unsubscribes on destroy', () => {
    const game = { events: new EventEmitter() };
    const a = new AudioSynth(game);
    const payloads = {
      [EVT.RUN_START]: { seed: 'x' }, [EVT.RUN_END]: {}, [EVT.RUN_ABORT]: {},
      [EVT.LANDING]: { quality: 'perfect', hard: false }, [EVT.TRICK]: { count: 2 },
      [EVT.COMBO_CHANGED]: { reason: 'trick', multiplier: 1.5 }, [EVT.CRASH]: { negated: true },
      [EVT.RESPAWN]: {}, [EVT.POWERUP_COLLECTED]: {}, [EVT.POWERUP_EXPIRED]: { reason: 'timeout' },
      [EVT.HAZARD_HIT]: { effect: 'slow' }, [EVT.ZONE_ENTER]: {}, [EVT.GLITCH_START]: { kind: 'dropout', durationMs: 80, intensity: 1 },
      [EVT.DISTANCE_CHANGED]: { meters: 500 }, [EVT.SETTINGS_CHANGED]: { settings: { masterVolume: 1, musicVolume: 1, sfxVolume: 1 } },
      [EVT.GAME_PAUSE]: {}, [EVT.GAME_RESUME]: {}, [EVT.INPUT_ACTION]: { action: 'anyKey' },
    };
    for (const [k, v] of Object.entries(payloads)) expect(() => game.events.emit(k, v)).not.toThrow();
    a.destroy();
    for (const k of Object.keys(payloads)) expect(game.events.listenerCount(k)).toBe(0);
  });

  test('works with no game events at all', () => {
    expect(() => new AudioSynth({}).destroy()).not.toThrow();
  });
});
