/** Preview-only published melody tiers; byte integrity is delegated to R2 group storage.
 * Controlled clients pin their own tier; the last explicit selection becomes the next-client default. */
import {MELODY_R2_BASE,downloadR2Group,inspectR2Group,catalogCacheGroup} from './r2-cache.mjs';
const MELODY_POLICY='bb-melody-policy-v1-';
function melodyPolicyName(scope){if(typeof scope!=='string'||!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(scope))throw Error('Invalid melody scope');return MELODY_POLICY+encodeURIComponent(scope);}
function melodyPolicyUrl(origin,scope){return new URL(scope+'.bitstream/melody-policy',origin).href;}
function melodyEntry(e,quality){
 const tail=e?.logicalUrl?.slice(MELODY_R2_BASE.length);
 if(!e?.logicalUrl?.startsWith(MELODY_R2_BASE)||!/^packs\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.\/-]+\.ogg$/.test(tail)||tail.split('/').some(p=>!p||p==='.'||p==='..')||e.url!==MELODY_R2_BASE+'music-variants/'+quality+'/'+tail||!Number.isSafeInteger(e.bytes)||e.bytes<1||!(/^[a-f0-9]{64}$/).test(e.sha256))throw Error('Invalid melody mapping');
 return e;
}
function requiredGroups(plan,quality){if(plan?.release!==MELODY_R2_BASE||!['lite','full'].includes(quality)||!Array.isArray(plan.groups))throw Error('Invalid melody plan');const groups=plan.groups.filter(g=>g.quality===quality&&g.priority==='required');if(!groups.length)throw Error('No required melody groups');const seen=new Set();for(const g of groups)for(const e of g.entries){if(e.logicalUrl.endsWith('.ogg')){melodyEntry(e,quality);if(seen.has(e.logicalUrl))throw Error('Duplicate melody mapping');seen.add(e.logicalUrl);}else if(e.url!==e.logicalUrl||!e.url.startsWith(MELODY_R2_BASE))throw Error('Invalid melody metadata');}return groups;}
export async function stagePublishedMelody(plan,quality,opts){if(opts.consent!==true)throw Error('Explicit melody download consent required');const groups=requiredGroups(plan,quality);const catalog=await catalogCacheGroup(plan.catalog,opts.subtle);for(const g of [catalog,...groups])await downloadR2Group(g,opts);return {groups:groups.length,bytes:groups.reduce((n,g)=>n+g.bytes,0)};}
export async function activatePublishedMelody(plan,quality,opts){
 if(opts.stopped!==true)throw Error('Stopped transport required');const {storage,origin,scope,worker}=opts;let groups=[];
 if(quality!==null){groups=requiredGroups(plan,quality);const catalog=await catalogCacheGroup(plan.catalog,opts.subtle);for(const g of [catalog,...groups])if(!(await inspectR2Group(g,opts)).ready)throw Error('Melody tier incomplete');}
 const selection={quality,groups};
 if(worker){await new Promise((resolve,reject)=>{const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();reject(Error('Tier activation acknowledgement timed out'));},15000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();e.data?.ok?resolve():reject(Error(e.data?.error||'Tier activation rejected'));};worker.postMessage({type:'bb-melody-select',selection},[channel.port2]);});return;}
 // Explicit legacy developer fixture only; production must use a controlled worker.
 const cache=await storage.open(melodyPolicyName(scope));await cache.put(melodyPolicyUrl(origin,scope),new Response(JSON.stringify(selection),{headers:{'Content-Type':'application/json'}}));
}
/** Append only fully verified newly-required recordings to THIS controlled
 * client's current quality. Never switch tier, pause, remove a recording,
 * or fetch a missing file. Safe while the existing soundtrack is playing. */
export async function appendVerifiedMelodyGroups(groups,opts){
 if(!groups?.length||!opts.worker)return {added:0,groupIds:[]};
 const knownCacheNames=typeof opts.storage?.keys==='function'?new Set(await opts.storage.keys()):null,ready=[];
 for(const g of groups){
  if(g.priority!=='required'||!['lite','full'].includes(g.quality))throw Error('Invalid melody tier extension');
  if((await inspectR2Group(g,{...opts,knownCacheNames})).ready)ready.push(g);
 }
 if(!ready.length)return {added:0,groupIds:[]};
 const ack=await new Promise((resolve,reject)=>{
  const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(Error('Melody extension acknowledgement timed out'));},15000);
  channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();e.data?.ok?resolve(e.data):reject(Error(e.data?.error||'Melody extension rejected'));};
  opts.worker.postMessage({type:'bb-melody-extend',groups:ready},[channel.port2]);
 });
 return {added:ack.added??ready.length,groupIds:ready.map(g=>g.id)};
}
export function renderMelodyTierRouter(){return `
const MELODY_POLICY=${JSON.stringify(MELODY_POLICY)};
${[melodyPolicyName,melodyPolicyUrl,melodyEntry].map(f=>f.toString()).join('\n')}
let melodyQueue=Promise.resolve();
function melodySerial(fn){const next=melodyQueue.then(fn,fn);melodyQueue=next.catch(()=>{});return next;}
function melodyClientUrl(id){return melodyPolicyUrl(self.location.origin,BASE)+'/client/'+encodeURIComponent(id);}
function melodyRevisionUrl(id){return melodyPolicyUrl(self.location.origin,BASE)+'/revision/'+id;}
const melodyJSON=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
async function melodyDefault(cache){const r=await cache.match(melodyPolicyUrl(self.location.origin,BASE));if(!r)return null;const data=await r.json();if(typeof data.revision==='string')return data.revision;
 // Read old direct preview selection without changing it.
 const id=await digest(new TextEncoder().encode(JSON.stringify(data)),crypto.subtle);await cache.put(melodyRevisionUrl(id),melodyJSON(data));return id;
}
async function melodyPin(cache,id,revision){await cache.put(melodyClientUrl(id),melodyJSON({revision}));}
async function melodyReadClient(clientId){return melodySerial(async()=>{
 const cache=await caches.open(melodyPolicyName(BASE));let revision;
 if(clientId){const pin=await cache.match(melodyClientUrl(clientId));if(pin)revision=(await pin.json()).revision;else{revision=await melodyDefault(cache);await melodyPin(cache,clientId,revision);}}
 else revision=await melodyDefault(cache);
 if(!revision)return null;const record=await cache.match(melodyRevisionUrl(revision));return record?record.json():{quality:null,groups:[]};
 });}
async function melodyExtend(source,groups){
 if(!source?.id||!source.url||new URL(source.url).origin!==self.location.origin||!new URL(source.url).pathname.startsWith(BASE)||!Array.isArray(groups)||groups.length>200)throw Error('Invalid melody extension sender');
 const policy=await caches.open(melodyPolicyName(BASE)),pin=await policy.match(melodyClientUrl(source.id));
 const oldRevision=pin?(await pin.json()).revision:await melodyDefault(policy);
 if(typeof oldRevision!=='string')throw Error('No active melody tier');
 const priorRecord=await policy.match(melodyRevisionUrl(oldRevision));if(!priorRecord)throw Error('Missing melody tier revision');
 const prior=await priorRecord.json();if(!['lite','full'].includes(prior.quality)||!Array.isArray(prior.groups))throw Error('Not an active melody tier');
 const ids=new Map(prior.groups.map(g=>[g.id,g])),urls=new Set(prior.groups.flatMap(g=>g.entries.map(e=>e.logicalUrl)));
 const names=new Set(await caches.keys()),verified=[];
 for(const g of groups){
  if(g.quality!==prior.quality||g.priority!=='required')throw Error('Extension would change current tier');
  await groupCheck(g,crypto.subtle);
  if(ids.has(g.id)){if(JSON.stringify(ids.get(g.id))!==JSON.stringify(g))throw Error('Conflicting existing melody group');continue;}
  const name=groupName(g,BASE);if(!names.has(name))throw Error('Uncached melody extension');
  const recordings=await caches.open(name),marker=await recordings.match(markerUrl(g,self.location.origin,BASE));if(!marker?.ok)throw Error('Unverified melody extension');
  const saved=await marker.json();if(saved.id!==g.id||saved.version!==g.version||JSON.stringify(saved.entries)!==JSON.stringify(g.entries))throw Error('Mismatched melody group marker');
  for(const entry of g.entries){
   if(urls.has(entry.logicalUrl))throw Error('Extension overlaps existing playback');
   if(entry.logicalUrl.endsWith('.ogg'))melodyEntry(entry,prior.quality);
   else if(entry.url!==entry.logicalUrl||!entry.url.startsWith(MELODY_R2_BASE))throw Error('Invalid extension metadata');
   if(!await verifiedResponse(recordings,entry,crypto.subtle))throw Error('Incomplete melody extension');
   urls.add(entry.logicalUrl);
  }
  ids.set(g.id,g);verified.push(g);
 }
 if(!verified.length)return {added:0};
 const updated={quality:prior.quality,groups:[...prior.groups,...verified]},revision=await digest(new TextEncoder().encode(JSON.stringify(updated)),crypto.subtle);
 await policy.put(melodyRevisionUrl(revision),melodyJSON(updated));await melodyPin(policy,source.id,revision);
 if(await melodyDefault(policy)===oldRevision)await policy.put(melodyPolicyUrl(self.location.origin,BASE),melodyJSON({revision}));
 return {added:verified.length};
}
self.addEventListener('message',event=>{
 if(event.data?.type!=='bb-melody-select'&&event.data?.type!=='bb-melody-extend')return;const port=event.ports[0];
 event.waitUntil(melodySerial(async()=>{
  if(event.data.type==='bb-melody-extend')return melodyExtend(event.source,event.data.groups);
  const source=event.source,selection=event.data.selection;
  if(!source?.id||!source.url||new URL(source.url).origin!==self.location.origin||!new URL(source.url).pathname.startsWith(BASE)||!selection||![null,'lite','full'].includes(selection.quality)||!Array.isArray(selection.groups))throw Error('Invalid melody selection client');
  if(selection.quality===null&&selection.groups.length)throw Error('Invalid silent selection');
  if(selection.quality!==null){if(!selection.groups.length)throw Error('Empty melody selection');for(const g of selection.groups){if(g.quality!==selection.quality||g.priority!=='required')throw Error('Wrong group quality');await groupCheck(g,crypto.subtle);}}
  const cache=await caches.open(melodyPolicyName(BASE)),prior=await melodyDefault(cache),clients=await self.clients.matchAll({type:'window'}),live=new Set(clients.map(c=>c.id));
  // Pin existing clients BEFORE updating the next-client default. A playing
  // tab keeps its original tier even if another tab selects a different one.
  for(const c of clients){if(c.id!==source.id&&new URL(c.url).pathname.startsWith(BASE)&&!await cache.match(melodyClientUrl(c.id)))await melodyPin(cache,c.id,prior);}
  const revision=await digest(new TextEncoder().encode(JSON.stringify(selection)),crypto.subtle);await cache.put(melodyRevisionUrl(revision),melodyJSON(selection));await melodyPin(cache,source.id,revision);await cache.put(melodyPolicyUrl(self.location.origin,BASE),melodyJSON({revision}));
  // Only obsolete client pointers are removed; cached recordings are retained.
  const prefix=melodyPolicyUrl(self.location.origin,BASE)+'/client/';for(const key of await cache.keys())if(key.url.startsWith(prefix)&&!live.has(decodeURIComponent(key.url.slice(prefix.length)))&&key.url!==melodyClientUrl(source.id))await cache.delete(key);
 }).then(result=>port?.postMessage({ok:true,...result}),e=>port?.postMessage({ok:false,error:String(e.message||e)})));
});
async function melodyTierResponse(url,clientId){
 if(!url.startsWith(MELODY_R2_BASE+'packs/')||!url.endsWith('.ogg'))return undefined;
 const selection=await melodyReadClient(clientId);if(!selection)return undefined;
 const unavailable=()=>new Response('Selected melody tier unavailable',{status:503,headers:{'Cache-Control':'no-store'}});
 try{const {quality,groups}=selection;if(!['lite','full'].includes(quality)||!Array.isArray(groups))return unavailable();
  const group=groups.find(g=>g.entries.some(e=>e.logicalUrl===url));if(!group)return unavailable();await groupCheck(group,crypto.subtle);
  const entry=melodyEntry(group.entries.find(e=>e.logicalUrl===url),quality),name=groupName(group,BASE),cache=await caches.open(name);
  const marker=await cache.match(markerUrl(group,self.location.origin,BASE));if(!marker?.ok)return unavailable();const saved=await marker.json();if(saved.id!==group.id||saved.version!==group.version||JSON.stringify(saved.entries)!==JSON.stringify(group.entries))return unavailable();
  const keys=new Set((await cache.keys()).map(k=>k.url));if(group.entries.some(e=>!keys.has(e.url)))return unavailable();return await verifiedResponse(cache,entry,crypto.subtle)||unavailable();
 }catch{return unavailable();}
}
`;}
