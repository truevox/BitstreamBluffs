/** One explicit release/rollback switch for GitHub Pages. Netlify is unaffected. */
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const config=JSON.parse(await readFile(new URL('./production-rollout.json',import.meta.url)));
if(Object.keys(config).length!==1||!['pwa','rollback'].includes(config.mode))throw Error('Unsafe Pages rollout mode');
if(config.mode==='pwa')await import('./build-pwa-release.mjs');
else{
 const {buildRollbackSite}=await import('./build-pwa-rollback.mjs');
 await buildRollbackSite(process.argv[2]||'/',process.argv[3]||'dist');
}
