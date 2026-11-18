import { chromium } from 'playwright';
const url=process.env.GAME_URL || 'http://127.0.0.1:8207/';
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const faults=[];
page.on('pageerror',x=>faults.push(String(x)));
try {
	await page.goto(url,{waitUntil:'domcontentloaded'});
	await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
	const settings=await page.evaluate(()=>{
		const g=window.__bbGame,t=g.scene.getScene('TitleScene');
		t.menu.items.find(i=>i.label==='SETTINGS').onSelect();
		const menu=t.view.menu.items;
		return {hasToggle:menu.some(i=>i.label==='WIND'),height:t.view.h,windEnabled:g.registry.get('settings').windEnabled};
	});
	console.log('SETTINGS',settings);
	await page.evaluate(()=>{const t=window.__bbGame.scene.getScene('TitleScene');t._closeView();t.startRun('bsod-contract-smoke')});
	await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:20000});
	await page.waitForTimeout(500);
	const state=await page.evaluate(()=>{
		const g=window.__bbGame,r=g.scene.getScene('RunScene');
		window.__testBsodMessages=[];
		g.events.on('bb:bsodStateChanged',s=>window.__testBsodMessages.push(s));
		return {active:r.bsod?.active,gap:r.bsodState?.gapPx,wall:r.bsod?.wallX,sled:r.sled?.x,fields:Object.keys(r.bsodState||{})};
	});
	console.log('RUN_INITIAL',state);
	await page.evaluate(()=>{
		const r=window.__bbGame.scene.getScene('RunScene');
		r.bsod.wallX=r.sled.body.bounds.min.x-2;
		r.bsod.wallSpeedPxS=10000;
	});
	await page.waitForTimeout(450);
	const crash=await page.evaluate(()=>{
		const g=window.__bbGame,r=g.scene.getScene('RunScene');
		return {crashed:r.crashed,lastCrash:g.registry.get('lastCrash'),messages:window.__testBsodMessages?.slice(-4)};
	});
	console.log('AFTER_CATCH',JSON.stringify({crashed:crash.crashed,cause:crash.lastCrash?.cause,name:crash.lastCrash?.name,events:crash.messages?.map(x=>({active:x.active,gapPx:x.gapPx}))}));
	console.log('PAGE_ERRORS',faults.slice(0,10));
	if(faults.length||!settings.hasToggle||settings.windEnabled!==true||!state.active||!state.fields.includes('relativeAirX')||!crash.crashed||crash.lastCrash?.cause!=='bsod'||!crash.messages?.some(x=>x.active===false))process.exitCode=1;
}finally{await browser.close()}
