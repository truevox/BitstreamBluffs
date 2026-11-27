/** Real compiled-game Museum entry and local-only GhostTape browser acceptance. */
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {chromium} from 'playwright';
import {preview} from 'vite';
let server,browser;
const errors=[];
const pass=(name,data={})=>console.log('PASS_MUSEUM_PUBLIC',JSON.stringify({name,...data}));
const tape=JSON.stringify({format:'bb-ghost-tape',version:1,simTickHz:120,
 trace:Buffer.from(new Float32Array([0,1,0,2,3,0]).buffer).toString('base64'),
 simRevision:9,physicsVersion:1,rulesetId:'sha256:'+'a'.repeat(64)});
const fixture=(name,content=tape)=>({name,mimeType:'application/json',buffer:Buffer.from(content)});
try {
 server=await preview({preview:{host:'127.0.0.1',port:0,strictPort:true}});
 const origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:960,height:540}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const boot=async()=>{
  await page.goto(origin+'/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene')&&
    window.__bbGame.scene.getScene('TitleScene').museumButton?.scene,null,{timeout:60000});
 };
 await boot();
 const layout=await page.evaluate(()=>{
  const s=window.__bbGame.scene.getScene('TitleScene');
  const rects=[s.museumButton,s.postcardButton,s.helpButton].map(b=>({x:b.x,y:b.y,w:b.w,h:b.h}));
  return {rects,nonoverlap:rects.every((a,i)=>rects.every((b,j)=>i===j||
     a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y))};
 });
 assert.equal(layout.nonoverlap,true,'title chips must not overlap');pass('title chip layout',layout);
 await page.keyboard.press('m');
 await page.waitForURL('**/tools/museum-of-bad-physics.html',{timeout:12000});
 assert.match(await page.title(),/Museum of Bad Physics/);
 const back=page.getByRole('link',{name:'Return to Bitstream Bluffs game'});
 assert.equal(await back.count(),1);pass('keyboard M opens compiled public Museum route');
 await page.evaluate(()=>{const revoke=URL.revokeObjectURL.bind(URL);window.__museumRevoked=[];
  URL.revokeObjectURL=(url)=>{window.__museumRevoked.push(url);return revoke(url);};});
 const requests=[];page.on('request',r=>{if(!r.url().startsWith('blob:'))requests.push({method:r.method(),url:r.url()});});
 const input=page.locator('#file-input');
 await input.setInputFiles(fixture('Recorded Glitch.json'));
 await page.waitForFunction(()=>document.querySelectorAll('.gallery-card').length===1,null,{timeout:8000});
 assert.match(await page.locator('.gallery-card').innerText(),/current revision claim/i);
 assert.match(await page.locator('.gallery-card img').getAttribute('src'),/^blob:/);
 assert.equal(await page.locator('.gallery-card svg').count(),0);
 pass('local GhostTape renders static image-backed SVG');
 await input.setInputFiles(fixture('<script>alert(1)</script>.json'));
 await page.waitForFunction(()=>document.querySelectorAll('.gallery-card').length===2,null,{timeout:8000});
 assert.equal(await page.locator('.gallery-card script').count(),0);
 assert.equal(await page.locator('.gallery-card').nth(1).locator('h2').innerText(),'Untitled');
 pass('malicious filename inert');
 await page.locator('#clear-all').click();
 await page.waitForFunction(()=>document.querySelectorAll('.gallery-card').length===0,null,{timeout:8000});
 assert.equal(await page.evaluate(()=>window.__museumRevoked.length),2);
 await input.setInputFiles(fixture('invalid.json','{not-json'));
 await page.waitForFunction(()=>document.getElementById('status').textContent.includes('not valid JSON'),null,{timeout:8000});
 assert.equal(await page.locator('.gallery-card').count(),0);
 assert.deepEqual(requests,[],'selected files must generate zero HTTP requests');
 pass('clear revokes URLs, bad JSON rejected and zero file-upload requests');
 await back.click();
 await page.waitForURL('**/index.html',{timeout:12000});
 await page.waitForFunction(()=>window.__bbGame?.scene?.isActive('TitleScene'),null,{timeout:60000});
 pass('back to game returns to Title');
 const target=await page.evaluate(()=>{
  const m=window.__bbGame.scene.getScene('TitleScene').museumButton;
  const b=document.querySelector('canvas').getBoundingClientRect();
  return {x:b.x+(m.x+m.w/2)*b.width/480,y:b.y+(m.y+m.h/2)*b.height/270};
 });
 await page.mouse.click(target.x,target.y);
 await page.waitForURL('**/tools/museum-of-bad-physics.html',{timeout:12000});
 pass('pointer click on Museum chip opens public route');
 assert.deepEqual(errors,[],'browser runtime errors');pass('compiled game acceptance',{pageErrors:0});
 await context.close();
}finally{await browser?.close();await server?.httpServer?.close();}
