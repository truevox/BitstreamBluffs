import {attachAuditionExtra} from './AuditionExtra.js';
import { buildMusicChain } from '../../src/systems/music/MusicFXGraph.js';
import { orchestraPreset } from '../../src/systems/music/DynamicOrchestraPresets.js';
let extraEnhancer=null;
const $=id=>document.getElementById(id);
const ROLES=['drums','bass','guitar','piano','other'];
let ctx=null,buffers=null,master=null,dryGain=null,processedGain=null;
let sources=[],chains={},playing=false,bypassed=false;
const value=id=>Number($(id).value);
const say=message=>{$('status').textContent=message;};
function controls(){
	$('play').disabled=!buffers;$('play').textContent=playing?'■ Stop':'▶ Play';
	for(const id of ['dry','takeoff','land','impact','scan'])$(id).disabled=!playing;
	$('dry').setAttribute('aria-pressed',String(bypassed));
	$('dry').textContent=bypassed?'Hear crystal cave':'Compare dry';
}
function setStrength(){
	$('strength-value').textContent=value('strength')+'%';
	if(!playing||!ctx)return;
	for(const role of ['bass','guitar','piano','other'])
		chains[role]?.find('crystallattice')?.set('strength',value('strength')/100,ctx.currentTime);
}
function setAirBloom(){
	$('air-bloom-value').textContent=value('air-bloom')+'%';
	if(!playing||!ctx)return;
	for(const role of ['bass','guitar','piano','other'])
		chains[role]?.find('crystallattice')?.set('airBloom',value('air-bloom')/100,ctx.currentTime);
}
function setOpenness(){
	const open=value('open')/100;
	$('open-value').textContent=value('open')+'% '+(open?'(airborne/open)':'(grounded)');
	if(!playing||!ctx)return;
	for(const role of ['bass','guitar','piano','other'])
		chains[role]?.find('crystallattice')?.set('openness',open,ctx.currentTime);
	chains.drums?.find('crystalPercussion')?.set('gain',1-open*.52,ctx.currentTime);
}
function notes(){
	if(!playing||!ctx)return [];
	const selected=chains.bass?.find('crystallattice')?.refs?.chroma?.read?.()||[];
	const msg=selected.length?
		'Current bass spectral evidence: '+selected.map(n=>'MIDI '+n.midi+' ('+Math.round(n.hz)+' Hz)').join(', ')+
		'. Only these measured notes qualify for the tiny landing cascade.':
		'No confident current bass pitch detected: NO synthetic chord. The source-fed resonators still ring on their own.';
	$('chroma-result').textContent=msg;
	return selected;
}
function impact(){
	if(!playing||!ctx||bypassed){say('Press Play and turn off Compare dry to hear the cascade.');return false;}
	const detected=notes();
	const fired=chains.bass?.find('crystallattice')?.set('impact',.85,ctx.currentTime);
	if(fired)say(detected.length?
		'Landing: source-fed crystal swell plus '+detected.length+' confidence-selected pitched chime(s).':
		'Landing: source-fed crystal swell only; pitched cascade withheld because current bass notes are ambiguous.');
	return fired===true;
}
async function ready(){if(!ctx)ctx=new AudioContext({latencyHint:'interactive'});await ctx.resume();}
async function load(){
	$('load').disabled=true;say('Loading the original five instrument stems…');
	try{await ready();const decoded=await Promise.all(ROLES.map(async role=>{
		const response=await fetch('/audition-loops/pope-leo/'+role+'.ogg');
		if(!response.ok)throw new Error('Missing original '+role+' stem');
		return ctx.decodeAudioData(await response.arrayBuffer());
	}));buffers=Object.fromEntries(ROLES.map((r,i)=>[r,decoded[i]]));
		say('Ready. Play, compare ground to airborne, then try the real-pitch cascade.');
	}catch(e){buffers=null;say('Stem load failed: '+String(e.message||e));}
	finally{$('load').disabled=false;controls();}
}
function stop(){
	extraEnhancer?.dispose();extraEnhancer=null;
	for(const source of sources){try{source.stop();}catch{}try{source.disconnect();}catch{}}
	for(const chain of Object.values(chains))chain.dispose();
	for(const node of [master,dryGain,processedGain])try{node?.disconnect();}catch{}
	sources=[];chains={};master=dryGain=processedGain=null;playing=false;bypassed=false;
	controls();
}
async function play(){
	if(playing){stop();say('Stopped. Original recorded stems remain unchanged.');return;}
	if(!buffers)return;
	await ready();master=ctx.createGain();master.gain.value=.32;master.connect(ctx.destination);
	dryGain=ctx.createGain();processedGain=ctx.createGain();dryGain.gain.value=0;processedGain.gain.value=1;
	dryGain.connect(master);processedGain.connect(master);extraEnhancer=attachAuditionExtra(ctx,processedGain,master);
	for(const role of ROLES){
		const chain=buildMusicChain(ctx,orchestraPreset('crystal-cavern',role),processedGain);
		const source=ctx.createBufferSource(),gain=ctx.createGain();
		source.buffer=buffers[role];source.loop=true;
		gain.gain.value=role==='drums'?.9:role==='bass'?.75:.65;
		source.connect(gain);gain.connect(chain.input);gain.connect(dryGain);
		source.start(ctx.currentTime+.1);sources.push(source);chains[role]=chain;
	}
	playing=true;setStrength();setAirBloom();setOpenness();controls();
	say('Playing original stems with source-excited crystal modes. Compare dry and take off.');
}
$('load').addEventListener('click',load);$('play').addEventListener('click',play);
$('dry').addEventListener('click',()=>{
	if(!playing)return;bypassed=!bypassed;const at=ctx.currentTime;
	dryGain.gain.setTargetAtTime(bypassed?1:0,at,.02);
	processedGain.gain.setTargetAtTime(bypassed?0:1,at,.02);
	controls();say(bypassed?'Unprocessed original recording.':'Crystal resonance restored; original stems continue.');
});
$('takeoff').addEventListener('click',()=>{
	if(!playing)return;$('open').value='100';setOpenness();
	say('Airborne: original drums retreat and the harmonic crystal lattice blooms.');
});
$('land').addEventListener('click',()=>{
	if(!playing)return;$('open').value='0';setOpenness();impact();
});
$('impact').addEventListener('click',impact);
$('scan').addEventListener('click',()=>{notes();say('Current original-bass spectral evidence refreshed.');});
$('strength').addEventListener('input',setStrength);$('open').addEventListener('input',setOpenness);
$('air-bloom').addEventListener('input',setAirBloom);
window.addEventListener('pagehide',()=>{stop();ctx?.close();});
controls();setStrength();setAirBloom();setOpenness();
