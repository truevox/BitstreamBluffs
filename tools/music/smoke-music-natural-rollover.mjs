/** Live Chromium/regression of NATURAL song end while on menu. No release mutation. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.GAME_URL||'http://100.115.120.66:8197/';
const browser=await chromium.launch({headless:true,args:['--no-sandbox',
	'--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[],http=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(r.status()>=400)http.push([r.status(),r.url()]);});
const info=()=>page.evaluate(()=>{
	const g=window.__bbGame;
	const d=g?.registry?.get('audioSynth')?._stemMusic;
	return {id:d?.track?.id,index:d?.trackIndex,menuMode:d?.menuMode,voice:d?._activeVoiceFor(d?.pack),
		clock:d?.clockStart,position:d?.clockStart!=null&&d.ctx?
			d.ctx.currentTime-d.clockStart:null,
		duration:d?.pack?.duration,started:d?.started,
		paused:d?.transportPaused,
		shuffle:d?.shuffleEnabled,next:d?.transportSnapshot()?.upcoming?.[0]?.id,
		audioState:d?.ctx?.state};
});
const ready=()=>page.waitForFunction(()=>{
	const d=window.__bbGame?.registry?.get('audioSynth')?._stemMusic;
	return d?.started&&d?.pack&&d?.clockStart!=null&&d?.ctx?.state==='running'
		&&d.activeNodes.size>=6;
},null,{timeout:45000});
const fastForwardToNaturalEnd=async(expectedMenuMode=true)=>{
	const old=await info();
	assert.ok(old.started&&old.duration>10);
	const sought=await page.evaluate(()=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return d.seekTo(d.pack.duration-1.7);
	});
	assert.equal(sought,true);
	await page.waitForFunction(prev=>{
		const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
		return d.track?.id!==prev && d.clockStart!==null;
	},old.id,{timeout:35000});
	const next=await info();
	assert.notEqual(next.id,old.id);
	assert.equal(next.menuMode,expectedMenuMode);
	assert.equal(next.started,true);
	console.log('NATURAL_END_ADVANCED',JSON.stringify({from:old.id,to:next.id,
		shuffle:next.shuffle,expectedNext:old.next,position:next.position}));
	return {old,next};
};
try{
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
	await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
	await page.keyboard.press('x');
	await ready();
	const first=await info();
	assert.equal(first.id,'local-one-more-run-bitstream-bluffs');
	assert.equal(first.menuMode,true);
	console.log('FIRST_SONG',JSON.stringify(first));
	// Run/death changes presentation, not current source position.
	await page.evaluate(()=>{
		const g=window.__bbGame;
		g.events.emit('bb:runStart',{seed:'natural-end-scene'});
		g.events.emit('bb:runEnd',{cause:'crash'});
	});
	const after=await info();
	assert.equal(after.clock,first.clock);
	assert.equal(after.id,first.id);
	assert.equal(after.menuMode,true);
	console.log('MENU_CRASH_CONTINUITY_PASS');
	const sequential=await fastForwardToNaturalEnd();
	assert.equal(sequential.next.id,'WRBGQUqD54U');
	console.log('NATURAL_SEQUENTIAL_PLAYLIST_ADVANCE_PASS');
	// Official user-facing settings event and saved persistent setting.
	const set=await page.evaluate(()=>{
		const g=window.__bbGame;
		const current=g.registry.get('settings');
		const newer={...current,musicShuffle:true};
		g.registry.set('settings',newer);
		g.events.emit('bb:settingsChanged',{settings:newer,key:'musicShuffle',value:true});
		const d=g.registry.get('audioSynth')._stemMusic;
		return d.shuffleEnabled;
	});
	assert.equal(set,true);
	const seen=new Set([(await info()).id]);
	for(let i=0;i<3;i++){
		await ready();
		const before=await info();
		const result=await fastForwardToNaturalEnd();
		assert.equal(result.next.id,before.next,
			'Music chosen at the natural ending must match its previewed next song');
		assert.equal(seen.has(result.next.id),false,
			'Shuffle repeated an enabled song in the same round');
		seen.add(result.next.id);
	}
	assert.equal(seen.size,4);
	console.log('NATURAL_SHUFFLE_FULL_NO_REPEAT_ROUND_PASS', [...seen]);
	// In an actual run the same song clock continues with biome lead, and
	// the natural next song stays in that biome; death returns to menu lead.
	await page.evaluate(()=>{
		const g=window.__bbGame;
		g.events.emit('bb:runStart',{seed:'rollover-under-active-run'});
		g.events.emit('bb:biomeEnter',{id:'crystal-cavern'});
	});
	const activeRun=await info();
	assert.equal(activeRun.menuMode,false);
	assert.equal(activeRun.voice,'voice:crystal-cavern');
	const runRollover=await fastForwardToNaturalEnd(false);
	assert.equal(runRollover.next.voice,'voice:crystal-cavern');
	await page.evaluate(()=>window.__bbGame.events.emit('bb:runEnd',{cause:'crash'}));
	const died=await info();
	assert.equal(died.menuMode,true);
	assert.equal(died.voice,'voice:debumont');
	assert.equal(died.clock,runRollover.next.clock);
	assert.equal(died.id,runRollover.next.id);
	console.log('RUN_ROLLOVER_AND_CRASH_DEBUMONT_WITHOUT_RESTART_PASS',JSON.stringify(died));
	assert.deepEqual(errors,[]);
	assert.deepEqual(http,[]);
	console.log('REAL_CHROMIUM_NATURAL_END_SOUNDTRACK_GATE_PASS');
} finally {await browser.close();}
