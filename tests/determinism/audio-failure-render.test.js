/**
 * Issue #140: audio is presentation. The built-game matrix case `audio-throwing` (every audio call throws, installed
 * after the run starts) stopped the game: RunScene.renderFrame called audio.getWorldDanceSample() outside any try,
 * the exception escaped game.step, and Phaser's RAF step only reschedules itself after the frame callback returns,
 * so the loop (and the simulation) never ran again. The read now goes through readWorldDanceAudio, which never throws.
 */
import { readWorldDanceAudio } from '../../src/systems/WorldDance.js';

const throwing = new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : () => { throw new Error(`audio down ${String(k)}`); }) });

describe('readWorldDanceAudio', () => {
  test('a throwing audio engine gives no dance instead of an exception', () => {
    expect(() => readWorldDanceAudio(throwing, true)).not.toThrow();
    expect(readWorldDanceAudio(throwing, true)).toEqual({ sample: null, meter: null });
  });

  test('missing audio, or dance not allowed, reads nothing', () => {
    let calls = 0;
    const audio = { getWorldDanceSample: () => { calls++; return { level: 1 }; }, getSyntheticMeterTiming: () => { calls++; return {}; } };
    expect(readWorldDanceAudio(null, true)).toEqual({ sample: null, meter: null });
    expect(readWorldDanceAudio(audio, false)).toEqual({ sample: null, meter: null });
    expect(calls).toBe(0);
  });

  test('a working engine passes its sample and meter through unchanged', () => {
    const sample = { level: 0.4 };
    const meter = { beatMs: 500 };
    const audio = { getWorldDanceSample: () => sample, getSyntheticMeterTiming: () => meter };
    const out = readWorldDanceAudio(audio, true);
    expect(out.sample).toBe(sample);
    expect(out.meter).toBe(meter);
  });

  test('no meter is read without a sample (as before)', () => {
    let meterCalls = 0;
    const audio = { getWorldDanceSample: () => null, getSyntheticMeterTiming: () => { meterCalls++; return {}; } };
    expect(readWorldDanceAudio(audio, true)).toEqual({ sample: null, meter: null });
    expect(meterCalls).toBe(0);
  });
});
