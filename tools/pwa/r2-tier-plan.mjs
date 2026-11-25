/** Build-time candidate plans for unpublished, independently encoded original stems.
 * Physical object keys are proposed release artifacts, not downloadable URLs. */
import {createHash} from 'node:crypto';
import {RELEASE_CATALOG} from './r2-release-plan.mjs';
import {canonicalStemUrl,variantSourceUrl} from './mono-stem-variants.mjs';
const BASE=new URL('.',RELEASE_CATALOG).href;
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const isHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function indexVariants(manifest,quality){
 if(manifest?.quality!==quality||!Array.isArray(manifest.entries))throw Error('Missing derivative manifest: '+quality);
 const byUrl=new Map();
 for(const e of manifest.entries){
  if(!e||e.quality!==quality||typeof e.originalReleaseUrl!=='string'||!e.originalReleaseUrl.startsWith(BASE)||byUrl.has(e.originalReleaseUrl))throw Error('Duplicate or wrong-release derivative');
  const logical=canonicalStemUrl('/music/'+e.originalReleaseUrl.slice(BASE.length));
  if(e.url!==logical||e.variantUrl!==variantSourceUrl(logical,quality)||!isHash(e.sourceSha256)||!isHash(e.sha256)||e.channels!==1||e.sampleRate!==48000||!Number.isSafeInteger(e.sourceFrames)||e.sourceFrames<1||e.frames!==e.sourceFrames||!Number.isSafeInteger(e.bytes)||e.bytes<1||!Number.isSafeInteger(e.sourceBytes)||e.sourceBytes<1)throw Error('Invalid mono derivative: '+logical);
  byUrl.set(e.originalReleaseUrl,e);
 }
 return byUrl;
}
export function planR2Tiers(original,manifests,mode){
 if(original?.format!=='bb-published-music-plan-v1'||!Array.isArray(original.groups)||!['high','space-saver','no-music'].includes(mode))throw Error('Invalid tier plan');
 if(mode==='no-music')return {mode,publicationReady:false,groups:[],downloads:[],bytes:0};
 const indexes={lite:indexVariants(manifests?.lite,'lite')};
 if(mode==='high')indexes.full=indexVariants(manifests?.full,'full');
 const groups=[];
 for(const group of original.groups){
  if(!['required','bonus'].includes(group.priority)||!Array.isArray(group.entries)||!group.entries.length)throw Error('Invalid original group');
  for(const [quality,index] of Object.entries(indexes)){
   const entries=group.entries.map(e=>{
    if(!e.url.startsWith(BASE)||!isHash(e.sha256)||!Number.isSafeInteger(e.bytes)||e.bytes<1)throw Error('Invalid original release asset');
    if(!e.url.endsWith('.ogg'))return {logicalUrl:e.url,originalUrl:e.url,sha256:e.sha256,bytes:e.bytes};
    const v=index.get(e.url);if(!v||v.sourceSha256!==e.sha256||v.sourceBytes!==e.bytes)throw Error('Missing or mismatched original derivative: '+e.url);
    return {logicalUrl:e.url,objectKey:v.variantUrl.slice(1),sourceSha256:e.sha256,sha256:v.sha256,bytes:v.bytes,frames:v.frames};
   });
   const id=group.id+':'+quality;groups.push({id,quality,priority:group.priority,originalId:group.id,entries,version:sha(entries).slice(0,20),bytes:entries.reduce((n,e)=>n+e.bytes,0)});
  }
 }
 const downloads=[];for(const priority of ['required','bonus'])for(const quality of Object.keys(indexes))downloads.push(...groups.filter(g=>g.priority===priority&&g.quality===quality));
 return {mode,publicationReady:false,groups,downloads,bytes:downloads.reduce((n,g)=>n+g.bytes,0)};
}
