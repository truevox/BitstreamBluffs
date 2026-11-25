/** Reuse verified mono derivatives for a new immutable release by source hash.
 * No network writes. Each completed song is published locally atomically.
 * Missing source songs are reported, never treated as successful coverage. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalStemUrl,stemCategory,targetKbps,variantSourceUrl} from './mono-stem-variants.mjs';
const [inventoryArg,oldArg,outArg]=process.argv.slice(2);
if(!inventoryArg||!oldArg||!outArg)throw Error('Usage: node tools/pwa/remap-mono-catalog.mjs CANDIDATE_INVENTORY OLD_BATCH NEW_BATCH');
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p));
const inventory=path.resolve(inventoryArg), root=path.dirname(inventory), old=path.resolve(oldArg), out=path.resolve(outArg);
if([root,old].some(x=>out===x||out.startsWith(x+path.sep)||x.startsWith(out+path.sep)))throw Error('Output must be disjoint');
const raw=fs.readFileSync(inventory), inv=JSON.parse(raw), fingerprint=sha(raw), release=`https://bsb-audio.bearcave.win/releases/20261124-melody-only-${fingerprint.slice(0,8)}/`;
const cat=read(path.join(root,'catalog.json')), index=new Map(inv.objects.map(e=>[e.key,e]));
if(index.size!==inv.objects.length||cat.tracks.length!==33||index.get('catalog.json').sha256!==sha(fs.readFileSync(path.join(root,'catalog.json'))))throw Error('Bad candidate inventory');
const verify=(file,e)=>{const b=fs.readFileSync(file);if(b.length!==e.bytes||sha(b)!==e.sha256)throw Error('Derivative checksum mismatch '+file);};
fs.mkdirSync(out,{recursive:true});const done=[],pending=[];let reused=0;
for(const t of cat.tracks){
 if(!/^[a-zA-Z0-9_-]+$/.test(t.id))throw Error('Bad song id');
 const prev=path.join(old,t.id), final=path.join(out,t.id), marker=path.join(prev,'pilot-summary.json');
 if(!fs.existsSync(marker)){pending.push(t.id);continue;}
 const summary=read(marker), rawPack=fs.readFileSync(path.join(root,t.manifest));
 if(summary.song!==t.id||summary.coverage!=='all-recordings'||sha(rawPack)!==index.get(t.manifest).sha256)throw Error('Bad song receipt '+t.id);
 const pack=JSON.parse(rawPack), prefix=t.manifest.slice(0,-'pack.json'.length), expected=[];
 if(pack.adaptive!==undefined)throw Error('Legacy orchestra still present '+t.id);
 for(const seg of pack.segments){if(Object.keys(seg.sources).length!==18)throw Error('Wrong role count');for(const rel of Object.values(seg.sources)){const key=prefix+rel,e=index.get(key);if(!e)throw Error('Missing source '+key);expected.push({key,e,frames:seg.frames});}}
 if(new Set(expected.map(x=>x.key)).size!==expected.length)throw Error('Duplicate source key');
 const existing=fs.existsSync(final), stage=existing?final:fs.mkdtempSync(path.join(out,'.stage-'));
 for(const quality of ['lite','full']){
  const m=read(path.join(prev,quality+'-manifest.json'));if(m.quality!==quality||m.entries.length!==summary.sourceCount||summary.qualities[quality].allExactFrames!==true)throw Error('Unverified previous manifest '+t.id);
  const byHash=new Map(m.entries.map(e=>[e.sourceSha256,e]));if(byHash.size!==m.entries.length)throw Error('Ambiguous source hash '+t.id);
  const entries=[];for(const {key,e,frames} of expected){const url=canonicalStemUrl('/music/'+key), a=byHash.get(e.sha256);if(!a||a.quality!==quality||a.sourceBytes!==e.size||a.sourceFrames!==frames||a.frames!==frames||a.channels!==1||a.sampleRate!==48000||a.targetKbps!==targetKbps(url,quality)||a.category!==stemCategory(url))throw Error('No compatible derivative '+key);
   const oldLogical=canonicalStemUrl(a.url);if(a.variantUrl!==variantSourceUrl(oldLogical,quality))throw Error('Invalid old derivative path');const variantUrl=variantSourceUrl(url,quality), src=path.join(prev,'derivatives',a.variantUrl.slice(1)), dst=path.join(stage,'derivatives',variantUrl.slice(1));verify(src,a);
   if(existing)verify(dst,a);else{fs.mkdirSync(path.dirname(dst),{recursive:true});fs.linkSync(src,dst);}
   entries.push({...a,url,variantUrl,originalReleaseUrl:release+key});
  }
  entries.sort((a,b)=>a.url.localeCompare(b.url));const manifest={format:m.format,quality,version:sha(JSON.stringify(entries)).slice(0,20),entries,sourceBytes:entries.reduce((n,e)=>n+e.sourceBytes,0),bytes:entries.reduce((n,e)=>n+e.bytes,0)};
  const mf=path.join(stage,quality+'-manifest.json');if(existing){if(JSON.stringify(read(mf))!==JSON.stringify(manifest))throw Error('Existing remap receipt differs');}else fs.writeFileSync(mf,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 }
 if(!existing)fs.renameSync(stage,final);done.push(t.id);reused+=expected.length*2;console.log('REUSED',t.id,expected.length*2);
}
const total=inv.objects.filter(e=>e.key.endsWith('.ogg')).length*2, result={release:release+'catalog.json',inventorySha256:fingerprint,done,pending,reused,total,allComplete:pending.length===0&&reused===total};console.log('RESULT',JSON.stringify(result));if(!result.allComplete)process.exitCode=2;
