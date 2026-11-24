import {attachAuditionExtra} from './AuditionExtra.js';
import {attachAuditionCharacterEdge} from './AuditionCharacterEdge.js';
import {buildMusicChain} from '../../src/systems/music/MusicFXGraph.js';
import {orchestraPreset} from '../../src/systems/music/DynamicOrchestraPresets.js';

let extraEnhancer=null;
let tonalCharacter=null;
const $=id=>document.getElementById(id);
const ROLES=['drums','bass','guitar','piano','other'];
const PACK='/audition-loops/one-more-run/';
const roleGain=role=>role==='drums'?.9:role==='bass'?.75:.65;
const number=id=>Number($(id).value);
const say=message=>{$('status').textContent=message;};
let ctx=null,buffers=null,master=null,rawBus=null,fxBus=null;
let streams={},chains={},playing=false,dry=false,solo=false,airborne=false;

const effect=role=>chains[role]?.find('ventforge');
const everyEffect=fn=>{for(const role of ROLES){const fx=effect(role);if(fx)fn(fx,role);}};
function controls(){
	$('play').disabled=!buffers;
	$('play').textContent=playing?'■ Stop':'▶ Play';
	for(const id of ['dry','solo','erupt','takeoff','land','rocks','settle'])$(id).disabled=!playing;
	$('dry').setAttribute('aria-pressed',String(dry));
	$('dry').textContent=dry?'Hear heated stems':'Compare dry';
	$('solo').setAttribute('aria-pressed',String(solo));
	$('solo').textContent=solo?'Hear all five':'Solo drums';
	$('phase').textContent=airborne?'Rising — hot air shimmers':'Grounded — volcanic crust hums';
	$('vent-icon').textContent=airborne?'🌋💨':'🌋';
}
function applyMix(){
	if(!playing||!ctx)return;
	for(const role of ROLES)
		streams[role]?.gain.gain.setTargetAtTime(solo&&role!=='drums'?0:roleGain(role),ctx.currentTime,.03);
}
const binder=(slider,output,param,role)=>{
	$(output).textContent=number(slider)+'%';
	if(!playing||!ctx)return;
	if(role==='all')everyEffect(fx=>fx.set(param,number(slider)/100,ctx.currentTime));
	else effect(role)?.set(param,number(slider)/100,ctx.currentTime);
};
function rumble(){binder('rumble','rumble-value','rumble','all');}
function shimmer(){binder('shimmer','shimmer-value','shimmer','all');}
function blast(){binder('blast','blast-value','blast','drums');}
function crust(){binder('crust','crust-value','crust','drums');}
function rising(){
	const vy=number('rising');
	$('rising-value').textContent=vy+' px/s upward';
	if(!playing||!ctx)return;
	everyEffect(fx=>fx.set('updraft',Math.max(0,Math.min(1,vy/1600)),ctx.currentTime));
}
function erupt(){
	if(!playing||dry){say('Enable the processed music to audition an eruption.');return false;}
	const yes=effect('drums')?.set('eruption',.95,ctx.currentTime)===true;
	if(yes)say('WHUUMMP—FSSSHHH! Demonstration of the real geyser-triggered eruption effect.');
	return yes;
}
function rocks(){
	if(!playing||dry){say('Enable the processed music to hear rocky impact debris.');return false;}
	const yes=effect('drums')?.set('crustImpact',.8,ctx.currentTime)===true;
	if(yes)say('KRAK-KRR! Volcanic-rock impact, not a musical drum note.');
	return yes;
}
function takeoff(){
	if(!playing||airborne)return;
	airborne=true;
	$('rising').value='1200';rising();controls();
	say('Airborne and ascending: the original music heats up. This ordinary jump does NOT fire a geyser.');
}
function settle(){
	if(!playing)return;
	airborne=false;$('rising').value='0';rising();controls();
	say('The updraft is gone. Original music retains a grounded volcanic crust.');
}
function land(){
	if(!playing||!airborne)return;
	settle();
	rocks();
}
async function ready(){
	if(!ctx)ctx=new AudioContext({latencyHint:'interactive'});
	await ctx.resume();
}
async function load(){
	if(playing)stop();
	$('load').disabled=true;say('Loading the original five instrument OGG sources…');
	try{
		await ready();
		const sound=await Promise.all(ROLES.map(async role=>{
			const response=await fetch(PACK+role+'.ogg');
			if(!response.ok)throw Error(role+' OGG unavailable: HTTP '+response.status);
			return ctx.decodeAudioData(await response.arrayBuffer());
		}));
		buffers=Object.fromEntries(ROLES.map((role,i)=>[role,sound[i]]));
		say('Original five stereo instrumental recordings ready. Play, raise heat, then test a geyser eruption.');
	}catch(error){buffers=null;say('Original audio unavailable: '+(error?.message||String(error)));}
	finally{$('load').disabled=false;controls();}
}
function stop(){
	tonalCharacter?.dispose();tonalCharacter=null;
	extraEnhancer?.dispose();extraEnhancer=null;
	for(const {source,gain} of Object.values(streams)){
		try{source.stop();}catch{}try{source.disconnect();}catch{}try{gain.disconnect();}catch{}
	}
	for(const chain of Object.values(chains))chain.dispose();
	for(const bus of [master,rawBus,fxBus])try{bus?.disconnect();}catch{}
	streams={};chains={};master=rawBus=fxBus=null;
	playing=dry=solo=airborne=false;$('rising').value='0';rising();controls();
}
async function play(){
	if(playing){stop();say('Stopped. Original recordings unchanged.');return;}
	if(!buffers)return;
	await ready();
	master=ctx.createGain();master.gain.value=.26;master.connect(ctx.destination);
	rawBus=ctx.createGain();fxBus=ctx.createGain();rawBus.gain.value=0;fxBus.gain.value=1;
	rawBus.connect(master);fxBus.connect(master);extraEnhancer=attachAuditionExtra(ctx,fxBus,master);
	tonalCharacter=attachAuditionCharacterEdge(ctx,fxBus,$('heat-wah'),'heat');
	const when=ctx.currentTime+.12;
	for(const role of ROLES){
		const chain=buildMusicChain(ctx,orchestraPreset('vertigo-vents',role),fxBus);
		const source=ctx.createBufferSource(),gain=ctx.createGain();
		source.buffer=buffers[role];source.loop=true;gain.gain.value=roleGain(role);
		source.connect(gain);gain.connect(rawBus);gain.connect(chain.input);gain.connect(tonalCharacter.input);
		source.start(when);streams[role]={source,gain};chains[role]=chain;
	}
	playing=true;dry=solo=airborne=false;
	rumble();shimmer();blast();crust();rising();controls();
	say('Grounded volcanic music. Try a jump, then Erupt: those MUST sound different.');
}
$('load').addEventListener('click',load);
$('play').addEventListener('click',play);
for(const [id,fn] of [['rumble',rumble],['shimmer',shimmer],['blast',blast],
	['crust',crust],['rising',rising]])$(id).addEventListener('input',fn);
$('dry').addEventListener('click',()=>{
	if(!playing)return;dry=!dry;
	rawBus.gain.setTargetAtTime(dry?1:0,ctx.currentTime,.02);
	fxBus.gain.setTargetAtTime(dry?0:1,ctx.currentTime,.02);
	controls();say(dry?'Dry original five-stem recording.':'Original five stems with geothermal processing restored.');
});
$('solo').addEventListener('click',()=>{
	if(!playing)return;solo=!solo;applyMix();controls();
	say(solo?'Solo original drums: isolate low rumble, real geyser and rock clatter.':
		'All original instrumental stems restored.');
});
$('erupt').addEventListener('click',erupt);
$('rocks').addEventListener('click',rocks);
$('takeoff').addEventListener('click',takeoff);
$('land').addEventListener('click',land);
$('settle').addEventListener('click',settle);
window.addEventListener('pagehide',()=>{stop();ctx?.close();});
controls();rumble();shimmer();blast();crust();rising();
if(new URLSearchParams(location.search).get('qa')==='1')
	window.__ventforgeQA=Object.freeze({buildMusicChain,orchestraPreset,attachAuditionCharacterEdge,getBuffers:()=>buffers});
