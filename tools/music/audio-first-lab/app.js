/**
 * PRIVATE music-only 4x12 lab. The real game, physics and chased BSOD are not touched.
 * Source audio, biome candidates and true voice master share a 48-kHz sample clock.
 */
const $=s=>document.querySelector(s);
const clamp=(v,lo=0,hi=1)=>Math.max(lo,Math.min(hi,Number.isFinite(v)?v:lo));
const smooth=v=>{const x=clamp(v);return x*x*(3-2*x)};
const fmt=v=>Math.floor(v/60)+':'+String(Math.floor(v%60)).padStart(2,'0')+'.'+Math.floor((v%1)*10);
const familyNames=['melody','bass','drums','featured'];
const mix={melody:100,bass:100,drums:100,featured:100};
const loaded=new Map();const LIMIT=22;
const HOME='bitstream-bluffs';
let catalog=null,song=null,biome=HOME;
let ctx=null,buses=null,playing=false,position=0,deck=null,epoch=0,error=null,solo=null;
let bassMode='sampled',drumsMode='sampled',featuredMode='sampled',candyMode='new';
const roleCard=name=>document.querySelector('.stem[data-role="'+name+'"]');
const biomeLabel=id=>catalog?.biomes?.find(x=>x.id===id)?.label||id;
const status=(message,bad=false)=>{
 const elem=$('#status');elem.textContent=message;elem.classList.toggle('alert',bad);
};

function makeCorruption(context,target){
 const input=context.createGain(),filter=context.createBiquadFilter();
 filter.type='lowpass';filter.frequency.value=17500;
 const dry=context.createGain(),wet=context.createGain(),curve=context.createWaveShaper();
 const data=new Float32Array(2048);
 for(let i=0;i<data.length;i++){let x=i*2/(data.length-1)-1;data[i]=Math.tanh(3.3*x)/Math.tanh(3.3);}
 curve.curve=data;curve.oversample='2x';wet.gain.value=0;
 const pulse=context.createGain(),osc=context.createOscillator(),depth=context.createGain();
 osc.frequency.value=4;osc.type='sine';depth.gain.value=0;
 input.connect(filter);filter.connect(dry);dry.connect(pulse);
 filter.connect(curve);curve.connect(wet);wet.connect(pulse);
 osc.connect(depth);depth.connect(pulse.gain);
 pulse.connect(target);osc.start();
 return {input,filter,dry,wet,pulse,osc,depth};
}
async function initAudio(){
 if(ctx){await ctx.resume();return;}
 ctx=new AudioContext({latencyHint:'interactive'});
 const master=ctx.createGain();master.gain.value=.85;master.connect(ctx.destination);
 const melody=ctx.createGain(),drums=ctx.createGain();
 melody.connect(master);drums.connect(master);
 const bass=ctx.createGain(),bassEQ=ctx.createBiquadFilter(),bassLevel=ctx.createGain();
 bassEQ.type='lowshelf';bassEQ.frequency.value=155;
 bass.connect(bassEQ);bassEQ.connect(bassLevel);bassLevel.connect(master);
 buses={melody,drums,bass,bassEQ,bassLevel,
 guitar:makeCorruption(ctx,master),piano:makeCorruption(ctx,master),other:makeCorruption(ctx,master)};
 applyBSOD();applySpeed();
 await ctx.resume();
}
async function bufferFor(url){
 if(loaded.has(url)){
  const p=loaded.get(url);loaded.delete(url);loaded.set(url,p);return p;
 }
 const promise=(async()=>{
  const response=await fetch('/'+url);
  if(!response.ok)throw new Error('Audio missing '+url+' (HTTP '+response.status()+')');
  const decoded=await ctx.decodeAudioData(await response.arrayBuffer());
  if(decoded.duration<31.45)throw new Error('Excerpt has incorrect duration '+url);
  return decoded;
 })();
 loaded.set(url,promise);
 while(loaded.size>LIMIT)loaded.delete(loaded.keys().next().value);
 try{return await promise}catch(ex){loaded.delete(url);throw ex}
}
function getSpecs(){
 const s=song,b=biome,out=[];
 for(const stem of ['vocals','bass','drums','guitar','piano','other']){
  const role=stem==='vocals'?'melody':
   stem==='bass'?'bass':stem==='drums'?'drums':stem===s.featured?'featured':'unchanged';
  out.push({key:'original:'+stem,path:s.id+'/original/'+stem+'.ogg',
   group:role==='melody'?'melody':stem,role,kind:'original'});
 }
 if(s.melodyVariants!==false){
  const folder=(b==='candy-cane-canyon'&&candyMode==='new')?'melody-candy-v3':'melody';
  out.push({key:'biome:melody',path:s.id+'/'+folder+'/'+b+'.ogg',
   group:'melody',role:'melody',kind:'biome'});
 }
 if(b!==HOME){
  for(const role of ['bass','drums','featured']){
   const folder=role==='bass'?(bassMode==='dsp'?'bass-dsp':'bass'):
    role==='drums'?(drumsMode==='dsp'?'drums':'drums-sampled'):
    s.featured==='guitar'?'featured':
    featuredMode==='dsp'?'featured':'featured-sampled';
   out.push({key:'biome:'+role,path:s.id+'/'+folder+'/'+b+'.ogg',
    group:role==='featured'?s.featured:role,role,kind:'biome'});
  }
 }
 return out;
}
function currentPosition(){
 if(!playing||!deck||!ctx)return position;
 return clamp(deck.offset+Math.max(0,ctx.currentTime-deck.at),0,song.durationSeconds);
}
const hasVariant=r=>(r==='melody'?song?.melodyVariants!==false:biome!==HOME);
function roleGain(item){
 if(solo && item.role!==solo)return 0;
 if(item.role==='unchanged')return $('#unchanged').checked?0.8:0;
 const value=clamp(mix[item.role]/100);
 // Correlated A/B stems use LINEAR crossfade to avoid +3dB summation
 // at 50/50. Independent sampled melodies/basses use equal power.
 const correlated=(item.role==='drums'&&drumsMode==='dsp')||
  (item.role==='featured'&&featuredMode==='dsp'&&song.featured!=='guitar')||
  (item.role==='bass'&&bassMode==='dsp');
 if(item.kind==='biome')return correlated?value:Math.sin(value*Math.PI/2);
 if(!hasVariant(item.role))return 1;
 return correlated?1-value:Math.cos(value*Math.PI/2);
}
function applyMix(){
 if(!deck||!ctx)return;
 for(const item of deck.inputs){
  item.gain.gain.setTargetAtTime(roleGain(item),ctx.currentTime,.024);
 }
}
function stopDeck(old){
 if(!old||!ctx)return;
 const t=ctx.currentTime;
 for(const item of old.inputs){
  item.fade.gain.cancelScheduledValues(t);
  item.fade.gain.setTargetAtTime(0,t,.045);
 }
 setTimeout(()=>{for(const item of old.inputs){
  try{item.source.stop();item.source.disconnect();item.gain.disconnect();item.fade.disconnect();}catch{}
 }},340);
}
async function startAt(offset){
 const token=++epoch;
 const selectedSong=song,selectedBiome=biome;
 const specs=getSpecs();
 status('Loading '+selectedSong.label+' / '+biomeLabel(selectedBiome)+'…');
 const buffers=await Promise.all(specs.map(item=>bufferFor(item.path)));
 if(token!==epoch||!playing)return;
 const now=ctx.currentTime,at=now+.085;
 const seek=clamp(offset,0,selectedSong.durationSeconds-.10);
 const next={offset:seek,at,inputs:[],songId:selectedSong.id,biomeId:selectedBiome};
 for(let i=0;i<specs.length;i++){
  const spec=specs[i];
  const out=spec.group==='melody'?buses.melody:
   spec.group==='drums'?buses.drums:
   spec.group==='bass'?buses.bass:buses[spec.group]?.input;
  if(!out)throw new Error('Unknown audio group '+spec.group);
  const source=ctx.createBufferSource();
  source.buffer=buffers[i];
  const gain=ctx.createGain(),fade=ctx.createGain();
  fade.gain.setValueAtTime(0,now);fade.gain.linearRampToValueAtTime(1,at+.12);
  gain.gain.value=roleGain(spec);
  source.connect(gain);gain.connect(fade);fade.connect(out);
  next.inputs.push({...spec,source,gain,fade});
 }
 for(const item of next.inputs)item.source.start(at,seek);
 const previous=deck;
 deck=next;position=seek;
 stopDeck(previous);
 error=null;
 status('Playing '+selectedSong.label+' · '+biomeLabel(selectedBiome)+' · A/B synchronized');
}
async function play(on){
 try{
  if(on===playing)return;
  if(on){
   await initAudio();
   playing=true;$('#play').textContent='⏸ Pause';
   await startAt(position);
  }else{
   position=currentPosition();playing=false;++epoch;
   $('#play').textContent='▶ Play';
   stopDeck(deck);deck=null;
   status('Paused · ready for precise A/B comparison');
  }
 }catch(e){
  error=String(e);status(error,true);playing=false;$('#play').textContent='▶ Play';
 }
}
async function rebuild(reset=false,forcedPosition=null){
 const where=Number.isFinite(forcedPosition)?forcedPosition:reset?0:currentPosition();
 position=where;++epoch;
 if(!playing)return;
 try{await startAt(where)}catch(e){error=String(e);status(error,true)}
}
function setSolo(role){
 solo=solo===role?null:role;
 for(const card of document.querySelectorAll('.stem')){
  const active=card.dataset.role===solo;
  const button=card.querySelector('[data-solo]');
  if(button){
   button.classList.toggle('active',active);
   button.textContent=active?'✓ Solo active — restore full mix':'🎧 Solo this family';
   button.setAttribute('aria-pressed',String(active));
  }
 }
 applyMix();
 status(solo?'Soloing '+solo+' · other source families muted':'Full mix restored · independently compare original/biome');
}
function setBlend(role,value){
 if(!familyNames.includes(role))return;
 mix[role]=Math.round(clamp(Number(value)/100)*100);
 const card=roleCard(role);
 card.querySelector('input[type=range]').value=String(mix[role]);
 card.querySelector('.percent').textContent=mix[role]+'%';
 card.querySelectorAll('[data-value]').forEach(button=>
  button.classList.toggle('active',Number(button.dataset.value)===mix[role]));
 applyMix();
}
function renderInfo(){
 if(!song)return;
 const feat=song.featured;
 const newMelody=song.melodyVariants!==false;
 const melodyDescription=roleCard('melody').querySelector('.desc');
 melodyDescription.textContent=newMelody?
  'Original isolated Maxi vocal ↔ biome melodic instrument. 50/50 allows both.':
  'GUITAR SHOWCASE: this song has only its original vocal. Twelve new melody voices have NOT been produced. Listen to the featured guitar alternatives instead.';
 const candySelector=document.querySelector('.candy-only');
 candySelector.hidden=!(newMelody&&biome==='candy-cane-canyon');
 const kit=song.drumsInstruments?.[biome];
 $('#drumsInfo').textContent=biome===HOME?
  'Home: original drums remain unchanged (they fade when airborne in the planned game).':
  drumsMode==='sampled'?
   'Sampled airborne kit: '+(kit?.label||biome)+'; source drum-hit estimates, not a source EQ.':
   'Previous airy version: original drum recording with atmospheric filtering and echoes.';
 const feature=song.featuredInstruments?.[biome];
 const featureTitle=feature?.name||feature?.instrument;
 $('#featuredVersionInfo').textContent=song.featured==='guitar'?
  'Guitar showcase: original sampled guitar instruments remain untouched. There was no earlier effects-only Guitar set on this song.':
  featuredMode==='sampled'?
   'NEW sampled '+song.featured+' performance: '+(featureTitle||biome)+
   ' (note/chord transcription is preliminary).':
   'PREVIOUS effects-only '+song.featured+' texture: the original recording with filter/reverb effects.';
 $('#featuredMode').disabled=song.featured==='guitar';
 const bassName=song.bassInstruments?.[biome]?.description;
 $('#bassInfo').textContent=biome===HOME?'Original bass only in the home signal.':
  bassMode==='sampled'?'Sampled instrument: '+(bassName||'themed bass')+
   '. Note detection is experimental and should be checked by ear.':
   'V1: subtly recolored ORIGINAL bass spectrum; useful as a reference against the sampled instrument.';
 const instrumentalTitle=song.featuredInstruments?.[biome]?.instrument;
 $('#featuredInfo').textContent=feat.toUpperCase()+
  ' selected for this song by offline coverage ('+Math.round(song.activity[feat]*100)+
  '% meaningful activity). ORIGINAL '+feat+' ↔ themed replacement.'+
  (instrumentalTitle?' Current sampled instrument: '+instrumentalTitle+'.':'');
 $('#songMetadata').textContent=song.label+
  ' · 32-second extract from '+fmt(song.excerptStartSeconds)+
  ' · Original accompaniment activity: guitar '+Math.round(song.activity.guitar*100)+
  '%, piano '+Math.round(song.activity.piano*100)+
  '%, Other '+Math.round(song.activity.other*100)+'%.'+
  (newMelody?'':' Guitar-only demo: original Maxi vocal stays as recorded; synthetic melody variants not generated.');
 const home=biome===HOME;
 for(const role of ['melody','bass','drums','featured']){
  const card=roleCard(role);
  const disabled=role==='melody'?!newMelody:home;
  card.style.opacity=disabled?'.68':'1';
  card.querySelector('input[type=range]').disabled=disabled;
  card.querySelectorAll('[data-value]').forEach(button=>button.disabled=disabled);
 }
}
function setBiome(next){
 if(!catalog?.biomes.some(x=>x.id===next))return;
 biome=next;
 document.querySelectorAll('.mountain').forEach(button=>{
  const selected=button.dataset.biome===next;
  button.classList.toggle('selected',selected);
  button.setAttribute('aria-pressed',String(selected));
 });
 renderInfo();
 rebuild(false);
}
function setSong(id){
 const next=catalog?.songs.find(x=>x.id===id);
 if(!next)return;
 song=next;
 $('#song').value=id;
 $('#range').textContent='Original passage '+fmt(song.excerptStartSeconds)+
  '–'+fmt(song.excerptStartSeconds+song.durationSeconds);
 $('#seek').max=String(song.durationSeconds);
 position=0;
 renderInfo();rebuild(true);
}
function applyBSOD(){
 const raw=Number($('#bsod').value),value=smooth(raw/100);
 $('#bsodValue').textContent=raw<12?'Far / clean':
  raw<38?'Closing in':raw<70?'Dangerously close':
  raw<93?'Corruption imminent':'IMMINENT DELETION';
 if(!buses||!ctx)return;
 for(const group of ['guitar','piano','other']){
  const bus=buses[group],t=ctx.currentTime;
  bus.filter.frequency.setTargetAtTime(17500*Math.pow(1100/17500,value),t,.13);
  bus.wet.gain.setTargetAtTime(.54*value,t,.13);
  bus.dry.gain.setTargetAtTime(1-.19*value,t,.13);
  bus.pulse.gain.setTargetAtTime(1-.15*value,t,.13);
  bus.depth.gain.setTargetAtTime(.27*value,t,.13);
  bus.osc.frequency.setTargetAtTime(4+12*value,t,.15);
 }
}
function applySpeed(){
 const v=Number($('#speed').value),drive=smooth(clamp(v/600)),boost=smooth(clamp((v-900)/360));
 $('#speedValue').textContent=v+' px/s'+(v>900?' · OVERSPEED':'');
 if(!buses||!ctx)return;
 buses.bassLevel.gain.setTargetAtTime(.18+.74*drive+.22*boost,ctx.currentTime,.09);
 buses.bassEQ.gain.setTargetAtTime(-1+5*drive+4.5*boost,ctx.currentTime,.12);
}
function animate(){
 const now=currentPosition();
 $('#seek').value=String(now);
 $('#time').textContent=fmt(now);
 if(song&&playing&&now>=song.durationSeconds-.1){
  if($('#loop').checked)rebuild(true);
  else play(false);
 }
 requestAnimationFrame(animate);
}
function setup(){
 const selector=$('#song');
 for(const songItem of catalog.songs)selector.add(new Option(songItem.label,songItem.id));
 const grid=$('#mountains');
 for(const b of catalog.biomes){
  const button=document.createElement('button');
  button.type='button';button.className='mountain';
  button.dataset.biome=b.id;
  const strong=document.createElement('strong'),span=document.createElement('span');
  strong.textContent=b.label;span.textContent=b.description;
  button.append(strong,span);
  button.addEventListener('click',()=>setBiome(b.id));
  grid.append(button);
 }
 for(const role of familyNames){
  const card=roleCard(role);
  card.querySelector('input[type=range]').addEventListener('input',e=>setBlend(role,Number(e.target.value)));
  card.querySelectorAll('[data-value]').forEach(button=>
   button.addEventListener('click',()=>setBlend(role,Number(button.dataset.value))));
  setBlend(role,mix[role]);
  const soloButton=document.createElement('button');
  soloButton.className='solo-button';soloButton.type='button';
  soloButton.dataset.solo=role;soloButton.textContent='🎧 Solo this family';
  soloButton.setAttribute('aria-pressed','false');
  soloButton.addEventListener('click',()=>setSolo(role));
  card.append(soloButton);
 }
 document.querySelectorAll('[data-all]').forEach(button=>button.addEventListener('click',()=>{
  for(const role of familyNames)setBlend(role,Number(button.dataset.all));
 }));
 document.querySelectorAll('[data-danger]').forEach(button=>button.addEventListener('click',()=>{
  $('#bsod').value=button.dataset.danger;applyBSOD();
 }));
 document.querySelectorAll('[data-speed]').forEach(button=>button.addEventListener('click',()=>{
  $('#speed').value=button.dataset.speed;applySpeed();
 }));
 $('#bsod').addEventListener('input',applyBSOD);
 $('#speed').addEventListener('input',applySpeed);
 $('#unchanged').addEventListener('change',applyMix);
 $('#bassMode').addEventListener('change',e=>{
  bassMode=e.target.value==='dsp'?'dsp':'sampled';
  renderInfo();rebuild(false);
 });
 $('#drumsMode').addEventListener('change',e=>{
  drumsMode=e.target.value==='dsp'?'dsp':'sampled';
  renderInfo();rebuild(false);
 });
 $('#featuredMode').addEventListener('change',e=>{
  featuredMode=e.target.value==='dsp'?'dsp':'sampled';
  renderInfo();rebuild(false);
 });
 $('#candyMode').addEventListener('change',e=>{
  candyMode=e.target.value==='legacy'?'legacy':'new';
  renderInfo();rebuild(false);
 });
 $('#play').addEventListener('click',()=>play(!playing));
 $('#restart').addEventListener('click',()=>rebuild(true));
 $('#seek').addEventListener('change',e=>{position=clamp(Number(e.target.value),0,song.durationSeconds);rebuild(false,position)});
 $('#song').addEventListener('change',e=>setSong(e.target.value));
 setSong(catalog.songs[0].id);
 setBiome(HOME);
 applyBSOD();applySpeed();
 requestAnimationFrame(animate);
 window.__fourFamilyLab={
  getState:()=>({song:song?.id,biome,playing,position:currentPosition(),
   mix:{...mix},solo,bassMode,drumsMode,featuredMode,candyMode,simulatedBSOD:Number($('#bsod').value),speed:Number($('#speed').value),
   deckInputs:deck?.inputs.map(x=>x.key)||[],deckPaths:deck?.inputs.map(x=>x.path)||[],deckSong:deck?.songId||null,deckBiome:deck?.biomeId||null,deckOffset:deck?.offset??null,audioState:ctx?.state||null,error}),
  setBlend,setBiome,setSong,setSolo,play,
  seek:(v)=>{position=clamp(v,0,song.durationSeconds);return rebuild(false,position)},
 };
 status('Ready · click Play for synchronized original/biome A/B');
}
(async()=>{
 try{
  const response=await fetch('/catalog.json');
  if(!response.ok)throw new Error('Private audio catalog missing');
  catalog=await response.json();
  if(!Array.isArray(catalog.songs)||catalog.songs.length<2)throw new Error('Expected at least two songs');
  setup();
 }catch(e){status('Cannot start lab: '+String(e),true)}
})();
