import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from 'playwright';
const port=await new Promise(resolve=>{
	const s=createServer();
	s.listen(0,'127.0.0.1',()=>{
		const p=s.address().port;
		s.close(()=>resolve(p));
	});
});
const base='http://127.0.0.1:'+port;
const vite=spawn('./node_modules/.bin/vite',['--host','127.0.0.1','--port',String(port),'--strictPort'],{
	cwd:process.cwd(),stdio:'ignore',env:{...process.env,BROWSER:'none'}
});
let browser;
try{
	let ready=false;
	for(let i=0;i<200;i++){
		try{const r=await fetch(base+'/');if(r.ok){ready=true;break;}}catch{}
		await new Promise(r=>setTimeout(r,100));
	}
	if(!ready)throw Error('Vite did not start');
	browser=await chromium.launch({
		headless:true,executablePath:'/usr/bin/chromium',
		args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
			'--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--mute-audio']
	});
	const page=await browser.newPage({viewport:{width:960,height:540}});
	const errors=[];
	page.on('pageerror',e=>errors.push(e.message));
	await page.goto(base+'/',{waitUntil:'networkidle'});
	await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),{timeout:45000});
	const result=await page.evaluate(async()=>{
		const {SettingsView}=await import('/src/ui/Views.js');
		const scene=window.__bbGame.scene.getScene('TitleScene');
		scene._openView(new SettingsView(scene,scene.theme,{onClose:()=>scene._closeView()}));
		const view=scene.view;
		const items=view.menu.items;
		const last=items.at(-1);
		const rowH=view.menu.rowH;
		const y=view.menu.y;
		const end=y+rowH*items.length;
		const original=window.open;
		let invoked=null;
		window.open=(...args)=>{invoked=args;return null;};
		last.onSelect();
		window.open=original;
		return {
			settingsRows:items.length,lastLabel:last.label,rowH,menuEnd:end,
			palettePreviewY:view.h-20,backButtonY:view.back.y,
			policyOpened:invoked,screenTitle:scene.scene.key
		};
	});
	await page.screenshot({path:'/tmp/bitstream-settings-streamer-smoke.png'});
	const policy=await page.request.get(base+'/streamers.html');
	const html=await policy.text();
	console.log(JSON.stringify({result,policyStatus:policy.status(),policyText:html.includes('Monetize your gameplay'),
		errors},null,2));
	if(result.settingsRows!==10||result.rowH!==15||result.menuEnd>result.palettePreviewY ||
		!result.lastLabel.includes('STREAMING')||
		!result.policyOpened?.[0]?.endsWith('/streamers.html')||policy.status()!==200||
		errors.length)process.exitCode=1;
}finally{
	if(browser)await browser.close();
	vite.kill('SIGTERM');
}
