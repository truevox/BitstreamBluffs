import '@tensorflow/tfjs-node';
import * as tf from '@tensorflow/tfjs';
import {readFileSync,writeFileSync} from 'node:fs';
const base='/home/hermes/experiments/bitstream-ddsp-20261115';
const data=readFileSync(base+'/audio/maxi-vocal-25-16k.f32');
const pcm=new Float32Array(data.length/4);
for(let i=0;i<pcm.length;i++)pcm[i]=data.readFloatLE(i*4);
if(pcm.length!==400000)throw Error('Expected exact 25s source');
console.log('SPICE_INPUT',pcm.length,'audioRMS',Math.sqrt(pcm.reduce((sum,x)=>sum+x*x,0)/pcm.length));
await tf.ready();
const model=await tf.loadGraphModel('http://127.0.0.1:8183/models/spice/model.json');
console.log('SPICE_MODEL',model.inputs,model.outputs);
const paddedLen=Math.ceil(pcm.length/512)*512;
const x=tf.pad(tf.tensor1d(pcm),[[0,paddedLen-pcm.length]]);
const start=Date.now();
const outputs=await model.executeAsync({input_audio_samples:x});
console.log('SPICE_OUTPUT',outputs.map(y=>({name:y.name,shape:y.shape})),Date.now()-start);
const uncertainty=Array.from(await outputs[0].data());
const pitch=Array.from(await outputs[1].data());
if(uncertainty.length!==pitch.length || pitch.length<650)throw Error('Bad output shape');
const results=[];
for(let i=0;i<pitch.length;i++){
	const hz=10*Math.pow(2,(pitch[i]*63.07+25.58)/12);
	results.push({time:i*.032,frequency:hz,confidence:1-uncertainty[i],pitch_value:pitch[i]});
}
const confidence=results.map(x=>x.confidence).sort((a,b)=>a-b);
const freq=results.filter(x=>x.confidence>.7).map(x=>x.frequency).sort((a,b)=>a-b);
const q=(a,p)=>a[Math.min(a.length-1,Math.floor((a.length-1)*p))];
const diag={frames:results.length,elapsedMs:Date.now()-start,
	confidenceMedian:q(confidence,.5),confidenceP10:q(confidence,.1),
	frequencyP10:q(freq,.1),frequencyMedian:q(freq,.5),frequencyP90:q(freq,.9),
	above07:confidence.filter(x=>x>=.7).length,
	above04:confidence.filter(x=>x>=.4).length};
console.log('SPICE_STATS',JSON.stringify(diag));
writeFileSync(base+'/audio/spice-raw-pitches.json',JSON.stringify({
	source:'Magenta SPICE tfhub google/tfjs-model/spice/2/default/1',
	sourceVocal:'Maxi Demucs stem 25s at t=150s, original 16kHz mono',
	sampleRate:16000,hop:512,frameSeconds:.032,stats:diag,pitches:results
},null,2)+'\n');
outputs.forEach(y=>y.dispose());
x.dispose();model.dispose();
console.log('WROTE_SPICE_RAW');
