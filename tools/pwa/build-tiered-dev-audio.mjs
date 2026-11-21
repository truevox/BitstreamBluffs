/** Developer-only, original-recording asset builder for offline quality proof.
 * Does not touch src/, manifest catalogs, game settings or production URLs.
 * Usage: node tools/pwa/build-tiered-dev-audio.mjs ORIGINAL_PUBLIC OUTPUT_ROOT
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {buildRealMusicGroupManifest} from './music-integrity-groups.mjs';
import {encodeMonoVariants} from './mono-stem-variants.mjs';
import {buildTieredMusicPlan} from './music-quality-groups.mjs';
const [source,output]=process.argv.slice(2);
if(!source||!output)throw new TypeError('original public root and separate derivative output root required');
const media=resolve(source),dest=resolve(output);
const catalog=JSON.parse(await readFile(join(media,'music/catalog.json'),'utf8'));
const track=catalog.tracks.find(t=>t.title.includes('One More Run'));
if(!track)throw Error('Missing source-recorded game song');
const pack=JSON.parse(await readFile(join(media,'music',track.manifest),'utf8'));
const plan=await buildRealMusicGroupManifest(media,catalog,{[track.id]:pack},{
  selection:Object.fromEntries(catalog.tracks.map(t=>[t.id,t.id===track.id])),
  unlockedBiomeIds:[],enabledBiomeIds:[],dynamicOrchestra:false,prefetchNextBiome:false,
});
const urls=[...new Set(plan.groups.flatMap(g=>g.entries.filter(e=>e.url.endsWith('.ogg')).map(e=>e.url)))];
console.log('SOURCE',JSON.stringify({trackId:track.id,groupCount:plan.groups.length,recordings:urls.length,requiredMiB:(plan.requiredBytes/1048576).toFixed(3)}));
const variants={};
for(const quality of ['lite','full']){
  let count=0;
  variants[quality]=await encodeMonoVariants({urls,quality,sourceRoot:media,outputRoot:dest,
    onProgress:({index,total})=>{if(index%20===0||index===total)console.log('ENCODE',quality,index,'/',total)} });
}
const tier=buildTieredMusicPlan(plan,variants,'high');
await mkdir(dest,{recursive:true});
const path=join(dest,'tiered-plan.json');
await writeFile(path,JSON.stringify(tier,null,2)+'\n');
console.log('COMPLETE',JSON.stringify({path,recordings:urls.length,
  liteMiB:(variants.lite.bytes/1048576).toFixed(3),fullMiB:(variants.full.bytes/1048576).toFixed(3),
  downloads:tier.downloads.map(x=>`${x.quality}:${x.group.id}`)}));
