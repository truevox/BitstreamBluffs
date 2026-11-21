/** Assemble source-bound Lite/Full caching inventories for one original song.
 * Logical paths stay /music/packs; physical URLs are /music-variants/...
 */
import {createHash} from 'node:crypto';
import {variantSourceUrl} from './mono-stem-variants.mjs';
import {musicDownloadOrder} from './music-quality-policy.mjs';
const sha=xs=>createHash('sha256').update(JSON.stringify(xs)).digest('hex').slice(0,20);

export function makeTieredGroup(original,quality,variantManifest){
  if(!original||!Array.isArray(original.entries)||!['lite','full'].includes(quality)||
    variantManifest?.quality!==quality||!Array.isArray(variantManifest.entries))
    throw new TypeError('Invalid source-backed quality group');
  const variants=new Map(variantManifest.entries.map(e=>[e.url,e]));
  if(variants.size!==variantManifest.entries.length)throw new Error('Duplicate source URL in quality variant manifest');
  const entries=original.entries.map(src=>{
    if(src.url.endsWith('.ogg')){
      const v=variants.get(src.url);
      if(!v||v.sourceSha256!==src.sha256||v.variantUrl!==variantSourceUrl(src.url,quality)||
        !Number.isSafeInteger(v.bytes)||v.bytes<1||!/^([a-f0-9]{64})$/.test(v.sha256)||
        v.channels!==1||v.sampleRate!==48000||Math.abs(v.duration-v.sourceDuration)>.03)
        throw new Error('Incomplete, tampered, or non-mono recorded stem: '+src.url);
      return {url:v.variantUrl,logicalUrl:src.url,bytes:v.bytes,sha256:v.sha256};
    }
    // Pack metadata and caption JSON are shared, not converted to audio.
    return {...src,logicalUrl:src.url};
  });
  if(!entries.length||new Set(entries.map(e=>e.logicalUrl)).size!==entries.length)
    throw new Error('Logical original stem paths must be distinct');
  const id=original.id+':'+quality;
  return {id,songId:original.songId,quality,priority:original.priority,
    originalId:original.id,kind:original.kind,biome:original.biome,
    version:sha(entries),entries,totalBytes:entries.reduce((n,x)=>n+x.bytes,0)};
}

export function buildTieredMusicPlan(originalPlan,variantManifests,mode){
  if(!Array.isArray(originalPlan?.groups)||!variantManifests?.lite||!variantManifests?.full)
    throw new TypeError('Original group plan and two derivative manifests required');
  const groups=originalPlan.groups.map(original=>({
    originalId:original.id,priority:original.priority,
    lite:makeTieredGroup(original,'lite',variantManifests.lite),
    full:makeTieredGroup(original,'full',variantManifests.full),
  }));
  return {format:'bb-tiered-music-v1',mode,groups,downloads:musicDownloadOrder(mode,groups)};
}
