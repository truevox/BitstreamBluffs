import {assertSafeFatalPair} from '../../tools/music/fatal-qa-peak-gate.js';
const safe=()=>({samplePeak:.92,estimatedTruePeak4x:.95,sampleClips:0,estimatedTrueClips4x:0,nonfiniteSamples:0});

test('two-sided fatal source output passes with safe count-in and control',()=>{
  expect(assertSafeFatalPair({...safe(),control:safe()})).toBe(true);
});
test.each([
  ['sample clipping',{samplePeak:1.05,sampleClips:3}],
  ['true-peak overs',{estimatedTruePeak4x:1.003,estimatedTrueClips4x:4}],
  ['nonfinite samples',{nonfiniteSamples:1}],
  ['missing metrics',{sampleClips:undefined}],
])('unsafe no-count-in control %s cannot be hidden by a safe count-in',(_name,broken)=>{
  expect(()=>assertSafeFatalPair({...safe(),control:{...safe(),...broken}})).toThrow();
});
test('missing control fails closed',()=>{
  expect(()=>assertSafeFatalPair(safe())).toThrow(/Missing/);
});
