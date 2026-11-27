/** Opt-in build capability. Default builds have no index digest and never register. */
import {expandOfflineRuntimePlan} from './OfflineRuntimePlan.js';
import {MelodyDownloadControls} from '../../../tools/pwa/melody-download-controls.mjs';
import {REG} from '../../constants.js';
import {earnedBiomeIds} from '../ProfileStore.js';
import {levelForXp} from '../Progression.js';
import {upcomingBiomePrefetch} from './NextBiomePrefetch.js';
import {EVT} from '../../events.js';
import {installPwaUpdater} from '../PwaUpdater.js';
const expected=typeof __BB_OFFLINE_INDEX_SHA256__==='string'?__BB_OFFLINE_INDEX_SHA256__:null;
/** Current authoritative settings and awarded profile, with one bounded
 * next-unlock lookahead. This does not transfer data or mutate the profile. */
export function offlinePreviewContext(game){
 const settings=game.registry.get(REG.SETTINGS)||{};
 const progression=game.registry.get(REG.PROGRESSION),profile=game.registry.get(REG.PROFILE)||progression?.store?.profile;
 const defs=Object.values(game.registry.get(REG.CONTENT)?.biomes||{});
 if(!profile||!progression)return null;
 const unlocked=earnedBiomeIds(profile,defs).filter(id=>id!=='bitstream-bluffs');
 const enabled=unlocked.filter(id=>!(profile.biomeOff&((defs.find(b=>b.id===id)?.bit)||0)));
 const currentLevel=levelForXp(profile.xp,progression.levels);
 const nextBiome=upcomingBiomePrefetch({currentLevel,biomeDefs:defs,unlockedBiomeIds:unlocked})[0]||null;
 return {selection:settings.musicEnabledSongs,unlockedBiomeIds:unlocked,enabledBiomeIds:enabled,nextBiome,currentLevel};
}

export async function installOfflinePreview(game){
 if(!expected||!globalThis.isSecureContext||!navigator.serviceWorker||!globalThis.caches||!globalThis.DecompressionStream)return false;
 const base=new URL(import.meta.env.BASE_URL,location.origin).pathname;
 const registration=await navigator.serviceWorker.register(base+'sw.js',{scope:base,updateViaCache:'none'});
 try { installPwaUpdater(game,registration); } catch {}
 const worker=navigator.serviceWorker.controller;
 if(!worker){game.registry.set('offlineMusicNeedsReopen',true);return false;} // never force claim/reload
 game.registry.set('offlineMusicNeedsReopen',false);
 const response=await fetch(base+'offline-melody-index.bin',{cache:'no-store'});if(!response.ok)throw Error('Missing offline index');
 const data=await response.arrayBuffer(),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(b=>b.toString(16).padStart(2,'0')).join('');if(digest!==expected)throw Error('Offline index integrity mismatch');
 const index=await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
 const settings=game.registry.get(REG.SETTINGS),director=game.registry.get(REG.AUDIO)?._stemMusic,initial=offlinePreviewContext(game);
 if(!director||!initial)return false;
 const plan=await expandOfflineRuntimePlan(index,initial);
 const controller=new MelodyDownloadControls({plan,mode:settings.offlineMusicQuality,options:{storage:caches,origin:location.origin,scope:base,worker,subtle:crypto.subtle,fetcher:fetch.bind(window),connection:navigator.connection,storageManager:navigator.storage},estimate:()=>navigator.storage.estimate(),isStopped:()=>director.isPlaybackBoundary()||(!director.started&&!director.cache.size&&!director.activeNodes.size),withStoppedTransport:fn=>director.withPlaybackBoundary(fn)});
 game.registry.set('offlineMusicDownloads',controller);director.setPlaybackBoundary(()=>controller.beforePlayback());
 // Phaser DataManager changedata-profile also covers a player toggling a
 // biome in the Profile menu; settings events cover playlist changes. No
 // implicit download, no forced transport restart and no cache deletion.
 let live=true,revision=0;
 const update=()=>{
  const ticket=++revision,contextTicket=controller.markContextChanged();
  Promise.resolve().then(async()=>{
   if(!live)return;
   const context=offlinePreviewContext(game);
   if(!context)return;
   const fresh=await expandOfflineRuntimePlan(index,context);
   if(live&&ticket===revision)await controller.replan(fresh,{contextTicket});
  }).catch(e=>{if(live)console.warn('[offline-preview] plan refresh failed: '+(e?.message||e));})
   .finally(()=>controller.finishContextCheck(contextTicket));
 };
 const onSetting=p=>{if(p?.key==='musicEnabledSongs')update();};
 const onProfile=()=>update();
 game.events.on(EVT.SETTINGS_CHANGED,onSetting);
 game.registry.events.on('changedata-profile',onProfile);
 game.events.once('destroy',()=>{
  live=false;revision++;game.events.off(EVT.SETTINGS_CHANGED,onSetting);
  game.registry.events.off('changedata-profile',onProfile);
  controller.cancel();director.setPlaybackBoundary(null);
 });
 return true;
}
