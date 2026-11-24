#!/usr/bin/env node
/** Exact original source OGGs, real FX chain, new source-only spatial reach.
 * At 0% (or Pyramid 125%) the added graph is bit-identical silent. Crucially
 * one-shot physical sounds aren't sent to the echo graph at any gain.
 */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const base=process.env.AUDITION_URL||'http://100.115.120.66:8212';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,
 args:['--no-sandbox','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
try{
 for(const [pageId,apiName,biome,kind,slider,startValue,eventId,eventStage] of [
  ['jellybloom','__jellybloomQA','sky-jellyfish-mountain','jelly','reach',0,'impact','drums'],
  ['orbitfield','__orbitfieldQA','space-mountain','space','echo-tail',0,'reentry','drums'],
  ['sunstone','__sunstoneQA','pyramid-peak','stone','resonance',125,'stone','drums']]){
  const page=await browser.newPage();
  await page.goto(`${base}/tools/music/${pageId}-audition.html?qa=1`,{waitUntil:'networkidle2',timeout:25000});
  await page.click('#load');
  await page.waitForFunction(()=>document.querySelector('#play')?.disabled===false,{timeout:18000});
  const result=await page.evaluate(async ({apiName,biome,kind,slider,startValue,eventId,eventStage})=>{
   const api=window[apiName],buffers=api.getBuffers(),roles=['drums','bass','guitar','piano','other'];
   const rate=48000,seconds=4.4;
   async function render(amount,event=false){
    const ctx=new OfflineAudioContext(2,Math.floor(rate*seconds),rate);
    const bus=ctx.createGain(),master=ctx.createGain();master.gain.value=.25;
    bus.connect(master);master.connect(ctx.destination);
    const selector=document.getElementById(slider);
    const prev=selector.value;selector.value=String(amount);
    const spatial=api.attachAuditionSpatialReach(ctx,bus,selector,kind);
    selector.value=prev;
    for(const role of roles){
     const chain=api.buildMusicChain(ctx,api.orchestraPreset(biome,role),bus);
     if(event&&role===eventStage)chain.find(kind==='jelly'?'jellybloom':kind==='space'?'orbitfield':'sunstone').set(eventId,.9,.2);
     const source=ctx.createBufferSource();source.buffer=buffers[role];
     const gain=ctx.createGain();gain.gain.value=role==='drums'?.9:role==='bass'?.75:.65;
     source.connect(gain);gain.connect(chain.input);gain.connect(spatial.input);
     source.start(0);
    }
    const rendered=await ctx.startRendering();spatial.dispose();
    return [Float32Array.from(rendered.getChannelData(0)),Float32Array.from(rendered.getChannelData(1))];
   }
   function stats(a){let ss=0,p=0;for(const ch of a)for(const v of ch){ss+=v*v;p=Math.max(p,Math.abs(v))}return {rms:Math.sqrt(ss/(a[0].length*2)),peak:p}}
   function deviation(a,b){let ss=0;for(let c=0;c<2;c++)for(let i=0;i<a[c].length;i++)ss+=(a[c][i]-b[c][i])**2;return Math.sqrt(ss/(a[0].length*2))}
   const original=await render(startValue),strong=await render(200),e0=await render(startValue,true),e1=await render(200,true);
   let err=0,ref=0;
   for(let c=0;c<2;c++)for(let i=0;i<e0[c].length;i++){
    const old=e0[c][i]-original[c][i],raised=e1[c][i]-strong[c][i];
    err+=(old-raised)**2;ref+=old**2;
   }
   return {baseline:stats(original),boost:stats(strong),change:deviation(original,strong),eventResidualError:Math.sqrt(err/Math.max(ref,1e-18))};
  },{apiName,biome,kind,slider,startValue,eventId,eventStage});
  const relative=result.change/result.baseline.rms;
  console.log(`ORIGINAL_STEM_SPATIAL_${kind.toUpperCase()}`,JSON.stringify({...result,relativeChange:relative}));
  assert.ok(relative>(kind==='stone'?.012:.038),`${kind} reach too subtle`);
  assert.ok(result.boost.peak<1,`${kind} overshot digital full scale`);
  assert.ok(result.eventResidualError<.001,`${kind} altered the physical sound`);
  await page.close();
 }
 console.log('SOURCE_ONLY_SPATIAL_3_BIOMES_EVENT_ISOLATION_PASS');
}finally{await browser.close()}
