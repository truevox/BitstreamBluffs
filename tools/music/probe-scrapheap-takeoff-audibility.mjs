import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
// Launch a source-backed web server, for example: python3 -m http.server 18829 --directory .
// Then set SCHLORP_SOURCE_URL=http://127.0.0.1:18829. A Vite dev server also works.
const base=process.env.SCHLORP_SOURCE_URL || 'http://127.0.0.1:5173';
(async()=>{
 const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(base+'/tools/music/scrapheap-audition.html',{waitUntil:'domcontentloaded'});
 const result=await page.evaluate(async(url)=>{
  const {buildMusicChain}=await import('/src/systems/music/MusicFXGraph.js');
  const live=new AudioContext({sampleRate:48000}), roles=['drums','bass','guitar','piano','other'],buffers={};
  for(const name of roles){let response=await fetch('/scrapheap-audition/'+name+'.mp3');if(!response.ok)response=await fetch('/public/scrapheap-audition/'+name+'.mp3');if(!response.ok)throw new Error('Stem load failed: '+name);buffers[name]=await live.decodeAudioData(await response.arrayBuffer());}
  const sr=live.sampleRate;await live.close();const N=sr*4;
  async function render(mode){
   const ctx=new OfflineAudioContext(2,N,sr),master=ctx.createGain();master.gain.value=.32;master.connect(ctx.destination);
   const chain=buildMusicChain(ctx,[{type:'scrapheap',id:'scrapheap',contact:0.55}],master);
   for(const name of roles){const source=ctx.createBufferSource(),vol=ctx.createGain();source.buffer=buffers[name];vol.gain.value=name==='drums'?.9:name==='bass'?.75:.65;source.connect(vol);vol.connect(name==='drums'?chain.input:master);source.start(0);}
      if(mode==='takeoffA'||mode==='takeoffB'){
    chain.find('scrapheap').set('suctionStyle',mode==='takeoffB'?1:0,ctx.currentTime);
    chain.find('scrapheap').set('takeoff',.55,1.2);
    chain.find('scrapheap').set('contact',0,1.2);
   }
   if(mode==='noContact')chain.find('scrapheap').set('contact',0,1.2);
   if(mode==='landing')chain.find('scrapheap').set('impact',.9,1.2);
   return ctx.startRendering();
  }
  const [baseline,control,peel,gulp,landing]=await Promise.all(['baseline','noContact','takeoffA','takeoffB','landing'].map(render));
  function rms(buffer,a,b){const start=Math.floor(a*sr),stop=Math.floor(b*sr);let sum=0;for(let ch=0;ch<2;ch++){const samples=buffer.getChannelData(ch);for(let i=start;i<stop;i++){const v=samples[i];sum+=v*v;}}return Math.sqrt(sum/(2*(stop-start)));}
  function diff(a,b,x,y){const start=Math.floor(x*sr),stop=Math.floor(y*sr);let sum=0;for(let ch=0;ch<2;ch++){const aa=a.getChannelData(ch),bb=b.getChannelData(ch);for(let i=start;i<stop;i++){sum+=(aa[i]-bb[i])**2;}}return Math.sqrt(sum/(2*(stop-start)));}
  function peak(buffer){let p=0,finite=true;for(let c=0;c<2;c++){const vals=buffer.getChannelData(c);for(let i=0;i<N;i++){const v=vals[i];p=Math.max(p,Math.abs(v));if(!Number.isFinite(v))finite=false;}}return {peak:p,finite};}
  return {
   baselineRMS:rms(control,1.2,1.55),
   peelDifferenceRMS:diff(peel,control,1.2,1.55),
   gulpDifferenceRMS:diff(gulp,control,1.2,1.55),
   peelPeak:peak(peel), gulpPeak:peak(gulp), landingPeak:peak(landing),
   landingDifferenceRMS:diff(landing,baseline,1.2,1.55),
   differentTexturesRMS:diff(peel,gulp,1.2,1.55),
  };
 },base);
 console.log('SCHLORP_AUDIBILITY_PROBE',JSON.stringify({base,result,errors}));
 assert.deepEqual(errors,[]);
 for(const style of ['peel','gulp']) {
  assert.equal(result[style+'Peak'].finite,true);
  assert(result[style+'Peak'].peak < .95,style+' peak unexpectedly high');
  assert(result[style+'DifferenceRMS'] > .018,style+' is below owner-liked 80% audition audibility floor');
  assert(result[style+'DifferenceRMS'] < result.landingDifferenceRMS*.96,
   style+' should remain smaller than the owner-approved landing');
 }
 assert.equal(result.landingPeak.finite,true);
 assert(result.differentTexturesRMS > .012,'The two textures need genuinely different output');
 await browser.close();
})().catch(e=>{console.error(e.stack);process.exitCode=1});
