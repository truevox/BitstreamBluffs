import { buildMusicChain } from '../../src/systems/music/MusicFXGraph.js';

const $ = id => document.getElementById(id);
let ctx = null, chain = null, buffer = null, source = null, running = false, airborne = false;
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
	if (ctx) setDepth($('depth').value, false);
};
const ensureContext = async () => {
	if (!ctx) {
		ctx = new AudioContext();
		chain = buildMusicChain(ctx, [{ type: 'snowpack', id: 'snow', depth: Number($('depth').value) }], ctx.destination);
	}
	await ctx.resume();
};
$('file').addEventListener('change', async () => {
	stop();
	const file = $('file').files?.[0];
	if (!file) return;
	$('play').disabled = true; $('burst').disabled = true;
	try {
		await ensureContext();
		buffer = await ctx.decodeAudioData(await file.arrayBuffer());
		$('play').disabled = false; $('burst').disabled = false;
		status(file.name + ' • ' + buffer.duration.toFixed(1) + ' seconds • ready to audition');
	} catch (error) {
		buffer = null;
		status('Could not decode that file: ' + String(error.message || error));
	}
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
	setDepth($('depth').value, false);
	status(airborne ? 'Airborne: original recording opens up above the snow.' : 'Landing: powder settles around the original recording.');
});
window.addEventListener('pagehide', () => {
	stop(); chain?.dispose(); ctx?.close();
});
