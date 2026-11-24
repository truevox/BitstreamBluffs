import {attachAuditionExtra} from './AuditionExtra.js';
import { buildMusicChain } from '../../src/systems/music/MusicFXGraph.js';
import { orchestraPreset } from '../../src/systems/music/DynamicOrchestraPresets.js';
import { WorldDanceEnvelope } from '../../src/systems/WorldDance.js';

let extraEnhancer=null;
const $=id=>document.getElementById(id);
const STEMS=['drums','bass','guitar','piano','other'];
const SONG='/music/packs/33_local-one-more-run-bitstream-bluffs/';
const gainFor=role=>role==='drums'?.9:role==='bass'?.75:.65;
const val=id=>Number($(id).value);
const percent=id=>val(id)+'%';
const say=message=>{$('status').textContent=message;};
let ctx=null,buffers=null,master=null,rawBus=null,fxBus=null;
let stems={},chains={},playing=false,dry=false,solo=false,airborne=false;
let monitor=null,monitorSink=null,spectrum=null,frameHandle=null;
let lastSpectrumMs=0,lastAccentMs=-Infinity,accentsDetected=0,accentsClicked=0;
let autoAccents=true,dance=new WorldDanceEnvelope();

const stage=role=>chains[role]?.find('steamworks');
const allStages=fn=>{for(const role of STEMS){const fx=stage(role);if(fx)fn(fx,role);}};
function controls(){
	$('play').disabled=!buffers;
	$('play').textContent=playing?'■ Stop':'▶ Play';
	for(const id of ['dry','solo','takeoff','land','impact','vent','ground','accent-hit'])$(id).disabled=!playing;
	$('dry').setAttribute('aria-pressed',String(dry));
	$('dry').textContent=dry?'Hear gears':'Compare dry';
	$('solo').setAttribute('aria-pressed',String(solo));
	$('solo').textContent=solo?'Hear all stems':'Solo drums';
	$('phase').textContent=airborne?'Airborne — machinery disengaged':'Grounded — gears engaged';
	$('auto-accent').setAttribute('aria-pressed',String(autoAccents));
	$('auto-accent').textContent='Recorded accent clicks: '+(autoAccents?'ON':'OFF');
}
function applyMix(){
	if(!playing||!ctx)return;
	for(const role of STEMS)
		stems[role]?.gain.gain.setTargetAtTime(solo&&role!=='drums'?0:gainFor(role),ctx.currentTime,.03);
}
function speed(){
	const px=val('speed');
	$('speed-value').textContent=px+' px/s';
	$('cycle').textContent=(1.5+8.4*Math.min(1,px/1600)).toFixed(1)+' cycles/s';
	if(!playing||!ctx)return;
	allStages(fx=>fx.set('speed',Math.min(1,px/1600),ctx.currentTime));
}
function weight(){
	$('weight-value').textContent=percent('weight');
	if(playing&&ctx)allStages(fx=>fx.set('intensity',val('weight')/100,ctx.currentTime));
}
function release(){
	$('steam-value').textContent=percent('steam');
	if(playing&&ctx)stage('drums')?.set('steam',val('steam')/100,ctx.currentTime);
}
function metal(){
	$('metal-value').textContent=percent('metal');
	if(playing&&ctx)stage('drums')?.set('impactWeight',val('metal')/100,ctx.currentTime);
}
function accent(){
	$('accent-value').textContent=percent('accent');
	if(playing&&ctx)stage('drums')?.set('accentWeight',val('accent')/100,ctx.currentTime);
}
function accentHit(){
	if(!playing||!ctx||dry||airborne)return false;
	const result=stage('drums')?.set('musicAccent',.85,ctx.currentTime)===true;
	if(result)say('TIK! Test click (manual). Automatic clicks still require real detected recorded accents.');
	return result;
}
function sampleOriginalMusic(){
	if(!playing||!monitor||!ctx||!spectrum||ctx.state!=='running')return;
	const timeMs=ctx.currentTime*1000;
	if(timeMs-lastSpectrumMs<40)return;
	const delta=lastSpectrumMs?timeMs-lastSpectrumMs:40;
	lastSpectrumMs=timeMs;
	monitor.getByteFrequencyData(spectrum);
	const band=[0,0,0],counts=[0,0,0];
	const hzBin=ctx.sampleRate/monitor.fftSize;
	for(let i=1;i<spectrum.length;i++){
		const hz=i*hzBin,index=hz<250?0:hz<2500?1:2;
		band[index]+=spectrum[i]/255;counts[index]++;
	}
	const bass=band[0]/(counts[0]||1),mid=band[1]/(counts[1]||1);
	const frame={revision:'original-one-more-run-audition',timeMs,bass,mid};
	const strength=dance.update(frame,delta,null);
	$('gear-visual').style.transform='rotate('+(timeMs*.002+strength*.27)+'rad)';
	if(dance.lastAccentMs!==lastAccentMs&&Number.isFinite(dance.lastAccentMs)){
		lastAccentMs=dance.lastAccentMs;accentsDetected++;
		if(autoAccents&&!airborne&&!dry&&
			stage('drums')?.set('musicAccent',Math.max(.18,.76*bass+.24*mid),ctx.currentTime))
			accentsClicked++;
		$('accent-status').textContent='Original recording accents: '+accentsDetected+
			' · audible gear clicks: '+accentsClicked;
	}
}
function frameLoop(){
	if(!playing){frameHandle=null;return;}
	sampleOriginalMusic();
	frameHandle=requestAnimationFrame(frameLoop);
}
function vent(){
	if(!playing||!ctx||dry){say('Play the processed stems, then try the steam valve.');return false;}
	const ok=stage('drums')?.set('release',Math.max(.18,Math.min(1,val('speed')/1600)),ctx.currentTime);
	if(ok)say('PSSHHHHT! A brief physical steam-valve release, independent of the recorded beat.');
	return ok===true;
}
function impact(){
	if(!playing||!ctx||dry){say('Play the processed stems, then try a gear-clash landing.');return false;}
	const ok=stage('drums')?.set('impact',.85,ctx.currentTime);
	if(ok)say('KLA-CHUNK! Gear teeth and a short rattling sprocket strike. No added musical note.');
	return ok===true;
}
function takeoff(){
	if(!playing||airborne)return;
	vent();airborne=true;
	allStages(fx=>fx.set('airborne',true,ctx.currentTime));
	controls();
	if(!dry)say('Airborne: the drive belt uncouples from the recording and the pressure valve vents.');
}
function land(){
	if(!playing||!airborne)return;
	airborne=false;
	allStages(fx=>fx.set('airborne',false,ctx.currentTime));
	controls();impact();
	if(!dry)say('Touchdown: pistons engage again, with a brief mechanical KLA-CHUNK.');
}
async function ready(){
	if(!ctx)ctx=new AudioContext({latencyHint:'interactive'});
	await ctx.resume();
}
async function load(){
	if(playing)stop();$('load').disabled=true;
	say('Loading the five original instrumental OGG recordings…');
	try{
		await ready();
		const decoded=await Promise.all(STEMS.map(async role=>{
			const response=await fetch(SONG+'0000-'+role+'.ogg');
			if(!response.ok)throw Error(role+' original source unavailable (HTTP '+response.status+')');
			return ctx.decodeAudioData(await response.arrayBuffer());
		}));
		buffers=Object.fromEntries(STEMS.map((role,i)=>[role,decoded[i]]));
		say('Ready: five original OGG stems. Play, increase speed, then take off and land.');
	}catch(e){buffers=null;say('Could not load original music: '+String(e?.message||e));}
	finally{$('load').disabled=false;controls();}
}
function stop(){
	extraEnhancer?.dispose();extraEnhancer=null;
	for(const {source,gain} of Object.values(stems)){
		try{source.stop();}catch{}try{source.disconnect();}catch{}try{gain.disconnect();}catch{}
	}
	if(frameHandle!==null){cancelAnimationFrame(frameHandle);frameHandle=null;}
	for(const chain of Object.values(chains))chain.dispose();
	for(const bus of [master,rawBus,fxBus,monitor,monitorSink])try{bus?.disconnect();}catch{}
	stems={};chains={};master=rawBus=fxBus=monitor=monitorSink=spectrum=null;
	playing=false;dry=false;solo=false;airborne=false;
	lastAccentMs=-Infinity;lastSpectrumMs=0;dance.reset();
	controls();
}
async function play(){
	if(playing){stop();say('Stopped. Nothing was changed in the original recording.');return;}
	if(!buffers)return;
	await ready();
	master=ctx.createGain();master.gain.value=.27;master.connect(ctx.destination);
	rawBus=ctx.createGain();fxBus=ctx.createGain();
	rawBus.gain.value=0;fxBus.gain.value=1;
	rawBus.connect(master);fxBus.connect(master);extraEnhancer=attachAuditionExtra(ctx,fxBus,master);
	monitor=ctx.createAnalyser();monitor.fftSize=1024;monitor.smoothingTimeConstant=.3;
	spectrum=new Uint8Array(monitor.frequencyBinCount);
	monitorSink=ctx.createGain();monitorSink.gain.value=1e-7;
	monitor.connect(monitorSink);monitorSink.connect(master);
	lastSpectrumMs=0;lastAccentMs=-Infinity;accentsDetected=0;accentsClicked=0;
	dance.reset();$('accent-status').textContent='Waiting for actual musical transients…';
	const when=ctx.currentTime+.12;
	for(const role of STEMS){
		const chain=buildMusicChain(ctx,orchestraPreset('steampunk-slopes',role),fxBus);
		const source=ctx.createBufferSource(),gain=ctx.createGain();
		source.buffer=buffers[role];source.loop=true;
		gain.gain.value=gainFor(role);
		source.connect(gain);gain.connect(rawBus);gain.connect(chain.input);
		gain.connect(monitor); // same original instrument source, no second playback
		source.start(when);
		stems[role]={source,gain};chains[role]=chain;
	}
	playing=true;dry=false;solo=false;airborne=false;
	weight();release();metal();accent();speed();controls();
	frameHandle=requestAnimationFrame(frameLoop);
	say('Playing the original recording through moving gear/valve machinery. Crank speed to hear the chuff accelerate.');
}
$('load').addEventListener('click',load);
$('play').addEventListener('click',play);
$('speed').addEventListener('input',speed);
$('weight').addEventListener('input',weight);
$('steam').addEventListener('input',release);
$('metal').addEventListener('input',metal);
$('accent').addEventListener('input',accent);
$('accent-hit').addEventListener('click',accentHit);
$('auto-accent').addEventListener('click',()=>{autoAccents=!autoAccents;controls();});
$('dry').addEventListener('click',()=>{
	if(!playing)return;dry=!dry;
	rawBus.gain.setTargetAtTime(dry?1:0,ctx.currentTime,.02);
	fxBus.gain.setTargetAtTime(dry?0:1,ctx.currentTime,.02);
	controls();say(dry?'Unprocessed, original five-stem song.':'Gear-driven original song restored.');
});
$('solo').addEventListener('click',()=>{
	if(!playing)return;solo=!solo;applyMix();controls();
	say(solo?'Drums only: isolate the speed-driven piston chuff and physical valve/impact.':
		'All five original instrumental stems playing together.');
});
$('takeoff').addEventListener('click',takeoff);
$('land').addEventListener('click',land);
$('impact').addEventListener('click',impact);
$('vent').addEventListener('click',vent);
$('ground').addEventListener('click',()=>{
	if(!playing)return;
	if(airborne)land();
	else say('Still grounded: pistons are engaged. Use speed to change gear cadence.');
});
window.addEventListener('pagehide',()=>{stop();ctx?.close();});
controls();speed();weight();release();metal();accent();
// Audition-only deterministic diagnostics: does not alter playback or export
// recordings; available only on explicit ?qa=1 for browser audio measurement.
if(new URLSearchParams(location.search).get('qa')==='1')
	window.__steamworksQA=Object.freeze({buildMusicChain,orchestraPreset,getBuffers:()=>buffers});
