/** One short, reversible, music-volume-governed turntable gesture.
 * Distinct from the actual stem transport: one-shot synthesized vinyl noise,
 * never a second music player or a recording of copyrighted audio.
 * Connect ONLY to AudioSynth's music bus (not the SFX bus) so soundtrack
 * mute, music slider and master volume apply. No external assets required.
 */
export const VINYL_SCRATCH_SECONDS = 0.205;
const clip = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class TurntableScratch {
  constructor(ctx, noiseBuffer, musicBus) {
    this.ctx = ctx;
    this.noiseBuffer = noiseBuffer;
    this.musicBus = musicBus;
    this._active = null;
    this._generation = 0;
    this.disposed = false;
  }

  /** Abort all still-scheduled one-shot nodes when a transition changes. */
  cancel() {
    ++this._generation;
    const active = this._active;
    this._active = null;
    if (!active) return;
    const now = this.ctx?.currentTime ?? 0;
    for (const source of active.sources) {
      try { source.stop(now); } catch { /* already stopped */ }
    }
    for (const node of active.nodes) {
      try { node.disconnect(); } catch { /* detached */ }
    }
  }

  /** Returns the one-shot's duration, or zero when audio is unavailable. */
  play(direction, volume = 1) {
    this.cancel();
    if (this.disposed || !this.ctx ||
        (this.ctx.state !== 'running' && typeof this.ctx.startRendering !== 'function') ||
        !this.noiseBuffer || !this.musicBus ||
        !['pause','resume'].includes(direction) || !(volume > 0)) return 0;
    try {
      const c = this.ctx;
      const t = c.currentTime;
      const duration = VINYL_SCRATCH_SECONDS;
      const v = clip(Number(volume) || 0, 0, 1);
      // One reusable design with opposite pitch/speed envelopes.
      const descending = direction === 'pause';
      const source = c.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.loop = false;
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.85;
      const scratch = c.createGain();
      scratch.gain.setValueAtTime(0, t);
      scratch.gain.linearRampToValueAtTime(0.15 * v, t + .012);
      scratch.gain.linearRampToValueAtTime(0.105 * v, t + .102);
      scratch.gain.linearRampToValueAtTime(0, t + duration);
      const rateStart = descending ? 1.9 : 0.46;
      const rateEnd = descending ? 0.46 : 1.9;
      source.playbackRate.setValueAtTime(rateStart, t);
      source.playbackRate.exponentialRampToValueAtTime(rateEnd, t + duration);
      filter.frequency.setValueAtTime(descending ? 3900 : 590, t);
      filter.frequency.exponentialRampToValueAtTime(descending ? 590 : 3900,
        t + duration);
      source.connect(filter);
      filter.connect(scratch);
      scratch.connect(this.musicBus);
      // A quiet, low-pitched platter drag adds body without a shrill screech.
      const tone = c.createOscillator();
      tone.type = 'triangle';
      tone.frequency.setValueAtTime(descending ? 310 : 85, t);
      tone.frequency.exponentialRampToValueAtTime(descending ? 85 : 310,
        t + duration);
      const tonalGain = c.createGain();
      tonalGain.gain.setValueAtTime(0, t);
      tonalGain.gain.linearRampToValueAtTime(0.026 * v, t + .014);
      tonalGain.gain.linearRampToValueAtTime(0.014 * v, t + .095);
      tonalGain.gain.linearRampToValueAtTime(0, t + duration);
      tone.connect(tonalGain);
      tonalGain.connect(this.musicBus);
      const token = this._generation;
      const active = { token, direction,
        sources: [source, tone], nodes: [source, filter, scratch, tone, tonalGain] };
      this._active = active;
      tone.onended = () => {
        if (this._active === active) this._active = null;
        for (const node of active.nodes) {
          try { node.disconnect(); } catch { /* ignore */ }
        }
      };
      // Nonlooping noise source is explicitly stopped; no orphaned oscillators.
      source.start(t, .3);
      source.stop(t + duration + .003);
      tone.start(t);
      tone.stop(t + duration + .003);
      return duration;
    } catch {
      this.cancel();
      return 0;
    }
  }

  destroy() {
    this.cancel();
    this.disposed = true;
    this.musicBus = null;
    this.noiseBuffer = null;
    this.ctx = null;
  }
}
