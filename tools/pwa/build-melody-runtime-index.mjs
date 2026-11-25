/** Build-time sanitization only. No publication or worker registration. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {planMelodyRelease,MELODY_BASE} from './melody-release-plan.mjs';
import {BIOME_IDS,HOME_BIOME} from '../../src/systems/music/BiomeVoices.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
export async function buildMelodyRuntimeIndex(inventory,readObject){
 const ids=BIOME_IDS.filter(x=>x!==HOME_BIOME);
 const plan=await planMelodyRelease(inventory,readObject,{unlockedBiomeIds:ids,enabledBiomeIds:ids},'high');
 const rel=url=>{if(!url.startsWith(MELODY_BASE))throw Error('Unexpected release URL');return url.slice(MELODY_BASE.length);};
 const groups=plan.groups.map(g=>[g.originalId,g.quality,g.entries.map(e=>[rel(e.logicalUrl),e.bytes,e.sha256,...(e.frames?[e.sourceSha256,e.frames]:[])])]);
 const index={format:'bb-melody-runtime-index-v1',release:MELODY_BASE,catalog:[plan.catalog.bytes,plan.catalog.sha256],groups};
 return index;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [source,dest]=process.argv.slice(2);if(!source||!dest)throw Error('Usage: build-melody-runtime-index INVENTORY NEW_OUTPUT');
 const inv=JSON.parse(await readFile(source)),objects=new Map(inv.objects.map(e=>[e.key,e]));
 const index=await buildMelodyRuntimeIndex(inv,k=>readFile(objects.get(k).path));const bytes=JSON.stringify(index)+'\n';await writeFile(dest,bytes,{flag:'wx'});console.log(JSON.stringify({groups:index.groups.length,bytes:Buffer.byteLength(bytes),sha256:hash(bytes)}));
}
