#!/usr/bin/env node
/* Browser check: real OGG/candidate audio + deliberate source-identity tampering. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const url=process.env.BEAT_LAB_URL||'http://100.115.120.66:8213/music-review/beat33/';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({acceptDownloads:true});
 const errors=[],bad=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400)bad.push([r.status(),r.url()])});
 await page.goto(url);
 await page.waitForFunction(()=>document.querySelector('#song')?.options.length>=5&&
  document.querySelector('#metrics')?.children.length>0);
 await page.selectOption('#song','ehy7VzQezYA');
 await page.waitForFunction(()=>document.querySelector('#metrics').textContent.includes('Original duration'));
 await page.selectOption('#prior','1');
 await page.selectOption('#accent','3');
 await page.click('#play');
 await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Playing original'),null,{timeout:20000});
 await page.fill('#notes','Research-only listening; no approved beat-one');
 const [download]=await Promise.all([page.waitForEvent('download'),page.click('#export')]);
 assert.equal(download.suggestedFilename(),'bitstream-beat33-listening-notes.json');
 assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);
 await page.click('#stop');
 console.log('BEAT33_REAL_SOURCE_AUDIO_AND_NOTES_PASS');
 // A misattributed source candidate file must be denied before another sound is played.
 await page.route('**/music-review/beat33/data/02_ehy7VzQezYA.json',async route=>{
  const response=await route.fetch();const report=await response.json();
  report.trackId='intentionally-tampered-wrong-source';
  await route.fulfill({response,json:report});
 });
 await page.selectOption('#song','FEsxYVStla4');
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('ready'));
 await page.selectOption('#song','ehy7VzQezYA');
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Source identity mismatch'));
 await page.click('#play');
 assert.match(await page.locator('#status').innerText(),/Source identity mismatch/);
 assert.deepEqual(errors,[]);
 console.log('BEAT33_SOURCE_IDENTITY_TAMPER_REJECTED_PASS');
}finally{await browser.close()}
