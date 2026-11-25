/** Developer-only bridge from the verified #330 publication inventory to selective #172 groups.
 * No automatic fetch, audio routing, registration, or derivative generation. */
import {createHash} from 'node:crypto';
import {normalizeCatalog} from '../../src/systems/music/MusicPack.js';
import {selectedMusicGroupPlan} from './music-groups.mjs';
export const RELEASE_CATALOG='https://bsb-audio.bearcave.win/releases/20261124-69a6fb46/catalog.json';
const hash=x=>createHash('sha256').update(x).digest('hex');
const validKey=k=>typeof k==='string'&&/^(?:catalog\.json|packs\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.\/-]+)$/.test(k)&&!k.split('/').some(s=>!s||s==='.'||s==='..');
export function planPublishedMusic(publication,catalogBytes,packBytesById,settings={}){
  if(publication?.format!=='bsb-runtime-music-publication-v1'||!Array.isArray(publication.objects)||publication.publicBaseCommit!=='69a6fb4674335d2496a801ddd7dcaabcb0a4a8bd')throw Error('Wrong publication release');
  const index=new Map();let total=0;
  for(const e of publication.objects){
    if(!validKey(e.key)||index.has(e.key)||!Number.isSafeInteger(e.size)||e.size<1||!(/^[a-f0-9]{64}$/).test(e.sha256))throw Error('Invalid publication object');
    index.set(e.key,e);total+=e.size;
  }
  if(total!==publication.totalBytes)throw Error('Publication byte total mismatch');
  const entry=key=>{const e=index.get(key);if(!e)throw Error('Unpublished required object: '+key);return {url:new URL(key,RELEASE_CATALOG).href,bytes:e.size,sha256:e.sha256};};
  const verifiedJson=(key,bytes)=>{const e=entry(key);if(!bytes||bytes.length!==e.bytes||hash(bytes)!==e.sha256)throw Error('Publication JSON mismatch: '+key);return JSON.parse(bytes);};
  const catalog=verifiedJson('catalog.json',catalogBytes), tracks=normalizeCatalog(catalog).tracks;
  if(tracks.length!==publication.tracks)throw Error('Publication track count mismatch');
  const packs=Object.fromEntries(tracks.filter(t=>packBytesById[t.id]).map(t=>[t.id,verifiedJson(t.manifest,packBytesById[t.id])]));
  const plan=selectedMusicGroupPlan(catalog,packs,settings);
  const groups=plan.songs.flatMap(song=>[...song.required.map(g=>[g,'required']),...song.bonus.map(g=>[g,'bonus'])].map(([g,priority])=>{
    if(!g.files.length)throw Error('Empty published music group: '+g.id);
    const entries=g.files.map(p=>{if(!p.startsWith('/music/packs/'))throw Error('Invalid logical music path');return entry(p.slice('/music/'.length));});
    return {id:g.id,songId:song.songId,kind:g.kind,biome:g.biome??null,priority,version:hash(JSON.stringify(entries)).slice(0,20),totalBytes:entries.reduce((n,e)=>n+e.bytes,0),entries};
  }));
  return {format:'bb-published-music-plan-v1',catalog:entry('catalog.json'),nextBiomes:plan.nextBiomes,groups,requiredBytes:groups.filter(g=>g.priority==='required').reduce((n,g)=>n+g.totalBytes,0),bonusBytes:groups.filter(g=>g.priority==='bonus').reduce((n,g)=>n+g.totalBytes,0)};
}
