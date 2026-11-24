import {attachAuditionExtra} from './AuditionExtra.js';
import {attachAuditionSpatialReach} from './AuditionSpatialReach.js';
import {buildMusicChain} from '../../src/systems/music/MusicFXGraph.js';
import {orchestraPreset} from '../../src/systems/music/DynamicOrchestraPresets.js';

let extraEnhancer=null;
let spatialReach=null;
const $=id=>document.getElementById(id);
const STEMS=['drums','bass','guitar','piano','other'];
const SONG='/audition-loops/one-more-run/';
const gainFor=role=>role==='drums'?.9:role==='bass'?.75:.65;
const number=id=>Number($(id).value);
const say=message=>{$('status').textContent=message;};
let ctx=null,buffers=null,master=null,rawBus=null,fxBus=null;
let streams={},chains={},playing=false,dry=false,solo=false,airborne=false;
const stage=role=>chains[role]?.find('jellybloom');
const everyStage=fn=>{for(const role of STEMS){const fx=stage(role);if(fx)fn(fx,role);}};
function controls(){
	$('play').disabled=!buffers;
	$('play').textContent=playing?'■ Stop':'▶ Play';
	for(const id of ['dry','solo','takeoff','land','impact','lift'])$(id).disabled=!playing;
	$('dry').setAttribute('aria-pressed',String(dry));
	$('dry').textContent=dry?'Hear Jelly Bloom':'Compare dry';
	$('solo').setAttribute('aria-pressed',String(solo));
	$('solo').textContent=solo?'Hear all original stems':'Solo drums';
	$('phase').textContent=airborne?'Floating — stereo tendrils open':'Grounded — membrane softly tucked';
	$('jelly').style.transform=airborne?'translateY(-12px) scale(1.18)':'translateY(0) scale(1)';
}
function updateLevels(){
	if(!playing||!ctx)return;
	for(const role of STEMS)streams[role]?.gain.gain.setTargetAtTime(
		solo&&role!=='drums'?0:gainFor(role),ctx.currentTime,.035);
}
function buoyancy(){
	$('buoyancy-value').textContent=number('buoyancy')+'%';
	if(playing&&ctx)everyStage(fx=>fx.set('buoyancy',number('buoyancy')/100,ctx.currentTime));
}
function floatRate(){
	$('float-value').textContent=number('float')+'%';
	if(playing&&ctx)everyStage(fx=>fx.set('floatRate',number('float')/100,ctx.currentTime));
}
function spring(){
	$('spring-value').textContent=number('spring')+'%';
	if(playing&&ctx)stage('drums')?.set('spring',number('spring')/100,ctx.currentTime);
}
function liftLevel(){
	$('lift-value').textContent=number('lift-level')+'%';
	if(playing&&ctx)stage('other')?.set('liftLevel',number('lift-level')/100,ctx.currentTime);
}
function impact(){
	if(!playing||!ctx||dry){say('Enable Jelly Bloom first, then try the elastic rebound.');return false;}
	const ok=stage('drums')?.set('impact',.9,ctx.currentTime)===true;
	if(ok){$('jelly').classList.remove('bounced');void $('jelly').offsetWidth;
		$('jelly').classList.add('bounced');
		say('BWOOOING! Elastic bell and two smaller membrane rebounds — a physical impact, not a new song note.');}
	return ok;
}
function lift(){
	if(!playing||!ctx||dry){say('Enable Jelly Bloom first, then try the float lift.');return false;}
	const ok=stage('other')?.set('lift',.80,ctx.currentTime)===true;
	if(ok)say('FWOOO — the membrane unweights, while the original recording keeps playing.');
	return ok;
}
function takeoff(){
	if(!playing||airborne)return;
	lift();airborne=true;
	everyStage(fx=>fx.set('airborne',true,ctx.currentTime));
	controls();if(!dry)say('Airborne: the original instruments open into a wider, brighter, gently undulating halo.');
}
function land(){
	if(!playing||!airborne)return;
	airborne=false;
	everyStage(fx=>fx.set('airborne',false,ctx.currentTime));
	controls();impact();
}
async function ready(){
	if(!ctx)ctx=new AudioContext({latencyHint:'interactive'});
	await ctx.resume();
}
async function load(){
	if(playing)stop();$('load').disabled=true;
	say('Loading the five original instrument OGG stems…');
	try{
		await ready();
		const decoded=await Promise.all(STEMS.map(async role=>{
			const response=await fetch(SONG+role+'.ogg');
			if(!response.ok)throw Error('Original '+role+' recording missing: HTTP '+response.status);
			return ctx.decodeAudioData(await response.arrayBuffer());
		}));
		buffers=Object.fromEntries(STEMS.map((role,i)=>[role,decoded[i]]));
		say('Loaded all five source stems. Try Play, Take off, and Land.');
	}catch(error){buffers=null;say('Could not load original music: '+(error?.message||String(error)));}
	finally{$('load').disabled=false;controls();}
}
function stop(){
	spatialReach?.dispose();spatialReach=null;
	extraEnhancer?.dispose();extraEnhancer=null;
	for(const {source,gain} of Object.values(streams)){
		try{source.stop();}catch{}try{source.disconnect();}catch{}try{gain.disconnect();}catch{}
	}
	for(const chain of Object.values(chains))chain.dispose();
	for(const bus of [master,rawBus,fxBus])try{bus?.disconnect();}catch{}
	streams={};chains={};master=rawBus=fxBus=null;
	playing=dry=solo=airborne=false;
	controls();
}
async function play(){
	if(playing){stop();say('Playback stopped. Original recordings were not altered.');return;}
	if(!buffers)return;
	await ready();
	master=ctx.createGain();master.gain.value=.25;master.connect(ctx.destination);
	rawBus=ctx.createGain();fxBus=ctx.createGain();
	rawBus.gain.value=0;fxBus.gain.value=1;
	rawBus.connect(master);fxBus.connect(master);extraEnhancer=attachAuditionExtra(ctx,fxBus,master);
	spatialReach=attachAuditionSpatialReach(ctx,fxBus,$('reach'),'jelly');
	const when=ctx.currentTime+.12;
	for(const role of STEMS){
		const chain=buildMusicChain(ctx,orchestraPreset('sky-jellyfish-mountain',role),fxBus);
		const source=ctx.createBufferSource(),gain=ctx.createGain();
		source.buffer=buffers[role];source.loop=true;
		gain.gain.value=gainFor(role);
		source.connect(gain);gain.connect(rawBus);gain.connect(chain.input);gain.connect(spatialReach.input);
		source.start(when);
		streams[role]={source,gain};chains[role]=chain;
	}
	playing=true;dry=solo=airborne=false;
	buoyancy();floatRate();spring();liftLevel();controls();
	say('Playing original five-stem music through elastic sky-jellyfish membranes.');
}
$('load').addEventListener('click',load);
$('play').addEventListener('click',play);
$('buoyancy').addEventListener('input',buoyancy);
$('float').addEventListener('input',floatRate);
$('spring').addEventListener('input',spring);
$('lift-level').addEventListener('input',liftLevel);
$('dry').addEventListener('click',()=>{
	if(!playing)return;dry=!dry;
	rawBus.gain.setTargetAtTime(dry?1:0,ctx.currentTime,.02);
	fxBus.gain.setTargetAtTime(dry?0:1,ctx.currentTime,.02);
	controls();say(dry?'Dry five-stem original recording.':'Sky Jellyfish parallel source halo restored.');
});
$('solo').addEventListener('click',()=>{
	if(!playing)return;solo=!solo;updateLevels();controls();
	say(solo?'Drums alone: listen for membrane movement and real elastic impact.':
		'All five original instruments are restored.');
});
$('takeoff').addEventListener('click',takeoff);
$('land').addEventListener('click',land);
$('impact').addEventListener('click',impact);
$('lift').addEventListener('click',lift);
window.addEventListener('pagehide',()=>{stop();ctx?.close();});
controls();buoyancy();floatRate();spring();liftLevel();
if(new URLSearchParams(location.search).get('qa')==='1')
	window.__jellybloomQA=Object.freeze({buildMusicChain,orchestraPreset,attachAuditionSpatialReach,getBuffers:()=>buffers});
