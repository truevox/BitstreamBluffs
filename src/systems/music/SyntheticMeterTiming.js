/** Explicitly fake, SOURCE-UNVERIFIED 4/4 meter for optional COSMETIC uses.
 * 0.5s is inherited from the previously shipped fatal crash count-in.
 * The beat and measure origin are the original recording's t=0, NOT an
 * established musical first beat or true bar line. No gameplay timing.
 */
export const SYNTHETIC_BEAT_SECONDS=.5;
export const SYNTHETIC_BEATS_PER_MEASURE=4;
export const SYNTHETIC_METER_KIND='synthetic-unverified';

/** Pure source-transport calculation. It NEVER verifies musical structure. */
export function syntheticMeterAt(positionSeconds,{
  beatSeconds=SYNTHETIC_BEAT_SECONDS,
  beatsPerMeasure=SYNTHETIC_BEATS_PER_MEASURE,
  durationSeconds=Infinity,
}={}){
  if(!Number.isFinite(positionSeconds)||positionSeconds<0||
    !Number.isFinite(beatSeconds)||beatSeconds<.25||beatSeconds>2||
    !Number.isSafeInteger(beatsPerMeasure)||beatsPerMeasure<2||beatsPerMeasure>12||
    !(durationSeconds===Infinity||Number.isFinite(durationSeconds)&&durationSeconds>0)||
    positionSeconds>=durationSeconds)return null;
  // Epsilon avoids classifying a boundary as the previous beat from float
  // rounding; note that all values still belong to an UNVERIFIED meter.
  const beatIndex=Math.floor(positionSeconds/beatSeconds+1e-8);
  const measureIndex=Math.floor(beatIndex/beatsPerMeasure);
  const beatInMeasure=beatIndex%beatsPerMeasure+1;
  const measureSeconds=beatSeconds*beatsPerMeasure;
  const beatStartSeconds=beatIndex*beatSeconds;
  const measureStartSeconds=measureIndex*measureSeconds;
  const nextBeatSeconds=(beatIndex+1)*beatSeconds;
  const nextMeasureStartSeconds=(measureIndex+1)*measureSeconds;
  return Object.freeze({
    trusted:false,timingKind:SYNTHETIC_METER_KIND,
    use:'cosmetic-only',canAuthorizeGameplay:false,
    assumedMeter:'4/4-synthetic',
    sourceTimeSeconds:positionSeconds,
    beatSeconds,beatsPerMeasure,measureSeconds,
    beatIndex,beatInMeasure,measureIndex,
    beatStartSeconds,measureStartSeconds,
    nextBeatSeconds,nextMeasureStartSeconds,
    isMeasureStartBeat:beatInMeasure===1,
    // Convenience for consumers polling <=25Hz; use measureIndex transitions
    // for exactly-once triggering instead of trusting this flag as an event.
    atMeasureStart:beatInMeasure===1&&
      positionSeconds-measureStartSeconds<=.05,
  });
}
