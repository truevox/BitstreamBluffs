import { sourceStemURL, sourceClipSlices, PACK_ROOT } from '../downbeat-review/clock.mjs';
import { validateHarmonyData, rowAtSourceTime, resonanceNotes, boundedWetMix,
	HARMONY_SHA256, SOURCE_MANIFEST_SHA256, MASTER_SHA256 } from './resonators.mjs';
import { createCrystalGraph, synthesizeLanding } from './graph.mjs';

const $=id=>document.getElementById(id);
const status=text=>{$('status').textContent=text;};
const originalRoles=['vocals','drums','bass','guitar','piano','other'];
const harmonicRoles=new Set(['guitar','piano','other']);
let ctx=null, pack=null, packet=null, harmony=null;
let requestNumber=0, sources=[], outputs=[], cache=new Map();
let wetControl=null, playingFrom=null;
let clockAnimation=null;
const MAX_SOURCE_CACHE=12;

async function hashBytes(bytes) {
	if (!crypto?.subtle)throw new Error('HTTPS/localhost required for SHA-256 source checks');
	const result=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
	return [...result].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function fetchVerified(url,expected) {
	const response=await fetch(url);
	if (!response.ok)throw new Error('Missing required original source: '+response.status+' '+url);
	const bytes=await response.arrayBuffer();
	if (await hashBytes(bytes)!==expected)throw new Error('Original source SHA-256 mismatch: '+url);
	return bytes;
}

function passage() {
	const p=packet?.suggestedSourcePassages?.[Number($('passage').value)];
	if (!p || p.candidateOnly!==true || p.humanVerified!==false)
		throw new Error('No unverified original-source passage selected');
	return p;
}
function selectedWet() { return boundedWetMix(Number($('wet').value)/100*.55); }
function adjustWet() {
	$('wetLabel').textContent=$('wet').value+'%';
	if (ctx && wetControl) {
		wetControl.gain.setTargetAtTime($('shimmer').checked ? selectedWet() : 0,
			ctx.currentTime,.045);
	}
}
function updatePlaybackState(active) {
	$('stop').disabled=!active;
	$('land').disabled=!active;
	$('play').disabled=active || !pack;
}
function stop() {
	requestNumber++;
	if (clockAnimation!==null)cancelAnimationFrame(clockAnimation);
	clockAnimation=null;
	for (const node of sources) {
		try { node.stop(); } catch { /* already stopped */ }
	}
	for (const node of [...sources,...outputs]) {
		try { node.disconnect(); } catch { /* already disconnected */ }
	}
	sources=[];outputs=[];wetControl=null;playingFrom=null;
	updatePlaybackState(false);
}
async function originalAudio(segmentIndex,role) {
	const url=sourceStemURL(pack,segmentIndex,role);
	const cached=cache.get(url);
	if (cached)return cached;
	const sha=packet.windows[segmentIndex]?.originalStemHashesSha256?.[role];
	if (!sha)throw new Error('Original role fingerprint missing: '+segmentIndex+'/'+role);
	const bytes=await fetchVerified(url,sha);
	const buffer=await ctx.decodeAudioData(bytes);
	cache.set(url,buffer);
	while (cache.size>MAX_SOURCE_CACHE)cache.delete(cache.keys().next().value);
	return buffer;
}
function tickClock() {
	if (!playingFrom || !harmony)return;
	const seconds=playingFrom.sourceStart+Math.max(0,ctx.currentTime-playingFrom.when);
	const row=rowAtSourceTime(harmony,seconds);
	const notes=resonanceNotes(row);
	$('now').textContent='Original-source time '+seconds.toFixed(2)+'s · unverified strongest pitch classes: '
		+(notes.length?notes.map(x=>x.name).join(' / '):'uncertain (shimmer subdued)')
		+' · evidence '+(row?.confidence?.toFixed(2)??'0')+' · '+(row?.status??'no original-source evidence');
	if (seconds>playingFrom.sourceEnd+.1) {
		stop();status('Excerpt finished. Replay or try a different passage.');
		return;
	}
	clockAnimation=requestAnimationFrame(tickClock);
}
function impactBell() {
	if (!ctx || !playingFrom || !wetControl || !$('shimmer').checked)return;
	const src=playingFrom.sourceStart+Math.max(0,ctx.currentTime-playingFrom.when);
	const row=rowAtSourceTime(harmony,src);
	const notes=resonanceNotes(row);
	if (!notes.length) {
		status('No confident source harmony at this moment: suppressing invented landing pitches.');
		return;
	}
	const imp=Math.min(1,Math.max(0,Number($('impact').value)/100));
	const started=synthesizeLanding(ctx,playingFrom.graph,notes,imp,ctx.currentTime+.006);
	for(const node of started){outputs.push(node);if(typeof node.stop==='function')sources.push(node);}
	status('Impact-scaled ORIGINAL-harmony bell audition (not a game landing event or verified chord).');
}
async function play() {
	stop();const request=requestNumber;
	const p=passage(),[sourceStart,sourceEnd]=p.suggestedListenRangeSeconds;
	updatePlaybackState(true);status('Checking original OGG SHA-256 fingerprints and decoding source audio…');
	try {
		ctx??=new AudioContext();await ctx.resume();
		const slices=sourceClipSlices(pack,sourceStart,sourceEnd);
		const selected=$('mix').value==='harmony'?[...harmonicRoles]:originalRoles;
		const clips=await Promise.all(slices.flatMap(slice=>selected.map(async role=>
			({slice,role,buffer:await originalAudio(slice.segmentIndex,role)}))));
		if (request!==requestNumber)return;
		const start=ctx.currentTime+.16;
		const graph=createCrystalGraph(ctx,{destination:ctx.destination,harmony,sourceStart,sourceEnd,
			startAt:start,dryGain:selected.length===6?.23:.36,
			wetMix:$('shimmer').checked?selectedWet():0});
		outputs.push(...graph.nodes);
		wetControl=graph.wetControl;
		const changes=graph.changeCount;
		for (const {slice,role,buffer} of clips) {
			if (slice.bufferOffsetSeconds+slice.durationSeconds>buffer.duration+.03)
				throw new Error('Source-decoded OGG shorter than verified manifest: '+role);
			const node=ctx.createBufferSource();node.buffer=buffer;
			node.connect(graph.dry);
			if(harmonicRoles.has(role))node.connect(graph.input);
			const duration=Math.min(slice.durationSeconds,buffer.duration-slice.bufferOffsetSeconds);
			node.start(start+slice.clipOffsetSeconds,slice.bufferOffsetSeconds,duration);
			sources.push(node);
		}
		playingFrom={sourceStart,sourceEnd,when:start,graph};
		$('now').textContent='Playing source '+sourceStart.toFixed(2)+'–'+sourceEnd.toFixed(2)+'s.';
		status('Playing unchanged '+selected.length+' source OGG stems; '+changes
			+' smoothed original-source harmony changes · shimmer '+($('shimmer').checked?'ON':'OFF')+'.');
		updatePlaybackState(true);clockAnimation=requestAnimationFrame(tickClock);
	} catch(error) {
		stop();status('Playback unavailable: '+error.message);
	}
}
async function load() {
	try {
		const [manifestResponse,packetResponse,harmonyResponse]=await Promise.all([
			fetch(PACK_ROOT+'pack.json'),fetch('../downbeat-review/candidates.json'),fetch('./harmony.json')]);
		if (![manifestResponse,packetResponse,harmonyResponse].every(r=>r.ok))
			throw new Error('Original pack or source-harmony research unavailable');
		const [manifestBytes,packetBytes,harmonyBytes]=await Promise.all([
			manifestResponse.arrayBuffer(),packetResponse.arrayBuffer(),harmonyResponse.arrayBuffer()]);
		if(await hashBytes(manifestBytes)!==SOURCE_MANIFEST_SHA256
			||await hashBytes(harmonyBytes)!==HARMONY_SHA256)
			throw new Error('Original-song manifest or harmony JSON SHA-256 mismatch');
		pack=JSON.parse(new TextDecoder().decode(manifestBytes));
		packet=JSON.parse(new TextDecoder().decode(packetBytes));
		harmony=JSON.parse(new TextDecoder().decode(harmonyBytes));
		validateHarmonyData(harmony,pack,packet);
		if(packet.source.originalMasterWavSha256!==MASTER_SHA256)throw new Error('Original WAV master fingerprint not consistent');
		if(packet.suggestedSourcePassages.some(p=>p.candidateOnly!==true||p.humanVerified!==false))
			throw new Error('Unapproved source-research passage guard failed');
		$('passage').replaceChildren(...packet.suggestedSourcePassages.map((p,i)=>
			new Option(p.centerSeconds.toFixed(1)+'s · '+p.reviewReason,String(i))));
		// 16.4s is the owner's corrected earlier example, now source-exact.
		$('passage').value=String(packet.suggestedSourcePassages.findIndex(p=>Math.abs(p.centerSeconds-16.44)<.01));
		$('source').textContent='Original WAV master '+MASTER_SHA256.slice(0,20)
			+'… · original pack '+SOURCE_MANIFEST_SHA256.slice(0,15)
			+'… · harmony SHA '+HARMONY_SHA256.slice(0,15)+'… · '
			+harmony.timeline.length+' 250ms original-source pitch-class windows; '+
			'no verified meter or tuning.';
		updatePlaybackState(false);
		status('Ready: original-source harmony confirmed by SHA. Click Play, then toggle shimmer for dry/wet A/B.');
	} catch(error) {
		pack=null;updatePlaybackState(false);status('Research source verification failed: '+error.message);
	}
}
$('passage').addEventListener('change',()=>{stop();status('Selected source passage '+passage().centerSeconds.toFixed(2)+'s. Press Play to audition.');});
$('mix').addEventListener('change',()=>{stop();status('Changed original source stems; press Play to compare.');});
$('wet').addEventListener('input',adjustWet);
$('shimmer').addEventListener('change',()=>{adjustWet();if(playingFrom)status('Crystal shimmer '+($('shimmer').checked?'ON':'OFF')+' · same unchanged original OGG playback.');});
$('impact').addEventListener('input',()=>{$('impactLabel').textContent=$('impact').value+'%';});
$('play').addEventListener('click',play);
$('stop').addEventListener('click',()=>{stop();status('Stopped.');});
$('land').addEventListener('click',impactBell);
load();
