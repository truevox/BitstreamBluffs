import { AudioSynth } from '../../src/systems/AudioSynth.js';
import { sunDanceGeometry, WorldDanceEnvelope } from '../../src/systems/WorldDance.js';

function audioFixture() {
  const synth = Object.create(AudioSynth.prototype);
  synth.ctx = { currentTime: 0, state: 'running' };
  synth._stemMusic = {
    started: true,
    transportPaused: false,
    track: { id: 'diagnostic' },
    pack: { id: 'diagnostic', frameCount: 480000, sampleRate: 48000 },
    clockStart: 0,
    _token: 1,
    activeNodes: { size: 6 },
    songEnabled: { diagnostic: true },
    mixer: { energy: () => ({ bass: 0.3, mid: 0.3, treble: 0 }) },
  };
  synth._destroyed = false;
  synth._musicMode = 'run';
  synth._paused = false;
  synth._musicWanted = true;
  synth.settings = { masterVolume: 1, musicVolume: 1, musicEnabledSongs: { diagnostic: true } };
  synth._vinylAudible = () => true;
  synth.getFatalCountInStatus = () => ({ active: false });
  return synth;
}

const meter = (revision, beatIndex, measureIndex = 0, overrides = {}) => ({
  timingKind: 'synthetic-unverified',
  use: 'cosmetic-only',
  trusted: false,
  canAuthorizeGameplay: false,
  beatIndex,
  measureIndex,
  beatInMeasure: beatIndex % 4 + 1,
  transportRevision: revision,
  ...overrides,
});

function pixels(strength) {
  const sun = sunDanceGeometry(strength, 40);
  const ridgeHorizonOffset = 1.7 * strength * 0.7;
  return {
    strength,
    widthDeltaPx: sun.widthRadius - 40,
    heightDeltaPx: sun.heightRadius - 40,
    ridgeHorizonOffsetPx: ridgeHorizonOffset,
  };
}

describe('World Dance diagnostic: producer, unverified meter, envelope and pixels', () => {
  test('AudioSynth producer sample shape flows into the real envelope', () => {
    const synth = audioFixture();
    const sample = synth.getWorldDanceSample();
    const timing = synth.getSyntheticMeterTiming();

    expect(sample).toMatchObject({
      revision: expect.any(String),
      timeMs: expect.any(Number),
      bass: 0.3,
      mid: 0.3,
    });
    expect(Number.isFinite(sample.timeMs)).toBe(true);
    expect(timing).toMatchObject({
      timingKind: 'synthetic-unverified',
      use: 'cosmetic-only',
      trusted: false,
      canAuthorizeGameplay: false,
      beatIndex: expect.any(Number),
      measureIndex: expect.any(Number),
      beatInMeasure: 1,
    });
    expect(Number.isInteger(timing.beatIndex)).toBe(true);
    expect(Number.isInteger(timing.measureIndex)).toBe(true);
    expect(timing.transportRevision).toBe(sample.revision);

    const envelope = new WorldDanceEnvelope();
    const strength = envelope.update(sample, 16.7, timing);
    expect(Number.isFinite(strength)).toBe(true);
    expect(strength).toBeGreaterThanOrEqual(0);
    expect(strength).toBeLessThanOrEqual(1);
    expect(envelope.revision).toBe(sample.revision);
    expect(envelope.lastSampleMs).toBe(sample.timeMs);
  });

  test.each([
    ['null sample', null],
    ['non-finite time', { revision: 'r', timeMs: Infinity, bass: 0.3, mid: 0.3 }],
    ['missing revision', { timeMs: 1, bass: 0.3, mid: 0.3 }],
    ['non-string revision', { revision: 4, timeMs: 1, bass: 0.3, mid: 0.3 }],
    ['NaN bass', { revision: 'r', timeMs: 1, bass: NaN, mid: 0.3 }],
  ])('%s resets the envelope', (_label, sample) => {
    const envelope = new WorldDanceEnvelope();
    envelope.pulse = 0.8;
    envelope.mixLevel = 0.3;
    expect(envelope.update(sample, 16.7)).toBe(0);
    expect(envelope.strength).toBe(0);
  });

  test('matching unverified meter boundary accents after neutral first observation; invalid gates add none', () => {
    const sample0 = { revision: 'r', timeMs: 0, bass: 0.3, mid: 0.3 };
    const envelope = new WorldDanceEnvelope();
    envelope.update(sample0, 16.7, meter('r', 3, 0));
    expect(envelope.meterPulse).toBe(0);
    expect(envelope.update({ ...sample0, timeMs: 500 }, 16.7, meter('r', 4, 1, { beatInMeasure: 1 }))).toBeGreaterThan(0);
    expect(envelope.meterPulse).toBeCloseTo(0.85);

    const rejects = [
      { timingKind: 'verified' },
      { trusted: true },
      { canAuthorizeGameplay: true },
      { beatIndex: 1.5 },
      { transportRevision: 'other' },
    ];
    for (const override of rejects) {
      const fresh = new WorldDanceEnvelope();
      fresh.update(sample0, 16.7, meter('r', 0, 0));
      const pulseBefore = fresh.meterPulse;
      fresh.update({ ...sample0, timeMs: 500 }, 16.7, meter('r', 1, 0, override));
      expect(fresh.meterPulse).toBe(pulseBefore);
    }
  });

  test('revision changes and backward clock movement reset to zero', () => {
    const envelope = new WorldDanceEnvelope();
    envelope.update({ revision: 'r', timeMs: 0, bass: 0.1, mid: 0.1 }, 16.7);
    envelope.update({ revision: 'r', timeMs: 50, bass: 0.8, mid: 0.3 }, 50);
    expect(envelope.strength).toBeGreaterThan(0);
    expect(envelope.update({ revision: 'next', timeMs: 100, bass: 0.3, mid: 0.3 }, 16.7)).toBe(0);
    envelope.update({ revision: 'next', timeMs: 150, bass: 0.8, mid: 0.3 }, 50);
    expect(envelope.update({ revision: 'next', timeMs: 120, bass: 0.3, mid: 0.3 }, 16.7)).toBe(0);
  });

  test('silence cannot bounce, even at a valid unverified meter boundary', () => {
    const envelope = new WorldDanceEnvelope();
    envelope.update({ revision: 'r', timeMs: 0, bass: 0, mid: 0 }, 16.7, meter('r', 0, 0));
    const strength = envelope.update({ revision: 'r', timeMs: 500, bass: 0, mid: 0 }, 16.7, meter('r', 1, 0));
    expect(strength).toBeLessThanOrEqual(1e-12);
  });

  test('realistic sample sequence quantifies settled and transient pixel response', () => {
    const synth = audioFixture();
    const envelope = new WorldDanceEnvelope();
    const sequence = [
      { timeMs: 0, bass: 0.3, mid: 0.3 },
      { timeMs: 50, bass: 0.3, mid: 0.3 },
      { timeMs: 500, bass: 0.3, mid: 0.3 },
      { timeMs: 550, bass: 0.3, mid: 0.3 },
    ];
    const settled = [];
    for (const frame of sequence) {
      synth.ctx.currentTime = frame.timeMs / 1000;
      synth._stemMusic.mixer.energy = () => ({ bass: frame.bass, mid: frame.mid, treble: 0 });
      const sample = synth.getWorldDanceSample();
      const timing = synth.getSyntheticMeterTiming();
      settled.push(envelope.update(sample, 50, timing));
    }
    const settledPeak = Math.max(...settled);
    const settledPixels = pixels(settledPeak);
    expect(settledPeak).toBeGreaterThan(0);
    expect(settledPeak).toBeLessThanOrEqual(1);
    // Radius 40 gives +4.8p/-3.6p px; ridge offset is 1.7p*0.7 = 1.19p px.
    expect(settledPixels.widthDeltaPx).toBeCloseTo(4.8 * settledPeak, 10);
    expect(settledPixels.heightDeltaPx).toBeCloseTo(-3.6 * settledPeak, 10);
    expect(settledPixels.ridgeHorizonOffsetPx).toBeCloseTo(1.19 * settledPeak, 10);
    console.log('World Dance settled strength → pixels', settledPixels);

    const transientEnvelope = new WorldDanceEnvelope();
    const transient = [
      { timeMs: 0, bass: 0.1, mid: 0.08 },
      { timeMs: 50, bass: 0.52, mid: 0.25 },
    ];
    let transientPeak = 0;
    for (const frame of transient) {
      synth.ctx.currentTime = frame.timeMs / 1000;
      synth._stemMusic.mixer.energy = () => ({ bass: frame.bass, mid: frame.mid, treble: 0 });
      const sample = synth.getWorldDanceSample();
      const timing = synth.getSyntheticMeterTiming();
      transientPeak = Math.max(transientPeak, transientEnvelope.update(sample, 50, timing));
    }
    const transientPixels = pixels(transientPeak);
    // Sun deltas are exactly 4.8p/-3.6p px and the ridge offset is 1.19p px.
    expect(transientPeak).toBeGreaterThan(settledPeak);
    expect(transientPixels.widthDeltaPx).toBeCloseTo(40 * 0.12 * transientPeak, 10);
    expect(transientPixels.heightDeltaPx).toBeCloseTo(-40 * 0.09 * transientPeak, 10);
    expect(transientPixels.ridgeHorizonOffsetPx).toBeCloseTo(1.7 * transientPeak * 0.7, 10);
    console.log('World Dance transient strength → pixels', transientPixels);
  });
});

// The meter is an arbitrary 0.5 s source-zero-origin 4/4 clock, explicitly unverified; source-verified analysis is #50.
// TODO(live verification): a real browser run with real audio is required to establish actual live sample cadence and rendered scenery. Pixel magnitude is measured here; visibility to a player is an owner judgment.
