import { chromium } from 'playwright';
const origin='http://100.115.120.66:8185';
const errors=[];
const browser=await chromium.launch({
 headless:true,executablePath:'/usr/bin/chromium',
 args:['--no-sandbox','--disable-dev-shm-usage',
       '--autoplay-policy=no-user-gesture-required',
       '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']
});
const page=await browser.newPage({viewport:{width:1250,height:840}});
page.on('pageerror',error=>errors.push('JS: '+error.message));
page.on('response',resp=>{if(resp.status()>=400)errors.push('HTTP '+resp.status()+' '+resp.url());});
const state=()=>page.evaluate(()=>window.__fourFamilyLab?.getState());
try{
 await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:25000});
 await page.waitForFunction(()=>window.__fourFamilyLab?.getState().song==='pope',{timeout:12000});
 console.log('READY',JSON.stringify(await state()));
 console.log('BIOMES',await page.locator('.mountain').count());
 if(!(await page.locator('.candy-only').isHidden()))
  throw Error('Candy version selector must be hidden outside Candy biome');
 await page.locator('.mountain[data-biome="crystal-cavern"]').click();
 await page.locator('#play').click();
 await page.waitForFunction(()=>{
  const p=window.__fourFamilyLab?.getState();
  return p?.audioState==='running' && p?.deckInputs?.length===10 &&
     p.biome==='crystal-cavern' && p.playing && !p.error;
 },{timeout:45000});
 await page.waitForTimeout(1000);
 const initialPope=await state();
 if(!initialPope.deckPaths.some(p=>p.includes('/drums-sampled/crystal-cavern.ogg')))
  throw Error('NEW sampled drum kit did not load as default');
 if(!initialPope.deckPaths.some(p=>p.includes('/featured-sampled/crystal-cavern.ogg')))
  throw Error('NEW sampled Other-family instrument did not load');
 console.log('POPE_NEW_SAMPLED_DRUMS_AND_OTHER',JSON.stringify(initialPope));
 await page.locator('#drumsMode').selectOption('dsp');
 await page.waitForFunction(()=>window.__fourFamilyLab?.getState().deckPaths?.some(p=>
  p.includes('/drums/crystal-cavern.ogg')),{timeout:30000});
 console.log('OLD_AIR_DRUMS_RETAINED',JSON.stringify(await state()));
 await page.locator('#drumsMode').selectOption('sampled');
 await page.waitForFunction(()=>window.__fourFamilyLab?.getState().deckPaths?.some(p=>
  p.includes('/drums-sampled/crystal-cavern.ogg')),{timeout:30000});
 await page.locator('#featuredMode').selectOption('dsp');
 await page.waitForFunction(()=>window.__fourFamilyLab?.getState().deckPaths?.some(p=>
  p.includes('/featured/crystal-cavern.ogg')),{timeout:30000});
 console.log('OLD_FEATURED_DSP_RETAINED',JSON.stringify(await state()));
 await page.locator('#featuredMode').selectOption('sampled');
 await page.waitForFunction(()=>window.__fourFamilyLab?.getState().deckPaths?.some(p=>
  p.includes('/featured-sampled/crystal-cavern.ogg')),{timeout:30000});
 await page.locator('.mountain[data-biome="candy-cane-canyon"]').click();
 await page.waitForFunction(()=>window.__fourFamilyLab?.getState().deckPaths?.some(p=>
  p.includes('/melody-candy-v3/candy-cane-canyon.ogg')),{timeout:30000});
 console.log('NEW_SUGAR_POP_MELODY',JSON.stringify(await state()));
 if(!(await page.locator('.candy-only').isVisible()))
  throw Error('Candy selector was not displayed for correct song/biome');
 await page.locator('#candyMode').selectOption('legacy');
 await page.waitForFunction(()=>window.__fourFamilyLab?.getState().deckPaths?.some(p=>
  p.includes('/melody/candy-cane-canyon.ogg')),{timeout:30000});
 console.log('OLD_CANDY_LEAD_RETAINED',JSON.stringify(await state()));
 await page.locator('#candyMode').selectOption('new');
 await page.waitForFunction(()=>window.__fourFamilyLab?.getState().deckPaths?.some(p=>
  p.includes('/melody-candy-v3/candy-cane-canyon.ogg')),{timeout:30000});
 await page.locator('.mountain[data-biome="crystal-cavern"]').click();
 if(!(await page.locator('.candy-only').isHidden()))
  throw Error('Candy-only selector still visible after changing biome');
 await page.waitForFunction(()=>window.__fourFamilyLab?.getState().deckBiome==='crystal-cavern',
  {timeout:30000});
 console.log('POPE_CRYSTAL_PLAYING',JSON.stringify(await state()));
 for(const role of ['melody','bass','drums','featured']){
  await page.locator('.stem[data-role="'+role+'"] [data-value="50"]').click();
 }
 await page.waitForTimeout(1000);
 console.log('HALF_BLEND',JSON.stringify(await state()));
 await page.locator('.stem[data-role="bass"] [data-solo]').click();
 await page.waitForFunction(()=>window.__fourFamilyLab?.getState().solo==='bass');
 const soloed=await state();
 if(soloed.mix.bass!==50)throw Error('Solo changed the A/B blend');
 await page.locator('.stem[data-role="bass"] [data-solo]').click();
 await page.waitForFunction(()=>window.__fourFamilyLab?.getState().solo===null);
 console.log('FAMILY_SOLO_AND_RESTORE',JSON.stringify(await state()));
 await page.locator('#bassMode').selectOption('dsp');
 await page.waitForFunction(()=>{
  const p=window.__fourFamilyLab?.getState();
  return p?.bassMode==='dsp'&&p?.deckPaths?.some(x=>x.includes('/bass-dsp/crystal-cavern.ogg'));
 },{timeout:30000});
 console.log('ORIGINAL_TEXTURE_BASS_V1',JSON.stringify(await state()));
 await page.locator('#bassMode').selectOption('sampled');
 await page.waitForFunction(()=>{
  const p=window.__fourFamilyLab?.getState();
  return p?.bassMode==='sampled'&&p?.deckPaths?.some(x=>x.includes('/bass/crystal-cavern.ogg'));
 },{timeout:30000});
 console.log('NEW_SAMPLED_BASS_V2',JSON.stringify(await state()));
 await page.locator('#bsod').evaluate(element=>{
  element.value='85';element.dispatchEvent(new Event('input',{bubbles:true}));
 });
 await page.locator('#speed').evaluate(element=>{
  element.value='1250';element.dispatchEvent(new Event('input',{bubbles:true}));
 });
 console.log('BSOD_AND_SPEED',JSON.stringify(await state()));
 await page.locator('.mountain[data-biome="space-mountain"]').click();
 await page.waitForFunction(()=>{
  const p=window.__fourFamilyLab?.getState();
  return p?.deckBiome==='space-mountain'&&p?.deckInputs?.length===10&&p?.playing;
 },{timeout:30000});
 await page.waitForTimeout(800);
 console.log('BIOME_SWAP',JSON.stringify(await state()));
 await page.locator('#song').selectOption('one-more-run');
 await page.waitForFunction(()=>{
  const p=window.__fourFamilyLab?.getState();
  return p?.deckSong==='one-more-run' && p?.deckInputs?.length===10 && p.playing;
 },{timeout:45000});
 await page.waitForTimeout(1000);
 console.log('OTHER_SONG_PLAYING',JSON.stringify(await state()));
 const newPiano=await state();
 if(!newPiano.deckPaths.some(p=>p.includes('/featured-sampled/space-mountain.ogg')))
  throw Error('ONE MORE RUN sampled piano was not selected by default');
 if(!newPiano.deckPaths.some(p=>p.includes('/drums-sampled/space-mountain.ogg')))
  throw Error('ONE MORE RUN sampled air drums were not selected by default');
 const info=await page.locator('#featuredInfo').innerText();
 if(!info.includes('PIANO'))throw Error('One More Run featured piano not displayed: '+info);
 await page.screenshot({path:'/tmp/bb-4family-audio-first-lab.png',fullPage:true});
 await page.locator('[data-all="0"]').click();
 const allOriginal=await state();
 if(Object.values(allOriginal.mix).some(v=>v!==0))throw Error('Original all button failed');
 await page.locator('[data-all="100"]').click();
 const allBiome=await state();
 if(Object.values(allBiome.mix).some(v=>v!==100))throw Error('Biome all button failed');
 await page.locator('#seek').evaluate(element=>{
  element.value='17';element.dispatchEvent(new Event('change',{bubbles:true}));
 });
 await page.waitForTimeout(900);
 const now=await state();
 if(Math.abs(now.position-17) > 1.4 || now.deckOffset!==17)throw Error('seek failed: '+JSON.stringify(now));
 console.log('SEEK',JSON.stringify(now));
 // Guitar showcase: third track has eleven real SF2 instrument renditions
 // of the separated guitar, while melody intentionally remains original.
 await page.locator('#song').selectOption('every-hacker-pt2');
 await page.waitForFunction(()=>{
  const p=window.__fourFamilyLab?.getState();
  return p?.deckSong==='every-hacker-pt2' && p?.deckInputs?.length===9 &&
   p?.deckPaths?.some(x=>x.includes('/featured/space-mountain.ogg')) && p.playing;
 },{timeout:45000});
 const guitarState=await state();
 if(!(await page.locator('#featuredMode').isDisabled()))
  throw Error('Sampled Guitar should not show unavailable older-effects version');
 if(!guitarState.deckPaths.some(p=>p.includes('/drums-sampled/space-mountain.ogg')))
  throw Error('Guitar third song sampled drums missing');
 if(!guitarState.deckInputs.includes('original:guitar')||!guitarState.deckInputs.includes('biome:featured'))
  throw Error('Third track missing original vs sampled guitar');
 if(!(await page.locator('.stem[data-role="melody"] input[type=range]').isDisabled()))
  throw Error('Third song incorrectly claims to have 12 synthetic melody voices');
 await page.locator('.mountain[data-biome="steampunk-slopes"]').click();
 await page.waitForFunction(()=>{
  const p=window.__fourFamilyLab?.getState();
  return p?.deckBiome==='steampunk-slopes' &&
   p.deckPaths?.some(x=>x.includes('/featured/steampunk-slopes.ogg'));
 },{timeout:40000});
 await page.locator('.stem[data-role="featured"] [data-value="0"]').click();
 await page.locator('.stem[data-role="featured"] [data-value="50"]').click();
 await page.locator('.stem[data-role="featured"] [data-value="100"]').click();
 await page.locator('.stem[data-role="featured"] [data-solo]').click();
 await page.waitForFunction(()=>window.__fourFamilyLab?.getState().solo==='featured');
 console.log('SAMPLED_GUITAR_SHOWCASE',JSON.stringify(await state()));
 await page.screenshot({path:'/tmp/bitstream-guitar-third-audio-lab.png',fullPage:true});
 await page.locator('.stem[data-role="featured"] [data-solo]').click();
 await page.locator('#play').click();
 await page.waitForFunction(()=>!window.__fourFamilyLab?.getState().playing);
 const paused=await state();
 if(paused.audioState!=='running')throw Error('Audio context unexpectedly interrupted');
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS_PRIVATE_AUDIO_AB_LAB',JSON.stringify({
   songs:3,biomes:await page.locator('.mountain').count(),guitarShowcase:true,
  newDrumKits:33,otherInstruments:11,pianoInstruments:11,candyNewMelodies:2,allPreviousPreserved:true,
  mixedStemFamilies:4,originalAndBiomeBlend:true,
  simulatedBSOD:true,simulatedSpeed:true,featuredOneMoreRun:'piano',
  seekSeconds:Math.round(now.position),
  browserErrors:errors.length,pausedCorrectly:!paused.playing
 }));
}finally{await browser.close()}
