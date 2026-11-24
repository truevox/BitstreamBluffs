/** Fail-closed per-scenario final PCM evidence; never reduce undefined counters to NaN. */
export function assertMixedQaMetrics(item){
  if(!item||typeof item!=='object')throw Error('Missing mixed-output metrics');
  for(const name of ['sampleClips','estimatedTrueClips4x','nonfiniteSamples']){
    if(!Number.isSafeInteger(item[name])||item[name]!==0)
      throw Error('Unsafe or missing mixed-output '+name);
  }
  for(const name of ['samplePeak','estimatedTruePeak4x','estimatedTruePeakDbTp4x'])
    if(!Number.isFinite(item[name]))throw Error('Invalid/missing mixed-output '+name);
  if(item.samplePeak<0||item.samplePeak>=1||item.estimatedTruePeak4x<0||
    item.estimatedTruePeak4x>=1||item.estimatedTruePeak4x<item.samplePeak-1e-7)
    throw Error('Out-of-range mixed-output peaks');
  return true;
}
