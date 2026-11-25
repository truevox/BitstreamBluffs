/** Candidate-only planning adapter for #336/#337; no publishing or registration. */
import {createHash} from 'node:crypto';
import {normalizeCatalog} from '../../src/systems/music/MusicPack.js';
import {selectedMusicGroupPlan} from './music-groups.mjs';
import {canonicalStemUrl,variantSourceUrl,targetKbps,stemCategory} from './mono-stem-variants.mjs';
export const MELODY_BASE='https://bsb-audio.bearcave.win/releases/20261124-melody-only-748a0670/';
const hash=x=>createHash('sha256').update(x).digest('hex'),version=x=>hash(JSON.stringify(x)).slice(0,20);
const validKey=k=>typeof k==='string'&&/^(?:catalog\.json|packs\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.\/-]+|music-variants\/(?:lite|full)\/packs\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.\/-]+\.ogg|[A-Za-z0-9_-]+\/(?:lite|full)-manifest\.json)$/.test(k)&&!k.split('/').some(x=>!x||x==='.'||x==='..');
export async function planMelodyRelease(inventory,readObject,settings={},mode='high'){
 if(inventory?.format!=='bsb-r2-melody-release-v1'||inventory.release!==MELODY_BASE.split('/').at(-2)||inventory.baseRelease!=='20261124-69a6fb46'||!Array.isArray(inventory.objects)||!['high','space-saver','no-music'].includes(mode))throw Error('Invalid melody release');
 const index=new Map();let total=0,audio=0;
 for(const e of inventory.objects){if(!validKey(e.key)||index.has(e.key)||!Number.isSafeInteger(e.size)||e.size<1||!(/^[a-f0-9]{64}$/).test(e.sha256))throw Error('Invalid release object');index.set(e.key,e);total+=e.size;if(e.key.endsWith('.ogg'))audio++;}
 if(index.size!==inventory.totalObjects||total!==inventory.totalBytes||audio!==inventory.totalAudioObjects)throw Error('Release totals mismatch');
 const descriptor=key=>{const e=index.get(key);if(!e)throw Error('Missing release object: '+key);return {url:MELODY_BASE+key,bytes:e.size,sha256:e.sha256};};
 const json=async key=>{const e=descriptor(key),raw=await readObject(key);if(raw.length!==e.bytes||hash(raw)!==e.sha256)throw Error('Release JSON checksum mismatch: '+key);return JSON.parse(raw);};
 const catalog=await json('catalog.json'),tracks=normalizeCatalog(catalog).tracks;if(tracks.length!==inventory.tracks)throw Error('Track count mismatch');
 if(mode==='no-music')return {format:'bb-melody-candidate-plan-v1',release:MELODY_BASE,publicationReady:false,mode,catalog:descriptor('catalog.json'),groups:[],downloads:[],bytes:0};
 const packs={},byId=new Map();for(const t of tracks){if(settings.selection?.[t.id]===false)continue;const raw=await json(t.manifest);if(raw.adaptive!==undefined||raw.segments.some(s=>Object.keys(s.sources).length!==18))throw Error('Nonuniform melody pack');packs[t.id]=raw;byId.set(t.id,t);}
 const plan=selectedMusicGroupPlan(catalog,packs,{...settings,dynamicOrchestra:false});const qualities=mode==='high'?['lite','full']:['lite'],groups=[];
 for(const song of plan.songs){const track=byId.get(song.songId),prefix=track.manifest.slice(0,-'pack.json'.length),expected=new Map();for(const seg of packs[song.songId].segments)for(const rel of Object.values(seg.sources)){const key=prefix+rel;if(expected.has(key))throw Error('Duplicate pack recording');expected.set(key,seg.frames);}
  for(const quality of qualities){const manifest=await json(song.songId+'/'+quality+'-manifest.json');if(manifest.quality!==quality||manifest.entries.length!==expected.size||manifest.version!==version(manifest.entries))throw Error('Invalid derivative manifest');const derivatives=new Map();
   for(const e of manifest.entries){const key=e.originalReleaseUrl?.slice(MELODY_BASE.length);if(!e.originalReleaseUrl?.startsWith(MELODY_BASE)||!expected.has(key)||derivatives.has(key))throw Error('Wrong source release or duplicate derivative');const src=descriptor(key),logical=canonicalStemUrl('/music/'+key),variant=variantSourceUrl(logical,quality),physical=descriptor(variant.slice(1));if(e.url!==logical||e.variantUrl!==variant||e.quality!==quality||e.sourceSha256!==src.sha256||e.sourceBytes!==src.bytes||e.sha256!==physical.sha256||e.bytes!==physical.bytes||e.channels!==1||e.sampleRate!==48000||e.sourceFrames!==expected.get(key)||e.frames!==e.sourceFrames||e.targetKbps!==targetKbps(logical,quality)||e.category!==stemCategory(logical))throw Error('Derivative provenance mismatch: '+key);derivatives.set(key,{...physical,logicalUrl:src.url,sourceSha256:src.sha256,frames:e.frames});}
   for(const [priority,list] of [['required',song.required],['bonus',song.bonus]])for(const g of list){const entries=g.files.map(p=>{const key=p.slice('/music/'.length),src=descriptor(key);if(key.endsWith('.ogg')){const e=derivatives.get(key);if(!e)throw Error('Missing derivative');return e;}return {...src,logicalUrl:src.url};});if(!entries.length)throw Error('Empty melody group');groups.push({id:g.id+':'+quality,originalId:g.id,songId:song.songId,priority,quality,entries,version:version(entries),bytes:entries.reduce((n,e)=>n+e.bytes,0)});}
  }
 }
 const downloads=[];for(const priority of ['required','bonus'])for(const quality of qualities)downloads.push(...groups.filter(g=>g.priority===priority&&g.quality===quality));
 return {format:'bb-melody-candidate-plan-v1',release:MELODY_BASE,publicationReady:false,mode,catalog:descriptor('catalog.json'),groups,downloads,bytes:downloads.reduce((n,g)=>n+g.bytes,0)};
}
