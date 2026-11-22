/** Source-safe research CLI. Nothing in the game imports this file.
 * Usage: node tools/pwa/encode-mono-sample.mjs lite SOURCE_PUBLIC OUTPUT_ROOT URL [URL...]
 * One URL = one exact independently panned original stem. */
import {writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {encodeMonoVariants} from './mono-stem-variants.mjs';

const [quality,sourceRoot,outputRoot,...urls]=process.argv.slice(2);
if(!quality||!sourceRoot||!outputRoot||urls.length===0){
  console.error('Usage: node tools/pwa/encode-mono-sample.mjs lite|full SOURCE_PUBLIC OUTPUT_ROOT /music/packs/.../0000-bass.ogg [...]');
  process.exitCode=2;
}else {
  const manifest=await encodeMonoVariants({quality,sourceRoot,outputRoot,urls,
    onProgress:({index,total,category})=>console.error(`[${index}/${total}] ${category}`)});
  await mkdir(join(outputRoot,'manifests'),{recursive:true});
  const path=join(outputRoot,'manifests',`${quality}-${manifest.version}.json`);
  await writeFile(path,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({manifest:path,quality,entries:manifest.entries.length,
    sourceMiB:(manifest.sourceBytes/1048576).toFixed(3),monoMiB:(manifest.bytes/1048576).toFixed(3),
    percentOfOriginal:(100*manifest.bytes/manifest.sourceBytes).toFixed(1)},null,2));
}
