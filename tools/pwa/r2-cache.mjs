/** Explicit-consent, developer-only verified cache for the immutable #333 release. */
export const R2_BASE='https://bsb-audio.bearcave.win/releases/20261124-69a6fb46/';
export const MELODY_R2_BASE='https://bsb-audio.bearcave.win/releases/20261124-melody-only-748a0670/';
const PREFIX='bb-r2-recordings-v1-';
function releaseUrl(url){
  if(typeof url!=='string')return false;
  const base=[R2_BASE,MELODY_R2_BASE].find(b=>url.startsWith(b));if(!base)return false;
  const key=url.slice(base.length);
  return (/^(?:catalog\.json|packs\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.\/-]+)$/.test(key)||
    (base===MELODY_R2_BASE&&/^music-variants\/(?:lite|full)\/packs\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.\/-]+\.ogg$/.test(key)))&&!key.split('/').some(p=>!p||p==='.'||p==='..');
}
function scopePath(scope){if(typeof scope!=='string'||!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(scope))throw Error('Invalid cache scope');return scope;}
function cachePrefix(scope){return PREFIX+encodeURIComponent(scopePath(scope))+'-';}
function groupShape(group){
  if(!group||!(/^[A-Za-z0-9:_-]{1,180}$/).test(group.id)||!(/^[a-f0-9]{20}$/).test(group.version)||!Array.isArray(group.entries)||!group.entries.length||group.entries.length>15000)throw Error('Invalid R2 group');
  const seen=new Set();
  for(const e of group.entries){if(!e||!releaseUrl(e.url)||!Number.isSafeInteger(e.bytes)||e.bytes<1||!(/^[a-f0-9]{64}$/).test(e.sha256)||seen.has(e.url))throw Error('Invalid R2 entry');seen.add(e.url);}
}
async function digest(bytes,subtle){return [...new Uint8Array(await subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function groupCheck(group,subtle){groupShape(group);if((await digest(new TextEncoder().encode(JSON.stringify(group.entries)),subtle)).slice(0,20)!==group.version)throw Error('R2 group version mismatch');}
function groupName(group,scope){return cachePrefix(scope)+group.id+'-'+group.version;}
function markerUrl(group,origin,scope){return new URL(scope+'.bitstream/r2-complete/'+encodeURIComponent(group.id)+'/'+group.version,origin).href;}
async function verifiedResponse(cache,e,subtle){const r=await cache.match(e.url);if(!r?.ok||r.type==='opaque')return null;const b=await r.clone().arrayBuffer();return b.byteLength===e.bytes&&await digest(b,subtle)===e.sha256?r:null;}
export async function catalogCacheGroup(entry,subtle){const entries=[entry];return {id:'release-catalog',version:(await digest(new TextEncoder().encode(JSON.stringify(entries)),subtle)).slice(0,20),entries};}
/** Full readiness is verified, not inferred from an old completion marker. */
export async function inspectR2Group(group,{storage,origin,scope,subtle}){
  await groupCheck(group,subtle);const cache=await storage.open(groupName(group,scope));
  const marker=await cache.match(markerUrl(group,origin,scope));let complete=false;
  if(marker?.ok){try{const saved=await marker.json();complete=saved.id===group.id&&saved.version===group.version&&JSON.stringify(saved.entries)===JSON.stringify(group.entries);}catch{}}
  let missingBytes=0,verifiedBytes=0;
  for(const e of group.entries){if(await verifiedResponse(cache,e,subtle))verifiedBytes+=e.bytes;else missingBytes+=e.bytes;}
  return {ready:complete&&missingBytes===0,missingBytes,verifiedBytes};
}
export async function downloadR2Group(group,{storage,origin,scope,subtle,fetcher,consent=false,signal,onProgress=()=>{},concurrency=4}){
  if(consent!==true)throw Error('Explicit download consent required');
  scopePath(scope);await groupCheck(group,subtle);
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw Error('Invalid download concurrency');
  const cache=await storage.open(groupName(group,scope)),marker=markerUrl(group,origin,scope);
  await cache.delete(marker);let next=0,completed=0,bytes=0,failure=null;
  const aborted=()=>{if(signal?.aborted)throw Error('R2 download aborted');};
  await Promise.all(Array.from({length:Math.min(concurrency,group.entries.length)},async()=>{
    while(!failure&&next<group.entries.length){const e=group.entries[next++];try{
      aborted();if(!await verifiedResponse(cache,e,subtle)){
        const r=await fetcher(e.url,{mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',signal});
        if(!r.ok||r.type==='opaque'||r.url!==e.url)throw Error('Invalid R2 CORS response: '+e.url);
        const b=await r.arrayBuffer();if(b.byteLength!==e.bytes||await digest(b,subtle)!==e.sha256)throw Error('R2 asset integrity mismatch: '+e.url);
        aborted();await cache.put(e.url,new Response(b,{headers:{'Content-Type':r.headers.get('Content-Type')||'application/octet-stream'}}));
      }
      aborted();completed++;bytes+=e.bytes;onProgress({completed,total:group.entries.length,bytes});
    }catch(e){failure??=e;}}
  }));
  if(failure)throw failure;aborted();
  await cache.put(marker,new Response(JSON.stringify({id:group.id,version:group.version,entries:group.entries}),{headers:{'Content-Type':'application/json'}}));
  if(signal?.aborted){await cache.delete(marker);aborted();}
  return {completed,bytes};
}
/** Deliberately separate namespace from the legacy same-origin music caches. */
export function renderR2RouteWorker(){return `
const R2_BASE=${JSON.stringify(R2_BASE)};
const MELODY_R2_BASE=${JSON.stringify(MELODY_R2_BASE)};
const PREFIX=${JSON.stringify(PREFIX)};
${[releaseUrl,scopePath,cachePrefix,groupShape,digest,groupCheck,groupName,markerUrl,verifiedResponse].map(f=>f.toString()).join('\n')}
const R2_VERIFIED=new Set();
async function cachedR2(url){
  for(const name of await caches.keys()){
    if(!name.startsWith(cachePrefix(BASE)))continue;
    const suffix=name.slice(cachePrefix(BASE).length),match=/^(.+)-([a-f0-9]{20})$/.exec(suffix);if(!match)continue;
    const cache=await caches.open(name),marker=markerUrl({id:match[1],version:match[2]},self.location.origin,BASE);
    const record=await cache.match(marker);if(!record?.ok){R2_VERIFIED.delete(name);continue;}
    let group;try{group=await record.json();await groupCheck(group,crypto.subtle);if(groupName(group,BASE)!==name)continue;}catch{continue;}
    const entry=group.entries.find(e=>e.url===url);if(!entry)continue;
    const keys=new Set((await cache.keys()).map(r=>r.url));
    if(group.entries.some(e=>!keys.has(e.url))){R2_VERIFIED.delete(name);continue;}
    if(!R2_VERIFIED.has(name)){
      let valid=true;for(const e of group.entries)if(!await verifiedResponse(cache,e,crypto.subtle)){valid=false;break;}
      if(!valid)continue;R2_VERIFIED.add(name);
    }
    const r=await verifiedResponse(cache,entry,crypto.subtle);if(r)return r;
    R2_VERIFIED.delete(name);
  }
  return null;
}
self.addEventListener('message',e=>{if(e.data?.type==='bb-r2-cache-updated')R2_VERIFIED.clear();});
`;}
