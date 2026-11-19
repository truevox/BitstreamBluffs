/**
 * Small, visual-only reactive envelope for the in-run scenery.
 *
 * The released song-specific beat grids are UNVERIFIED. This class does
 * NOT synthesize a metronome, name onsets as quarter notes, or influence
 * music, physics, Gym READY, collision, scores, or the ledger.
 * The input is short-interval samples of the *audible original music mix*.
 * Positive transient changes make scenery squash; a quick spring-like decay
 * returns the world to its ordinary geometry between musical accents.
 */
const clamp01 = n => Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;

export function worldDanceMotionAllowed(settings, prefersReducedMotion = false) {
  return settings?.reduceMotion !== true && settings?.worldDance !== false &&
    prefersReducedMotion !== true;
}

/** Each biome interprets the same musical accents in its own visual voice.
 * These are cosmetic multipliers; the intensity never leaks to physics.
 */
const DANCE_MOTIF_STYLES=Object.freeze({
    ridges:[1,0.7,0], drift:[0.8,0.55,0], terraces:[0.6,0.4,0],
    currents:[0.6,0.75,0], facets:[0.65,0.35,0],
    stars:[0.6,0.2,0.25],
    'candy-stripes':[1,0.55,1],
    jellyfish:[0.65,0.35,0.85],
    'brass-pipes':[0.55,0.15,0.42],
    'dew-drops':[0.85,0.32,1],
    vents:[0.7,0.4,0.45],
});

export function biomeDanceStyle(motif, strength) {
  const p=clamp01(strength);
  const [sun,horizon,decor]=DANCE_MOTIF_STYLES[motif]||DANCE_MOTIF_STYLES.ridges;
  return {sun:clamp01(p*sun),horizon:clamp01(p*horizon),decor:clamp01(p*decor)};
}

export function sunDanceGeometry(pulse, radius = 40) {
  const p=clamp01(pulse);
  const r=Number.isFinite(radius)&&radius>0 ? radius : 40;
  return {widthRadius:r*(1+0.12*p),heightRadius:r*(1-0.09*p)};
}

export class WorldDanceEnvelope {
  constructor(){this.reset();}

  reset(){
    this.pulse=0;
    this.intensity=0;
    this.baseline=0;
    this.previous=0;
    this.lastSampleMs=null;
    this.lastAccentMs=-Infinity;
    this.revision=null;
    return 0;
  }

  /** Expose the deliberately restrained cosmetic envelope: transient accent
   * supplies rhythm, smoothed actual mix intensity supplies the dynamics.
   * No unverified grid, BPM, sound transport or time-driven oscillator.
   */
  get strength(){
    return clamp01(this.pulse*(0.18+0.68*this.intensity));
  }

  /**
   * @param {Object|null} sample bass/mid energy, audio-clock milliseconds,
   *    transport revision (from read-only AudioSynth, or null for silence)
   * @param {number} dtMs render delta, clamped so background tabs don't pop
   */
  update(sample,dtMs){
    if(!sample||!Number.isFinite(sample.timeMs)||
      typeof sample.revision!=='string'||
      !Number.isFinite(sample.bass)||!Number.isFinite(sample.mid))return this.reset();
    if(this.revision!==sample.revision ||
      (this.lastSampleMs!==null&&sample.timeMs<this.lastSampleMs))this.reset();
    this.revision=sample.revision;
    const dt=Number.isFinite(dtMs)?Math.max(0,Math.min(100,dtMs)):16.7;
    this.pulse*=Math.exp(-dt/165); // natural soft spring-back, not another beat source
    if(this.lastSampleMs===sample.timeMs)return this.strength;
    const level=clamp01(0.76*sample.bass+0.24*sample.mid);
    if(this.lastSampleMs===null){
      this.baseline=level;
      this.previous=level;
      this.lastSampleMs=sample.timeMs;
      return this.strength;
    }
    const interval=Math.max(0,Math.min(200,sample.timeMs-this.lastSampleMs));
    this.lastSampleMs=sample.timeMs;
    // Distinguish a quiet passage from a loud chorus. Use the *recorded*
    // mixture's level, with attack faster than release, never a guessed BPM.
    const target=clamp01((level-.10)/.62);
    const smoothing=1-Math.exp(-interval/(target>this.intensity?220:900));
    this.intensity+=(target-this.intensity)*smoothing;
    const rise=level-this.previous;
    const above=level-this.baseline;
    // The adaptive baseline tracks slow changes, while sudden positive
    // accents survive. This avoids endless bobbing on a sustained note.
    this.baseline+= (level-this.baseline)*(1-Math.exp(-interval/650));
    this.previous=level;
    if(rise>0.017&&above>0.034&&sample.timeMs-this.lastAccentMs>=165){
      const impulse=clamp01((rise*4+above*3.3));
      this.pulse=Math.max(this.pulse,impulse);
      this.lastAccentMs=sample.timeMs;
    }
    return this.strength;
  }
}
