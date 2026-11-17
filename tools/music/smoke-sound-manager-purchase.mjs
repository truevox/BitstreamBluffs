import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const url=process.env.GAME_URL||'http://100.115.120.66:8195/';
const browser=await chromium.launch({headless:true,args:[
	'--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[],http=[];
page.on('pageerror',error=>errors.push(String(error)));
page.on('response',r=>{if(r.status()>=400)http.push([r.status(),r.url()]);});
try{
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
	await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:35000});
	const bought=await page.evaluate(()=>{
		const game=window.__bbGame;
		const progression=game.registry.get('progression');
		const store=progression.store;
		store.save({...store.profile,bank:260});
		game.registry.set('profile',store.profile);
		const scene=game.scene.getScene('TitleScene');
		scene.menu.items.find(i=>i.label==='SETTINGS').onSelect();
		const settings=scene.view;
		settings.menu.items.find(i=>i.label==='MANAGE SOUND').onSelect();
		const sound=settings.soundView;
		const before={
			locked:!sound._unlocked(),
			price:sound.menu.items.find(i=>i.label.startsWith('UNLOCK ORIGINAL VOCALS'))?.label,
		};
		sound.menu.items.find(i=>i.label.startsWith('UNLOCK ORIGINAL VOCALS')).onSelect();
		const after={
			owned:sound._unlocked(),
			bank:store.profile.bank,
			vocalsEnabled:game.registry.get('settings').musicVocals,
			lines:sound.menu.items.map(item=>item.label),
			slidersDisabled:sound.menu.items
				.filter(item=>['VOCALS LEVEL','SYNTH MELODY WITH VOCALS'].includes(item.label))
				.map(item=>item.disabled),
		};
		const vocals=sound.menu.items.find(item=>item.label==='ORIGINAL VOCALS');
		vocals.set(true);
		const enabled={
			profileOwned:game.registry.get('profile')?.unlocked?.musicVocals,
			actualAudioSettings:game.registry.get('audioSynth')?.settings?.musicVocals,
			vocals:game.registry.get('settings').musicVocals,
			director:game.registry.get('audioSynth')._stemMusic.vocals,
			sliders:sound.menu.items
				.filter(item=>['VOCALS LEVEL','SYNTH MELODY WITH VOCALS'].includes(item.label))
				.map(item=>item.disabled),
		};
		const gain=sound.menu.items.find(item=>item.label==='VOCALS LEVEL');
		gain.set(.4);
		const synth=sound.menu.items.find(item=>item.label==='SYNTH MELODY WITH VOCALS');
		synth.set(.6);
		return {before,after,enabled,volumes:{
			vocal:game.registry.get('settings').vocalGain,
			melody:game.registry.get('settings').melodyWithVocalsGain},
		};
	});
	assert.equal(bought.before.locked,true);
	assert.ok(bought.before.price?.includes('200 SHARDS'));
	assert.equal(bought.after.owned,true);
	assert.equal(bought.after.bank,60);
	assert.equal(bought.after.vocalsEnabled,false);
	assert.deepEqual(bought.after.slidersDisabled,[true,true]);
	console.log('PROFILE_VOCAL_ENTITLEMENT_GATE_BROWSER',bought.enabled);
	assert.deepEqual(bought.enabled,{profileOwned:true,actualAudioSettings:true,
		vocals:true,director:true,sliders:[false,false]});
	assert.deepEqual(bought.volumes,{vocal:.4,melody:.6});
	console.log('SHARDS_VOCALS_INDIVIDUAL_DUCKING_BROWSER_PASS',bought);
	await page.reload({waitUntil:'domcontentloaded',timeout:25000});
	await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
	const persisted=await page.evaluate(()=>{
		const game=window.__bbGame;
		const store=game.registry.get('progression').store;
		const s=game.registry.get('settings');
		const sound=game.registry.get('audioSynth');
		return {
			owned:store.profile.unlocked.musicVocals,
			bank:store.profile.bank,
			enabled:s.musicVocals,
			director:sound._stemMusic.vocals,
			wind:s.windVolume,
			vocal:s.vocalGain,
			melody:s.melodyWithVocalsGain,
		};
	});
	assert.deepEqual(persisted,{owned:true,bank:60,enabled:true,
		director:true,wind:1,vocal:.4,melody:.6});
	assert.deepEqual(errors,[]);
	assert.deepEqual(http,[]);
	console.log('SHARDS_VOCALS_SETTING_PERSISTENCE_BROWSER_PASS',persisted);
}finally{await browser.close();}
