/** Opt-in build capability. Default builds have no index digest and never register. */
import {expandOfflineRuntimePlan} from './OfflineRuntimePlan.js';
import {MelodyDownloadControls} from '../../../tools/pwa/melody-download-controls.mjs';
import {REG} from '../../constants.js';
import {earnedBiomeIds} from '../ProfileStore.js';
const expected=typeof __BB_OFFLINE_INDEX_SHA256__==='string'?__BB_OFFLINE_INDEX_SHA256__:null;
export async function installOfflinePreview(game){
 if(!expected||!globalThis.isSecureContext||!navigator.serviceWorker||!globalThis.caches||!globalThis.DecompressionStream)return false;
 const base=new URL(import.meta.env.BASE_URL,location.origin).pathname;
 await navigator.serviceWorker.register(base+'sw.js',{scope:base,updateViaCache:'none'});
 const worker=navigator.serviceWorker.controller;if(!worker)return false; // first install requires next navigation; never force claim/reload
 const response=await fetch(base+'offline-melody-index.bin',{cache:'no-store'});if(!response.ok)throw Error('Missing offline index');
 const data=await response.arrayBuffer(),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(b=>b.toString(16).padStart(2,'0')).join('');if(digest!==expected)throw Error('Offline index integrity mismatch');
 const index=await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
 const settings=game.registry.get(REG.SETTINGS),profile=game.registry.get(REG.PROGRESSION)?.store?.profile,content=game.registry.get(REG.CONTENT),director=game.registry.get(REG.AUDIO)?._stemMusic;
 if(!director||!profile)return false;
 const defs=Object.values(content.biomes||{}),owned=earnedBiomeIds(profile,defs).filter(x=>x!=='bitstream-bluffs'),enabled=owned.filter(id=>!(profile.biomeOff&((defs.find(b=>b.id===id)?.bit)||0)));
 const plan=await expandOfflineRuntimePlan(index,{selection:settings.musicEnabledSongs,unlockedBiomeIds:owned,enabledBiomeIds:enabled});
 const controller=new MelodyDownloadControls({plan,mode:settings.offlineMusicQuality,options:{storage:caches,origin:location.origin,scope:base,worker,subtle:crypto.subtle,fetcher:fetch.bind(window)},estimate:()=>navigator.storage.estimate(),isStopped:()=>director.isPlaybackBoundary()||(!director.started&&!director.cache.size&&!director.activeNodes.size),withStoppedTransport:fn=>director.withPlaybackBoundary(fn)});
 game.registry.set('offlineMusicDownloads',controller);director.setPlaybackBoundary(()=>controller.beforePlayback());return true;
}
