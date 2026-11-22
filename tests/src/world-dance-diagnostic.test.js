import { AudioSynth } from '../../src/systems/AudioSynth.js';
import { motifDecor } from '../../src/entities/Background.js';
import { biomeDanceStyle, sunDanceGeometry, WorldDanceEnvelope } from '../../src/systems/WorldDance.js';

/**
 * A deliberately partial AudioSynth: this is a UNIT SEAM, not a synth.
 * It proves the sample *shape* and the downstream contract, never that a real
 * synth is audible. Two seams are stubbed for that reason:
 *   - `_vinylAudible()` in production also requires `this.nodes`
 *     (AudioSynth.js:713-718); this fixture omits `nodes`, so without the stub
 *     `getWorldDanceSample()` would return null. The stub is the seam.
 *   - `getFatalCountInStatus()` is stubbed to a permanent idle state so the
 *     fixture does not depend on the count-in state machine or its timers.
 * `track.id: 'diagnostic'` is NOT a catalog song. `hasEnabledSongs()` succeeds
 * only because `sanitizeSongSelection()` defaults the real catalog songs to
 * enabled (MusicPlaylist.js:11-17,43-44) — it says nothing about 'diagnostic'.
 */
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
  synth._vinylAudible = () => true; // unit seam: the fixture has no `nodes` (see above)
  synth.getFatalCountInStatus = () => ({ active: false }); // unit seam: keep recovery idle (see above)
  return synth;
}

const CADENCE_MS = 50;
const BEAT_MS = 500;

/**
 * Drive the real producer (`getWorldDanceSample`/`getSyntheticMeterTiming`)
 * into the real envelope on a uniform render cadence. Every frame advances the
 * audio clock by exactly `CADENCE_MS` and passes the same `dt`, so intensity
 * smoothing and pulse decay see the same interval — no synthetic gaps.
 */
function cadence(frames, energyAt) {
  const synth = audioFixture();
  const envelope = new WorldDanceEnvelope();
  const series = [];
  for (let i = 0; i < frames; i++) {
    const timeMs = i * CADENCE_MS;
    synth.ctx.currentTime = timeMs / 1000;
    const { bass, mid } = energyAt(i);
    synth._stemMusic.mixer.energy = () => ({ bass, mid, treble: 0 });
    const sample = synth.getWorldDanceSample();
    const timing = synth.getSyntheticMeterTiming();
    series.push({ timeMs, strength: envelope.update(sample, CADENCE_MS, timing) });
  }
  return series;
}

/** The settled ordinary-beat level of a uniform 0.30/0.30 cadence: the peak of
 * the last full beat window after several measures of adaptation. */
function settledLevel() {
  const strengths = cadence(120, () => ({ bass: 0.3, mid: 0.3 })).map(f => f.strength);
  return Math.max(...strengths.slice(-BEAT_MS / CADENCE_MS));
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

/**
 * Sun geometry from the real `sunDanceGeometry()`. These are RADIUS deltas:
 * the drawn sun's width/height changes by twice each delta (+4.8p/-3.6p px at
 * radius 40 mean a +9.6p/-7.2p px full width/height change). Do not read a
 * radius delta as a diameter change.
 */
function sunPixels(strength) {
  const sun = sunDanceGeometry(strength, 40);
  return {
    strength,
    widthRadiusDeltaPx: sun.widthRadius - 40,
    heightRadiusDeltaPx: sun.heightRadius - 40,
  };
}

/**
 * MEASURED decor displacement, not a formula. Drive the production
 * `motifDecor()` twice at a fixed (motif, scrollX, timeMs, seed): once with no
 * horizon dance, once with the motif's real horizon dance value for this
 * strength (`biomeDanceStyle`, the same value Background passes at
 * Background.js:777-779). Return the observed max |Δy| across every primitive's
 * `pts[].y` and `y`.
 *
 * The theoretical ceiling is 1.7 × horizonDance (|sin| ≤ 1), which for these
 * motifs stays at or below 1.19 × strength; `sin` attenuates the observed value
 * below that, so assertions use a loose bound and never an exact float.
 * Motif dependence is real: stars, jellyfish and brass-pipes never feed
 * `horizonDanceOffset()` into a primitive and measure exactly 0.
 */
function measureDecorDisplacement(motif, strength, at = { scrollX: 400, timeMs: 1234, seed: 0 }) {
  const { horizon } = biomeDanceStyle(motif, strength);
  const still = motifDecor(motif, at.scrollX, at.timeMs, at.seed, { horizonDance: 0, bees: false });
  const dancing = motifDecor(motif, at.scrollX, at.timeMs, at.seed, { horizonDance: horizon, bees: false });
  expect(dancing).toHaveLength(still.length);
  let maxAbsDeltaY = 0;
  for (let i = 0; i < still.length; i++) {
    const before = still[i].pts || [];
    const after = dancing[i].pts || [];
    expect(after).toHaveLength(before.length);
    for (let j = 0; j < before.length; j++) {
      maxAbsDeltaY = Math.max(maxAbsDeltaY, Math.abs(before[j].y - after[j].y));
    }
    if (typeof still[i].y === 'number' && typeof dancing[i].y === 'number') {
      maxAbsDeltaY = Math.max(maxAbsDeltaY, Math.abs(still[i].y - dancing[i].y));
    }
  }
  return { motif, strength, horizonDance: horizon, maxAbsDeltaY };
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

  test('uniform cadence reaches a steady state across several beats', () => {
    // 120 frames × 50 ms = 6000 ms = 12 synthetic beats (500 ms each), so the
    // startup adaptation is long past and we can compare whole beat windows.
    const series = cadence(120, () => ({ bass: 0.3, mid: 0.3 }));
    const strengths = series.map(f => f.strength);
    const perBeat = BEAT_MS / CADENCE_MS;
    const settled = Math.max(...strengths.slice(-perBeat));
    const earlier = Math.max(...strengths.slice(-2 * perBeat, -perBeat));

    // Bounded, and genuinely steady: every frame of the last two beat windows
    // agrees with the same phase of the previous 500 ms beat.
    expect(settled).toBeGreaterThan(0);
    expect(settled).toBeLessThanOrEqual(1);
    expect(Math.abs(settled - earlier)).toBeLessThan(1e-6);
    for (let i = strengths.length - 2 * perBeat; i < strengths.length - perBeat; i++) {
      expect(strengths[i + perBeat]).toBeCloseTo(strengths[i], 6);
    }

    const settledPixels = sunPixels(settled);
    // Radius deltas from the real sunDanceGeometry(): +4.8p / -3.6p px at r=40.
    expect(settledPixels.widthRadiusDeltaPx).toBeCloseTo(4.8 * settled, 10);
    expect(settledPixels.heightRadiusDeltaPx).toBeCloseTo(-3.6 * settled, 10);

    // Measured decor displacement at this settled strength (not a formula).
    const motifs = ['candy-stripes', 'stars', 'vents', 'dew-drops', 'jellyfish', 'brass-pipes'];
    const decor = motifs.map(m => measureDecorDisplacement(m, settled));
    const byMotif = Object.fromEntries(decor.map(d => [d.motif, d]));
    for (const d of decor) {
      // Theoretical ceiling: |1.7·horizonDance·sin(...)| ≤ 1.7·horizonDance,
      // and horizonDance ≤ 0.7·strength, hence ≤ 1.19·strength. Loose, never exact.
      expect(d.maxAbsDeltaY).toBeLessThanOrEqual(1.19 * settled);
    }
    // These motifs do route horizonDance into decor roots: real, non-zero motion.
    expect(byMotif['candy-stripes'].maxAbsDeltaY).toBeGreaterThan(0.5 * 1.7 * byMotif['candy-stripes'].horizonDance);
    expect(byMotif.vents.maxAbsDeltaY).toBeGreaterThan(0);
    expect(byMotif['dew-drops'].maxAbsDeltaY).toBeGreaterThan(0);
    // These never feed horizonDanceOffset() into a primitive: exactly zero,
    // not "a small number we never measured".
    expect(byMotif.stars.maxAbsDeltaY).toBe(0);
    expect(byMotif.jellyfish.maxAbsDeltaY).toBe(0);
    expect(byMotif['brass-pipes'].maxAbsDeltaY).toBe(0);

    console.log('World Dance settled level (ordinary beat, measured)', {
      settledStrength: settled,
      sun: settledPixels,
      decorDisplacementsPx: decor,
      theoreticalCeilingPx: 1.19 * settled,
    });
  });

  test('transient onset peaks above settled and then decays toward it', () => {
    const transient = cadence(20, i => (
      i === 0 ? { bass: 0.1, mid: 0.08 } : { bass: 0.52, mid: 0.25 }
    ));
    const strengths = transient.map(f => f.strength);
    const onsetPeak = Math.max(...strengths);
    const settled = settledLevel();

    expect(onsetPeak).toBeGreaterThan(settled);

    // At least three post-onset frames must decay monotonically toward the
    // settled level rather than staying pinned at the peak.
    const afterOnset = strengths.slice(1);
    expect(afterOnset.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < 4; i++) {
      expect(afterOnset[i]).toBeLessThan(afterOnset[i - 1]);
    }
    expect(afterOnset[3]).toBeLessThan(onsetPeak * 0.75);

    const transientPixels = sunPixels(onsetPeak);
    // Sun deltas are radius deltas; a rendered sun's full width/height changes
    // by twice these values (+9.6p / -7.2p px full extent at r=40).
    expect(transientPixels.widthRadiusDeltaPx).toBeCloseTo(4.8 * onsetPeak, 10);
    expect(transientPixels.heightRadiusDeltaPx).toBeCloseTo(-3.6 * onsetPeak, 10);

    console.log('World Dance transient onset peak vs settled level (measured)', {
      onsetPeakStrength: onsetPeak,
      settledStrength: settled,
      sun: transientPixels,
    });
  });
});

// The meter is an arbitrary 0.5 s source-zero-origin 4/4 clock, explicitly unverified; source-verified analysis is #50.
// Sun numbers are radius deltas from the real sunDanceGeometry(); decor numbers are MEASURED max |Δy| from the real
// motifDecor() at a fixed frame, not the 1.7·dance·sin formula. 1.19 × strength is only a theoretical ceiling.
// TODO(live verification): a real browser run with real audio is required to establish actual live sample cadence and
// rendered scenery. These displacements are measured here; visibility to a player is an owner judgment.
