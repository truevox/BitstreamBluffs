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
  const paths=new Set();
  for(const entry of manifest.entries){
    if(!entry?.url?.startsWith('/music/packs/')||entry.url.includes('..')||
      !Number.isSafeInteger(entry.bytes)||entry.bytes<1||
      !/^[a-f0-9]{64}$/.test(entry.sha256)||paths.has(entry.url))return null;
    paths.add(entry.url);
    if(!await validRecording(cache,entry))return null;
  }
  const group={cache,entries:new Map(manifest.entries.map(e=>[e.url,e]))};
  VERIFIED_MUSIC_GROUPS.set(cacheName,group);
  return group;
}
async function realMusicFromCache(path){
  for(const name of await caches.keys()){
    if(!name.startsWith(MUSIC_CACHE_PREFIX))continue;
    const group=await completeMusicGroup(name);
    if(!group?.entries.has(path))continue;
    const response=await validRecording(group.cache,group.entries.get(path));
    if(response)return response;
    VERIFIED_MUSIC_GROUPS.delete(name);
  }
  return null;
}
self.addEventListener('message',event=>{
  if(event.data?.type==='bb-music-cache-updated')VERIFIED_MUSIC_GROUPS.clear();
});
`;
}
