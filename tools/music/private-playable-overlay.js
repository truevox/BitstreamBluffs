/**
 * PRIVATE PROOF ONLY. This drives the normal in-game StemMusicDirector,
 * not a separate sample player. Never bundle with public release.
 */
(() => {
	const mountains = [
		['bitstream-bluffs','Bitstream Bluffs · arcade chip'],
		['debumont','Debumont'],
		['garbage-dump-glacier','Garbage Dump Glacier'],
		['pyramid-peak','Pyramid Peak'],
		['underwater-mountain','Underwater Mountain'],
		['crystal-cavern','Crystal Cavern'],
		['space-mountain','Space Mountain'],
		['candy-cane-canyon','Candy Cane Canyon'],
		['sky-jellyfish-mountain','Sky Jellyfish Mountain'],
		['steampunk-slopes','Steampunk Slopes'],
		['micro-mountain','Micro Mountain'],
		['vertigo-vents','Vertigo Vents · Gentle organ'],
	];
	const tracks = [
		['FEsxYVStla4','Pope Leo Wants the AI Root Password'],
		['one-more-run-bitstream-bluffs','One More Run'],
	];
	const css = document.createElement('style');
	css.textContent = [
		'#bb-private-demo {position:fixed;z-index:99999;top:10px;right:10px;width:min(350px,92vw);',
		'padding:10px 12px;background:rgba(10,12,27,.94);color:#f0f0f6;',
		'border:1px solid #62dfe4;border-radius:12px;box-shadow:0 4px 28px #000b;',
		'font:14px/1.35 system-ui,sans-serif;}',
		'#bb-private-demo * {box-sizing:border-box}',
		'#bb-private-demo summary{cursor:pointer;font-weight:700;color:#7df4dd;user-select:none}',
		'#bb-private-demo .bb-controls{display:grid;gap:8px;margin:12px 0 5px}',
		'#bb-private-demo label{display:grid;gap:2px;font-size:12px;color:#ddd}',
		'#bb-private-demo select,#bb-private-demo button{background:#202540;color:#fff;',
		'border:1px solid #7a83af;border-radius:6px;padding:8px;max-width:100%;font:inherit}',
		'#bb-private-demo button{cursor:pointer;background:#263a41;border-color:#6ae8da;font-weight:700}',
		'#bb-private-demo .bb-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
		'#bb-private-demo .bb-small{font-size:11px;color:#b8c6d4}',
		'#bb-proof-status{font-size:12px;color:#adeadc;min-height:34px;word-break:break-word}',
		'#bb-proof-status.bb-error{color:#ffa7c7}',
	].join('');
	document.head.append(css);
	const panel = document.createElement('details');
	panel.id = 'bb-private-demo';
	panel.open = true;
	panel.innerHTML = [
		'<summary>🎵 PRIVATE GAME AUDIO TEST · 2 songs × 12 mountains</summary>',
		'<div class="bb-controls">',
		'<label>Song<select id="bb-proof-track"></select></label>',
		'<label>Mountain instrument<select id="bb-proof-mountain"></select></label>',
		'<div class="bb-actions">',
		'<button type="button" id="bb-proof-play">▶ Hear it now</button>',
		'<button type="button" id="bb-proof-apply">🎹 Change voice</button>',
		'</div><div id="bb-proof-status" aria-live="polite">Loading the real game music engine…</div>',
		'<div class="bb-small">This uses Bitstream Bluffs itself, with six synchronized backing',
		'stems and twelve switchable melodic voices. Press Hear it now on the',
		'title screen or Start Run to play and ride. In-game biome events can',
		'change the voice naturally; select a mountain here to hear it again.</div>',
		'<div class="bb-small">Private research build. No pretrained weights shipped.',
		' <a style="color:#7df4dd" href="/streamers.html">Streamers welcome</a>.</div>',
		'</div>',
	].join('');
	document.body.append(panel);
	for (const type of ['keydown','keyup','pointerdown','pointerup','mousedown','mouseup','click','touchstart']) {
		panel.addEventListener(type,e=>e.stopPropagation());
	}
	const song=panel.querySelector('#bb-proof-track');
	const voice=panel.querySelector('#bb-proof-mountain');
	const message=panel.querySelector('#bb-proof-status');
	for (const item of tracks) song.add(new Option(item[1],item[0]));
	for (const item of mountains) voice.add(new Option(item[1],item[0]));
	voice.value='vertigo-vents';
	let activeUserChange=0;
	const get=()=>{
		const game=window.__bbGame;
		const audio=game?.registry?.get('audioSynth');
		return {audio,p:audio?._musicProvider};
	};
	function notify(text,error=false){
		message.classList.toggle('bb-error',error);
		message.textContent=text;
	}
	async function choose(start=false){
		const {audio,p}=get();
		if(!audio||!p?.ready){
			notify('Audio catalog is loading; try again after a moment.',true);
			return false;
		}
		const index=p.catalog.findIndex(x=>x.id===song.value);
		if(index<0){notify('Song is missing from private music catalog.',true);return false;}
		p.trackIndex=index;
		if(start){
			audio.unlock();
			audio.startMusic('private-biome-proof');
		}
		if(p.started && p.track && p.track.id!==song.value && p.ctx?.state==='running'){
			await p._beginTrack(index,p.ctx.currentTime+0.15);
		}
		if(p.lastError){notify('Audio provider error: '+p.lastError,true);return false;}
		p.setBiome(voice.value);
		activeUserChange=Date.now();
		notify('Selected '+voice.selectedOptions[0]?.textContent+' · '+song.selectedOptions[0]?.textContent);
		return true;
	}
	panel.querySelector('#bb-proof-play').addEventListener('click',()=>choose(true).catch(e=>notify(String(e),true)));
	panel.querySelector('#bb-proof-apply').addEventListener('click',()=>choose(false).catch(e=>notify(String(e),true)));
	song.addEventListener('change',()=>choose(false).catch(e=>notify(String(e),true)));
	voice.addEventListener('change',()=>{
		const {p}=get();
		if(!p?.ready){notify('Music is still loading.',true);return;}
		p.setBiome(voice.value);
		activeUserChange=Date.now();
		notify('Selected '+voice.selectedOptions[0]?.textContent);
	});
	const timer=setInterval(()=>{
		if(!panel.isConnected){clearInterval(timer);return;}
		const {p}=get();
		if(!p?.ready||Date.now()-activeUserChange<2200)return;
		if(p.lastError){notify('Audio engine: '+p.lastError,true);return;}
		const elapsed=p.ctx&&p.clockStart!==null?Math.max(0,p.ctx.currentTime-p.clockStart):0;
		notify((p.track?.title||'Ready to start')+' · '+elapsed.toFixed(1)+'s · '+p.biome+
			' · '+(p.started?'playing':'idle'));
	},900);
})();
