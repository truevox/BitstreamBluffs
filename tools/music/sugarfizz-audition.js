import {attachAuditionExtra} from './AuditionExtra.js';
import {buildMusicChain} from '../../src/systems/music/MusicFXGraph.js';
import {orchestraPreset} from '../../src/systems/music/DynamicOrchestraPresets.js';

let extraEnhancer=null;
const $=id=>document.getElementById(id);
const ROLES=['drums','bass','guitar','piano','other'];
const SONG='/audition-loops/one-more-run/';
const roleGain=role=>role==='drums'?.9:role==='bass'?.75:.65;
const number=id=>Number($(id).value);
const say=message=>{$('status').textContent=message;};
let ctx=null,buffers=null,master=null,rawBus=null,fxBus=null;
let sources={},chains={},playing=false,dry=false,solo=false,airborne=false;
const fx=role=>chains[role]?.find('sugarfizz');
const each=fn=>{for(const role of ROLES)if(fx(role))fn(fx(role),role);};
function controls(){
	$('play').disabled=!buffers;$('play').textContent=playing?'■ Stop':'▶ Play';
	for(const id of ['dry','solo','takeoff','land','pop','wrapper'])$(id).disabled=!playing;
	$('dry').setAttribute('aria-pressed',String(dry));
	$('dry').textContent=dry?'Hear Sugar Fizz':'Compare dry';
	$('solo').setAttribute('aria-pressed',String(solo));
	$('solo').textContent=solo?'Hear all five':'Solo drums';
	$('phase').textContent=airborne?'Airborne — sweet high frequencies open':'Grounded — sugar rush and fizzy candy';
	$('candy-emoji').style.transform=airborne?'translateY(-12px) rotate(12deg)':'translateY(0) rotate(0)';
}
function updateLevels(){
	if(!ctx||!playing)return;
	for(const role of ROLES)
		sources[role]?.gain.gain.setTargetAtTime(solo&&role!=='drums'?0:roleGain(role),ctx.currentTime,.035);
}
const bind=(slider,output,param,role)=>{
	$(output).textContent=number(slider)+'%';
	if(!ctx||!playing)return;
	if(role==='all')each(stage=>stage.set(param,number(slider)/100,ctx.currentTime));
	else fx(role)?.set(param,number(slider)/100,ctx.currentTime);
};
function sweet(){bind('sweet','sweet-value','sweetness','all');}
function fizz(){bind('fizz','fizz-value','fizz','all');}
function popLevel(){bind('pop-level','pop-value','popLevel','drums');}
function wrapperLevel(){bind('wrapper-level','wrapper-value','wrapperLevel','other');}
function speed(){
	$('speed-value').textContent=number('speed')+' px/s';
	if(!ctx||!playing)return;
	each(stage=>stage.set('speed',Math.min(1,number('speed')/1800),ctx.currentTime));
}
function pop(){
	if(!playing||!ctx||dry){say('Hear Sugar Fizz first to audition a crunchy candy landing.');return false;}
	const result=fx('drums')?.set('pop',.9,ctx.currentTime)===true;
	if(result)say('POP-KRRRRK! Crunchy pop-rocks candy landing, with little crackle aftershocks.');
	return result;
}
function wrapper(){
	if(!playing||!ctx||dry){say('Hear Sugar Fizz first to audition the wrapper tear.');return false;}
	const result=fx('other')?.set('wrapper',.9,ctx.currentTime)===true;
	if(result)say('CRRRT! A short brittle wrapper tear, not Garbage sticky suction.');
	return result;
}
function takeoff(){
	if(!playing||airborne)return;
	wrapper();airborne=true;each(stage=>stage.set('airborne',true,ctx.currentTime));
	controls();
	if(!dry)say('Airborne: sugar fizz opens brighter; one wrapper tear, no new beat or song notes.');
}
function land(){
	if(!playing||!airborne)return;
	airborne=false;each(stage=>stage.set('airborne',false,ctx.currentTime));
	controls();pop();
}
async function ready(){
	if(!ctx)ctx=new AudioContext({latencyHint:'interactive'});
	await ctx.resume();
}
async function load(){
	if(playing)stop();
	$('load').disabled=true;say('Loading five original instrument OGG recordings…');
	try{
		await ready();
		const audio=await Promise.all(ROLES.map(async role=>{
			const response=await fetch(SONG+role+'.ogg');
			if(!response.ok)throw Error(role+' source missing: HTTP '+response.status);
			return ctx.decodeAudioData(await response.arrayBuffer());
		}));
		buffers=Object.fromEntries(ROLES.map((role,i)=>[role,audio[i]]));
		say('Five original stereo instrument sources ready. Try speed 1,650, then take off and land.');
	}catch(error){buffers=null;say('Original music not available: '+(error?.message||String(error)));}
	finally{$('load').disabled=false;controls();}
}
function stop(){
	extraEnhancer?.dispose();extraEnhancer=null;
	for(const {source,gain} of Object.values(sources)){
		try{source.stop();}catch{}try{source.disconnect();}catch{}try{gain.disconnect();}catch{}
	}
	for(const chain of Object.values(chains))chain.dispose();
	for(const bus of [master,rawBus,fxBus])try{bus?.disconnect();}catch{}
	sources={};chains={};master=rawBus=fxBus=null;
	playing=dry=solo=airborne=false;controls();
}
async function play(){
	if(playing){stop();say('Playback stopped; original stems untouched.');return;}
	if(!buffers)return;
	await ready();
	master=ctx.createGain();master.gain.value=.26;master.connect(ctx.destination);
	rawBus=ctx.createGain();fxBus=ctx.createGain();
	rawBus.gain.value=0;fxBus.gain.value=1;
	rawBus.connect(master);fxBus.connect(master);extraEnhancer=attachAuditionExtra(ctx,fxBus,master);
	const when=ctx.currentTime+.12;
	for(const role of ROLES){
		const chain=buildMusicChain(ctx,orchestraPreset('candy-cane-canyon',role),fxBus);
		const source=ctx.createBufferSource(),gain=ctx.createGain();
		source.buffer=buffers[role];source.loop=true;gain.gain.value=roleGain(role);
		source.connect(gain);gain.connect(rawBus);gain.connect(chain.input);
		source.start(when);
		sources[role]={source,gain};chains[role]=chain;
	}
	playing=true;dry=solo=airborne=false;
	sweet();fizz();speed();popLevel();wrapperLevel();controls();
	say('Source-fed original song with candy fizz. Increase physical speed toward 1,800!');
}
$('load').addEventListener('click',load);
$('play').addEventListener('click',play);
for(const [id,fn] of [['sweet',sweet],['fizz',fizz],['speed',speed],
	['pop-level',popLevel],['wrapper-level',wrapperLevel]])
	$(id).addEventListener('input',fn);
$('dry').addEventListener('click',()=>{
	if(!playing)return;dry=!dry;
	rawBus.gain.setTargetAtTime(dry?1:0,ctx.currentTime,.02);
	fxBus.gain.setTargetAtTime(dry?0:1,ctx.currentTime,.02);
	controls();say(dry?'Dry original five-stem recording.':'Sugar fizz source effects restored.');
});
$('solo').addEventListener('click',()=>{
	if(!playing)return;solo=!solo;updateLevels();controls();
	say(solo?'Original drums only: isolate candy crackle and real landing.':
		'All five original instruments restored.');
});
$('takeoff').addEventListener('click',takeoff);
$('land').addEventListener('click',land);
$('pop').addEventListener('click',pop);
$('wrapper').addEventListener('click',wrapper);
window.addEventListener('pagehide',()=>{stop();ctx?.close();});
controls();sweet();fizz();speed();popLevel();wrapperLevel();
if(new URLSearchParams(location.search).get('qa')==='1')
	window.__sugarfizzQA=Object.freeze({buildMusicChain,orchestraPreset,getBuffers:()=>buffers});
