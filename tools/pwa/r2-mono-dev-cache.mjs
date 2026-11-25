/** Developer-only local candidate tier cache. No published derivative URLs or production registration. */
const RELEASE='https://bsb-audio.bearcave.win/releases/20261124-69a6fb46/';
const TIER_PREFIX='bb-r2-mono-dev-v1-';
function tierScope(scope){if(typeof scope!=='string'||!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(scope))throw Error('Invalid tier scope');return scope;}
function tierName(scope,quality){tierScope(scope);if(!['lite','full','policy'].includes(quality))throw Error('Invalid tier name');return TIER_PREFIX+encodeURIComponent(scope)+'-'+quality;}
function tierMarker(origin,scope,kind){return new URL(scope+'.bitstream/mono-dev/'+kind,origin).href;}
function tierEntries(groups,quality){
 const selected=groups.filter(g=>g.priority==='required'&&g.quality===quality);if(!selected.length)throw Error('No required tier groups');
 const entries=new Map();for(const g of selected){for(const e of g.entries){if(!e.objectKey)continue;
  const tail=e.logicalUrl?.slice(RELEASE.length);if(!e.logicalUrl?.startsWith(RELEASE)||!/^packs\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.\/-]+\.ogg$/.test(tail)||tail.split('/').some(p=>!p||p==='.'||p==='..')||e.objectKey!=='music-variants/'+quality+'/'+tail||!Number.isSafeInteger(e.bytes)||e.bytes<1||!(/^[a-f0-9]{64}$/).test(e.sha256)||entries.has(e.logicalUrl))throw Error('Invalid candidate stem');entries.set(e.logicalUrl,e);
 }}if(!entries.size)throw Error('Empty candidate tier');return [...entries.values()];
}
async function tierHash(bytes,subtle){return [...new Uint8Array(await subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function tierValid(cache,e,subtle){const r=await cache.match(e.logicalUrl);if(!r?.ok)return null;const b=await r.clone().arrayBuffer();return b.byteLength===e.bytes&&await tierHash(b,subtle)===e.sha256?r:null;}
export async function stageMonoTier(groups,quality,{storage,origin,scope,subtle,fetcher,consent=false}){
 if(!consent)throw Error('Explicit candidate download consent required');const entries=tierEntries(groups,quality),cache=await storage.open(tierName(scope,quality)),marker=tierMarker(origin,scope,quality);await cache.delete(marker);
 for(const e of entries){if(await tierValid(cache,e,subtle))continue;const url=new URL(scope+e.objectKey,origin).href;const r=await fetcher(url,{cache:'no-store',redirect:'error',credentials:'same-origin'});if(!r.ok||r.url!==url)throw Error('Unexpected candidate response');const b=await r.arrayBuffer();if(b.byteLength!==e.bytes||await tierHash(b,subtle)!==e.sha256)throw Error('Candidate integrity mismatch');await cache.put(e.logicalUrl,new Response(b,{headers:{'Content-Type':'audio/ogg'}}));}
 await cache.put(marker,new Response(JSON.stringify(entries),{headers:{'Content-Type':'application/json'}}));return {count:entries.length,bytes:entries.reduce((n,e)=>n+e.bytes,0)};
}
export async function activateMonoTier(quality,groups,{storage,origin,scope,subtle,stopped=false}){
 if(quality!==null&&!stopped)throw Error('Stopped transport required');
 if(quality!==null){const entries=tierEntries(groups,quality),cache=await storage.open(tierName(scope,quality)),r=await cache.match(tierMarker(origin,scope,quality));if(!r?.ok||JSON.stringify(await r.json())!==JSON.stringify(entries))throw Error('Candidate tier not complete');for(const e of entries)if(!await tierValid(cache,e,subtle))throw Error('Candidate tier not verified');}
 const policy=await storage.open(tierName(scope,'policy'));await policy.put(tierMarker(origin,scope,'active'),new Response(JSON.stringify({quality}),{headers:{'Content-Type':'application/json'}}));
}
export function renderMonoDevRouter(){return `
const RELEASE=${JSON.stringify(RELEASE)},TIER_PREFIX=${JSON.stringify(TIER_PREFIX)};
${[tierScope,tierName,tierMarker,tierHash,tierValid].map(f=>f.toString()).join('\n')}
async function monoDevResponse(url){
 const policy=await caches.open(tierName(BASE,'policy')),r=await policy.match(tierMarker(self.location.origin,BASE,'active'));if(!r)return undefined;
 const unavailable=()=>new Response('Selected mono candidate is unavailable',{status:503,headers:{'Cache-Control':'no-store'}});
 try{const {quality}=await r.json();if(!['lite','full'].includes(quality))return unavailable();const cache=await caches.open(tierName(BASE,quality)),marker=await cache.match(tierMarker(self.location.origin,BASE,quality));if(!marker?.ok)return unavailable();const entries=await marker.json(),e=entries.find(e=>e.logicalUrl===url);if(!e)return unavailable();const keys=new Set((await cache.keys()).map(k=>k.url));if(entries.some(e=>!keys.has(e.logicalUrl)))return unavailable();return await tierValid(cache,e,crypto.subtle)||unavailable();}catch{return unavailable();}
}
`;}
