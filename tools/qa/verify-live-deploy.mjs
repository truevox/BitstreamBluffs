#!/usr/bin/env node
/**
 * Read-only public deployment integrity check for Bitstream Bluffs.
 *
 * Usage:
 *   npm run build
 *   node tools/qa/verify-live-deploy.mjs
 *   node tools/qa/verify-live-deploy.mjs --dist /path/to/dist
 *   node tools/qa/verify-live-deploy.mjs --url https://simulate.sledhead.ing/
 *
 * Requires a local built dist/ from the commit you want to compare. Checks
 * exact HTML and emitted JS bytes; a matching filename alone isn't proof.
 * This does not write to Netlify, GitHub, user data, or public leaderboards.
 */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2);
function option(name,fallback){
 const i=args.indexOf(name);
 if(i<0)return fallback;
 if(!args[i+1]||args[i+1].startsWith('--'))throw Error(`Missing value for ${name}`);
 return args[i+1];
}
const dist=path.resolve(option('--dist',path.join(root,'dist')));
const base=option('--url','https://simulate.sledhead.ing/');
const hash=buf=>createHash('sha256').update(buf).digest('hex');
const scriptName=html=>{
 const found=html.match(/<script\b[^>]*\bsrc=["']([^"']*\/assets\/index-[A-Za-z0-9_-]+\.js)["'][^>]*>/i);
 if(!found)throw Error('Build HTML lacks a recognizable Vite index asset');
 return found[1];
};
async function fetchBytes(url){
 const r=await fetch(url,{signal:AbortSignal.timeout(20000),redirect:'follow',headers:{'accept':'text/html,application/javascript,*/*'}});
 if(!r.ok)throw Error(`${r.status} ${r.statusText} at ${url}`);
 return Buffer.from(await r.arrayBuffer());
}
async function main(){
 if(!/^https:\/\//.test(base))throw Error('Refusing a non-HTTPS public release URL');
 const [localHtml,liveHtml]=await Promise.all([
  readFile(path.join(dist,'index.html')),fetchBytes(base),
 ]);
 const localScript=scriptName(localHtml.toString('utf8'));
 const remoteScript=scriptName(liveHtml.toString('utf8'));
 if(localScript!==remoteScript)throw Error(`Release mismatch: local ${localScript} versus live ${remoteScript}`);
 const rel=localScript.replace(/^\//,'');
 const [localJs,remoteJs]=await Promise.all([
  readFile(path.join(dist,rel)),fetchBytes(new URL(localScript,base)),
 ]);
 const evidence={
  url:new URL(base).origin,
  asset:localScript,
  localHtmlSha256:hash(localHtml),liveHtmlSha256:hash(liveHtml),
  localJsSha256:hash(localJs),liveJsSha256:hash(remoteJs),
 };
 if(evidence.localHtmlSha256!==evidence.liveHtmlSha256 ||
    evidence.localJsSha256!==evidence.liveJsSha256){
  console.error('DEPLOY_INTEGRITY_FAIL',JSON.stringify(evidence,null,2));
  process.exitCode=1;
  return;
 }
 console.log('PUBLIC_NETLIFY_DEPLOY_BYTE_PARITY_PASS',JSON.stringify(evidence,null,2));
}
main().catch(e=>{console.error('DEPLOY_INTEGRITY_ERROR',e.message);process.exitCode=1;});
