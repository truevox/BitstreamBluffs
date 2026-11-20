/** Single-transport fatal-death musical recovery. Research/review build.
 * CRITICAL: the 0.5s pulse is a SYNTHETIC UNVERIFIED TEST GRID, NOT a
 * verified beat for any shipped soundtrack. This module NEVER writes to
 * RELEASE_BEAT_GRIDS or publishes its pulses to the Gym's trusted API.
 *
 * Only four short one-shot excerpts from the ORIGINAL decoded drum stem
 * are scheduled; no second song transport, alternate decoder, or seek.
 * All normal stems continue to advance silently behind their own separate
 * recovery gains. Original stem and adaptive orchestra routing are intact.
 */
import {VINYL_SCRATCH_SECONDS} from './TurntableScratch.js';
import {SYNTHETIC_BEAT_SECONDS,SYNTHETIC_BEATS_PER_MEASURE} from './SyntheticMeterTiming.js';

export const FATAL_SYNTHETIC_BEAT_SECONDS=SYNTHETIC_BEAT_SECONDS;
export const FATAL_SILENT_BEATS=2;
export const FATAL_DRUM_BEATS=4;
export const FATAL_ACCENT_SECONDS=.14;

export function planFatalCountIn(startAudioTime,{
  beatSeconds=FATAL_SYNTHETIC_BEAT_SECONDS,
  silentBeats=FATAL_SILENT_BEATS,
  scratchSeconds=VINYL_SCRATCH_SECONDS,
  timingKind='synthetic-unverified',
}={}){
  if(!Number.isFinite(startAudioTime)||startAudioTime<0||
    !Number.isFinite(beatSeconds)||beatSeconds<.25||beatSeconds>1.1||
    !Number.isInteger(silentBeats)||silentBeats<1||silentBeats>3||
    !Number.isFinite(scratchSeconds)||scratchSeconds<0||scratchSeconds>.5)
    return null;
  const silenceStart=startAudioTime+scratchSeconds;
  const drumsStart=silenceStart+silentBeats*beatSeconds;
  const beatOnsets=Object.freeze(Array.from({length:FATAL_DRUM_BEATS},
    (_,i)=>drumsStart+i*beatSeconds));
  // Never relabel an experimental proposal as a verified source grid.
  if(timingKind!=='synthetic-unverified')return null;
  const bandAt=drumsStart+FATAL_DRUM_BEATS*beatSeconds;
  // Label the four artificial count-in beats 1..4: the count-in's first
  // drum accent is its synthetic downbeat. This is NOT a downbeat found in
  // the original OGG or necessarily aligned with the song-wide fake meter.
  const beatInMeasure=Object.freeze(Array.from({length:FATAL_DRUM_BEATS},
    (_,i)=>i%SYNTHETIC_BEATS_PER_MEASURE+1));
  const measureStartOnsets=Object.freeze(beatOnsets.filter((_,i)=>
    beatInMeasure[i]===1));
  return Object.freeze({startAudioTime,silenceStart,drumsStart,
    bandAt,beatOnsets,beatSeconds,silentBeats,
    beatInMeasure,measureStartOnsets,
    beatsPerMeasure:SYNTHETIC_BEATS_PER_MEASURE,
    measureSeconds:SYNTHETIC_BEATS_PER_MEASURE*beatSeconds,
    syntheticMeterOrigin:'count-in-first-drum',
    timingKind,verified:false});
}

/** Pick one short rising transient from ORIGINAL decoded OGG drum audio.
 * This is deliberately NOT a note detector nor a quarter-note verifier.
 * Each selected 140ms excerpt is repeated 4x, one isolated accent/slot.
 * We refuse very quiet/missing stems rather than inventing a drum recording.
 */
export function findOriginalDrumAccent(d){
  const pack=d?.pack,cache=d?.cache;
  if(!pack?.segments?.length||!cache?.get||!Number.isFinite(pack.sampleRate))return null;
  const pos=Math.max(0,d.ctx?.currentTime-d.clockStart||0);
  const candidates=[];
  for(let i=0;i<pack.segments.length;i++){
    const buffer=cache.get(`${i}/drums`);
    if(!buffer?.getChannelData||buffer.length<.3*buffer.sampleRate||
      !Number.isFinite(buffer.sampleRate)||buffer.sampleRate<8000)continue;
    const seg=pack.segments[i],delta=Math.abs((seg.startFrame+seg.frames/2)/pack.sampleRate-pos);
    candidates.push({i,buffer,delta});
  }
  candidates.sort((a,b)=>a.delta-b.delta);
  for(const {i,buffer} of candidates.slice(0,4)){
    const length=buffer.length,rate=buffer.sampleRate;
    const channels=[];
    for(let c=0;c<Math.min(2,buffer.numberOfChannels);c++)
      channels.push(buffer.getChannelData(c));
    if(!channels.length)continue;
    const hop=Math.max(1,Math.round(rate*.021));
    const window=Math.max(1,Math.round(rate*.014));
    const end=length-Math.round(FATAL_ACCENT_SECONDS*rate)-1;
    let best=-Infinity,bestAt=0;
    for(let at=hop*2;at<end;at+=hop){
      let current=0,prior=0;
      const step=Math.max(1,Math.round(window/20));
      for(let j=0;j<window;j+=step){
        for(const data of channels){
          current+=Math.abs(data[at+j]||0);
          prior+=Math.abs(data[at-window+j]||0);
        }
      }
      // Prefer a clearly audible rising attack, not a steady cymbal bed.
      const score=current+.6*Math.max(0,current-prior);
      if(score>best){best=score;bestAt=at;}
    }
    const volume=best/(Math.ceil(window/Math.max(1,Math.round(window/20)))*channels.length);
    if(!(volume>.015))continue;
    const offsetSeconds=Math.max(0,(bestAt-Math.round(rate*.006))/rate);
    return Object.freeze({buffer,segmentIndex:i,offsetSeconds,
      excerptSeconds:Math.min(FATAL_ACCENT_SECONDS,buffer.duration-offsetSeconds-.001),
      source:'original-decoded-ogg-drums',onsetScore:volume});
  }
  return null;
}

export class FatalCrashCountIn {
  /** Warm one or two *original* drum-only segments when a source has an
   * almost silent introduction. This uses the director's existing
   * verified music-pack URL, same fetch/cache/decode method and token,
   * never a second audio player. No new file is imported or modified.
   */
  async prepare(d){
    const token=d?._token;
    if(!d?.pack||!d.pack.segments?.length||
      findOriginalDrumAccent(d)||typeof d._fetchSource!=='function')return false;
    const info={track:d.track,pack:d.pack,base:d.packBase};
    for(let i=1;i<Math.min(4,d.pack.segments.length);i++){
      if(token!==d._token||d.disposed||this.ctx!==d.ctx)return false;
      try{await d._fetchSource(info,i,'drums',token)}catch{return false;}
      if(findOriginalDrumAccent(d))return true;
    }
    return false;
  }

  constructor(ctx,mixer,scratch){
    this.ctx=ctx;this.mixer=mixer;this.scratch=scratch;
    this.active=null;this.sources=[];this.nodes=[];this.generation=0;
  }

  cancel(){
    ++this.generation;
    // Also covers an exception halfway through a four-source schedule:
    // never leave source gates stuck silent because active was not set yet.
    if(this.mixer?.recoveryPlan)this.mixer.cancelRecoveryPlan();
    if(this.active)this.scratch?.cancel();
    for(const src of this.sources){try{src.stop(this.ctx.currentTime)}catch{}}
    for(const node of this.nodes){try{node.disconnect()}catch{}}
    this.sources=[];this.nodes=[];
    this.active=null;
  }

  /** Start on a real fatal CRASH, not on RUN_END. Returns a readonly
   * report with its timing-evidence disclaimer and exact source identity.
   * If drum source is silent/missing, leave ordinary continuous music alone.
   */
  start(d,{beatSeconds=FATAL_SYNTHETIC_BEAT_SECONDS,
    timingKind='synthetic-unverified',silentBeats=FATAL_SILENT_BEATS,
    runId=null}={}){
    const c=this.ctx;
    if(!c||c.state!=='running'||!d?.started||d.transportPaused||
      d.ctx!==c||!d.pack||!d.track||d._loading||
      !d.activeNodes?.size||d.clockStart===null||
      this.mixer!==d.mixer)return null;
    const drum=findOriginalDrumAccent(d);
    if(!drum||drum.excerptSeconds<.06)return null;
    const plan=planFatalCountIn(c.currentTime,{beatSeconds,silentBeats,timingKind});
    if(!plan)return null;
    this.cancel();
    try{
      // The recovery gate itself may throw after partially changing its
      // AudioParams. A failure must unwind the original band immediately,
      // not leave it inadvertently muted during Game Over.
      if(!this.mixer.setRecoveryPlan(plan)){
        this.cancel();
        return null;
      }
      // One short scratch on existing music bus, then exact silence.
      this.scratch?.play('pause');
      const token=this.generation;
      for(let i=0;i<plan.beatOnsets.length;i++){
        const due=plan.beatOnsets[i];
        const source=c.createBufferSource();
        source.buffer=drum.buffer;
        const envelope=c.createGain();
        envelope.gain.setValueAtTime(0,due);
        envelope.gain.linearRampToValueAtTime(.95,due+.009);
        envelope.gain.setValueAtTime(.8,due+Math.min(.07,drum.excerptSeconds*.6));
        envelope.gain.linearRampToValueAtTime(0,due+drum.excerptSeconds);
        source.connect(envelope);
        envelope.connect(this.mixer.countInInput);
        this.sources.push(source);
        this.nodes.push(source,envelope);
        source.start(due,drum.offsetSeconds,drum.excerptSeconds);
        source.stop(due+drum.excerptSeconds+.004);
      }
      this.active=Object.freeze({...plan,runId,
        trackId:d.track.id,transportToken:d._token,clockStart:d.clockStart,
        sourceSegment:drum.segmentIndex,sourceOffset:drum.offsetSeconds,
        drumSource:drum.source,scheduledDrumAccents:FATAL_DRUM_BEATS,
        generation:token});
      return this.snapshot();
    }catch{
      this.cancel();return null;
    }
  }

  snapshot(){
    const a=this.active;
    if(!a)return Object.freeze({active:false,stage:'idle'});
    const t=this.ctx?.currentTime??Infinity;
    const stage=t>=a.bandAt?'full-band':
      t>=a.drumsStart?'four-drum-count-in':
      t>=a.silenceStart?'silent-beats':'vinyl-scratch';
    return Object.freeze({...a,active:t<a.bandAt+.055,stage,
      clockBasis:'AudioContext.currentTime'});
  }

  destroy(){this.cancel();this.ctx=null;this.mixer=null;this.scratch=null;}
}
