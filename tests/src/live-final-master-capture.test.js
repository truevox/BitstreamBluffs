import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function makeTap(){
  let Processor;
  const messages=[];
  const sandbox={Float32Array, sampleRate:44100, currentFrame:0,
    AudioWorkletProcessor:class { constructor(){this.port={postMessage:m=>messages.push(m),onmessage:null}} },
    registerProcessor:(_name,klass)=>{Processor=klass;}};
  vm.runInNewContext(readFileSync(new URL('../../tools/music/live-final-master-capture-processor.js',import.meta.url),'utf8'),sandbox);
  const tap=new Processor();
  const next=(frame,len=128)=>{
    sandbox.currentFrame=frame;
    const input=[new Float32Array(len).fill(.2),new Float32Array(len).fill(.3)];
    tap.process([[...input]],[[new Float32Array(len),new Float32Array(len)]]);
  };
  return {tap,next,messages};
}

test('contiguous render quanta flush exact continuous PCM',()=>{
  const {next,messages}=makeTap();
  for(let i=0;i<8;i++)next(1000+i*128);
  expect(messages.filter(m=>m.type==='discontinuity')).toHaveLength(0);
  expect(messages.filter(m=>m.type==='pcm')).toHaveLength(1);
  expect(messages.find(m=>m.type==='pcm').frames).toBe(1024);
  const stopped=makeTap();
  stopped.next(0);
  stopped.tap.port.onmessage({data:{type:'stop'}});
  expect(stopped.tap.active).toBe(true);
  stopped.next(128);
  // The report must require the worklet's explicit continuity-v4 proof.
  expect(stopped.tap.active).toBe(false);
  expect(stopped.messages.find(m=>m.type==='stopped').quantumValidationVersion).toBe(4);
});

test.each([
  ['missing 128 frames',[0,128,384],256],
  ['overlap 128 frames',[0,128,128],256],
  ['canceling gap and overlap',[0,256,256],128],
])('%s is flagged inside an unfinished 1024-frame chunk',(_label,sequence,expected)=>{
  const {next,messages,tap}=makeTap();
  for(const frame of sequence)next(frame);
  const faults=messages.filter(m=>m.type==='discontinuity');
  expect(faults).toHaveLength(1);
  expect(faults[0].expected).toBe(expected);
  expect(tap.active).toBe(false);
});
