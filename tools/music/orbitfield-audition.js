import {buildMusicChain} from '../../src/systems/music/MusicFXGraph.js';
import {orchestraPreset} from '../../src/systems/music/DynamicOrchestraPresets.js';

const $=id=>document.getElementById(id);
const ROLES=['drums','bass','guitar','piano','other'];
const PACK='/music/packs/33_local-one-more-run-bitstream-bluffs/';
const roleGain=role=>role==='drums'?.9:role==='bass'?.75:.65;
const value=id=>Number($(id).value);
const say=message=>{$('status').textContent=message;};
let ctx=null,buffers=null,master=null,rawBus=null,fxBus=null,playing=false,dry=false,solo=false,airborne=false;
let sources={},chains={};
const fx=role=>chains[role]?.find('orbitfield');
const every=fn=>{for(const role of ROLES)if(fx(role))fn(fx(role),role);};
function controls(){
	$('play').disabled=!buffers;$('play').textContent=playing?'■ Stop':'▶ Play';
	for(const id of ['dry','solo','takeoff','land','reentry-test','eject-test'])$(id).disabled=!playing;
	$('dry').textContent=dry?'Hear orbital field':'Compare dry';
	$('dry').setAttribute('aria-pressed',String(dry));
	$('solo').textContent=solo?'Hear all stems':'Solo drums';
	$('solo').setAttribute('aria-pressed',String(solo));
	$('phase').textContent=airborne?'Orbiting — music drifts wide':'Grounded — the enormous field recedes';
	$('planet').style.transform=airborne?'translateY(-9px) rotate(8deg)':'translateY(0) rotate(0)';
}
function mixLevels(){
	if(!ctx||!playing)return;
	for(const role of ROLES)sources[role]?.gain.gain.setTargetAtTime(
		solo&&role!=='drums'?0:roleGain(role),ctx.currentTime,.035);
}
function spread(){
	$('spread-value').textContent=value('spread')+'%';
	if(playing)every(stage=>stage.set('spread',value('spread')/100,ctx.currentTime));
}
function drift(){
	$('drift-value').textContent=value('drift')+'%';
	if(playing)every(stage=>stage.set('drift',value('drift')/100,ctx.currentTime));
}
function shock(){
	$('shock-value').textContent=value('shock')+'%';
	if(playing)fx('drums')?.set('reentryLevel',value('shock')/100,ctx.currentTime);
}
function airlock(){
	$('airlock-value').textContent=value('airlock')+'%';
	if(playing)fx('other')?.set('ejectLevel',value('airlock')/100,ctx.currentTime);
}
function altitude(){
	$('altitude-value').textContent=value('altitude')+' px';
	$('gravity-value').textContent=value('gravity')+' px/s²';
	const gravity=Math.max(0,Math.min(1,(900-value('gravity'))/900));
	const openness=airborne?Math.max(0,Math.min(1,
		Math.max(0,value('altitude'))/700*.82+gravity*.35)):0;
	$('openness').textContent=Math.round(openness*100)+'%';
	if(playing&&ctx)every(stage=>{
		stage.set('weightless',openness,ctx.currentTime);
		stage.set('lowGravity',gravity,ctx.currentTime);
	});
}
function fire(kind){
	if(!playing||!ctx||dry){say('Hear the orbital field first to audition this physical effect.');return false;}
	const role=kind==='reentry'?'drums':'other';
	const ok=fx(role)?.set(kind,.9,ctx.currentTime)===true;
	if(ok)say(kind==='reentry'?
		'WHUUMM—FMM! Solid ground returns in a slow pressure shock.':
		'PFFT—shhh. The rider slips out into near silence.');
	return ok;
}
function takeoff(){
	if(!playing||airborne)return;
	fire('eject');
	airborne=true;
	if(value('altitude')===0)$('altitude').value=500;
	altitude();controls();
	if(!dry)say('Airborne! The ORIGINAL recorded music opens into a long, slowly drifting stereo void.');
}
function land(){
	if(!playing||!airborne)return;
	airborne=false;$('altitude').value=0;
	altitude();controls();fire('reentry');
}
async function ready(){
	if(!ctx)ctx=new AudioContext({latencyHint:'interactive'});
	await ctx.resume();
}
async function load(){
	if(playing)stop();$('load').disabled=true;say('Loading the five original stereo instrument OGG sources…');
	try{
		await ready();
		const audio=await Promise.all(ROLES.map(async role=>{
			const response=await fetch(PACK+'0000-'+role+'.ogg');
			if(!response.ok)throw Error(role+' original OGG unavailable: HTTP '+response.status);
			return ctx.decodeAudioData(await response.arrayBuffer());
		}));
		buffers=Object.fromEntries(ROLES.map((role,i)=>[role,audio[i]]));
		say('Five original recordings ready. Play, take off, then compare the huge stereo field with dry.');
	}catch(error){buffers=null;say('Original audio unavailable: '+(error?.message||String(error)));}
	finally{$('load').disabled=false;controls();}
}
function stop(){
	for(const {source,gain} of Object.values(sources)){
		try{source.stop();}catch{}try{source.disconnect();}catch{}try{gain.disconnect();}catch{}
	}
	for(const chain of Object.values(chains))chain.dispose();
	for(const bus of [master,rawBus,fxBus])try{bus?.disconnect();}catch{}
	sources={};chains={};master=rawBus=fxBus=null;playing=dry=solo=airborne=false;
	$('altitude').value=0;altitude();controls();
}
async function play(){
	if(playing){stop();say('Playback stopped. Original media unchanged.');return;}
	if(!buffers)return;
	await ready();
	master=ctx.createGain();master.gain.value=.24;master.connect(ctx.destination);
	rawBus=ctx.createGain();fxBus=ctx.createGain();rawBus.gain.value=0;fxBus.gain.value=1;
	rawBus.connect(master);fxBus.connect(master);
	const when=ctx.currentTime+.12;
	for(const role of ROLES){
		const chain=buildMusicChain(ctx,orchestraPreset('space-mountain',role),fxBus);
		const source=ctx.createBufferSource(),gain=ctx.createGain();
		source.buffer=buffers[role];source.loop=true;gain.gain.value=roleGain(role);
		source.connect(gain);gain.connect(rawBus);gain.connect(chain.input);
		source.start(when);sources[role]={source,gain};chains[role]=chain;
	}
	playing=true;dry=solo=airborne=false;spread();drift();shock();airlock();altitude();controls();
	say('Playing the original five-stem music. Take off to open the weightless halo.');
}
$('load').addEventListener('click',load);
$('play').addEventListener('click',play);
for(const [id,fn] of [['spread',spread],['drift',drift],['shock',shock],
	['airlock',airlock],['altitude',altitude],['gravity',altitude]])
	$(id).addEventListener('input',fn);
$('takeoff').addEventListener('click',takeoff);
$('land').addEventListener('click',land);
$('reentry-test').addEventListener('click',()=>fire('reentry'));
$('eject-test').addEventListener('click',()=>fire('eject'));
$('solo').addEventListener('click',()=>{
	if(!playing)return;solo=!solo;mixLevels();controls();
	say(solo?'Original drums alone: isolate the long field and real re-entry.':
		'All five original instruments restored.');
});
$('dry').addEventListener('click',()=>{
	if(!playing)return;dry=!dry;
	rawBus.gain.setTargetAtTime(dry?1:0,ctx.currentTime,.025);
	fxBus.gain.setTargetAtTime(dry?0:1,ctx.currentTime,.025);
	controls();say(dry?'Dry source recording, unchanged.':'Original recording plus enormous weightless source field.');
});
window.addEventListener('pagehide',()=>{stop();ctx?.close();});
controls();spread();drift();shock();airlock();altitude();
if(new URLSearchParams(location.search).get('qa')==='1')
	window.__orbitfieldQA=Object.freeze({buildMusicChain,orchestraPreset,getBuffers:()=>buffers});
