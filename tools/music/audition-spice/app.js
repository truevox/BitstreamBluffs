import { createBiomeImpulse } from '../../../src/systems/music/ImpulseBank.js';

const dom = id => document.getElementById(id);
const STATUS = dom('status');
const PREVIEW_ROOT = '/music-audition-spice/';
const VOICE_LABEL = 'Maxi / original vocal';
const CROSSFADE_SECONDS = 0.24;

let gallery;
let context;
let master;
let backingGain;
let backingSource;
let playbackAt = 0;
let pausedAt = 0;
let playing = false;
let loading = false;
let selectedId = 'organ-spice';
let priorSelectedId = selectedId;
let currentVoice = null;
let switchGeneration = 0;
let lastFeedback = '';
let voiceVolume = 1;
let backingVolume = 0.55;
let inputGain = 0.55;
const buffers = new Map();
const impulses = new Map();
const assessments = new Map();
const routes = new Set();

const voices = () => gallery?.voices || [];
const selected = () => voices().find(v => v.id === selectedId);
const currentName = () => selectedId === 'original' ? VOICE_LABEL :
	(selected()?.instrument || 'Bitstream Bluffs');

function showStatus(message, failure = false) {
	STATUS.textContent = message;
	STATUS.style.color = failure ? '#ff929a' : '#9ceba9';
}
function fmt(seconds) {
	const s = Math.floor(Math.max(0, seconds) || 0);
	return Math.floor(s / 60) + ':' + String(s % 60).padStart(2,'0');
}
function gainFor(id) {
	if (id === 'original') return 0.85;
	const voice = voices().find(v => v.id === id);
	return voice ? Math.pow(10, voice.gainDb / 20) : 1;
}
function pathFor(id) {
	if (id === 'original') return gallery.originalVocal;
	const voice = voices().find(v => v.id === id);
	if (!voice) throw new Error('Unknown mountain voice');
	return voice.file;
}
function bufferDuration() {
	return Math.max(0.1, gallery?.excerptSeconds || 25);
}
function position() {
	if (!playing || !context) return pausedAt;
	return Math.max(0,Math.min(bufferDuration(),context.currentTime-playbackAt));
}
function reflectPosition() {
	const p = position();
	dom('seek').value = String(p);
	dom('position').textContent = fmt(p);
}
function reflectSelection() {
	dom('current').textContent = currentName();
	for (const card of dom('mountains').querySelectorAll('[data-voice]')) {
		const isActive = card.dataset.voice === selectedId;
		card.classList.toggle('active',isActive);
		card.setAttribute('aria-pressed',String(isActive));
	}
	dom('original').textContent = selectedId === 'original'
		? 'Return to mountain voices'
		: "Hear Maxi's original vocal";
}
async function ensureContext() {
	if (!context) {
		context = new AudioContext({ latencyHint: 'interactive' });
		const compressor = context.createDynamicsCompressor();
		compressor.threshold.value = -8;
		compressor.knee.value = 12;
		compressor.ratio.value = 3;
		compressor.attack.value = 0.004;
		compressor.release.value = 0.16;
		master = context.createGain();
		master.gain.value = 0.8;
		master.connect(compressor);
		compressor.connect(context.destination);
		backingGain = context.createGain();
		backingGain.gain.value = backingVolume;
		backingGain.connect(master);
	}
	await context.resume();
	return context;
}
async function loadBuffer(filename) {
	if (buffers.has(filename)) return buffers.get(filename);
	const load = (async () => {
		const res = await fetch(PREVIEW_ROOT + filename);
		if (!res.ok) throw new Error('Missing audio asset: '+filename);
		const bytes = await res.arrayBuffer();
		const ctx = await ensureContext();
		return ctx.decodeAudioData(bytes);
	})();
	buffers.set(filename, load);
	try { return await load; }
	catch(e) { buffers.delete(filename); throw e; }
}
function getImpulse(id) {
	if (!impulses.has(id)) impulses.set(id,createBiomeImpulse(context,id,'mobile'));
	return impulses.get(id);
}
function setRouteWet(route) {
	if (!route?.wet) return;
	const now=context.currentTime;
	route.wet.gain.cancelScheduledValues(now);
	route.wet.gain.setTargetAtTime(dom('room').checked ? 0.23 : 0,now,0.045);
}
function makeVoice(buffer, id, when, offset, fadeFromZero) {
	const src = context.createBufferSource();
	src.buffer = buffer;
	const envelope = context.createGain();
	envelope.gain.value = fadeFromZero ? 0 : gainFor(id) * voiceVolume;
	src.connect(envelope);
	envelope.connect(master);
	const room = context.createConvolver();
	room.buffer = getImpulse(id === 'original' ? 'bitstream-bluffs' : id);
	const wet = context.createGain();
	wet.gain.value = dom('room').checked ? 0.23 : 0;
	envelope.connect(room); room.connect(wet); wet.connect(master);
	const route = { src, envelope, room, wet, id, disposed:false };
	routes.add(route);
	src.onended = () => {
		// Keep a short window for IR release, then disconnect all nodes.
		setTimeout(() => disposeRoute(route),1800);
	};
	if (fadeFromZero) envelope.gain.linearRampToValueAtTime(gainFor(id)*voiceVolume,when+CROSSFADE_SECONDS);
	src.start(when,offset);
	return route;
}
function disposeRoute(route) {
	if (!route || route.disposed) return;
	route.disposed = true;
	routes.delete(route);
	for (const node of [route.src,route.envelope,route.room,route.wet]) {
		try { node.disconnect(); } catch {}
	}
}
function stopRoutes() {
	for (const route of routes) {
		try { route.src.stop(); } catch {}
		disposeRoute(route);
	}
	routes.clear();
	currentVoice = null;
	if (backingSource) {
		try { backingSource.stop(); } catch {}
		try { backingSource.disconnect(); } catch {}
		backingSource = null;
	}
}
async function startAt(offset = pausedAt) {
	if (loading || playing) return;
	loading = true;
	showStatus('Decoding the selected voice and backing track…');
	try {
		await ensureContext();
		const id = selectedId;
		const [voice, backing] = await Promise.all([
			loadBuffer(pathFor(id)),
			loadBuffer(gallery.backing)
		]);
		const when = context.currentTime + 0.09;
		pausedAt = Math.max(0,Math.min(offset,bufferDuration()-0.04));
		playbackAt = when-pausedAt;
		stopRoutes();
		currentVoice = makeVoice(voice,id,when,pausedAt,false);
		backingSource = context.createBufferSource();
		backingSource.buffer = backing;
		backingSource.connect(backingGain);
		backingSource.start(when,pausedAt);
		playing = true;
		dom('play').textContent = '❚❚ Pause';
		showStatus('Playing synchronized stems · switch mountains freely');
		requestAnimationFrame(tick);
		queueBackgroundDownloads();
	} catch(e) {
		showStatus('Audio error: '+String(e.message || e),true);
		playing = false;
		dom('play').textContent = '▶ Play';
	} finally { loading = false; }
}
function pause() {
	if (!playing) return;
	pausedAt = Math.min(bufferDuration(),position());
	playing = false;
	stopRoutes();
	dom('play').textContent = '▶ Play';
	showStatus('Paused · ready');
	reflectPosition();
}
async function choose(id) {
	if (selectedId === id) return;
	if (selectedId !== 'original') priorSelectedId = selectedId;
	selectedId = id;
	reflectSelection();
	if (!playing || !context) {
		showStatus('Selected '+currentName()+'. Press Play to audition.');
		return;
	}
	const generation = ++switchGeneration;
	showStatus('Loading '+currentName()+'…');
	try {
		const buffer = await loadBuffer(pathFor(id));
		if (!playing || generation !== switchGeneration) return;
		const when=context.currentTime+0.07;
		const offset=Math.max(0,Math.min(bufferDuration()-0.05,when-playbackAt));
		const previous=currentVoice;
		const next=makeVoice(buffer,id,when,offset,true);
		if (previous) {
			const gain=previous.envelope.gain;
			gain.cancelScheduledValues(when);
			gain.setValueAtTime(gain.value,when);
			gain.linearRampToValueAtTime(0,when+CROSSFADE_SECONDS);
			try { previous.src.stop(when+CROSSFADE_SECONDS+0.01); } catch {}
		}
		currentVoice=next;
		showStatus('Now playing '+currentName()+' · aligned crossfade');
	} catch(e) { showStatus(String(e.message || e),true); }
}
function tick() {
	reflectPosition();
	if (!playing) return;
	if (position() >= bufferDuration()-0.08) {
		pause();
		if (dom('loop').checked) {
			pausedAt=0;
			startAt(0);
		} else {
			pausedAt=0;
			reflectPosition();
		}
		return;
	}
	requestAnimationFrame(tick);
}
function queueBackgroundDownloads() {
	// Small encoded previews, but keep the decoded-memory footprint controlled.
	const index=Math.max(0,voices().findIndex(v => v.id === selectedId));
	const following=voices()[(index+1)%voices().length];
	if (following && context && buffers.size < 7) loadBuffer(following.file).catch(()=>{});
}
function feedbackText() {
	const lines=['Bitstream Bluffs / SPICE versus V3 original pitch tracker','Pope song, 2:30–2:55',
		'First-pass synthetic voice palette.'];
	for (const voice of voices()) {
		const rating=assessments.get(voice.id) || 'Not reviewed';
		lines.push(voice.label+' — '+voice.instrument+': '+rating);
	}
	const notes=dom('notes').value.trim();
	if (notes) lines.push('Additional notes: '+notes);
	return lines.join('\n');
}
async function copyFeedback() {
	const text=feedbackText();
	try {
		await navigator.clipboard.writeText(text);
		showStatus('Feedback copied. Paste it into our chat. 💛');
	} catch {
		dom('notes').value=lastFeedback=text;
		dom('notes').select();
		document.execCommand('copy');
		showStatus('Feedback text selected and copied if the browser allows it.');
	}
}
function makeCards() {
	const grid=dom('mountains');
	const feedback=dom('feedback');
	voices().forEach((voice,i) => {
		const button=document.createElement('button');
		button.type='button';
		button.className='voice';
		button.dataset.voice=voice.id;
		button.setAttribute('aria-pressed','false');
		const number=document.createElement('span');
		number.className='num';
		number.textContent=String(i+1).padStart(2,'0')+' / 12';
		const title=document.createElement('strong');
		title.textContent=voice.id.replaceAll('-',' ').replace(/\b\w/g,c=>c.toUpperCase());
		const instr=document.createElement('div');
		instr.className='name';instr.textContent=voice.instrument;
		const desc=document.createElement('p');desc.textContent=voice.description;
		button.append(number,title,instr,desc);
		button.addEventListener('click',()=>choose(voice.id));
		grid.appendChild(button);
		const row=document.createElement('label');
		row.className='feedback-row';
		const label=document.createElement('span');label.textContent=voice.label;
		const select=document.createElement('select');
		select.setAttribute('aria-label','Rating for '+voice.id);
		for (const value of ['Not reviewed','Keep','Tweak','Replace']) {
			const option=document.createElement('option');
			option.value=value;option.textContent=value;select.appendChild(option);
		}
		select.addEventListener('change',()=>assessments.set(voice.id,select.value));
		row.append(label,select);feedback.appendChild(row);
	});
	reflectSelection();
}

dom('play').addEventListener('click',()=>{ if (playing) pause(); else startAt(); });
dom('restart').addEventListener('click',()=>{ if(playing) pause();pausedAt=0;reflectPosition();startAt(0); });
dom('original').addEventListener('click',()=>choose(selectedId==='original'?priorSelectedId:'original'));
dom('seek').addEventListener('change',()=>{
	const at=Number(dom('seek').value) || 0;
	if(playing){pause();pausedAt=at;startAt(at);}
	else {pausedAt=at;reflectPosition();}
});
dom('backing').addEventListener('change',()=>{ if(backingGain) backingGain.gain.setTargetAtTime(dom('backing').checked?backingVolume:0,context.currentTime,0.04);});
dom('room').addEventListener('change',()=>{for(const route of routes)setRouteWet(route);});
dom('voiceLevel').addEventListener('input',()=>{
	voiceVolume=Number(dom('voiceLevel').value)/100;
	if(context)for(const route of routes){
		route.envelope.gain.setTargetAtTime(gainFor(route.id)*voiceVolume,context.currentTime,0.025);
	}
});
dom('backingLevel').addEventListener('input',()=>{
	backingVolume=Number(dom('backingLevel').value)/100;
	if(context&&backingGain)backingGain.gain.setTargetAtTime(dom('backing').checked?backingVolume:0,context.currentTime,0.025);
});
dom('copy').addEventListener('click',copyFeedback);
document.addEventListener('keydown',event=>{
	if(event.target?.matches('input,textarea,select'))return;
	if(event.code==='Space'){event.preventDefault();dom('play').click();}
	else if(event.code==='ArrowRight'||event.code==='ArrowLeft'){
		event.preventDefault();
		const index=Math.max(0,voices().findIndex(v=>v.id===selectedId));
		const next=(index+(event.code==='ArrowRight'?1:-1)+voices().length)%voices().length;
		choose(voices()[next].id);
	}
});

(async()=>{
	try {
		const response=await fetch(PREVIEW_ROOT+'gallery.json',{cache:'no-store'});
		if(!response.ok)throw new Error('Audition manifest unavailable');
		gallery=await response.json();
		if(gallery.format!=='bitstream-voice-gallery-v1'||gallery.voices.length!==12)throw new Error('Invalid audition manifest');
		makeCards();
		dom('seek').max=String(gallery.excerptSeconds);
		dom('duration').textContent=fmt(gallery.excerptSeconds)+' · excerpt from '+fmt(gallery.excerptStartSeconds);
		showStatus('SPICE vs V3 pitch — 12 variants, same song and timbres');
	} catch(e) {
		showStatus('Gallery unavailable: '+String(e.message||e),true);
		dom('play').disabled=true;
	}
})();
