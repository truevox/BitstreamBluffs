/** Reproducible published GitHub Pages build. No R2 write credentials or local music masters. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {MELODY_BASE} from './melody-release-plan.mjs';
import {generateOfflineWorker,MAX_PRECACHE_BYTES} from './build-offline-worker.mjs';
const base=process.argv[2]||'/',outDir=resolve(process.argv[3]||'dist');
if(!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base))throw Error('Bad release base path');
const pinned={
 release:'20261124-melody-only-748a0670',
 sha256:'a22dcf90efc2dfd58531efb6130acd7379e127b9e883252a266af91df4210ade',
 catalogSha256:'08c10dded1561db09908fc53f926070a1a61aec5f8813acac9a89dcbef4709ad',
 groupCount:792,
};
const sha=b=>createHash('sha256').update(b).digest('hex');
const source=fileURLToPath(new URL('./releases/melody-only-748a0670/offline-melody-index.bin',import.meta.url));
const payload=await readFile(source),digest=sha(payload);
if(digest!==pinned.sha256)throw Error('Pinned offline index digest mismatch');
const index=JSON.parse(gunzipSync(payload));
if(index.format!=='bb-melody-runtime-index-v1'||index.release!==MELODY_BASE||index.groups?.length!==pinned.groupCount||index.catalog?.[1]!==pinned.catalogSha256||pinned.release!==MELODY_BASE.split('/').at(-2))throw Error('Offline index release identity mismatch');
const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
try{
 const r=await fetch(MELODY_BASE+'catalog.json',{signal:controller.signal,redirect:'error'});
 if(!r.ok)throw Error('Published R2 catalog not available: HTTP '+r.status);
 const body=Buffer.from(await r.arrayBuffer());
 if(body.length!==index.catalog[0]||sha(body)!==pinned.catalogSha256)throw Error('Published R2 catalog differs from pinned release');
 const catalog=JSON.parse(body);if(catalog.tracks?.length!==33)throw Error('Published R2 catalog missing songs');
}finally{clearTimeout(timeout);}
await mkdir(outDir,{recursive:true});
await build({base,define:{__BB_OFFLINE_INDEX_SHA256__:JSON.stringify(digest),__BB_MELODY_CATALOG_URL__:JSON.stringify(MELODY_BASE+'catalog.json')},build:{outDir,emptyOutDir:true}});
await writeFile(resolve(outDir,'offline-melody-index.bin'),payload,{flag:'wx'});
const inventory=await generateOfflineWorker(outDir,base,{melodyDev:true});
if(inventory.totalBytes>=MAX_PRECACHE_BYTES)throw Error('Offline PWA shell exceeds release budget');
console.log('PASS_PUBLISHED_PWA_BUILD',JSON.stringify({base,release:pinned.release,indexSha256:digest,shellVersion:inventory.version,shellBytes:inventory.totalBytes,groups:index.groups.length,tracks:33}));
