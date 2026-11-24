/** Independent, two-sided final-stereo output acceptance gate.
 * A quiet fatal count-in cannot disguise a clipping no-count-in control.
 */
export function assertSafeFatalPair(item){
  for(const [label,measured] of [['count-in',item],['no-count-in control',item?.control]]){
    if(!measured)throw Error('Missing '+label+' final PCM measurements');
    for(const name of ['samplePeak','estimatedTruePeak4x','sampleClips',
      'estimatedTrueClips4x','nonfiniteSamples'])
      if(!Number.isFinite(measured[name]))
        throw Error('Missing or invalid '+label+' '+name);
    if(measured.sampleClips!==0||measured.estimatedTrueClips4x!==0||
      measured.nonfiniteSamples!==0||measured.samplePeak>=1||
      measured.estimatedTruePeak4x>=1||measured.estimatedTruePeak4x<0)
      throw Error('Unsafe '+label+' final output: clips/overs/nonfinite');
  }
  return true;
}
