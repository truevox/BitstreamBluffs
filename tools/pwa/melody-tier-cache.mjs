/** Preview-only published melody tiers; byte integrity is delegated to R2 group storage.
 * Persistent selection is scope-wide. Multi-client transport coordination is NOT shipped. */
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
export async function activatePublishedMelody(plan,quality,opts){if(opts.stopped!==true)throw Error('Stopped transport required');const {storage,origin,scope}=opts;let groups=[];if(quality!==null){groups=requiredGroups(plan,quality);const catalog=await catalogCacheGroup(plan.catalog,opts.subtle);for(const g of [catalog,...groups])if(!(await inspectR2Group(g,opts)).ready)throw Error('Melody tier incomplete');}const cache=await storage.open(melodyPolicyName(scope));await cache.put(melodyPolicyUrl(origin,scope),new Response(JSON.stringify({quality,groups}),{headers:{'Content-Type':'application/json'}}));}
export function renderMelodyTierRouter(){return `
const MELODY_POLICY=${JSON.stringify(MELODY_POLICY)};
${[melodyPolicyName,melodyPolicyUrl,melodyEntry].map(f=>f.toString()).join('\n')}
async function melodyTierResponse(url){
 if(!url.startsWith(MELODY_R2_BASE+'packs/')||!url.endsWith('.ogg'))return undefined;
 const policy=await caches.open(melodyPolicyName(BASE)),record=await policy.match(melodyPolicyUrl(self.location.origin,BASE));if(!record)return undefined;
 const unavailable=()=>new Response('Selected melody tier unavailable',{status:503,headers:{'Cache-Control':'no-store'}});
 try{const {quality,groups}=await record.json();if(!['lite','full'].includes(quality)||!Array.isArray(groups))return unavailable();
  const group=groups.find(g=>g.entries.some(e=>e.logicalUrl===url));if(!group)return unavailable();await groupCheck(group,crypto.subtle);
  const entry=melodyEntry(group.entries.find(e=>e.logicalUrl===url),quality),name=groupName(group,BASE),cache=await caches.open(name);
  const marker=await cache.match(markerUrl(group,self.location.origin,BASE));if(!marker?.ok)return unavailable();const saved=await marker.json();if(saved.id!==group.id||saved.version!==group.version||JSON.stringify(saved.entries)!==JSON.stringify(group.entries))return unavailable();
  const keys=new Set((await cache.keys()).map(k=>k.url));if(group.entries.some(e=>!keys.has(e.url)))return unavailable();return await verifiedResponse(cache,entry,crypto.subtle)||unavailable();
 }catch{return unavailable();}
}
`;}
