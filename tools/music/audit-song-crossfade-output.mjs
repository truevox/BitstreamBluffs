/** Real source handoffs, continuous v4 post-guard PCM, independent FFmpeg meter.
 * Controlled game DSP (simulation stopped), not a natural gameplay trajectory.
 * Reports private, exclusively created; no audio files written.
 */
import assert from 'node:assert/strict';
import {writeFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright';
import {measureFourTimesTruePeak} from './estimate-true-peak-4x.js';
const url=process.env.GAME_URL||'http://127.0.0.1:8220/';
const index=Number(process.env.QA_INDEX);
const out=process.env.REPORT_OUT;
assert.ok(Number.isInteger(index)&&index>=0&&index<33);
assert.ok(out&&!existsSync(out),'Unique report required');
const report={format:'bsb-crossfade-live-v4-output-v1',index,status:'FAIL_QA_OR_SOURCE',pageErrors:[],httpErrors:[],mode:'controlled-gameplay-dsp'};
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1080,height:720}});
 page.on('pageerror',e=>report.pageErrors.push(String(e)));
 page.on('response',r=>{if(r.status()>=400&&!(/\/music\/packs\/[^/]+\/adaptive\/debutmont\//.test(r.url())&&r.status()===404))report.httpErrors.push({status:r.status(),url:r.url()});});
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.registry.get('audioSynth')?._stemMusic?.ready&&window.__bbGame.scene.getScene('TitleScene')?.sys.isActive(),null,{timeout:30000});
 await page.keyboard.press('x');
 await page.waitForFunction(()=>window.__bbGame?.registry.get('audioSynth')?.ctx?.state==='running',null,{timeout:30000});
 await page.evaluate(async()=>{
  const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic;
  g.registry.set('profile',{...(g.registry.get('profile')||{}),unlocked:{...(g.registry.get('profile')?.unlocked||{}),musicVocals:true}});
  a.applySettings({...a.settings,masterVolume:1,musicVolume:1,sfxVolume:1,windVolume:1,windEnabled:true,musicVocals:true,vocalGain:1,musicCrossfade:true,dynamicOrchestra:false,musicShuffle:false});
  await d._gridRequest;
  if(d.transitionGrids.size!==33||!a.settings.musicVocals)throw Error('Missing 33 grids or unlocked vocals');
  g.scene.getScene('TitleScene').startRun('crossfade-output-qa');
 });
 await page.waitForFunction(()=>window.__bbGame.scene.getScene('RunScene')?.sys.isActive(),null,{timeout:25000});
 report.expected=await page.evaluate(async index=>{
  const g=window.__bbGame,a=g.registry.get('audioSynth'),d=a._stemMusic,c=a.ctx;
  g.loop.stop();d.setMenuMode(false);d.stop();d.lastCrossfade=null;d.trackIndex=index;
  const info=await d._getTrack(index);
  await c.audioWorklet.addModule('/tools/music/live-final-master-capture-processor.js');
  d._resumeOffset=info.pack.duration-9;d.start();
  return {from:info.track.id,to:d.catalog[(index+1)%33].id,biome:d.biome,vocals:a.settings.musicVocals};
 },index);
 await page.waitForFunction(index=>{const d=window.__bbGame.registry.get('audioSynth')._stemMusic;return d.started&&d.trackIndex===index&&d.pack&&!d._loading&&d.activeNodes.size>=6},index,{timeout:30000});
 await page.evaluate(()=>{
  const a=window.__bbGame.registry.get('audioSynth'),c=a.ctx;
  const tap=new AudioWorkletNode(c,'bsb-live-final-master-tap',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',processorOptions:{stableWarmupFrames:Math.round(c.sampleRate*.45)}});
  const silent=c.createGain();silent.gain.value=0;a.nodes.peakGuard.connect(tap);tap.connect(silent);silent.connect(c.destination);
  const state={chunks:[],errors:[],arm:null,stop:null};
  tap.port.onmessage=({data:m})=>{if(m.type==='pcm')state.chunks.push(m);if(m.type==='armed')state.arm=m;if(m.type==='discontinuity')state.errors.push(m);if(m.type==='stopped')state.stop=m;};
  window.__crossfadeTap={tap,silent,state};
 });
 await page.waitForFunction(()=>{const x=window.__crossfadeTap.state;return x.arm&&x.chunks.length>=5||x.errors.length},null,{timeout:15000,polling:50});
 await page.waitForFunction(()=>{const d=window.__bbGame.registry.get('audioSynth')._stemMusic;return !!d.lastCrossfade||window.__crossfadeTap.state.errors.length},null,{timeout:15000,polling:50});
 report.observed=await page.evaluate(()=>{
  const d=window.__bbGame.registry.get('audioSynth')._stemMusic;
  if(window.__crossfadeTap.state.errors.length)throw Error('INSTRUMENT_CAPTURE: render discontinuity');
  return {fade:d.lastCrossfade,clock:d.clockStart,token:d._token,menuMode:d.menuMode,nodes:[...d._sourceEnvelopes.values()].map(({role,token,end})=>({role,token,end}))};
 });
 const f=report.observed.fade;
 assert.equal(f.from,report.expected.from);assert.equal(f.to,report.expected.to);assert.equal(report.observed.menuMode,false);
 assert.ok(f.end-f.start>=1.9&&f.end-f.start<=4.05);assert.equal(report.observed.clock,f.start);
 for(const role of ['drums','bass','guitar','piano','other','vocals']){
  assert.ok(report.observed.nodes.some(n=>n.role===role&&n.token===report.observed.token-1&&n.end>f.start),'Missing outgoing '+role);
  assert.ok(report.observed.nodes.some(n=>n.role===role&&n.token===report.observed.token),'Missing incoming '+role);
 }
 await page.waitForFunction(()=>{const d=window.__bbGame.registry.get('audioSynth')._stemMusic;return d.ctx.currentTime>d.lastCrossfade.end+.65||window.__crossfadeTap.state.errors.length},null,{timeout:12000,polling:50});
 const capture=await page.evaluate(async()=>{
  const a=window.__bbGame.registry.get('audioSynth'),d=a._stemMusic,x=window.__crossfadeTap,s=x.state;
  if(s.errors.length)throw Error('INSTRUMENT_CAPTURE: quantum gap '+JSON.stringify(s.errors));
  x.tap.port.postMessage({type:'stop'});
  const until=Date.now()+2500;
  while(!s.stop&&!s.errors.length&&Date.now()<until)await new Promise(r=>setTimeout(r,25));
  if(!s.stop||s.errors.length)throw Error('INSTRUMENT_CAPTURE: no continuous stop receipt '+JSON.stringify(s.errors));
  a.nodes.peakGuard.disconnect(x.tap);x.tap.disconnect();x.silent.disconnect();
  if(!s.arm||s.stop.quantumValidationVersion!==4||!s.stop.armed||!s.chunks.length)throw Error('INSTRUMENT_CAPTURE: missing v4 receipt');
  let frame=s.arm.armFrame;const rate=a.ctx.sampleRate;
  for(const c of s.chunks){if(c.frame!==frame||c.sampleRate!==rate||c.left.length!==c.frames||c.right.length!==c.frames)throw Error('INSTRUMENT_CAPTURE: chunk mismatch');frame+=c.frames;}
  if(frame!==s.stop.captureEndFrame||frame!==s.stop.finalQuantumStart+s.stop.finalQuantumFrames||s.stop.finalQuantumFrames<=0)throw Error('INSTRUMENT_CAPTURE: terminal mismatch');
  const n=frame-s.arm.armFrame,pcm=new Float32Array(n*2);let off=0;
  for(const c of s.chunks)for(let j=0;j<c.frames;j++){pcm[off++]=c.left[j];pcm[off++]=c.right[j];}
  const bytes=new Uint8Array(pcm.buffer);let binary='';
  for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return {base64:btoa(binary),firstFrame:s.arm.armFrame,frames:n,rate,endFrame:frame,terminal:s.stop,warmupGaps:s.arm.warmupGaps,clean:[...d._sourceEnvelopes.values()].every(n=>n.token===d._token)};
 });
 const {base64,...receipt}=capture;report.receipt=receipt;
 const {firstFrame,frames,rate,endFrame}=receipt;
 assert.ok(firstFrame/rate<=f.start-.25&&endFrame/rate>=f.end+.25,'INSTRUMENT_CAPTURE: incomplete overlap');
 assert.ok(receipt.clean,'Old nodes remain');
 const bytes=Buffer.from(base64,'base64');assert.equal(bytes.length,frames*8);
 const left=new Float32Array(frames),right=new Float32Array(frames);
 for(let i=0;i<frames;i++){left[i]=bytes.readFloatLE(i*8);right[i]=bytes.readFloatLE(i*8+4);}
 report.metrics=measureFourTimesTruePeak({length:frames,sampleRate:rate,numberOfChannels:2,getChannelData:c=>c?right:left});
 // Independent FFmpeg EBU R128 true-peak estimate, separate implementation.
 const ff=spawnSync('ffmpeg',['-nostdin','-hide_banner','-f','f32le','-ar',String(rate),'-ac','2','-i','pipe:0','-af','ebur128=peak=true','-f','null','-'],{input:bytes,encoding:'utf8',maxBuffer:4<<20,timeout:20000});
 if(ff.status!==0)throw Error('FFmpeg meter failed: '+String(ff.stderr).slice(-500));
 const summary=ff.stderr.slice(ff.stderr.lastIndexOf('Summary:'));
 const truePeak=summary.match(/True peak:\s*Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/);
 assert.ok(truePeak,'Missing independent true peak');
 report.ffmpeg={truePeakDbTp:Number(truePeak[1]),summary};
 // 50ms stereo RMS windows across overlap. Detect long stretches of near-silence,
 // not a claim of a source-level dropout (intentional quiet music is possible).
 let low=0,longest=0,minRms=1;
 const begin=Math.ceil(f.start*rate-firstFrame),end=Math.floor(f.end*rate-firstFrame),step=Math.round(rate*.05);
 for(let i=begin;i+step<=end;i+=step){let sum=0;for(let j=i;j<i+step;j++)sum+=left[j]*left[j]+right[j]*right[j];const rms=Math.sqrt(sum/(2*step));minRms=Math.min(minRms,rms);low=rms<.001?low+1:0;longest=Math.max(longest,low);}
 report.overlapEnergy={min50msRms:minRms,longestBelowMinus60DbSeconds:longest*step/rate};
 const m=report.metrics;
 if(m.sampleClips||m.nonfiniteSamples||m.estimatedTrueClips4x||m.samplePeak>=1||m.estimatedTruePeak4x>=1||report.ffmpeg.truePeakDbTp>=0){report.status='VALID_CAPTURE_AUDIO_LIMIT_FAILURE';throw Error('Measured output limit failure');}
 assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.httpErrors,[]);
 report.status='PASS_CONTIGUOUS_V4_OVERLAP_PCM_NOT_MASTERED';
 console.log('CROSSFADE_OUTPUT_PASS',JSON.stringify({index,overlap:f.end-f.start,beatAligned:f.beatAligned,peak:m.estimatedTruePeakDbTp4x,ffmpeg:report.ffmpeg.truePeakDbTp,quiet:report.overlapEnergy.longestBelowMinus60DbSeconds}));
}catch(e){
 report.error=String(e);
 if(report.status!=='VALID_CAPTURE_AUDIO_LIMIT_FAILURE'&&!report.metrics&&!report.pageErrors.length&&!report.httpErrors.length&&String(e).includes('INSTRUMENT_CAPTURE:'))report.status='INVALID_INSTRUMENT_CAPTURE';
 console.error(report.status,report.error);process.exitCode=1;
}finally{await browser.close();writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
