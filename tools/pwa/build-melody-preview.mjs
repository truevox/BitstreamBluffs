/** Deliberate local/preview build, not the default deployment command. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {build} from 'vite';
import {buildMelodyRuntimeIndex} from './build-melody-runtime-index.mjs';
import {MELODY_BASE} from './melody-release-plan.mjs';
import {generateOfflineWorker} from './build-offline-worker.mjs';
const [source,dest,base='/']=process.argv.slice(2);if(!source||!dest||!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base))throw Error('Usage: build-melody-preview INVENTORY NEW_OUTDIR BASE');
const inv=JSON.parse(await readFile(source)),objects=new Map(inv.objects.map(e=>[e.key,e]));
const index=await buildMelodyRuntimeIndex(inv,k=>readFile(objects.get(k).path)),payload=gzipSync(JSON.stringify(index),{level:9}),digest=createHash('sha256').update(payload).digest('hex');
const outDir=resolve(dest);await mkdir(outDir);await build({base,define:{__BB_OFFLINE_INDEX_SHA256__:JSON.stringify(digest),__BB_MELODY_CATALOG_URL__:JSON.stringify(MELODY_BASE+'catalog.json')},build:{outDir,emptyOutDir:false}});await writeFile(resolve(outDir,'offline-melody-index.bin'),payload,{flag:'wx'});const shell=await generateOfflineWorker(outDir,base,{melodyDev:true});console.log('PASS_MELODY_PREVIEW_BUILD',JSON.stringify({indexBytes:payload.length,digest,groups:index.groups.length,shellBytes:shell.totalBytes}));
