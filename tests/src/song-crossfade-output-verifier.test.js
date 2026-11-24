import {verifyCase,PASS} from '../../tools/music/verify-song-crossfade-output.mjs';
const tracks=Array.from({length:33},(_,i)=>({id:'song-'+i}));
function fixture(index=0){
 const from=tracks[index].id,to=tracks[(index+1)%33].id,token=7;
 const nodes=['drums','bass','guitar','piano','other','vocals'].flatMap(role=>[{role,token:token-1,end:14},{role,token,end:24}]);
 return {format:'bsb-crossfade-live-v4-output-v1',index,status:PASS,mode:'controlled-gameplay-dsp',
  pageErrors:[],httpErrors:[],expected:{from,to,biome:'debutmont',vocals:true},
  observed:{fade:{from,to,start:10,end:13,beatAligned:true},clock:10,token,menuMode:false,nodes},
  receipt:{firstFrame:44100*9,frames:44100*5,rate:44100,endFrame:44100*14,clean:true,
   terminal:{quantumValidationVersion:4,armed:true,armFrame:44100*9,finalQuantumStart:44100*14-128,finalQuantumFrames:128,captureEndFrame:44100*14}},
  metrics:{sampleRate:44100,channels:2,windowStartFrame:0,windowEndFrame:44100*5,samplesPerChannel:44100*5,samplePeak:.5,estimatedTruePeak4x:.51,estimatedTruePeakDbTp4x:-5.8,sampleClips:0,estimatedTrueClips4x:0,nonfiniteSamples:0},
  ffmpeg:{truePeakDbTp:-5.8},overlapEnergy:{min50msRms:.02,longestBelowMinus60DbSeconds:0}};
}
test('accept exact catalog wrap and full qualified PCM span',()=>{
 expect(verifyCase(fixture(32),32,tracks)).toMatchObject({index:32,from:'song-32',to:'song-0',overlap:3,seconds:5});
});
test.each([
 ['incorrect song',r=>r.observed.fade.to='wrong'],
 ['incorrect index',r=>r.index=4],
 ['missing outgoing source',r=>r.observed.nodes=r.observed.nodes.filter(n=>!(n.role==='drums'&&n.token===6))],
 ['missing terminal sample',r=>r.receipt.endFrame--],
 ['unqualified capture',r=>r.receipt.terminal.quantumValidationVersion=3],
 ['truncated meter',r=>r.metrics.windowEndFrame--],
 ['nonfinite sample',r=>r.metrics.nonfiniteSamples=1],
 ['sample clipping',r=>r.metrics.sampleClips=1],
 ['independent true peak over',r=>r.ffmpeg.truePeakDbTp=.1],
 ['page error',r=>r.pageErrors.push('error')],
 ['source error',r=>r.httpErrors.push({status:404})],
])('fails closed: %s',(_,mutate)=>{const r=fixture();mutate(r);expect(()=>verifyCase(r,0,tracks)).toThrow();});
