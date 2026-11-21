/** Developer-only original recording cache router. Injected into the generated
 * shell worker but NEVER registered by production code. */
export function renderMusicRouteWorker() {
  return `
// Original Opus/Ogg files are served ONLY from complete SHA-256-checked groups.
// No synthesized stand-ins or runtime network-media cache are produced here.
const MUSIC_CACHE_PREFIX='bb-real-music-v1-';
const VERIFIED_MUSIC_GROUPS=new Map();
function musicHex(buffer){return [...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function validRecording(cache,entry){
  const stored=await cache.match(new URL(entry.url,self.location.origin));
  if(!stored||!stored.ok)return null;
  const bytes=await stored.clone().arrayBuffer();
  if(bytes.byteLength!==entry.bytes)return null;
  const digest=musicHex(await crypto.subtle.digest('SHA-256',bytes));
  return digest===entry.sha256?stored:null;
}
async function completeMusicGroup(cacheName){
  if(VERIFIED_MUSIC_GROUPS.has(cacheName))return VERIFIED_MUSIC_GROUPS.get(cacheName);
  if(!cacheName.startsWith(MUSIC_CACHE_PREFIX))return null;
  const suffix=cacheName.slice(MUSIC_CACHE_PREFIX.length);
  const match=/^(.+)-([a-f0-9]{20})$/.exec(suffix);
  if(!match)return null;
  const [,id,version]=match;
  const cache=await caches.open(cacheName);
  const marker=await cache.match(new URL('/.bitstream/offline-music-complete/'+encodeURIComponent(id)+'/'+version,self.location.origin));
  const inventory=await cache.match(new URL('/.bitstream/offline-music-integrity/'+encodeURIComponent(id)+'/'+version,self.location.origin));
  if(!marker?.ok||!inventory?.ok||await marker.text()!==id+':'+version)return null;
  let manifest;
  try{manifest=await inventory.json();}catch{return null;}
  if(manifest?.id!==id||manifest?.version!==version||!Array.isArray(manifest.entries)||
    !manifest.entries.length||manifest.entries.length>15000)return null;
  const quality=manifest.quality||null;
  const tiered=quality==='lite'||quality==='full';
  if(quality&&!tiered)return null;
  if(tiered&&(!/^[a-zA-Z0-9_-]{1,100}$/.test(manifest.songId)||
    typeof manifest.originalId!=='string'||id!==manifest.originalId+':'+quality))return null;
  const paths=new Set(),logicalPaths=new Set();
  for(const entry of manifest.entries){
    const path=entry?.logicalUrl||entry?.url;
    if(typeof path!=='string'||typeof entry?.url!=='string'||
      !path.startsWith('/music/packs/')||
      path.split('/').slice(3).some(part=>!/^[a-zA-Z0-9_.-]+$/.test(part))||
      path.includes('..')||entry.url.includes('..')||
      (tiered?(path.endsWith('.ogg')?
        entry.url!=='/music-variants/'+quality+path.slice('/music'.length):entry.url!==path)
        :entry.url!==path)||
      !Number.isSafeInteger(entry.bytes)||entry.bytes<1||
      !/^[a-f0-9]{64}$/.test(entry.sha256)||paths.has(entry.url)||logicalPaths.has(path))return null;
    paths.add(entry.url);logicalPaths.add(path);
    if(!await validRecording(cache,entry))return null;
  }
  const group={cache,quality,songId:manifest.songId||null,originalId:manifest.originalId||null,
    entries:new Map(manifest.entries.map(e=>[e.logicalUrl||e.url,e]))};
  VERIFIED_MUSIC_GROUPS.set(cacheName,group);
  return group;
}
const QUALITY_POLICY_CACHE='bb-music-preference-v1';
const QUALITY_POLICY_PATH='/.bitstream/music-preference';
function validQualityPolicy(policy){
  if(!policy||!['high','saver','off'].includes(policy.mode)||
    !Array.isArray(policy.songs)||policy.songs.length>64)return false;
  const ids=new Set();
  for(const song of policy.songs){
    if(!song||typeof song.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(song.id)||
      !['lite','full'].includes(song.activeQuality)||!Array.isArray(song.required)||
      !song.required.length||song.required.length>64||ids.has(song.id)||
      new Set(song.required).size!==song.required.length||
      song.required.some(x=>typeof x!=='string'||!/^[a-zA-Z0-9:_-]{1,100}$/.test(x)))return false;
    ids.add(song.id);
  }
  return true;
}
async function qualityPolicy(){
  const cache=await caches.open(QUALITY_POLICY_CACHE);
  const data=await cache.match(new URL(QUALITY_POLICY_PATH,self.location.origin));
  if(!data)return null;
  try{const obj=await data.json();return validQualityPolicy(obj)?obj:null;}catch{return null;}
}
async function tieredMusicFromCache(path,policy){
  // OFF is a hard no-network/no-media policy. The application must also mute
  // the actual music transport: returning 503 cannot by itself stop synth FX.
  if(policy.mode==='off')return new Response('Music disabled by player preference.',
    {status:503,headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
  const all=[];
  for(const name of await caches.keys()){
    if(!name.startsWith(MUSIC_CACHE_PREFIX))continue;
    const group=await completeMusicGroup(name);
    if(group?.quality)all.push(group);
  }
  const song=policy.songs.find(s=>all.some(g=>g.songId===s.id&&g.entries.has(path)));
  if(!song)return null;
  const ready=q=>song.required.every(id=>all.some(g=>g.songId===song.id&&
    g.originalId===id&&g.quality===q));
  // Space saver is Lite-only. Never silently serve an available Full
  // recording instead of the user-selected space-saving representation.
  const requested=policy.mode==='saver'?'lite':song.activeQuality;
  const chosen=policy.mode==='saver'?(ready('lite')?'lite':null):
    ready(requested)?requested:ready('lite')?'lite':ready('full')?'full':null;
  if(!chosen)return null;
  const group=all.find(g=>g.songId===song.id&&g.quality===chosen&&g.entries.has(path));
  if(!group)return null;
  return await validRecording(group.cache,group.entries.get(path));
}
async function realMusicFromCache(path){
  const policy=await qualityPolicy();
  if(policy)return await tieredMusicFromCache(path,policy);
  // Legacy original-quality developer test flow, unchanged until the player
  // explicitly sets a tier preference. Never blend with opted-in tiered data.
  for(const name of await caches.keys()){
    if(!name.startsWith(MUSIC_CACHE_PREFIX))continue;
    const group=await completeMusicGroup(name);
    if(!group||group.quality||!group.entries.has(path))continue;
    const response=await validRecording(group.cache,group.entries.get(path));
    if(response)return response;
    VERIFIED_MUSIC_GROUPS.delete(name);
  }
  return null;
}
self.addEventListener('message',event=>{
  if(event.data?.type==='bb-music-cache-updated')VERIFIED_MUSIC_GROUPS.clear();
  if(event.data?.type==='bb-set-music-preference'){
    const source=event.source,port=event.ports?.[0];
    if(!source?.url||new URL(source.url).origin!==self.location.origin||
      !validQualityPolicy(event.data.policy)){
      port?.postMessage({ok:false,error:'Invalid music preference or origin'});
      return;
    }
    event.waitUntil((async()=>{
      try{
        const cache=await caches.open(QUALITY_POLICY_CACHE);
        await cache.put(new URL(QUALITY_POLICY_PATH,self.location.origin),
          new Response(JSON.stringify(event.data.policy),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}));
        VERIFIED_MUSIC_GROUPS.clear();
        // Reply only AFTER the new setting is durably stored. No race with
        // the next fetch, and no optimistic acknowledgment before failure.
        port?.postMessage({ok:true});
      }catch{
        port?.postMessage({ok:false,error:'Failed to persist music preference'});
      }
    })());
  }
});
`;
}
