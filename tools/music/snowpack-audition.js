import { buildMusicChain } from '../../src/systems/music/MusicFXGraph.js';

const $ = id => document.getElementById(id);
let ctx = null, chain = null, buffer = null, source = null, running = false, burstTimer = null;
const status = message => { $('status').textContent = message; };
const setDepth = (amount, updateSlider = true) => {
	const depth = Math.max(0, Math.min(1, Number(amount) || 0));
	if (updateSlider) $('depth').value = String(depth);
	$('readout').textContent = Math.round(depth * 100) + '%';
	chain?.find('snow')?.set('depth', depth, ctx.currentTime);
};
const stop = () => {
	if (!source) return;
	try { source.stop(); source.disconnect(); } catch {}
	source = null; running = false;
	$('play').textContent = '▶ Play / pause';
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
	if (burstTimer) clearTimeout(burstTimer);
	const normal = Number($('depth').value);
	// A trick or landing can momentarily punch a hole in the acoustic snow.
	chain?.find('snow')?.set('depth', Math.min(.16, normal), ctx.currentTime);
	burstTimer = setTimeout(() => {
		chain?.find('snow')?.set('depth', Number($('depth').value), ctx.currentTime);
		burstTimer = null;
	}, 270);
});
window.addEventListener('pagehide', () => {
	if (burstTimer) clearTimeout(burstTimer);
	stop(); chain?.dispose(); ctx?.close();
});
