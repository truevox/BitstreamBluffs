/** Private source-bound, original-six-stem beat candidate listening lab.
 * Never writes authoritative downbeats, never mutates game settings or song audio.
 */
const $=id=>document.getElementById(id);
const samplesPerSecond=48000;
let catalog=[],pack=null,candidates=null,ctx=null,active=[],session=0;
const KEY='bb-private-beat33-observations-v1';
const observations=(()=>{try{const value=JSON.parse(localStorage.getItem(KEY)||'{}');return value&&typeof value==='object'?value:{}}catch{return {}}})();
const status=text=>$('status').textContent=text;
const basename=id=>catalog.find(t=>t.id===id)?.manifest?.split('/').at(-2)||'';
const beatPath=(id)=>{
 const slot=Number(basename(id).split('_')[0]);
 if(!Number.isInteger(slot)||slot<1||slot>33)throw Error('Invalid source pack slot');
 return '/music-review/beat33/data/'+basename(id)+'.json';
};
const current=()=>catalog.find(t=>t.id===$('song').value);
const loadJson=async path=>{const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw Error('Missing research source: '+path+' ('+r.status+')');return r.json()};
function stop(){session++;for(const n of active){try{n.stop?.()}catch{}try{n.disconnect?.()}catch{}}active=[];status('Stopped. Original recordings and game state unchanged.')}
async function loadSong(){stop();const song=current();if(!song)return;try{
 status('Loading original source manifest and research evidence...');
 const [source,beats]=await Promise.all([
  loadJson('/music/'+song.manifest),loadJson(beatPath(song.id))]);
 if(source.id!==song.id||beats.trackId!==song.id||beats.status!=='UNVERIFIED_SOURCE_BEAT_CANDIDATES')
  throw Error('Source identity mismatch; refusing to play');
 if(!Array.isArray(source.segments)||source.segments.length<1||beats.candidateBeatPaths.length!==2)
  throw Error('Missing source-bound segment/beat evidence');
 pack=source;candidates=beats;$('segment').max=source.segments.length-1;$('segment').value=0;
 $('notes').value=observations[song.id]?.notes||'';
 update();status('Original source and machine candidates ready (unverified).');
}catch(e){pack=null;candidates=null;status('Unavailable: '+e.message)}}
function update(){const song=current();if(!pack||!candidates)return;
 const index=Number($('segment').value);const seg=pack.segments[index],sel=candidates.candidateBeatPaths[Number($('prior').value)];
 const st=seg.startFrame/samplesPerSecond,en=(seg.startFrame+seg.frames)/samplesPerSecond;
 $('section-title').textContent='#'+(index+1)+'/'+pack.segments.length+' · '+st.toFixed(2)+'–'+en.toFixed(2)+' seconds';
 const inWindow=sel.beatsSourceFrames48k.filter(frame=>frame>=seg.startFrame&&frame<seg.startFrame+seg.frames).length;
 const candidatesAgree=candidates.candidateBeatPaths.every(p=>Math.abs(p.algorithmEstimatedBpm-sel.algorithmEstimatedBpm)<5);
 $('metrics').replaceChildren();
 for(const [label,value] of [
  ['Est. pulse tempo',sel.algorithmEstimatedBpm+' BPM (not certified)'],
  ['Original duration',candidates.sourceSeconds.toFixed(1)+' seconds'],
  ['Proposed beats here',String(inWindow)],
  ['Drum/bass jointly support',''+sel.jointDrumBassSupportNotConfidence+' (not confidence)'],
  ['Two prior tempos agree?',candidatesAgree?'Within 5 BPM':'No — check half/double time'],
  ['Meter / first bar','UNVERIFIED']]){
  const card=document.createElement('div'),name=document.createElement('span');
  name.textContent=label;card.append(name,document.createTextNode(value));$('metrics').append(card);
 }
}
async function play(){if(!pack||!candidates)return;stop();const turn=session;
 const button=$('play');button.disabled=true;try{
 if(!ctx)ctx=new AudioContext();await ctx.resume();
 const song=current(),index=Number($('segment').value),seg=pack.segments[index];
 const keys=['drums','bass','guitar','piano','other','vocals'];
 const folder='/music/'+song.manifest.replace(/pack\.json$/,'');
 status('Decoding six original source stems...');
 const buffers=await Promise.all(keys.map(async key=>{
  const file=seg.sources[key];if(!file)throw Error('Missing original stem '+key);
  const r=await fetch(folder+file);if(!r.ok)throw Error('Original OGG unavailable '+file+' '+r.status);
  return ctx.decodeAudioData(await r.arrayBuffer());
 }));
 if(turn!==session)return;
 const when=ctx.currentTime+.15;
 const combined=ctx.createGain();combined.gain.value=.42;
 const compressor=ctx.createDynamicsCompressor();
 compressor.threshold.value=-11;compressor.ratio.value=6;
 compressor.attack.value=.003;compressor.release.value=.18;
 combined.connect(compressor);compressor.connect(ctx.destination);
 active.push(combined,compressor);
 for(const buffer of buffers){const node=ctx.createBufferSource();node.buffer=buffer;
  const gain=ctx.createGain();gain.gain.value=.22;
  node.connect(gain);gain.connect(combined);node.start(when);active.push(node,gain);
 }
 const variant=candidates.candidateBeatPaths[Number($('prior').value)];
 const accent=$('accent').value;
 variant.beatsSourceFrames48k.forEach((frame,idx)=>{
  if(frame<seg.startFrame||frame>=seg.startFrame+seg.frames)return;
  const at=when+(frame-seg.startFrame)/samplesPerSecond;
  const strong=accent!=='none'&&(idx%4===Number(accent));
  const oscillator=ctx.createOscillator(),gain=ctx.createGain();
  oscillator.type='sine';oscillator.frequency.value=strong?1250:740;
  gain.gain.setValueAtTime(0,at);
  gain.gain.linearRampToValueAtTime(strong?.092:.045,at+.002);
  gain.gain.exponentialRampToValueAtTime(.0001,at+.065);
  oscillator.connect(gain);gain.connect(ctx.destination);
  oscillator.start(at);oscillator.stop(at+.068);active.push(oscillator,gain);
 });
 status('Playing original recorded stems and UNVERIFIED beat candidate.');
 const duration=seg.frames/samplesPerSecond;
 window.setTimeout(()=>{if(session===turn)status('Source section finished. Choose another or replay.')},(duration+.2)*1000);
}catch(e){status('Playback failed: '+e.message)}finally{button.disabled=false}}
function saveNotes(){const id=$('song').value;if(!id)return;
 observations[id]={notes:$('notes').value,preferredTempoPrior:$('prior').value,
  preferredAccent:$('accent').value,lastSegment:Number($('segment').value),
  status:'HUMAN_OBSERVATION_ONLY_NOT_APPROVED_DOWNBEAT'};
 try{localStorage.setItem(KEY,JSON.stringify(observations))}catch{}}
$('song').addEventListener('change',loadSong);
$('segment').addEventListener('input',()=>{stop();update();saveNotes()});
$('prior').addEventListener('change',()=>{stop();update();saveNotes()});
$('accent').addEventListener('change',()=>{stop();update();saveNotes()});
$('notes').addEventListener('input',saveNotes);
$('stop').addEventListener('click',stop);
$('play').addEventListener('click',play);
$('export').addEventListener('click',()=>{
 saveNotes();const value={format:'bitstream-33-human-listening-observations-v1',
  exportedAt:new Date().toISOString(),status:'HUMAN_OBSERVATIONS_ONLY_NOT_GAME_BEAT_AUTHORITY',observations};
 const blob=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}),
  url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;
 a.download='bitstream-beat33-listening-notes.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
(async()=>{try{
 const response=await loadJson('/music/catalog.json');catalog=response.tracks;
 for(const song of catalog){const option=document.createElement('option');option.value=song.id;
  option.textContent=song.title;$('song').append(option)}
 if(!catalog.length)throw Error('No private source songs installed');
 await loadSong();
}catch(e){status('Private audio not installed: '+e.message)}})();
