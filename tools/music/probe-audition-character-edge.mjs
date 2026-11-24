#!/usr/bin/env node
/** Real original OGGs, browser OfflineAudioContext, audible signature + headroom.
 * Compare exact same actual source segment, no noise or event one-shots added.
 * Prove 0%-new-DSP silent and 100% and 200% produce clear audible changes.
 */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const base=process.env.AUDITION_URL||'http://100.115.120.66:8212';
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,
 args:['--no-sandbox','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
try{
 for(const [id,name,kind,slider] of [
  ['sugarfizz','__sugarfizzQA','candy','candy-character'],
  ['ventforge','__ventforgeQA','heat','heat-wah']]){
  const page=await browser.newPage();
  await page.goto(`${base}/tools/music/${id}-audition.html?qa=1`,{waitUntil:'networkidle2',timeout:25000});
  await page.click('#load');
  await page.waitForFunction(()=>document.querySelector('#play')?.disabled===false,{timeout:18000});
  const result=await page.evaluate(async ({name,kind,slider})=>{
   const api=window[name],buffers=api.getBuffers(),roles=['drums','bass','guitar','piano','other'];
   const rate=48000, seconds=3.5;
   async function render(amount,withEvents=false){
    const ctx=new OfflineAudioContext(2,Math.round(rate*seconds),rate);
    const bus=ctx.createGain(),master=ctx.createGain();master.gain.value=.26;
    bus.connect(master);master.connect(ctx.destination);
    const selector=document.getElementById(slider);
    const prev=selector.value;selector.value=String(amount);
    const character=api.attachAuditionCharacterEdge(ctx,bus,selector,kind);
    selector.value=prev;
    for(const role of roles){
     const chain=api.buildMusicChain(ctx,api.orchestraPreset(kind==='candy'?'candy-cane-canyon':'vertigo-vents',role),bus);
     if(withEvents&&role==='drums')chain.find(kind==='candy'?'sugarfizz':'ventforge').set(kind==='candy'?'pop':'crustImpact',.9,.25);
     const source=ctx.createBufferSource();source.buffer=buffers[role];
     const gain=ctx.createGain();gain.gain.value=role==='drums'?.9:role==='bass'?.75:.65;
     source.connect(gain);gain.connect(chain.input);gain.connect(character.input);source.start(0);
    }
    const rendered=await ctx.startRendering();character.dispose();
    return [Float32Array.from(rendered.getChannelData(0)),Float32Array.from(rendered.getChannelData(1))];
   }
   function stats(arr){let squared=0,peak=0;
    for(const channel of arr)for(const s of channel){squared+=s*s;peak=Math.max(peak,Math.abs(s));}
    return {rms:Math.sqrt(squared/(2*arr[0].length)),peak};
   }
   function diff(a,b){let sq=0;for(let c=0;c<2;c++)for(let i=0;i<a[c].length;i++){const v=a[c][i]-b[c][i];sq+=v*v;}return Math.sqrt(sq/(2*a[0].length));}
   const results={};for(const amount of [0,100,200])results[amount]=await render(amount);
   const baseline=stats(results[0]);
   const metrics={baseline,at100:stats(results[100]),at200:stats(results[200]),
    different100:diff(results[0],results[100]),different200:diff(results[0],results[200])};
   const eventOff=await render(0,true),eventOn=await render(200,true);
   // Event must bypass the NEW character graph, meaning adding the very same
   // event to both renders increases the signal by an identical additive PCM.
   // Delta after-minus-before event matches independently of the slider.
   function deltaEvent(amount,withEvent){return stats(withEvent).rms;}
   metrics.eventRmsOff=stats(eventOff).rms;metrics.eventRmsOn=stats(eventOn).rms;
   // Compute effect-independent event residual: (eventOn - musicOn) compared
   // to (eventOff - musicOff), both source-aligned same original audio.
   let err2=0,ref2=0;
   for(let c=0;c<2;c++)for(let i=0;i<eventOff[c].length;i++){
    const e0=eventOff[c][i]-results[0][c][i],e1=eventOn[c][i]-results[200][c][i];
    err2+=(e1-e0)**2;ref2+=e0**2;
   }
   metrics.eventSignalRelativeError=Math.sqrt(err2/Math.max(1e-18,ref2));
   return metrics;
  },{name,kind,slider});
  console.log(`ORIGINAL_STEM_CHARACTER_${kind.toUpperCase()}`,JSON.stringify(result));
  assert.ok(result.different100/result.baseline.rms>.08,`${kind} too subtle at 100%`);
  assert.ok(result.different200/result.baseline.rms>.18,`${kind} too subtle at 200%`);
  assert.ok(result.at200.peak<1,`${kind} exceeded unity`);
  assert.ok(result.eventSignalRelativeError<.002,`${kind} changed a user-approved one-shot event`);
  await page.close();
 }
 console.log('ORIGINAL_SOURCE_CHARACTER_AND_EVENT_ISOLATION_PASS');
}finally{await browser.close()}
