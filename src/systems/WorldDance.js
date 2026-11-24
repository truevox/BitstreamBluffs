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
import { resolveReduceMotion } from '../ui/Motion.js';

const clamp01 = n => Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;

export function worldDanceMotionAllowed(settings, prefersReducedMotion = false) {
  // Match the actual persisted Auto/On/Off setting used throughout the UI.
  // Explicit OFF must override OS reduced motion; explicit ON must suppress
  // movement even without OS preference. Legacy boolean true is fail-safe.
  return settings?.worldDance !== false && settings?.reduceMotion !== true &&
    !resolveReduceMotion(settings?.reduceMotion, prefersReducedMotion);
}

/**
 * Read the audio engine's world-dance sample and synthetic meter for one render frame (issue #140).
 * Audio is presentation: a missing, muted or failing engine must give "no dance", never an exception.
 * An exception here escaped RunScene.renderFrame, and Phaser's RAF step reschedules itself only AFTER the
 * frame callback returns, so one throw stopped the game loop (and the simulation) for good.
 * @param {object|null|undefined} audio REG.AUDIO engine
 * @param {boolean} allowed worldDanceMotionAllowed(...)
 * @returns {{sample: any, meter: any}} nulls when not allowed, unavailable or failing
 */
export function readWorldDanceAudio(audio, allowed) {
  if (!allowed || !audio) return { sample: null, meter: null };
  try {
    const sample = audio.getWorldDanceSample?.() ?? null;
    const meter = sample ? audio.getSyntheticMeterTiming?.() ?? null : null;
    return { sample, meter };
  } catch (e) {
    // Log once so a real audio-engine bug stays visible; every later failure is silent "no dance".
    if (!readWorldDanceAudio.warned) {
      readWorldDanceAudio.warned = true;
      try { console.warn('[WorldDance] audio read failed; scenery dance disabled for this failure', e); } catch { /* no console */ }
    }
    return { sample: null, meter: null };
  }
}

/** Each biome interprets the same musical accents in its own visual voice.
 * These are cosmetic multipliers; the intensity never leaks to physics.
 */
const DANCE_MOTIF_STYLES=Object.freeze({
    ridges:[1,0.7,0], drift:[0.8,0.55,0], terraces:[0.8,0.6,0],
    currents:[0.85,0.75,0], facets:[0.85,0.55,0],
    stars:[0.9,0.65,0.75],
    'candy-stripes':[1,0.55,1],
    jellyfish:[0.85,0.5,0.85],
    'brass-pipes':[0.9,0.65,0.85],
    'dew-drops':[0.85,0.65,1],
    vents:[0.85,0.75,0.9],
});

/** Audition-only visual transfer curve: lift small real accents without
 * clipping strong accents together. Neutral and maximum remain unchanged.
 * The detector and its audio-facing onset timestamps are untouched. */
export function visibleDanceStrength(strength) {
  const p=clamp01(strength);
  // Give strong accents more contrast against the troughs.
  return 4*p/(1+3*p);
}

export function biomeDanceStyle(motif, strength) {
  const p=visibleDanceStrength(strength);
  const [sun,horizon,decor]=DANCE_MOTIF_STYLES[motif]||DANCE_MOTIF_STYLES.ridges;
  return {sun:clamp01(p*sun),horizon:clamp01(p*horizon),decor:clamp01(p*decor)};
}

export function sunDanceGeometry(pulse, radius = 40) {
  const p=clamp01(pulse);
  const r=Number.isFinite(radius)&&radius>0 ? radius : 40;
  return {widthRadius:r*(1+0.48*p),heightRadius:r*(1-0.36*p)};
}

export class WorldDanceEnvelope {
  constructor(){this.skylineBands=new Float32Array(3);this.reset();}

  reset(){
    this.skylineBands.fill(0);
    this.visualStrength=0;
    this.visualHoldMs=0;
    this.pulse=0;
    this.meterPulse=0;
    this.mixLevel=0;
    this.lastMeterRevision=null;
    this.lastBeatIndex=null;
    this.lastMeasureIndex=null;
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
    // The artificial meter never becomes gameplay timing. Its visible impact
    // is gated by the actual recorded mix: silence has no rhythmic bounce.
    const audible=clamp01((this.mixLevel-0.025)/0.14);
    return clamp01(this.pulse*(0.18+0.68*this.intensity)+
      this.meterPulse*(0.07+0.19*this.intensity)*audible);
  }

  /**
   * @param {Object|null} sample bass/mid energy, audio-clock milliseconds,
   *    transport revision (from read-only AudioSynth, or null for silence)
   * @param {number} dtMs render delta, clamped so background tabs don't pop
   */
  update(sample,dtMs,meter=null){
    const raw=this._updateDetector(sample,dtMs,meter);
    // The audio-facing onset detector and its returned strength remain
    // exactly as before. This separate peak follower drives scenery only.
    // reset() clears both on silence, invalid input, revision or seek.
    if(this.lastSampleMs===null)return raw;
    // Three existing analyser bands, independently smoothed for Arcade.
    // Do not feed these back into the onset detector or music transport.
    for(let i=0;i<3;i++){
      const level=i===0?sample.bass:i===1?sample.mid:sample.treble;
      const target=clamp01((clamp01(level)-.10)/.72);
      const old=this.skylineBands[i];
      const delta=Number.isFinite(dtMs)?Math.max(0,Math.min(100,dtMs)):16.7;
      this.skylineBands[i]=old+(target-old)*(1-Math.exp(-delta/(target>old?65:150)));
    }
    const dt=Number.isFinite(dtMs)?Math.max(0,Math.min(100,dtMs)):16.7;
    if(raw>this.visualStrength){
      // Fast attack: retain most of a short accent even at low frame rates.
      this.visualStrength+=(raw-this.visualStrength)*(1-Math.exp(-dt/32));
      this.visualHoldMs=105;
    }else{
      const held=Math.min(dt,this.visualHoldMs);
      this.visualHoldMs-=held;
      this.visualStrength=raw+(this.visualStrength-raw)*Math.exp(-(dt-held)/145);
      if(raw===0&&this.visualStrength<.001)this.visualStrength=0;
    }
    return raw;
  }

  _updateDetector(sample,dtMs,meter=null){
    if(!sample||!Number.isFinite(sample.timeMs)||
      typeof sample.revision!=='string'||
      !Number.isFinite(sample.bass)||!Number.isFinite(sample.mid))return this.reset();
    if(this.revision!==sample.revision ||
      (this.lastSampleMs!==null&&sample.timeMs<this.lastSampleMs))this.reset();
    this.revision=sample.revision;
    const dt=Number.isFinite(dtMs)?Math.max(0,Math.min(100,dtMs)):16.7;
    this.pulse*=Math.exp(-dt/165); // actual recording transient envelope
    this.meterPulse*=Math.exp(-dt/140); // short, cosmetic measure/beat accent
    // The public synthetic meter is not a real musical analysis. Check the
    // transport revision and edge indices; NEVER repeatedly trigger while
    // isMeasureStartBeat remains true over multiple render frames.
    if(meter?.timingKind==='synthetic-unverified'&&meter?.use==='cosmetic-only'&&
      meter?.trusted===false&&meter?.canAuthorizeGameplay===false&&
      meter.transportRevision===sample.revision&&
      Number.isSafeInteger(meter.beatIndex)&&meter.beatIndex>=0&&
      Number.isSafeInteger(meter.measureIndex)&&meter.measureIndex>=0){
      if(this.lastMeterRevision!==meter.transportRevision){
        this.lastMeterRevision=meter.transportRevision;
        this.lastBeatIndex=meter.beatIndex;
        this.lastMeasureIndex=meter.measureIndex;
      }else if(meter.beatIndex!==this.lastBeatIndex){
        const changedMeasure=meter.measureIndex!==this.lastMeasureIndex &&
          meter.beatInMeasure===1;
        this.meterPulse=Math.max(this.meterPulse,changedMeasure?0.85:0.32);
        this.lastBeatIndex=meter.beatIndex;
        this.lastMeasureIndex=meter.measureIndex;
      }
    }else{
      this.lastMeterRevision=null;
      this.lastBeatIndex=null;
      this.lastMeasureIndex=null;
    }
    if(this.lastSampleMs===sample.timeMs)return this.strength;
    const level=clamp01(0.76*sample.bass+0.24*sample.mid);
    this.mixLevel=level;
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
