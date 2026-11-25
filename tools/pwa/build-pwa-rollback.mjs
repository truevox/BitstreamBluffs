/** Emergency GitHub Pages rollback: ordinary game, safe service-worker retirement. */
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';

export function renderRetiringWorker(){
 return `/* Bitstream Bluffs safe PWA retirement. Never delete any cache or IndexedDB. */\n`+
  `'use strict';\n`+
  `self.addEventListener('install', event => { event.waitUntil(Promise.resolve()); });\n`+
  `self.addEventListener('activate', event => {\n`+
  `  // This can activate only AFTER old controlled clients have closed.\n`+
  `  event.waitUntil(self.registration.unregister());\n`+
  `});\n`;
}
export async function buildRollbackSite(base='/',dest='dist'){
 if(!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base))throw Error('Bad rollback base');
 const outDir=resolve(dest);
 await build({base,build:{outDir,emptyOutDir:true}});
 await writeFile(resolve(outDir,'sw.js'),renderRetiringWorker(),{flag:'wx'});
 console.log('PASS_SAFE_PWA_RETIRE_BUILD',JSON.stringify({base,outDir,worker:'retire',preservesUserData:true}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildRollbackSite(process.argv[2]||'/',process.argv[3]||'dist');
