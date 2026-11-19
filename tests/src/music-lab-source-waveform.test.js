import {originalStemWaveform,LAB_WAVEFORM_BINS} from '../../src/systems/music/SourceStemWaveform.js';

function fakeAudio(length,rate,channels=2){
  const data=Array.from({length:channels},(_,c)=>{
    const a=new Float32Array(length);
    for(let i=0;i<length;i++)a[i]=c===0?(i%110<60?.55:-.48):(i%110<60?.35:-.32);
    return a;
  });
  return {length,sampleRate:rate,numberOfChannels:channels,getChannelData:c=>data[c]};
}

describe('Music Lab source waveform and provisional piano roll source-frame alignment',()=>{
  const pack={sampleRate:48000,segments:[
    {startFrame:0,frames:48000},{startFrame:48000,frames:48000},
  ]};
  test('samples actual cached original stem audio, not guessed MIDI, from both segments',()=>{
    const cache=new Map([
      ['0/bass',fakeAudio(48000,48000)],
      ['1/bass',fakeAudio(48000,48000)],
    ]);
    const graph=originalStemWaveform(pack,cache,'bass',0,96000,64);
    expect(graph.role).toBe('bass');
    expect(graph.available).toBe(64);
    expect(graph.coverage).toBe(1);
    expect(graph.bins).toBeInstanceOf(Float32Array);
    expect(Math.max(...graph.bins)).toBeCloseTo(.55,2);
    expect(Math.min(...graph.bins)).toBeGreaterThan(.4);
  });
  test('uses source frames to locate buffer positions even if AudioContext resamples from 48k to 24k',()=>{
    const cache=new Map([['0/drums',fakeAudio(24000,24000)]]);
    const graph=originalStemWaveform(pack,cache,'drums',0,48000,40);
    expect(graph.available).toBe(40);
    expect(graph.coverage).toBe(1);
    expect(graph.bins.some(v=>v>.5)).toBe(true);
  });
  test('decoding absent displays zero coverage, never fake waveform',()=>{
    const missing=originalStemWaveform(pack,new Map(),'other',0,48000,40);
    expect(missing.coverage).toBe(0);
    expect([...missing.bins]).toEqual(Array(40).fill(0));
  });
  test('partial decoded windows report partial waveform visibility honestly',()=>{
    const cache=new Map([['1/piano',fakeAudio(48000,48000)]]);
    const graph=originalStemWaveform(pack,cache,'piano',0,96000,40);
    expect(graph.available).toBe(20);
    expect(graph.coverage).toBe(.5);
    expect(graph.bins.slice(0,20).every(v=>v===0)).toBe(true);
    expect(graph.bins.slice(20).some(v=>v>.4)).toBe(true);
  });
  test('waveform under piano roll refuses bad source ranges and oversized work',()=>{
    expect(originalStemWaveform(pack,new Map(),'bass',48000,48000)).toBeNull();
    expect(originalStemWaveform(pack,new Map(),'bass',0,48000,3000)).toBeNull();
    expect(originalStemWaveform(pack,new Map(),'bass',-1,48000,LAB_WAVEFORM_BINS)).not.toBeNull();
    expect(originalStemWaveform(null,new Map(),'bass',0,48000)).toBeNull();
  });
});
