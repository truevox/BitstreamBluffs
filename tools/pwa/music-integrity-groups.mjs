/** Build reproducible SHA-256 inventories for only the real recordings required
 * by current player choices plus optional future-biome bonuses. Developer-only. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { selectedMusicGroupPlan } from './music-groups.mjs';

const hash=(bytes)=>createHash('sha256').update(bytes).digest('hex');

async function integrityForGroup(publicRoot, group, songId) {
  const entries=[];
  let totalBytes=0;
  const root=resolve(publicRoot)+sep;
  for(const url of group.files) {
    if(typeof url!=='string'||!/^\/music\/packs\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]+$/.test(url)||url.includes('..')) {
      throw new TypeError(`Invalid original recording path: ${url}`);
    }
    const name=resolve(publicRoot,url.slice(1));
    if(!name.startsWith(root))throw new Error('Audio file escaped public directory');
    const size=await stat(name);
    if(!size.isFile()||size.size<1)throw new Error(`Missing or empty real music file: ${url}`);
    const digest=createHash('sha256');
    for await(const chunk of createReadStream(name))digest.update(chunk);
    entries.push({url,bytes:size.size,sha256:digest.digest('hex')});
    totalBytes+=size.size;
  }
  entries.sort((a,b)=>a.url.localeCompare(b.url));
  const version=hash(JSON.stringify(entries)).slice(0,20);
  return {id:group.id,songId,kind:group.kind,biome:group.biome??null,version,totalBytes,entries};
}

export async function buildRealMusicGroupManifest(publicRoot, catalog, packs, settings) {
  const plan=selectedMusicGroupPlan(catalog,packs,settings);
  const all=[];
  for(const song of plan.songs){
    for(const g of song.required)all.push({...await integrityForGroup(publicRoot,g,song.songId),priority:'required'});
    for(const g of song.bonus)all.push({...await integrityForGroup(publicRoot,g,song.songId),priority:'bonus'});
  }
  return {format:'bb-real-music-groups-v1',nextBiomes:plan.nextBiomes,groups:all,
    requiredBytes:all.filter(x=>x.priority==='required').reduce((n,g)=>n+g.totalBytes,0),
    bonusBytes:all.filter(x=>x.priority==='bonus').reduce((n,g)=>n+g.totalBytes,0)};
}
