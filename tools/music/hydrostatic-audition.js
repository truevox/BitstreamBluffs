import { buildMusicChain } from '../../src/systems/music/MusicFXGraph.js';
import { HydrostaticPressure } from '../../src/systems/music/HydrostaticPressure.js';
import { orchestraPreset } from '../../src/systems/music/DynamicOrchestraPresets.js';
const $=id=>document.getElementById(id);
const ROLES=['drums','bass','guitar','piano','other'];
const controller=new HydrostaticPressure();
let ctx=null,buffers=null,master=null,rawGain=null,processedGain=null;
let sources=[],chains=[],playing=false,bypassed=false,phase='ground';
let terrainY=0;
const contrast=()=>Number($('contrast').value)/100;
const waveStrength=()=>Number($('wave').value)/100;
const status=message=>{$('status').textContent=message;};
function setContrast(){
	$('contrast-value').textContent=Math.round(contrast()*100)+'%';
	if(playing&&ctx)for(const chain of chains)
		chain.find('hydrostatic')?.set('contrast',contrast(),ctx.currentTime);
}
function setWaveStrength(){
	$('wave-value').textContent=Math.round(waveStrength()*100)+'%';
	if(playing&&ctx)chains[0]?.find('hydrostatic')?.set('waveStrength',waveStrength(),ctx.currentTime);
}
function triggerWave(strength=.85){
	if(!playing||!ctx||bypassed){
		status('Press Play and turn off Compare dry to hear the physical pressure wave.');
		return false;
	}
	return chains[0]?.find('hydrostatic')?.set('impact',strength,ctx.currentTime)===true;
}
const percent=x=>Math.round(x*100)+'%';
const control=()=>{
	$('play').disabled=!buffers;
	$('play').textContent=playing?'■ Stop':'▶ Play';
	$('bypass').disabled=!playing;
	$('bypass').textContent=bypassed?'Hear processed':'Compare dry';
	$('bypass').setAttribute('aria-pressed',String(bypassed));
	for(const id of ['jump','apex','fall','land','wave-hit','exit'])$(''+id).disabled=!playing;
};
function applyMotion(grounded,riderY,vy){
	const state=controller.update({terrainY,riderY,vy,grounded});
	$('stored-value').textContent=percent(state.storedPressure01);
	$('audible-value').textContent=percent(state.audiblePressure01);
	$('relief-value').textContent=percent(state.jumpRelief01);
	$('stored-bar').style.width=percent(state.storedPressure01);
	$('audible-bar').style.width=percent(state.audiblePressure01);
	if(playing&&ctx)for(const chain of chains)
		chain.find('hydrostatic')?.set('pressure',state.audiblePressure01,ctx.currentTime);
	return state;
}
async function ready(){if(!ctx)ctx=new AudioContext({latencyHint:'interactive'});await ctx.resume();}
async function load(){
	if(playing)stop();$('load').disabled=true;status('Loading five original stems…');
	try {
		await ready();
		const data=await Promise.all(ROLES.map(async role=>{
			const response=await fetch('/scrapheap-audition/'+role+'.mp3');
			if(!response.ok)throw new Error(role+' missing ('+response.status+')');
			return ctx.decodeAudioData(await response.arrayBuffer());
		}));
		buffers=Object.fromEntries(ROLES.map((role,i)=>[role,data[i]]));
		status('Ready. Play, descend deep, then climb back uphill or try a rising jump.');
	} catch(e){buffers=null;status('Stem load failed: '+String(e.message||e));}
	finally {$('load').disabled=false;control();}
}
function stop(){
	for(const source of sources){try{source.stop();}catch{}try{source.disconnect();}catch{}}
	for(const chain of chains)chain.dispose();
	for(const node of [master,rawGain,processedGain])try{node?.disconnect();}catch{}
	sources=[];chains=[];master=rawGain=processedGain=null;playing=false;bypassed=false;
	control();
}
async function play(){
	if(playing){stop();status('Stopped. Depth memory stays until Exit biome / reset pressure.');return;}
	if(!buffers)return;
	await ready();master=ctx.createGain();master.gain.value=.32;master.connect(ctx.destination);
	rawGain=ctx.createGain();processedGain=ctx.createGain();rawGain.gain.value=0;processedGain.gain.value=1;
	rawGain.connect(master);processedGain.connect(master);
	for(const role of ROLES){
		const chain=buildMusicChain(ctx,orchestraPreset('underwater-mountain',role),processedGain);
		const source=ctx.createBufferSource(),gain=ctx.createGain();
		source.buffer=buffers[role];source.loop=true;
		gain.gain.value=role==='drums'?.9:role==='bass'?.75:.65;
		source.connect(gain);gain.connect(rawGain);gain.connect(chain.input);
		source.start(ctx.currentTime+.10);sources.push(source);chains.push(chain);
	}
	playing=true;control();
	setContrast();setWaveStrength();applyMotion(true,terrainY,0);
	status('Music is continuous. Slide terrain deeper: stored pressure rises; moving uphill cannot lower it.');
}
$('load').addEventListener('click',load);$('play').addEventListener('click',play);
$('bypass').addEventListener('click',()=>{
	if(!playing)return;bypassed=!bypassed;
	const now=ctx.currentTime;
	rawGain.gain.setTargetAtTime(bypassed?1:0,now,.02);
	processedGain.gain.setTargetAtTime(bypassed?0:1,now,.02);
	control();status(bypassed?'Dry original five-stem recording.':'Back to hydrostatic DSP on original stems.');
});
$('contrast').addEventListener('input',setContrast);
$('wave').addEventListener('input',setWaveStrength);
$('terrain').addEventListener('input',()=>{
	terrainY=Number($('terrain').value);$('terrain-value').textContent=terrainY+' px';
	const state=applyMotion(phase==='ground',phase==='ground'?terrainY:
		terrainY-(phase==='apex'?145:phase==='rise'?75:55),
		phase==='rise'?-550:phase==='fall'?490:0);
	status('Terrain '+terrainY+'px relative to entry; deepest terrain descent: '+
		Math.round(state.deepestTerrainDescentPx)+'px (never decreases until biome exit).');
});
$('jump').addEventListener('click',()=>{
	phase='rise';applyMotion(false,terrainY-75,-550);
	status('Rising: stored pressure remains, audible pressure temporarily lifts.');
});
$('apex').addEventListener('click',()=>{
	phase='apex';applyMotion(false,terrainY-145,0);
	status('At apex: some temporary relief, no loss of remembered depth.');
});
$('fall').addEventListener('click',()=>{
	phase='fall';applyMotion(false,terrainY-55,490);
	status('Falling: pressure is returning even before touchdown.');
});
$('land').addEventListener('click',()=>{
	phase='ground';applyMotion(true,terrainY,0);
	if(triggerWave(.8))
		status('Landed: full remembered pressure restored, with water-hammer thump and bubbling release.');
	else if(!playing) status('Landed: full stored pressure restored. Play to hear the water-hammer wave.');
});
$('wave-hit').addEventListener('click',()=>{
	if(triggerWave(.85))
		status('WWHUMP—blublublup! A physical pressure wave independent of song beats.');
});
$('exit').addEventListener('click',()=>{
	controller.reset();phase='ground';terrainY=0;
	$('terrain').value=0;$('terrain-value').textContent='0 px';
	applyMotion(true,0,0);
	status('Confirmed biome exit/reset: memory cleared. New entry terrain baseline is 0px.');
});
window.addEventListener('pagehide',()=>{stop();ctx?.close();});
control();
