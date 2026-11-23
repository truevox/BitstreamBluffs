#!/usr/bin/env node
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import puppeteer from 'puppeteer';
const packs=['01_FEsxYVStla4','03_WRBGQUqD54U',
 '31_FYImnz5-hXs','33_local-one-more-run-bitstream-bluffs'];
const url=process.env.MUSIC_BUS_URL||
 'http://127.0.0.1:19008/tools/music/final-game-music-bus-audit.html';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,
 args:['--no-sandbox','--enable-unsafe-swiftshader',
 '--autoplay-policy=no-user-gesture-required']});
try{
 const page=await browser.newPage(),errors=[];
 page.setDefaultTimeout(180000);
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400)errors.push(String(r.status())+' '+r.url());});
 await page.goto(url,{waitUntil:'networkidle2',timeout:25000});
 await page.waitForFunction(()=>!!window.__finalGameMusicBusQA,{timeout:12000});
 const fullSegment=process.env.MUSIC_BUS_FULL_SEGMENT==='1';
 const subset=(fullSegment||process.env.MUSIC_BUS_FOCUS)?
  ['garbage-dump-glacier','vertigo-vents','crystal-cavern','bitstream-bluffs']:null;
 const duration=fullSegment?12:2.5;
 const report=await page.evaluate(async args=>
  await window.__finalGameMusicBusQA.audit(args.packs,args.subset||undefined,args.duration,args.fullSegment),
  {packs,subset,duration,fullSegment});
 assert.equal(report.results.length,4*(subset?4:12)*(fullSegment?1:2)+(fullSegment?0:4));
 assert.deepEqual(errors,[]);
 assert(report.results.every(row=>row.nonfiniteSamples===0),
  'Non-finite game music bus output');
 if(process.env.MUSIC_BUS_REPORT)
  writeFileSync(process.env.MUSIC_BUS_REPORT,JSON.stringify(report,null,2)+'\n','utf8');
 const highest=[...report.results].sort((a,b)=>b.samplePeak-a.samplePeak);
 console.log('GAME_MUSIC_BUS_COMPRESSOR_REAL_OGG_REPORT',JSON.stringify({
  cases:report.results.length,secondsPerRender:duration,
  highest:highest.slice(0,20),
  overUnity:report.results.filter(r=>r.overUnitySamples>0).length,
  nearUnity:report.results.filter(r=>r.nearUnitySamples>0).length
 }));
 console.log('GAME_MUSIC_BUS_COMPRESSOR_ORIGINAL_OGG_RENDER_PASS');
}finally{await browser.close();}
