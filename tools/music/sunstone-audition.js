import {attachAuditionExtra} from './AuditionExtra.js';
import {buildMusicChain} from '../../src/systems/music/MusicFXGraph.js';
import {orchestraPreset} from '../../src/systems/music/DynamicOrchestraPresets.js';
let extraEnhancer=null;
const $=id=>document.getElementById(id);
const ROLES=['drums','bass','guitar','piano','other'];
const PACK='/audition-loops/one-more-run/';
const roleGain=role=>role==='drums'?.9:role==='bass'?.75:.65;
const number=id=>Number($(id).value);
const say=text=>{$('status').textContent=text;};
let ctx=null,buffers=null,master=null,rawBus=null,fxBus=null,playing=false,dry=false,solo=false,airborne=false,wasThermal=false;
let sources={},chains={};
const effect=role=>chains[role]?.find('sunstone');
const each=fn=>{for(const role of ROLES)if(effect(role))fn(effect(role),role);};
function controls(){
	$('play').disabled=!buffers;$('play').textContent=playing?'■ Stop':'▶ Play';
	for(const id of ['dry','solo','takeoff','land','gust-test','stone-test'])$(id).disabled=!playing;
	$('dry').setAttribute('aria-pressed',String(dry));$('dry').textContent=dry?'Hear Sunstone':'Compare dry';
	$('solo').setAttribute('aria-pressed',String(solo));$('solo').textContent=solo?'Hear all stems':'Solo drums';
	$('phase').textContent=airborne?'In flight — thermal resonance':'Grounded — the terraces are still';
	$('sun').style.transform=airborne?'translateY(-14px) scale(1.16)':'translateY(0) scale(1)';
}
function mixLevels(){
	if(!playing||!ctx)return;
	for(const role of ROLES)sources[role]?.gain.gain.setTargetAtTime(
		solo&&role!=='drums'?0:roleGain(role),ctx.currentTime,.035);
}
function resonance(){
	$('resonance-value').textContent=number('resonance')+'%';
	if(playing)each(fx=>fx.set('resonance',number('resonance')/100,ctx.currentTime));
}
function drift(){
	$('drift-value').textContent=number('drift')+'%';
	if(playing)each(fx=>fx.set('drift',number('drift')/100,ctx.currentTime));
}
function gustLevel(){
	$('gust-value').textContent=number('gust-level')+'%';
	if(playing)effect('other')?.set('gustLevel',number('gust-level')/100,ctx.currentTime);
}
function stoneLevel(){
	$('stone-value').textContent=number('stone-level')+'%';
	if(playing)effect('drums')?.set('stoneLevel',number('stone-level')/100,ctx.currentTime);
}
function fire(kind){
	if(!playing||!ctx||dry){say('Enable Sunstone source processing before playing this physical sound.');return false;}
	const ok=effect(kind==='gust'?'other':'drums')?.set(kind,.9,ctx.currentTime)===true;
	if(ok)say(kind==='gust'?
		'WHOOO—oooh! Real thermal air moves through the sandstone columns.':
		'TOK–KRRRR. A ceramic terrace landing with a soft sandy scatter.');
	return ok;
}
function thermal(){
	$('gravity-value').textContent=number('gravity')+' px/s²';
	$('ascent-value').textContent=number('ascent')+' px/s rising';
	const eligible=$('zone').checked&&airborne&&number('gravity')<900;
	const reduction=Math.max(0,Math.min(1,(900-number('gravity'))/350));
	const rising=Math.max(0,Math.min(1,number('ascent')/1100));
	const loft=eligible?Math.max(0,Math.min(1,.16+.6*reduction+.24*rising)):0;
	$('loft').textContent=Math.round(loft*100)+'%';
	if(playing&&ctx){
		each(fx=>fx.set('loft',loft,ctx.currentTime));
		if(eligible&&!wasThermal&&!dry)fire('gust');
	}
	wasThermal=eligible;
}
function takeoff(){
	if(!playing||airborne)return;
	airborne=true;thermal();controls();
	if(!dry)say(wasThermal?
		'Airborne in an actual thermal: the original stems fill the sandstone chambers.':
		'Ordinary jump outside a thermal: no invented updraft gust.');
}
function land(){
	if(!playing||!airborne)return;
	airborne=false;wasThermal=false;thermal();controls();fire('stone');
}
async function ready(){
	if(!ctx)ctx=new AudioContext({latencyHint:'interactive'});
	await ctx.resume();
}
async function load(){
	if(playing)stop();$('load').disabled=true;say('Loading the five original instrument OGG recordings…');
	try{
		await ready();
		const decoded=await Promise.all(ROLES.map(async role=>{
			const response=await fetch(PACK+role+'.ogg');
			if(!response.ok)throw Error(role+' original OGG missing: HTTP '+response.status);
			return ctx.decodeAudioData(await response.arrayBuffer());
		}));
		buffers=Object.fromEntries(ROLES.map((role,i)=>[role,decoded[i]]));
		say('All five original stereo instruments ready. Take off IN a thermal, then compare dry.');
	}catch(error){buffers=null;say('Original audio unavailable: '+(error?.message||String(error)));}
	finally{$('load').disabled=false;controls();}
}
function stop(){
	extraEnhancer?.dispose();extraEnhancer=null;
	for(const {source,gain} of Object.values(sources)){
		try{source.stop();}catch{}try{source.disconnect();}catch{}try{gain.disconnect();}catch{}
	}
	for(const chain of Object.values(chains))chain.dispose();
	for(const bus of [master,rawBus,fxBus])try{bus?.disconnect();}catch{}
	sources={};chains={};master=rawBus=fxBus=null;playing=dry=solo=airborne=wasThermal=false;
	controls();thermal();
}
async function play(){
	if(playing){stop();say('Stopped. No source files changed.');return;}
	if(!buffers)return;
	await ready();
	master=ctx.createGain();master.gain.value=.25;master.connect(ctx.destination);
	rawBus=ctx.createGain();fxBus=ctx.createGain();rawBus.gain.value=0;fxBus.gain.value=1;
	rawBus.connect(master);fxBus.connect(master);extraEnhancer=attachAuditionExtra(ctx,fxBus,master);
	const start=ctx.currentTime+.12;
	for(const role of ROLES){
		const chain=buildMusicChain(ctx,orchestraPreset('pyramid-peak',role),fxBus);
		const source=ctx.createBufferSource(),gain=ctx.createGain();
		source.buffer=buffers[role];source.loop=true;gain.gain.value=roleGain(role);
		source.connect(gain);gain.connect(rawBus);gain.connect(chain.input);
		source.start(start);sources[role]={source,gain};chains[role]=chain;
	}
	playing=true;dry=solo=airborne=wasThermal=false;
	resonance();drift();gustLevel();stoneLevel();thermal();controls();
	say('Warm original music on a grounded terrace. Take off while the thermal checkbox is enabled.');
}
$('load').addEventListener('click',load);
$('play').addEventListener('click',play);
for(const [id,fn] of [['resonance',resonance],['drift',drift],['gust-level',gustLevel],
	['stone-level',stoneLevel],['gravity',thermal],['ascent',thermal]])
	$(id).addEventListener('input',fn);
$('zone').addEventListener('change',thermal);
$('takeoff').addEventListener('click',takeoff);
$('land').addEventListener('click',land);
$('gust-test').addEventListener('click',()=>fire('gust'));
$('stone-test').addEventListener('click',()=>fire('stone'));
$('dry').addEventListener('click',()=>{
	if(!playing)return;dry=!dry;
	rawBus.gain.setTargetAtTime(dry?1:0,ctx.currentTime,.025);
	fxBus.gain.setTargetAtTime(dry?0:1,ctx.currentTime,.025);
	controls();say(dry?'Dry original five-stem source.':'Sunstone source-fed sandstone resonance restored.');
});
$('solo').addEventListener('click',()=>{
	if(!playing)return;solo=!solo;mixLevels();controls();
	say(solo?'Original drum stem alone — isolate ceramic terrace landing.':
		'All five original instruments restored.');
});
window.addEventListener('pagehide',()=>{stop();ctx?.close();});
controls();resonance();drift();gustLevel();stoneLevel();thermal();
if(new URLSearchParams(location.search).get('qa')==='1')
	window.__sunstoneQA=Object.freeze({buildMusicChain,orchestraPreset,getBuffers:()=>buffers});
