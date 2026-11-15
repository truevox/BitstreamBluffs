#!/usr/bin/env node
/**
 * Local Magenta DDSP neural timbre-transfer experiment.
 * Source: Maxi 25-second isolated vocal's loudness + V3 continuous F0.
 * No MIDI, no changes to game or stem masters.
 */
import '@tensorflow/tfjs-node';
import * as tf from '@tensorflow/tfjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const ROOT=resolve(import.meta.dirname || new URL('.',import.meta.url).pathname);
const RATE=16000,FPS=250;
const NAMES=['violin','trumpet','tenor_saxophone','flute'];
const FEATURES=JSON.parse(readFileSync(join(ROOT,'audio/ddsp-25s-v3.json'),'utf8'));
const OUT=join(ROOT,'audio/rendered');
mkdirSync(OUT,{recursive:true});
if(FEATURES.seconds!==25||FEATURES.frameRate!==FPS||FEATURES.f0_hz.length!==6250)
	throw new Error('Invalid source audio feature window');
const log=(event,data)=>console.log(JSON.stringify({event,...data}),);
tf.registerOp('Roll',node=>{
	const two=tf.split(node.inputs[0],2,2);
	const result=tf.concat([two[1],two[0]],2);
	two.forEach(x=>x.dispose());
	return result;
});
await tf.ready();
log('backend',{name:tf.getBackend(),version:tf.version_core});

function quantile(input,p){
	const a=input.filter(Number.isFinite).sort((x,y)=>x-y);
	return a[Math.floor(Math.min(a.length-1,(p/100)*(a.length-1)))];
}
function normLoudness(raw,pitch,settings){
	const active=raw.filter((v,i)=>pitch[i]>0 && v>-100);
	const max=quantile(active,99.5);
	const median=quantile(active,50);
	const desired=settings.averageMaxLoudness-settings.meanLoudness;
	const scaling=Math.min(2,Math.max(1,desired/Math.max(3,max-median)));
	return raw.map(v=>Math.max(-120,Math.min(settings.averageMaxLoudness,
		settings.averageMaxLoudness+scaling*(v-max))));
}
function stats(a){
	let energy=0,max=0,invalid=0;
	for(const v of a){
		if(!Number.isFinite(v)){invalid++;continue;}
		energy+=v*v;max=Math.max(max,Math.abs(v));
	}
	return {rmsDb:+(20*Math.log10(Math.max(1e-9,Math.sqrt(energy/a.length)))).toFixed(2),
		peakDb:+(20*Math.log10(Math.max(1e-9,max))).toFixed(2),invalid};
}
function wav16(values){
	const buf=Buffer.allocUnsafe(44+values.length*2);
	buf.write('RIFF',0);
	buf.writeUInt32LE(36+values.length*2,4);
	buf.write('WAVEfmt ',8);
	buf.writeUInt32LE(16,16);
	buf.writeUInt16LE(1,20);
	buf.writeUInt16LE(1,22);
	buf.writeUInt32LE(RATE,24);
	buf.writeUInt32LE(RATE*2,28);
	buf.writeUInt16LE(2,32);
	buf.writeUInt16LE(16,34);
	buf.write('data',36);
	buf.writeUInt32LE(values.length*2,40);
	for(let i=0;i<values.length;i++){
		const v=Math.min(1,Math.max(-1,values[i]));
		buf.writeInt16LE(Math.round(v*(v<0?32768:32767)),44+i*2);
	}
	return buf;
}
const manifest={
	schema:'bitstream-ddsp-neural-synthesis-v1',
	song:FEATURES.song,
	start:FEATURES.excerptStart,
	seconds:FEATURES.seconds,
	sourceF0:FEATURES.pitchSource,
	sourceLoudness:FEATURES.loudnessSource,
	origin:'Official Magenta TFJS DDSP instrument checkpoints; local native Node TensorFlow CPU',
	noMidi:true,
	neural:true,
	artifactStatus:'private test, not approved for game release',
	voices:[]
};
for(const name of NAMES){
	const start=Date.now();
	const basedir=join(ROOT,'models',name);
	const settings=JSON.parse(readFileSync(join(basedir,'settings.json'),'utf8'));
	const loud=normLoudness(FEATURES.loudness_db,FEATURES.f0_hz,settings);
	const model=await tf.loadGraphModel('http://127.0.0.1:8183/models/'+name+'/model.json');
	const mix=new Float32Array(25*RATE);
	const weights=new Float32Array(25*RATE);
	for(let chunk=0;chunk<6;chunk++){
		const base=chunk*4*FPS;
		const f0=FEATURES.f0_hz.slice(base,base+5*FPS);
		const ld=loud.slice(base,base+5*FPS);
		if(f0.length!==1250||ld.length!==1250)throw new Error('Bad feature input frames');
		const inputs={f0_hz:tf.tensor1d(f0),loudness_db:tf.tensor1d(ld)};
		const y=await model.executeAsync(inputs);
		const outputTensor=Array.isArray(y)?y[0]:y;
		const audio=await outputTensor.data();
		if(Array.isArray(y))y.forEach(t=>t.dispose());else y.dispose();
		Object.values(inputs).forEach(t=>t.dispose());
		if(audio.length!==5*RATE)throw new Error('Expected 5-second output');
		let pos0=chunk*4*RATE;
		for(let i=0;i<audio.length;i++){
			let weight=1;
			if(chunk && i<RATE)weight=i/RATE;
			if(chunk<5 && i>=4*RATE)weight=(5*RATE-i)/RATE;
			mix[pos0+i]+=audio[i]*weight;
			weights[pos0+i]+=weight;
		}
		log('chunk',{name,index:chunk,...stats(audio),elapsedMs:Date.now()-start});
	}
	model.dispose();
	for(let i=0;i<mix.length;i++)mix[i]/=Math.max(.000001,weights[i]);
	const before=stats(mix);
	if(before.invalid||before.rmsDb<-65)throw new Error('Invalid output: '+JSON.stringify(before));
	const gain=Math.min(Math.pow(10,(-23-before.rmsDb)/20),
		.92/Math.pow(10,before.peakDb/20));
	for(let i=0;i<mix.length;i++)mix[i]*=gain;
	const wav=join(OUT,'ddsp-'+name+'-pope25.wav');
	const ogg=join(OUT,'ddsp-'+name+'-pope25.ogg');
	writeFileSync(wav,wav16(mix));
	const proc=spawnSync('ffmpeg',[
		'-hide_banner','-loglevel','error','-nostdin','-y','-i',wav,
		'-ar','48000','-ac','1','-c:a','libopus','-b:a','96k',ogg]);
	if(proc.status!==0)throw new Error('FFmpeg output failure: '+proc.stderr?.toString());
	const sha=createHash('sha256').update(readFileSync(join(basedir,'group1-shard1of1.bin'))).digest('hex');
	const item={name,ogg,wav,modelSha256:sha,elapsedMs:Date.now()-start,raw:before,normalized:stats(mix)};
	manifest.voices.push(item);
	log('finished',item);
}
writeFileSync(join(OUT,'ddsp-results.json'),JSON.stringify(manifest,null,2)+'\n');
log('complete',{voices:manifest.voices.length,out:OUT});
