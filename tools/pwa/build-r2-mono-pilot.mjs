/** Explicit local derivative pilot: never writes to the release or original media trees. */
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {planPublishedMusic,RELEASE_CATALOG} from './r2-release-plan.mjs';
import {encodeMonoVariants} from './mono-stem-variants.mjs';
const [sourceArg,outArg,trackArg]=process.argv.slice(2);
if(!sourceArg||!outArg)throw Error('Usage: node tools/pwa/build-r2-mono-pilot.mjs VERIFIED_PUBLICATION NEW_OUTPUT_DIR [TRACK_ID]');
const source=resolve(sourceArg),out=resolve(outArg);
if(out===source||out.startsWith(source+sep)||source.startsWith(out+sep))throw Error('Output and originals must be disjoint');
const inv=JSON.parse(await readFile(resolve(source,'publication-330-inventory.json'))),catalog=await readFile(resolve(source,'publication-330-catalog.json'));
const tracks=JSON.parse(catalog).tracks,chosen=trackArg?tracks.find(t=>t.id===trackArg):tracks.find(t=>t.title.includes('One More Run'));
if(!chosen)throw Error('Unknown song');
const byKey=new Map(inv.objects.map(x=>[x.key,x])),sha=b=>createHash('sha256').update(b).digest('hex');
async function sourceBytes(key){const e=byKey.get(key);if(!e)throw Error('Unpublished source: '+key);const b=e.origin==='released-git'?execFileSync('git',['show',inv.publicBaseCommit+':public/music/'+key],{maxBuffer:20*1024*1024}):await readFile(resolve(source,inv.source,key));if(b.length!==e.size||sha(b)!==e.sha256)throw Error('Source differs from publication: '+key);return b;}
const pack=await sourceBytes(chosen.manifest),selection=Object.fromEntries(tracks.map(t=>[t.id,t.id===chosen.id]));
const plan=planPublishedMusic(inv,catalog,{[chosen.id]:pack},{selection});
const entries=[...new Map(plan.groups.flatMap(g=>g.entries).filter(e=>e.url.endsWith('.ogg')).map(e=>[e.url,e])).values()];
await mkdir(out,{recursive:false});const stage=await mkdtemp(resolve(out,'source-stage-'));
const urls=entries.map(e=>'/music/'+e.url.slice(new URL('.',RELEASE_CATALOG).href.length));
const publicationByLogical=new Map(entries.map((e,i)=>[urls[i],e]));
const frames=file=>new Promise((ok,fail)=>{const p=spawn('ffmpeg',['-v','error','-nostdin','-i',file,'-map','0:a:0','-ac','1','-ar','48000','-f','s16le','-'],{stdio:['ignore','pipe','pipe']});let n=0,err='';p.stdout.on('data',b=>n+=b.length);p.stderr.on('data',b=>err+=b);p.on('error',fail);p.on('close',c=>c===0&&n>0&&n%2===0?ok(n/2):fail(Error('Decode failed '+file+' '+err)));});
try{
 for(const url of urls){const file=resolve(stage,url.slice(1));await mkdir(dirname(file),{recursive:true});await writeFile(file,await sourceBytes(url.slice('/music/'.length)),{flag:'wx'});}
 const originals={};for(const url of urls)originals[url]=await frames(resolve(stage,url.slice(1)));
 const result={format:'bb-r2-mono-pilot-v1',release:RELEASE_CATALOG,song:chosen.id,sourceCount:urls.length,sourceBytes:entries.reduce((n,e)=>n+e.bytes,0),qualities:{}};
 // Derivative tree is a sibling of the transient source stage, never inside it.
 for(const quality of ['lite','full']){
  const dest=resolve(out,'derivatives');const manifest=await encodeMonoVariants({urls,quality,sourceRoot:stage,outputRoot:dest,onProgress:({index,total})=>{if(index%20===0||index===total)console.log('ENCODE',quality,index,total);}});
  for(const e of manifest.entries){const pub=publicationByLogical.get(e.url);if(e.sourceSha256!==pub.sha256||e.sourceBytes!==pub.bytes)throw Error('Source provenance mismatch '+e.url);const n=await frames(resolve(dest,e.variantUrl.slice(1)));if(n!==originals[e.url])throw Error('Decoded frame mismatch '+e.url);e.sourceFrames=originals[e.url];e.frames=n;e.originalReleaseUrl=pub.url;}
  await writeFile(resolve(out,quality+'-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  result.qualities[quality]={count:manifest.entries.length,bytes:manifest.bytes,allExactFrames:true};
 }
 await writeFile(resolve(out,'pilot-summary.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log('PASS_R2_MONO_PILOT',JSON.stringify(result));
}finally{await rm(stage,{recursive:true,force:true});}
