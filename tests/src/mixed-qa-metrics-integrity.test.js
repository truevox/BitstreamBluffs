import {assertMixedQaMetrics} from '../../tools/music/assert-mixed-qa-metrics.js';
const good=()=>({sampleClips:0,estimatedTrueClips4x:0,nonfiniteSamples:0,
  samplePeak:.95,estimatedTruePeak4x:.96,estimatedTruePeakDbTp4x:-.354});
test('complete safe mixed-output metrics pass',()=>expect(assertMixedQaMetrics(good())).toBe(true));
test.each(['sampleClips','estimatedTrueClips4x','nonfiniteSamples','samplePeak','estimatedTruePeak4x','estimatedTruePeakDbTp4x'])('missing %s fails before aggregate',key=>{
  const item=good();delete item[key];expect(()=>assertMixedQaMetrics(item)).toThrow();
});
test.each([{sampleClips:2},{estimatedTrueClips4x:3},{nonfiniteSamples:1},
  {samplePeak:1.04},{estimatedTruePeak4x:1.02},{samplePeak:.97,estimatedTruePeak4x:.95},
  {sampleClips:NaN},{estimatedTrueClips4x:Infinity}])('unsafe samples or peaks fail closed %#',bad=>{
  expect(()=>assertMixedQaMetrics({...good(),...bad})).toThrow();
});
