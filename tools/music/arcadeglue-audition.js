import {attachAuditionExtra} from './AuditionExtra.js';
import {buildMusicChain} from '../../src/systems/music/MusicFXGraph.js';
import {orchestraPreset} from '../../src/systems/music/DynamicOrchestraPresets.js';
let extraEnhancer=null;
const $=id=>document.getElementById(id);
const STEMS=['drums','bass','guitar','piano','other'];
const PACK='/audition-loops/one-more-run/';
const g=role=>role==='drums'?.9:role==='bass'?.75:.65;
const v=id=>Number($(id).value);
const say=s=>{$('status').textContent=s;};
let ctx=null,buffers=null,master=null,rawBus=null,processedBus=null,playing=false,dry=false,solo=false,menu=false;
let sources={},chains={};
const fx=role=>chains[role]?.find('arcadeglue');
const each=fn=>{for(const role of STEMS)if(fx(role))fn(fx(role),role);};
function controls(){
	$('play').disabled=!buffers;
	$('play').textContent=playing?'■ Stop':'▶ Play';
	for(const id of ['dry','solo','menu'])$(id).disabled=!playing;
	$('dry').disabled=!playing||menu;
	$('menu').textContent=menu?'▶ Return to gameplay (750ms)':'☰ Enter clean menu (750ms)';
	$('menu').setAttribute('aria-pressed',String(menu));
	$('dry').textContent=dry?'Hear Arcade':'Compare dry';
	$('dry').setAttribute('aria-pressed',String(dry));
	$('solo').textContent=solo?'Hear all five':'Solo drums';
	$('solo').setAttribute('aria-pressed',String(solo));
	const bridge=$('mode').value==='bridge';
	$('progress').disabled=!bridge;
	$('progress-help').textContent=bridge?
		'True bridge mode: outgoing dissolve → full Arcade → incoming rebuild.':
		'Standalone Arcade: the full neon-chip treatment persists.';
	$('now').textContent=bridge?(
		v('progress')<25?'OUTGOING BIOME DISSOLVES':
		v('progress')<=75?'FULL ARCADE CORRIDOR':'INCOMING BIOME RECONSTRUCTS'
	):'ARCADE AS ITS OWN BIOME';
}
function applyMode(){
	const bridge=$('mode').value==='bridge';
	const t=Math.max(0,Math.min(1,v('progress')/100));
	$('progress-value').textContent=v('progress')+'%';
	$('visual').style.opacity=String(bridge?.2+.8*(t<.25?t/.25:t>.75?(1-t)/.25:1):1);
	controls();
	if(!playing||!ctx)return;
	each(stage=>{
		stage.set('bridge',bridge,ctx.currentTime);
		stage.set('progress',t,ctx.currentTime);
	});
	say(bridge?'Real bridge shape demo: original song clock never changes.':'Standalone Arcade: the same processor stays at full identity.');
}
function intensity(){
	$('intensity-value').textContent=v('intensity')+'%';
	if(playing)each(stage=>stage.set('intensity',v('intensity')/100,ctx.currentTime));
}
function chop(){
	$('chop-value').textContent=v('chop')+'%';
	if(playing)each(stage=>stage.set('chop',v('chop')/100,ctx.currentTime));
}
function setMenuMix(){
	if(!playing||!ctx)return;
	// Mirrors the live director's 750ms menu/run crossfade. A/B Compare
	// Dry stays fast for critical listening; this control demonstrates
	// the actual leisurely scene transition instead.
	const t=ctx.currentTime;
	for(const [bus,gain] of [[rawBus,menu?1:0],[processedBus,menu?0:1]]){
		const param=bus.gain;
		param.cancelScheduledValues(t);
		param.setValueAtTime(param.value,t);
		param.linearRampToValueAtTime(gain,t+.75);
	}
}
function mixLevels(){
	if(!playing||!ctx)return;
	for(const role of STEMS)sources[role]?.gain.gain.setTargetAtTime(
		solo&&role!=='drums'?0:g(role),ctx.currentTime,.035);
}
async function ready(){
	if(!ctx)ctx=new AudioContext({latencyHint:'interactive'});
	await ctx.resume();
}
async function load(){
	if(playing)stop();
	$('load').disabled=true;say('Loading five ORIGINAL stereo instrumental OGG stems…');
	try{
		await ready();
		const decoded=await Promise.all(STEMS.map(async role=>{
			const response=await fetch(PACK+role+'.ogg');
			if(!response.ok)throw Error(role+' source HTTP '+response.status);
			return ctx.decodeAudioData(await response.arrayBuffer());
		}));
		buffers=Object.fromEntries(STEMS.map((role,i)=>[role,decoded[i]]));
		say('Five synchronized original stereo recordings ready. Try both modes and compare dry.');
	}catch(error){buffers=null;say('Original music unavailable: '+(error?.message||error));}
	finally{$('load').disabled=false;controls();}
}
function stop(){
	extraEnhancer?.dispose();extraEnhancer=null;
	for(const {source,gain} of Object.values(sources)){
		try{source.stop();}catch{}
		try{source.disconnect();}catch{}
		try{gain.disconnect();}catch{}
	}
	for(const chain of Object.values(chains))chain.dispose();
	for(const bus of [master,rawBus,processedBus])try{bus?.disconnect();}catch{}
	sources={};chains={};master=rawBus=processedBus=null;playing=dry=solo=menu=false;controls();
}
async function play(){
	if(playing){stop();say('Stopped. The original stems remain untouched.');return;}
	if(!buffers)return;
	await ready();
	master=ctx.createGain();master.gain.value=.23;master.connect(ctx.destination);
	rawBus=ctx.createGain();processedBus=ctx.createGain();
	rawBus.gain.value=0;processedBus.gain.value=1;
	rawBus.connect(master);processedBus.connect(master);extraEnhancer=attachAuditionExtra(ctx,processedBus,master);
	const at=ctx.currentTime+.12;
	for(const role of STEMS){
		const chain=buildMusicChain(ctx,orchestraPreset('bitstream-bluffs',role),processedBus);
		const source=ctx.createBufferSource(),gain=ctx.createGain();
		source.buffer=buffers[role];source.loop=true;gain.gain.value=g(role);
		source.connect(gain);gain.connect(rawBus);gain.connect(chain.input);
		source.start(at);sources[role]={source,gain};chains[role]=chain;
	}
	playing=true;dry=solo=menu=false;intensity();chop();applyMode();controls();
	say('Arcade chip coloration is source-fed. Choose bridge or standalone; no invented notes.');
}
$('load').addEventListener('click',load);
$('play').addEventListener('click',play);
$('mode').addEventListener('change',applyMode);
$('progress').addEventListener('input',applyMode);
$('intensity').addEventListener('input',intensity);
$('chop').addEventListener('input',chop);
$('menu').addEventListener('click',()=>{
	if(!playing)return;
	if(dry)dry=false;
	menu=!menu;
	setMenuMix();
	controls();
	say(menu?'Entering clean original-recording menu over 750ms; no biome processing.' :
		'Returning to Arcade gameplay processing over 750ms, without seeking or restarting.');
});
$('dry').addEventListener('click',()=>{
	if(!playing||menu)return;dry=!dry;
	rawBus.gain.setTargetAtTime(dry?1:0,ctx.currentTime,.02);
	processedBus.gain.setTargetAtTime(dry?0:1,ctx.currentTime,.02);
	controls();say(dry?'Dry ORIGINAL synchronized instrumental music.':
		'Source-fed Arcade original-stem chip processor restored.');
});
$('solo').addEventListener('click',()=>{
	if(!playing)return;solo=!solo;mixLevels();controls();
	say(solo?'Original drum source alone — isolate bitcrush and arcade chip echoes.':
		'All five original stereo stems restored.');
});
$('from').addEventListener('click',()=>{
	$('mode').value='bridge';$('progress').value=0;applyMode();
});
$('middle').addEventListener('click',()=>{
	$('mode').value='bridge';$('progress').value=50;applyMode();
});
$('to').addEventListener('click',()=>{
	$('mode').value='bridge';$('progress').value=100;applyMode();
});
window.addEventListener('pagehide',()=>{stop();ctx?.close();});
controls();intensity();chop();applyMode();
if(new URLSearchParams(location.search).get('qa')==='1')
	window.__arcadeglueQA=Object.freeze({buildMusicChain,orchestraPreset,getBuffers:()=>buffers});
