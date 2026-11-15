import {chromium} from 'playwright';
const origin='http://100.115.120.66:8182';
const b=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',
	args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader','--autoplay-policy=no-user-gesture-required']});
const p=await b.newPage({viewport:{width:1200,height:900}});
const errors=[],missing=[];
p.on('pageerror',e=>errors.push(String(e)));
p.on('response',r=>{if(r.status()>=400)missing.push([r.status(),r.url()]);});
await p.goto(origin+'/tools/music/audition-kie/',{waitUntil:'domcontentloaded',timeout:20000});
const files=await p.evaluate(async()=>{
	const ids=['first1','first2','option1','option2','vocal','organ'];
	const records=[];
	for(const id of ids){
		const a=document.getElementById(id);
		if(!a)throw Error('Missing '+id);
		await new Promise((ok,bad)=>{
			if(a.readyState>=1)return ok();
			a.addEventListener('loadedmetadata',ok,{once:true});
			a.addEventListener('error',bad,{once:true});
			a.load();
		});
		records.push({id,duration:a.duration});
	}
	return records;
});
await p.locator('#jump').click();
const first=await p.evaluate(()=>document.getElementById('first1').currentTime);
await p.locator('[data-switch="first2"]').click();
await p.waitForTimeout(430);
const second=await p.evaluate(()=>document.getElementById('first2').currentTime);
await p.locator('[data-switch="option1"]').click();
await p.waitForTimeout(430);
const third=await p.evaluate(()=>document.getElementById('option1').currentTime);
await p.locator('[data-switch="option2"]').click();
await p.waitForTimeout(430);
const fourth=await p.evaluate(()=>document.getElementById('option2').currentTime);
await p.locator('[data-switch="organ"]').click();
await p.waitForTimeout(400);
const organ=await p.evaluate(()=>document.getElementById('organ').currentTime);
await p.locator('[data-switch="vocal"]').click();
await p.waitForTimeout(400);
const vocal=await p.evaluate(()=>document.getElementById('vocal').currentTime);
const links=await p.locator('a[download]').count();
const summary={files:files.map(v=>({id:v.id,seconds:+v.duration.toFixed(2)})),
	links,switchTimes:{first,second,third,fourth,organ,vocal},errors,missing};
console.log(JSON.stringify(summary,null,2));
await b.close();
if(errors.length||missing.length||files.length!==6||links!==4||
	Math.abs(first-150)>3||Math.abs(second-150)>3||
	Math.abs(third-150)>4||Math.abs(fourth-150)>4||
	organ<0||organ>6||Math.abs(vocal-151)>5)
	process.exitCode=1;
