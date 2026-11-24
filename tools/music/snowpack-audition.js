import {attachAuditionExtra} from './AuditionExtra.js';
import { buildMusicChain } from '../../src/systems/music/MusicFXGraph.js';

const $ = id => document.getElementById(id);
let ctx = null, chain = null, buffer = null, source = null, running = false, airborne = false, extraEnhancer = null;
const status = message => { $('status').textContent = message; };
const setDepth = (amount, updateSlider = true) => {
	const depth = Math.max(0, Math.min(1, Number(amount) || 0));
	if (updateSlider) $('depth').value = String(depth);
	$('readout').textContent = Math.round(depth * 100) + '%';
	chain?.find('snow')?.set('depth', airborne ? 0 : depth, ctx.currentTime);
};
const stop = () => {
	if (!source) return;
	try { source.stop(); source.disconnect(); } catch {}
	source = null; running = false;
	$('play').textContent = '▶ Play / pause';
	airborne = false;
	$('burst').textContent = '🏂 Jump — leave powder';
	$('hard').disabled = true;
	if (ctx) setDepth($('depth').value, false);
};
const ensureContext = async () => {
	if (!ctx) {
		ctx = new AudioContext();
		const processed=ctx.createGain();
		processed.connect(ctx.destination);
		chain = buildMusicChain(ctx, [{ type: 'snowpack', id: 'snow', depth: Number($('depth').value) }], processed);
		extraEnhancer=attachAuditionExtra(ctx,processed,ctx.destination);
	}
	await ctx.resume();
};
async function loadAudio(data, label) {
	stop();
	$('play').disabled = true; $('burst').disabled = true; $('hard').disabled = true;
	try {
		await ensureContext();
		buffer = await ctx.decodeAudioData(data);
		$('play').disabled = false; $('burst').disabled = false;
		status(label + ' • ' + buffer.duration.toFixed(1) + ' seconds • ready to audition');
	} catch (error) {
		buffer = null;
		status('Could not decode that recording: ' + String(error.message || error));
	}
}
$('file').addEventListener('change', async () => {
	const file = $('file').files?.[0];
	if (file) await loadAudio(await file.arrayBuffer(), file.name);
});
$('demo').addEventListener('click', async () => {
	status('Loading original instrument sample…');
	try {
		const response = await fetch('/audition-loops/pope-leo/mix.ogg');
		if (!response.ok) throw new Error('Sample unavailable');
		await loadAudio(await response.arrayBuffer(), 'Pope Leo / original instrumental stems');
	} catch (error) { status('Sample unavailable: ' + String(error.message || error)); }
});
$('play').addEventListener('click', async () => {
	if (running) { stop(); status('Stopped. Press Play to restart from the beginning.'); return; }
	if (!buffer) return;
	await ensureContext();
	source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
	source.connect(chain.input); source.start();
	running = true; $('play').textContent = '■ Stop';
	status('Looping original recording through the Snowpack processor.');
});
$('depth').addEventListener('input', event => {
	$('preset').value = '';
	setDepth(event.target.value, false);
});
$('preset').addEventListener('change', event => setDepth(event.target.value));
$('burst').addEventListener('click', () => {
	if (!buffer) return;
	airborne = !airborne;
	$('burst').textContent = airborne ? '🛬 Land — back into powder' : '🏂 Jump — leave powder';
	$('hard').disabled = !airborne;
	setDepth($('depth').value, false);
	if (!airborne) chain?.find('snow')?.set('impact', 0.25, ctx.currentTime);
	status(airborne ? 'Airborne: original recording opens up above the snow.' : 'Soft landing: quick extra burial, then a slow return to powder.');
});
$('hard').addEventListener('click', () => {
	if (!buffer || !airborne) return;
	airborne = false;
	$('hard').disabled = true;
	$('burst').textContent = '🏂 Jump — leave powder';
	setDepth($('depth').value, false);
	chain?.find('snow')?.set('impact', 0.85, ctx.currentTime);
	status('Hard landing: deeper snow burial pulse, then gradual resettling.');
});
window.addEventListener('pagehide', () => {
	stop(); extraEnhancer?.dispose(); chain?.dispose(); ctx?.close();
});
