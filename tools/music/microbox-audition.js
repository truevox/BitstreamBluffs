import {attachAuditionExtra} from './AuditionExtra.js';
import { buildMusicChain } from '../../src/systems/music/MusicFXGraph.js';
import { orchestraPreset } from '../../src/systems/music/DynamicOrchestraPresets.js';
import { MicroBeeAudio } from '../../src/systems/music/MicroBeeAudio.js';
import { beesAt } from '../../src/systems/MicroBees.js';
import { GAME_WIDTH } from '../../src/constants.js';
let extraEnhancer=null;
const $=id=>document.getElementById(id);
const ROLES=['drums','bass','guitar','piano','other'];
let ctx=null,buffers=null,master=null,dryGain=null,processedGain=null;
let playing=false,bypassed=false,beeSound=null,sources=[],chains=[],timeMs=5000;
const value=id=>Number($(id).value);
const announce=message=>{$('status').textContent=message;};
const setControls=()=>{
	$('play').disabled=!buffers;$('play').textContent=playing?'■ Stop':'▶ Play';
	for(const id of ['dry','takeoff','land','impact'])$(id).disabled=!playing;
	$('dry').setAttribute('aria-pressed',String(bypassed));
	$('dry').textContent=bypassed?'Hear microbox':'Compare dry';
};
function updateBees(){
	const camera=value('camera'),riderX=GAME_WIDTH*value('rider')/100;
	const bees=beesAt(camera,timeMs,0);
	$('camera-value').textContent=camera+' px';
	$('rider-value').textContent=value('rider')+'%';
	$('bees-value').textContent=value('bees')+'%';
	$('hive').replaceChildren();
	for(const bee of bees){
		const el=document.createElement('div');el.className='bee';
		el.style.left=(bee.x/GAME_WIDTH*100)+'%';el.style.opacity=bee.alpha;
		el.textContent='🐝';el.title='Real background bee '+bee.id+' at '+Math.round(bee.x)+'px';
		$('hive').appendChild(el);
	}
	$('bee-status').textContent=bees.length?bees.map(b=>
		'Bee '+b.id+': '+Math.round(b.x)+'px, '+Math.round((b.x-riderX)/GAME_WIDTH*100)+'% relative to rider').join(' · '):
		'No background bee currently visible at this camera position (correctly silent).';
	if(beeSound){beeSound.setIntensity(value('bees')/100);
		beeSound.setPositions(bees,{enabled:playing&&!bypassed,playerScreenX:riderX});}
}
function updateBox(){
	$('box-value').textContent=value('box')+'%';
	$('open-value').textContent=value('open')+'% '+(value('open')?'(opening)':'(closed)');
	$('impact-value').textContent=value('impact-weight')+'%';
	if(ctx&&playing)for(const chain of chains){
		const box=chain.find('microbox');
		box?.set('boxiness',value('box')/100,ctx.currentTime);
		box?.set('openness',value('open')/100,ctx.currentTime);
		box?.set('impactWeight',value('impact-weight')/100,ctx.currentTime);
	}
}
async function audioReady(){if(!ctx)ctx=new AudioContext({latencyHint:'interactive'});await ctx.resume();}
async function load(){
	$('load').disabled=true;announce('Loading the original five stems…');
	try{await audioReady();const decoded=await Promise.all(ROLES.map(async role=>{
		const res=await fetch('/audition-loops/pope-leo/'+role+'.ogg');
		if(!res.ok)throw new Error('Missing original stem: '+role);
		return ctx.decodeAudioData(await res.arrayBuffer());
	}));
	buffers=Object.fromEntries(ROLES.map((r,i)=>[r,decoded[i]]));
	announce('Ready: compare the tiny grounded box with wide-open flight.');
	}catch(e){buffers=null;announce('Load failed: '+String(e.message||e));}
	finally{$('load').disabled=false;setControls();}
}
function stop(){
	extraEnhancer?.dispose();extraEnhancer=null;
	for(const source of sources){try{source.stop();}catch{}try{source.disconnect();}catch{}}
	for(const chain of chains)chain.dispose();beeSound?.dispose();
	for(const bus of [master,dryGain,processedGain])try{bus?.disconnect();}catch{}
	sources=[];chains=[];beeSound=null;master=dryGain=processedGain=null;
	playing=false;bypassed=false;setControls();updateBees();
}
async function play(){
	if(playing){stop();announce('Stopped. Original recordings unchanged.');return;}
	if(!buffers)return;
	await audioReady();master=ctx.createGain();master.gain.value=.32;master.connect(ctx.destination);
	dryGain=ctx.createGain();processedGain=ctx.createGain();
	dryGain.gain.value=0;processedGain.gain.value=1;
	dryGain.connect(master);processedGain.connect(master);extraEnhancer=attachAuditionExtra(ctx,processedGain,master);
	for(const role of ROLES){
		const chain=buildMusicChain(ctx,orchestraPreset('micro-mountain',role),processedGain);
		const source=ctx.createBufferSource(),gain=ctx.createGain();
		source.buffer=buffers[role];source.loop=true;
		gain.gain.value=role==='drums'?.9:role==='bass'?.75:.65;
		source.connect(gain);gain.connect(chain.input);gain.connect(dryGain);
		source.start(ctx.currentTime+.10);sources.push(source);chains.push(chain);
	}
	beeSound=new MicroBeeAudio(ctx,processedGain);
	playing=true;updateBox();updateBees();setControls();
	announce('Playing full original song in a miniature enclosure. Try Take off then Land.');
}
function setOpen(amount){$('open').value=String(amount);updateBox();}
function impact(){
	if(!playing||!ctx||bypassed)return false;
	return chains[0]?.find('microbox')?.set('impact',.9,ctx.currentTime)===true;
}
$('load').addEventListener('click',load);$('play').addEventListener('click',play);
$('dry').addEventListener('click',()=>{
	if(!playing)return;bypassed=!bypassed;const now=ctx.currentTime;
	dryGain.gain.setTargetAtTime(bypassed?1:0,now,.02);
	processedGain.gain.setTargetAtTime(bypassed?0:1,now,.02);
	updateBees();setControls();announce(bypassed?'Original unprocessed stems, bees muted.':'Back to tiny room + real bee positions.');
});
$('takeoff').addEventListener('click',()=>{if(!playing)return;setOpen(100);announce('Airborne: the little enclosure opens, room becomes wider.');});
$('land').addEventListener('click',()=>{if(!playing)return;setOpen(0);impact();announce('Landed: enclosed again, with a plastic-box shake.');});
$('impact').addEventListener('click',()=>{if(impact())announce('KLOCK-klk-klk! Independent physical plastic-box rattle.');});
for(const id of ['box','open','impact-weight'])$(id).addEventListener('input',updateBox);
for(const id of ['camera','rider','bees'])$(id).addEventListener('input',updateBees);
window.addEventListener('pagehide',()=>{stop();ctx?.close();});
setControls();updateBees();updateBox();
