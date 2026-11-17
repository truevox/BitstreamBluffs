/**
 * Real 48kHz WebAudio A/B player for the private first-pass orchestra mixes.
 * Playback continues at the same sample-clock offset when selecting biomes.
 * Master Ogg assets are loaded lazily and never altered.
 */
const $ = id => document.getElementById(id);
const palette = {
	'debumont':'🏠','garbage-dump-glacier':'♻️','pyramid-peak':'🏜️',
	'underwater-mountain':'🌊','crystal-cavern':'💎','space-mountain':'🪐',
	'candy-cane-canyon':'🍬','sky-jellyfish-mountain':'☁️',
	'steampunk-slopes':'⚙️','micro-mountain':'🔬','vertigo-vents':'🌋',
};
const diagnosticBiome = {
	id:'sine-timing-lab',label:'Sine / Timing Reference',
	orchestra:'Flat Sine Timing Bench',
	description:'Dry 1ms-gated sine notes for original vocal melody, extracted bass and scored featured accompaniment. 3–10ms electronic drum clicks. NO source backing, SoundFonts, envelopes, effects, room or artificial delay.',
};
const state = {
	catalog:null,song:'pope',biome:'debumont',
	lastRealRevision:'controlled',lastRealAccompaniment:'new',
	arrangement:'orchestra',terrain:'air',revision:'controlled',accompaniment:'new',vocals:false,
	ctx:null,master:null,main:null,voice:null,
	playing:false,position:0,startClock:0,
	request:0,vocalRequest:0,cache:new Map(),
};

function getSong(){
	return state.catalog?.songs.find(song=>song.id===state.song);
}
function isDiagnostic(){return state.biome===diagnosticBiome.id;}
function getBiome(){
	if(isDiagnostic())return diagnosticBiome;
	return state.catalog?.biomes.find(row=>row.id===state.biome);
}
function clockText(seconds){
	const count=Math.max(0,Math.floor(seconds));
	return Math.floor(count/60)+':'+String(count%60).padStart(2,'0');
}
function playPosition(){
	if (!state.playing||!state.ctx)return state.position;
	return Math.max(0,Math.min(32,state.ctx.currentTime-state.startClock));
}
function desiredPath(){
	const song=getSong();
	if(!song)throw new Error('Missing song');
	if(state.arrangement==='original')return song.id+'/'+song.originalReference;
	if(isDiagnostic()){
		if(state.accompaniment==='stock')throw new Error('Stock audio has no sine note score. Select Current orchestra.');
		return 'revisions/diagnostic/'+song.id+'/'+state.accompaniment+'.ogg';
	}
	if(state.revision==='controlled'){
		return 'revisions/controlled-'+state.accompaniment+'/'+song.id+'/'+
			song.variants[state.biome][state.terrain];
	}
	if(state.revision==='rhythm' && state.accompaniment!=='new'){
		return 'revisions/accompaniment-'+state.accompaniment+'/'+song.id+'/'+
			song.variants[state.biome][state.terrain];
	}
	const prefix=state.revision==='original'?'':('revisions/'+state.revision+'/');
	return prefix+song.id+'/'+song.variants[state.biome][state.terrain];
}
function setStatus(text){
	$('status').textContent=text;
}
async function audio(){
	if(!state.ctx){
		state.ctx=new AudioContext({latencyHint:'interactive'});
		state.master=state.ctx.createGain();
		state.master.gain.value=.73;
		state.master.connect(state.ctx.destination);
	}
	await state.ctx.resume();
	return state.ctx;
}
async function decoded(path){
	if (!state.ctx)await audio();
	if(!state.cache.has(path)){
		const promise=(async()=>{
			const response=await fetch(path,{cache:'force-cache'});
			if(!response.ok)throw new Error('Missing audio '+path+' ('+response.status+')');
			const bytes=await response.arrayBuffer();
			const buffer=await state.ctx.decodeAudioData(bytes);
			if(buffer.duration<31.7)throw new Error('Audio clip unexpectedly short: '+path);
			return buffer;
		})().catch(error=>{
			state.cache.delete(path);
			throw error;
		});
		state.cache.set(path,promise);
	}
	return state.cache.get(path);
}
function startSlot(buffer,position=0,level=1,fade=.22,scheduledBegin=null){
	const ctx=state.ctx;
	const begin=scheduledBegin===null?ctx.currentTime+.028:scheduledBegin;
	const node=ctx.createBufferSource();
	const gain=ctx.createGain();
	node.buffer=buffer;
	node.connect(gain);
	gain.connect(state.master);
	gain.gain.setValueAtTime(fade?0:level,begin);
	if(fade)gain.gain.linearRampToValueAtTime(level,begin+fade);
	const offset=Math.max(0,Math.min(31.95,position));
	node.start(begin,offset);
	return {node,gain,begin,offset};
}
function stopSlot(slot,fade=.2,at=null){
	if(!slot)return;
	const begin=at===null?(state.ctx?.currentTime||0):at;
	try{
		slot.gain.gain.cancelScheduledValues(begin);
		slot.gain.gain.setValueAtTime(slot.gain.gain.value,begin);
		slot.gain.gain.linearRampToValueAtTime(0,begin+fade);
		slot.node.stop(begin+fade+.06);
	}catch{}
}
function flags(){
	for(const button of document.querySelectorAll('#versions button[data-revision]')){
		button.setAttribute('aria-pressed',String(button.dataset.revision===state.revision));
		button.disabled=state.arrangement==='original'||isDiagnostic();
	}
	for(const button of document.querySelectorAll('#accompaniment button[data-accompaniment]')){
		button.setAttribute('aria-pressed',String(button.dataset.accompaniment===state.accompaniment));
		button.disabled=state.arrangement==='original'||!['rhythm','controlled'].includes(state.revision)||
			(isDiagnostic()&&button.dataset.accompaniment==='stock')||
			(button.dataset.accompaniment==='reattacks'&&state.song!=='pope');
	}
	for(const [button,active] of [
		['original',state.arrangement==='original'],
		['new',state.arrangement==='orchestra'],
		['ground',state.terrain==='ground'],
		['air',state.terrain==='air'],
	]){
		$(button).setAttribute('aria-pressed',String(active));
	}
	$('ground').disabled=state.arrangement==='original'||isDiagnostic();
	$('air').disabled=state.arrangement==='original'||isDiagnostic();
	$('new').textContent=isDiagnostic()?'Sine timing reference':'Biome orchestra';
	const current=$('accompaniment').querySelector('[data-accompaniment="new"]');
	if(current)current.textContent=isDiagnostic()?'Detected note score':'Current orchestra';
	$('vocal').checked=state.vocals;
	$('play').textContent=state.playing?'❚❚ Pause':'▶ Play';
	$('seek').value=Math.min(32,playPosition());
	$('current').textContent=clockText(playPosition());
}
function display(){
	const song=getSong(),biome=getBiome();
	if(!song||!biome)return;
	$('orchestra').textContent=biome.orchestra;
	$('description').textContent=biome.description;
	$('sourceInfo').textContent=isDiagnostic()
		? 'LAB ONLY • '+song.featured.toUpperCase()+' note clock + lead + bass + V3 percussion clicks • NO original accompaniment audio • source excerpt '+song.excerptStartSeconds.toFixed(0)+'s'
		: 'Re-performed featured stem: '+song.featured.toUpperCase()
			+' • '+song.unselectedPreserved.map(name=>name.toUpperCase()).join(' + ')
			+' are ALWAYS original • '+song.excerptStartSeconds.toFixed(0)
			+'s source start';
	const status={stock:'Original Guitar + Piano + Other, unchanged at source timing.',
		new:'Current re-performance of '+song.featured.toUpperCase()+'; the other two are stock.',
		aligned:'Experimental source-transient retiming of '+song.featured.toUpperCase()+
			'; same notes/timbres. Not human-verified.',
		reattacks:'Pope only: experimental 18 new same-pitch retriggers within long Other notes. No new pitches or octave deletions. Not human-verified.'};
	$('accompExplanation').textContent=isDiagnostic()
		? ({
			new:'Current detected '+song.featured.toUpperCase()+' notes: immediate flat sine onsets. Other notes and drum clicks are identical across timing variants.',
			aligned:'Same sine note pitches and durations; onset times move per the source-transient-aligned candidate.',
			reattacks:'Pope only: same pure sine score with 18 proposed repeated attacks. Brief right-channel ticks mark featured-note onsets.',
		})[state.accompaniment]
		: status[state.accompaniment];
	for(const button of $('biomes').querySelectorAll('button[data-biome]')){
		button.setAttribute('aria-pressed',String(button.dataset.biome===state.biome));
	}
	flags();
}
async function vocalSync(){
	const token=++state.vocalRequest;
	if(!state.playing||!state.vocals){
		stopSlot(state.voice,.13);
		state.voice=null;
		return;
	}
	try{
		const path=getSong().id+'/'+getSong().vocals;
		const buffer=await decoded(path);
		if(token!==state.vocalRequest||!state.vocals||!state.playing)return;
		// This timestamp is on the SAME immutable song clock as the main
		// music; asynchronous fetch/decode must never pull vocals backwards.
		const begin=state.ctx.currentTime+.028;
		const position=Math.max(0,Math.min(31.95,begin-state.startClock));
		const old=state.voice;
		state.voice=startSlot(buffer,position,.72,.16,begin);
		stopSlot(old,.14,begin);
	}catch(error){
		setStatus('Could not add Maxi vocal: '+String(error.message||error));
	}
}
async function swap(){
	const token=++state.request;
	const next=desiredPath();
	setStatus('Loading '+(state.arrangement==='original'?'original':state.revision+' orchestra')+' audio…');
	try{
		const buffer=await decoded(next);
		if(token!==state.request)return;
		if(!state.playing){
			setStatus('Ready. Press Play to hear '+getBiome().orchestra+'.');
			return;
		}
		// The audio source that begins in the FUTURE must start at that
		// FUTURE song offset. Never restart the shared song clock on a swap.
		// The old playing slot and original vocal continue on that clock.
		const begin=state.ctx.currentTime+.028;
		const position=Math.max(0,Math.min(31.95,begin-state.startClock));
		const old=state.main;
		state.main=startSlot(buffer,position,1,.22,begin);
		stopSlot(old,.22,begin);
		setStatus('Playing '+(state.arrangement==='original'?'original song':'orchestra')+' · '+getBiome().orchestra);
		flags();
	}catch(error){
		if(token===state.request){
			setStatus('Could not load new recording: '+String(error.message||error));
		}
	}
}
async function play(){
	if(state.playing)return;
	try{
		await audio();
		const token=++state.request;
		const buffer=await decoded(desiredPath());
		if(token!==state.request||state.playing)return;
		state.main=startSlot(buffer,state.position,1,.05);
		state.startClock=state.main.begin-state.position;
		state.playing=true;
		flags();
		setStatus('Playing · '+getBiome().orchestra);
		await vocalSync();
	}catch(error){
		setStatus('Playback error: '+String(error.message||error));
	}
}
function pause(){
	if(!state.playing)return;
	state.position=playPosition();
	state.playing=false;
	++state.request;
	++state.vocalRequest;
	stopSlot(state.main,.09);
	stopSlot(state.voice,.09);
	state.main=null;state.voice=null;
	setStatus('Paused at '+clockText(state.position)+'.');
	flags();
}
function changeBiome(id){
	if(state.biome===id)return;
	const wasDiagnostic=isDiagnostic();
	if(id===diagnosticBiome.id){
		state.lastRealRevision=state.revision;
		state.lastRealAccompaniment=state.accompaniment;
		state.revision='controlled';
		if(state.accompaniment==='stock')state.accompaniment='new';
	}else if(wasDiagnostic){
		state.revision=state.lastRealRevision||'controlled';
		state.accompaniment=state.lastRealAccompaniment||'new';
	}
	state.biome=id;
	display();
	swap();
}
function changeArrangement(mode){
	if(state.arrangement===mode)return;
	state.arrangement=mode;
	display();
	swap();
}
function changeRevision(version){
	if(isDiagnostic())return;
	if(!['original','articulation','orchestral','rhythm','controlled'].includes(version))return;
	if(state.revision===version)return;
	state.revision=version;
	flags();
	if(state.arrangement==='orchestra')swap();
}
function changeAccompaniment(mode){
	if(isDiagnostic()&&mode==='stock')return;
	if(!['stock','new','aligned','reattacks'].includes(mode)||state.accompaniment===mode)return;
	if(mode==='reattacks'&&state.song!=='pope')return;
	state.accompaniment=mode;
	display();
	if(state.arrangement==='orchestra'&&['rhythm','controlled'].includes(state.revision))swap();
}
function changeTerrain(mode){
	if(isDiagnostic())return; // Both phases use the same dry high-resolution click score.
	if(state.terrain===mode)return;
	state.terrain=mode;
	display();
	if(state.arrangement==='orchestra')swap();
}
async function changeSong(song){
	if(song===state.song)return;
	const restart=state.playing;
	pause();
	state.song=song;
	if(song!=='pope'&&state.accompaniment==='reattacks')state.accompaniment='new';
	state.position=0;
	$('seek').value=0;
	display();
	if(restart)await play();
	else await swap();
}
function tick(){
	if(state.playing){
		const position=playPosition();
		$('seek').value=Math.min(32,position);
		$('current').textContent=clockText(position);
		if(position>=31.95){
			pause();
			state.position=0;
			// An explicit 32s loop for continuous A/B listening.
			play();
		}
	}
	requestAnimationFrame(tick);
}
async function init(){
	try{
		const response=await fetch('catalog.json',{cache:'no-cache'});
		if(!response.ok)throw new Error('No orchestra library on this server');
		const cat=await response.json();
		if(cat.format!=='bitstream-orchestra-auditions-v1'||
			cat.songs?.length!==2||cat.biomes?.length!==11){
			throw new Error('Unexpected orchestra catalog structure');
		}
		state.catalog=cat;
		for(const song of cat.songs){
			const option=document.createElement('option');
			option.value=song.id;
			option.textContent=song.title;
			$('song').append(option);
		}
		for(const row of [...cat.biomes,diagnosticBiome]){
			const button=document.createElement('button');
			button.type='button';
			button.className='biome';
			button.dataset.biome=row.id;
			button.textContent=(row.id===diagnosticBiome.id?'🧪 ':palette[row.id]||'🎵 ') +row.label;
			const sub=document.createElement('span');
			sub.textContent=row.orchestra;
			button.append(sub);
			button.addEventListener('click',()=>changeBiome(row.id));
			$('biomes').append(button);
		}
		$('song').value=state.song;
		$('song').addEventListener('change',event=>changeSong(event.target.value));
		for(const button of document.querySelectorAll('#versions button[data-revision]')){
			button.addEventListener('click',()=>changeRevision(button.dataset.revision));
		}
		for(const button of document.querySelectorAll('#accompaniment button[data-accompaniment]')){
			button.addEventListener('click',()=>changeAccompaniment(button.dataset.accompaniment));
		}
		$('original').addEventListener('click',()=>changeArrangement('original'));
		$('new').addEventListener('click',()=>changeArrangement('orchestra'));
		$('ground').addEventListener('click',()=>changeTerrain('ground'));
		$('air').addEventListener('click',()=>changeTerrain('air'));
		$('vocal').addEventListener('change',event=>{
			state.vocals=event.target.checked;
			vocalSync();
		});
		$('play').addEventListener('click',()=>state.playing?pause():play());
		$('seek').addEventListener('change',async event=>{
			const value=Math.max(0,Math.min(31.95,Number(event.target.value)||0));
			const restart=state.playing;
			if(restart)pause();
			state.position=value;
			flags();
			if(restart)await play();
		});
		document.addEventListener('keydown',event=>{
			if(event.code==='Space'&&event.target.tagName!=='SELECT'&&
				event.target.tagName!=='BUTTON'&&event.target.tagName!=='INPUT'){
				event.preventDefault();
				if(state.playing)pause();
				else play();
			}
		});
		display();
		setStatus('Ready. All audio remains private on this server.');
		requestAnimationFrame(tick);
		// Author diagnostics, never a download or persistent external save.
		window.orchestraDebug={state};
	}catch(error){
		setStatus('Unable to start orchestra lab: '+String(error.message||error));
	}
}
init();
