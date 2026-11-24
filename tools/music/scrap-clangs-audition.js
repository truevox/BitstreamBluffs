import {attachAuditionExtra} from './AuditionExtra.js';
import { buildMusicChain } from '../../src/systems/music/MusicFXGraph.js';
import { orchestraPreset } from '../../src/systems/music/DynamicOrchestraPresets.js';
import { contactFromMotion } from '../../src/systems/music/MusicPhysicsSignals.js';
import { ScrapPitchCadence } from '../../src/systems/music/ScrapPitchCadence.js';

let extraEnhancer=null;
const $ = id => document.getElementById(id);
const STEMS = ['drums','bass','guitar','piano','other'];
let ctx = null, buffers = null, chain = null, master = null;
let rawGain = null, processedGain = null, sources = [], accompaniment = [];
let bassChain=null, clangClock=new ScrapPitchCadence(), clangTimer=null, clangCount=0, clangAuto=true;
let manualClangUntil=0;
let playing = false, airborne = false, bypassed = false, drumOnly = false;
const say = message => { $('status').textContent = message; };
const effect = () => chain?.find('scrapheap');
const speed = () => Number($('speed').value);
const splock = () => Number($('splock').value)/100;
const suction = () => Number($('suction').value)/100;
const suctionTexture = () => Number($('suction-texture').value);
const clangDensity=()=>Number($('clang-density').value)/100;
const clangVolume=()=>Number($('clang-level').value)/100;
const setClangLevel=()=>{
	$('clang-level-value').textContent=Math.round(clangVolume()*100)+'%';
	if(ctx)effect()?.set('clangLevel',clangVolume(),ctx.currentTime);
};
const setClangDensity=()=>{$('clang-density-value').textContent=Math.round(clangDensity()*100)+'%';};
function notes(){
	const read=bassChain?.find('scrapPitchProbe')?.refs?.notes?.read;
	const detected=typeof read==='function'?read():[];
	$('pitch-status').textContent=detected.length?
		'Current original-bass spectral candidates: '+detected.map(n=>'MIDI '+n.midi+' ('+Math.round(n.hz)+'Hz)').join(', ')+
		'. Random clangs may use these measured peaks. Clangs played: '+clangCount+'.':
		'No confident current bass pitch: on-pitch clang is SKIPPED. Clangs played: '+clangCount+'.';
	return detected;
}
function fireVerifiedClang(candidate){
	if(!ctx||!playing||airborne||bypassed||speed()<280)return false;
	const played=effect()?.set('pitchedClang',{
		midi:candidate.midi,hz:candidate.hz,confidence:candidate.confidence,
		strength:Math.max(.3,contactFromMotion(speed(),true))},ctx.currentTime);
	if(played){clangCount++;
		say('KLANG! On-pitch fundamental at '+Math.round(candidate.hz)+'Hz, dirty junk-metal overtones.');}
	return played===true;
}
function pitchHit(){
	if(!ctx||!playing||airborne||bypassed||speed()<280)return false;
	const candidates=notes();
	if(candidates.length){manualClangUntil=0;
		return fireVerifiedClang(candidates[Math.floor(clangClock._random()*candidates.length)]);
	}
	// A manual TEST-only wait for the next real bass note, max four seconds.
	// The real game never adds extra timers or analyses every frame.
	manualClangUntil=ctx.currentTime+4;
	say('Waiting up to 4 seconds for the next confident original-bass pitch, not inventing a clang.');
	return false;
}
function automaticClangs(){
	if(!playing||airborne||bypassed){manualClangUntil=0;clangClock.resetTiming();return;}
	if(manualClangUntil){
		if(ctx.currentTime>manualClangUntil){
			manualClangUntil=0;say('No confident original bass note within 4 seconds; skipped test clang.');
		}else{
			const detected=notes();
			if(detected.length){manualClangUntil=0;
				fireVerifiedClang(detected[Math.floor(clangClock._random()*detected.length)]);}
		}
	}
	if(!clangAuto){clangClock.resetTiming();return;}
	const candidate=clangClock.next(ctx.currentTime,contactFromMotion(speed(),true),notes,clangDensity());
	if(candidate&&effect()?.set('pitchedClang',candidate,ctx.currentTime)){
		clangCount++;
		say('Random KLANG #'+clangCount+': '+Math.round(candidate.hz)+'Hz, chosen from live bass spectrum.');
	}
}
const setSuctionTexture = () => {
	if (ctx) effect()?.set('suctionStyle',suctionTexture(),ctx.currentTime);
	if (playing) say(suctionTexture()===0 ? 'Texture A: peeling a tacky seal with a wet pop.' :
		'Texture B: wet vacuum gulp, with little separating bubbles.');
};
const setSuction = () => {
	$('suction-value').textContent = Math.round(suction()*100)+'%';
	if (ctx) effect()?.set('suction',suction(),ctx.currentTime);
};
const setSplock = () => {
	$('splock-value').textContent = Math.round(splock()*100)+'%';
	if (ctx) effect()?.set('splock', splock(), ctx.currentTime);
};
const setContact = () => {
	const value = contactFromMotion(speed(),!airborne);
	$('contact-value').textContent = Math.round(value*100)+'%';
	if (ctx) effect()?.set('contact',value,ctx.currentTime);
};
const controlState = () => {
	$('play').disabled = !buffers;
	$('phrase').disabled=!buffers;
	$('bypass').disabled = !playing;
	$('solo').disabled = !playing;
	$('takeoff').disabled = !playing || airborne;
	$('soft').disabled = !playing || !airborne;
	$('hard').disabled = !playing || !airborne;
	$('splock-hit').disabled = !playing || bypassed;
	$('pitch-hit').disabled = !playing || bypassed || airborne;
	$('scan-pitch').disabled = !playing;
	$('auto-clangs').disabled=!playing;
	$('auto-clangs').setAttribute('aria-pressed',String(clangAuto));
	$('auto-clangs').textContent='Auto clangs: '+(clangAuto?'ON':'OFF');
	$('suction-hit').disabled = !playing || bypassed;
	$('play').textContent = playing ? '■ Stop' : '▶ Play';
	$('bypass').textContent = bypassed ? 'Hear processed' : 'Compare dry';
	$('bypass').setAttribute('aria-pressed',String(bypassed));
	$('solo').textContent = drumOnly ? 'Restore full mix' : 'Solo drums';
	$('solo').setAttribute('aria-pressed',String(drumOnly));
};
async function readyAudio() {
	if (!ctx) ctx = new AudioContext({latencyHint:'interactive'});
	await ctx.resume();
}
async function loadSample() {
	if (playing) stop();
	$('load').disabled = true;
	say('Loading five synchronized original instrument stems…');
	try {
		await readyAudio();
		const decoded = await Promise.all(STEMS.map(async role => {
			const response = await fetch('/audition-loops/pope-leo/' + role + '.ogg');
			if (!response.ok) throw new Error(role + ' stem is missing');
			return ctx.decodeAudioData(await response.arrayBuffer());
		}));
		buffers = Object.fromEntries(STEMS.map((role,i)=>[role,decoded[i]]));
		say('Original instrumental stems loaded. Press Play, then try Take off and Hard landing.');
	} catch (error) {
		buffers = null;
		say('Unable to load original stems: ' + String(error.message || error));
	} finally {
		$('load').disabled = false;
		controlState();
	}
}
function stop() {
	extraEnhancer?.dispose();extraEnhancer=null;
	for (const source of sources) {
		try { source.stop(); } catch {}
		try { source.disconnect(); } catch {}
	}
	sources = [];
	accompaniment = [];
	chain?.dispose(); chain = null;
	bassChain?.dispose();bassChain=null;
	if(clangTimer!==null){clearInterval(clangTimer);clangTimer=null;}
	clangClock.resetTiming();
	for (const node of [rawGain,processedGain,master]) {
		try { node?.disconnect(); } catch {}
	}
	rawGain = processedGain = master = null;
	playing = false;
	airborne = false;
	bypassed = false;
	drumOnly = false;
	setContact();
	controlState();
}
async function play(offsetSeconds=0) {
	if (playing) { stop(); say('Stopped. Press Play to restart the sample.'); return; }
	if (!buffers) return;
	await readyAudio();
	master = ctx.createGain();
	master.gain.value = .32;
	master.connect(ctx.destination);
	rawGain = ctx.createGain();
	processedGain = ctx.createGain();
	rawGain.gain.value = bypassed ? 1 : 0;
	processedGain.gain.value = bypassed ? 0 : 1;
	rawGain.connect(master);
	processedGain.connect(master);extraEnhancer=attachAuditionExtra(ctx,processedGain,master);
	chain = buildMusicChain(ctx,orchestraPreset('garbage-dump-glacier','drums'),processedGain);
	bassChain=buildMusicChain(ctx,orchestraPreset('garbage-dump-glacier','bass'),processedGain);
	clangClock.reset();clangCount=0;
	airborne = false;
	setContact();
	setSplock();
	setSuction();
	setSuctionTexture();
	setClangLevel();setClangDensity();
	const when=ctx.currentTime+.10;
	for (const role of STEMS) {
		const source=ctx.createBufferSource();
		source.buffer=buffers[role];
		source.loop=true;
		const level=ctx.createGain();
		level.gain.value=role==='drums' ? .9 : role==='bass' ? .75 : .65;
		source.connect(level);
		level.connect(rawGain);
		if (role==='drums') level.connect(chain.input);
		else if (role==='bass') {
			level.connect(bassChain.input);
			accompaniment.push({gain:level.gain,full:level.gain.value});
		} else {
			level.connect(processedGain);
			accompaniment.push({gain:level.gain,full:level.gain.value});
		}
		source.start(when,offsetSeconds);
		sources.push(source);
	}
	playing=true;
	clangTimer=setInterval(automaticClangs,75);
	controlState();
	say('Cruising through Garbage Dump Glacier: actual recorded drums drive the metallic resonators.');
}
$('load').addEventListener('click', loadSample);
$('play').addEventListener('click',()=>play(0));
$('phrase').addEventListener('click',()=>{if(playing)stop();play(3);});
$('splock').addEventListener('input', setSplock);
$('suction').addEventListener('input', setSuction);
$('suction-texture').addEventListener('change', setSuctionTexture);
$('clang-level').addEventListener('input',setClangLevel);
$('clang-density').addEventListener('input',setClangDensity);
$('scan-pitch').addEventListener('click',notes);
$('pitch-hit').addEventListener('click',pitchHit);
$('auto-clangs').addEventListener('click',()=>{
	clangAuto=!clangAuto;clangClock.resetTiming();controlState();
	say('Sparse source-verified random clangs '+(clangAuto?'enabled':'disabled')+'.');
});
$('speed').addEventListener('input', () => {
	$('speed-value').textContent = speed()+' px/s';
	setContact();
});
$('bypass').addEventListener('click', () => {
	bypassed=!bypassed;
	clangClock.resetTiming();
	if (ctx && rawGain && processedGain) {
		const at=ctx.currentTime;
		rawGain.gain.setTargetAtTime(bypassed ? 1 : 0,at,.02);
		processedGain.gain.setTargetAtTime(bypassed ? 0 : 1,at,.02);
	}
	controlState();
	say(bypassed ? 'Dry reference: the same original drum recording, no Scrapheap effect.' :
		'Processed: back to the original drums plus physical metal response.');
});
$('solo').addEventListener('click', () => {
	drumOnly = !drumOnly;
	if (ctx) for (const {gain,full} of accompaniment)
		gain.setTargetAtTime(drumOnly ? 0 : full,ctx.currentTime,.03);
	controlState();
	say(drumOnly ? 'Only the original drums + metal layer: move speed and compare dry.' :
		'Full instrumental mix restored, without restarting the song.');
});
const pullStrength = () => Math.max(.18, contactFromMotion(speed(),true));
$('takeoff').addEventListener('click', () => {
	if (!playing || airborne) return;
	// Physical suction sounds only on the true ground→airborne edge.
	// Matches StemMusicDirector's real-game signal policy.
	effect()?.set('takeoff',pullStrength(),ctx.currentTime);
	airborne=true;
	manualClangUntil=0;clangClock.resetTiming();
	setContact();
	controlState();
	say('SLLLORP! The garbage releases its grip, and ground rattles vanish in flight.');
});
$('suction-hit').addEventListener('click', () => {
	if (!playing || bypassed || !ctx) return;
	effect()?.set('takeoff', pullStrength(), ctx.currentTime);
	say('SLLLORP! Brief sticky suction-release, no change to gameplay state.');
});
function land(strength) {
	if (!playing || !airborne) return;
	airborne=false;
	setContact();
	effect()?.set('impact',strength,ctx.currentTime);
	controlState();
	say(strength>.6 ? 'Hard landing: thick sticky glorp—PLOCK with little scrap clatters.' :
		'Soft landing: brief rubbery squelch and restrained plock.');
}
$('soft').addEventListener('click',()=>land(.3));
$('hard').addEventListener('click',()=>land(.9));
$('splock-hit').addEventListener('click', () => {
	if (!playing || bypassed || !ctx) return;
	effect()?.set('impact', .9, ctx.currentTime);
	say('SPLORP—PLOCK! Adjustable sticky impact, with the same song continuing.');
});
window.addEventListener('pagehide',()=>{
	stop();
	ctx?.close();
});
controlState();

setClangLevel();setClangDensity();
