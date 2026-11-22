import { buildMusicChain } from '../../src/systems/music/MusicFXGraph.js';
import { orchestraPreset } from '../../src/systems/music/DynamicOrchestraPresets.js';
import { contactFromMotion } from '../../src/systems/music/MusicPhysicsSignals.js';

const $ = id => document.getElementById(id);
const STEMS = ['drums','bass','guitar','piano','other'];
let ctx = null, buffers = null, chain = null, master = null;
let rawGain = null, processedGain = null, sources = [];
let playing = false, airborne = false, bypassed = false;
const say = message => { $('status').textContent = message; };
const effect = () => chain?.find('scrapheap');
const speed = () => Number($('speed').value);
const setContact = () => effect()?.set('contact',contactFromMotion(speed(),!airborne),ctx.currentTime);
const controlState = () => {
	$('play').disabled = !buffers;
	$('bypass').disabled = !buffers;
	$('takeoff').disabled = !buffers || airborne;
	$('soft').disabled = !buffers || !airborne;
	$('hard').disabled = !buffers || !airborne;
	$('play').textContent = playing ? '■ Stop' : '▶ Play';
	$('bypass').textContent = bypassed ? 'Hear processed' : 'Compare dry';
	$('bypass').setAttribute('aria-pressed',String(bypassed));
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
			const response = await fetch('/scrapheap-audition/' + role + '.mp3');
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
	for (const source of sources) {
		try { source.stop(); } catch {}
		try { source.disconnect(); } catch {}
	}
	sources = [];
	chain?.dispose(); chain = null;
	for (const node of [rawGain,processedGain,master]) {
		try { node?.disconnect(); } catch {}
	}
	rawGain = processedGain = master = null;
	playing = false;
	airborne = false;
	bypassed = false;
	controlState();
}
async function play() {
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
	processedGain.connect(master);
	chain = buildMusicChain(ctx,orchestraPreset('garbage-dump-glacier','drums'),processedGain);
	airborne = false;
	setContact();
	const when=ctx.currentTime+.10;
	for (const role of STEMS) {
		const source=ctx.createBufferSource();
		source.buffer=buffers[role];
		source.loop=true;
		const level=ctx.createGain();
		level.gain.value=role==='drums' ? .9 : role==='bass' ? .75 : .65;
		source.connect(level);
		if (role==='drums') {
			level.connect(rawGain);
			level.connect(chain.input);
		} else {
			level.connect(master);
		}
		source.start(when);
		sources.push(source);
	}
	playing=true;
	controlState();
	say('Cruising through Garbage Dump Glacier: actual recorded drums drive the metallic resonators.');
}
$('load').addEventListener('click', loadSample);
$('play').addEventListener('click', play);
$('speed').addEventListener('input', () => {
	$('speed-value').textContent = speed()+' px/s';
	setContact();
});
$('bypass').addEventListener('click', () => {
	bypassed=!bypassed;
	if (ctx && rawGain && processedGain) {
		const at=ctx.currentTime;
		rawGain.gain.setTargetAtTime(bypassed ? 1 : 0,at,.02);
		processedGain.gain.setTargetAtTime(bypassed ? 0 : 1,at,.02);
	}
	controlState();
	say(bypassed ? 'Dry reference: the same original drum recording, no Scrapheap effect.' :
		'Processed: back to the original drums plus physical metal response.');
});
$('takeoff').addEventListener('click', () => {
	if (!buffers || airborne) return;
	airborne=true;
	setContact();
	controlState();
	say('Airborne: contact rattles rapidly disappear while the original instruments keep playing.');
});
function land(strength) {
	if (!buffers || !airborne) return;
	airborne=false;
	setContact();
	effect()?.set('impact',strength,ctx.currentTime);
	controlState();
	say(strength>.6 ? 'Hard landing: drum-driven metal rattle surges, then dies away.' :
		'Soft landing: a brief, quieter metal-rattle response.');
}
$('soft').addEventListener('click',()=>land(.3));
$('hard').addEventListener('click',()=>land(.9));
window.addEventListener('pagehide',()=>{
	stop();
	ctx?.close();
});
controlState();
