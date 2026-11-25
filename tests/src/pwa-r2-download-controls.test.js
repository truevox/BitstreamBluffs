import {webcrypto} from 'node:crypto';import {TextEncoder} from 'node:util';
import {R2DownloadControls} from '../../tools/pwa/r2-download-controls.mjs';
globalThis.TextEncoder=TextEncoder;
const e={url:'https://bsb-audio.bearcave.win/releases/20261124-69a6fb46/catalog.json',bytes:10,sha256:'a'.repeat(64)};
const plan={format:'bb-published-music-plan-v1',catalog:e,groups:[{id:'required',priority:'required',entries:[{...e,bytes:20}]},{id:'bonus',priority:'bonus',entries:[{...e,bytes:30}]}]};
function fixture(overrides={}){const ready=new Set(),calls=[],states=[];const c=new R2DownloadControls({plan,subtle:webcrypto.subtle,estimate:async()=>({quota:1e8,usage:0}),inspect:async g=>({ready:ready.has(g.id),missingBytes:ready.has(g.id)?0:g.entries.reduce((n,e)=>n+e.bytes,0)}),download:async(g,o)=>{calls.push(g.id);expect(o.consent).toBe(true);o.onProgress({bytes:g.entries.reduce((n,e)=>n+e.bytes,0)});ready.add(g.id);},onState:s=>states.push(s),...overrides});return {c,calls,states,ready};}
test('construction, refresh and unconsented start do not transfer; required-only explicit download verifies readiness',async()=>{const f=fixture();await f.c.refresh();expect(f.calls).toEqual([]);await expect(f.c.start()).rejects.toThrow(/consent/);expect(f.calls).toEqual([]);const s=await f.c.start({consent:true});expect(f.calls).toEqual(['release-catalog','required']);expect(s.ready).toBe(true);expect(s.completedBytes).toBe(30);});
test('quota refusal and missing estimator never download',async()=>{for(const estimate of [async()=>({quota:100,usage:90}),async()=>({})]){const f=fixture({estimate});const s=await f.c.start({consent:true});expect(['insufficient-storage','failed']).toContain(s.status);expect(f.calls).toEqual([]);}});
test('cancel aborts in-flight request and duplicate start does not spawn another queue',async()=>{let begun;const started=new Promise(r=>begun=r);const f=fixture({download:async(g,o)=>{begun();await new Promise(r=>o.signal.addEventListener('abort',r,{once:true}));}});const p=f.c.start({consent:true});expect(f.c.start({consent:true})).toBe(p);await started;f.c.cancel();expect((await p).status).toBe('cancelled');expect(f.c.state.ready).toBe(false);});
test('bonus opt-in comes last and readiness derives from required verification, not progress',async()=>{const f=fixture();await f.c.start({consent:true,includeBonus:true});expect(f.calls).toEqual(['release-catalog','required','bonus']);expect(f.c.state.ready).toBe(true);const f2=fixture({download:async()=>{}});expect((await f2.c.start({consent:true})).ready).toBe(false);});

test('no selected required recordings means zero transfers; ready cache needs no quota estimate',async()=>{const off=fixture({plan:{...plan,groups:[]}});expect((await off.c.start({consent:true})).status).toBe('no-music');expect(off.calls).toEqual([]);const ready=fixture({estimate:async()=>({})});ready.ready.add('release-catalog');ready.ready.add('required');expect((await ready.c.start({consent:true})).ready).toBe(true);expect(ready.calls).toEqual([]);});

test('cold readiness scans one CacheStorage.keys snapshot without creating empty group caches',async()=>{
 const entry={url:'https://bsb-audio.bearcave.win/releases/20261124-69a6fb46/packs/a/0000-bass.ogg',bytes:8,sha256:'a'.repeat(64)};
 const version=[...new Uint8Array(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([entry]))))].map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,20);
 let keys=0,opened=0;const storage={keys:async()=>{keys++;return[];},open:async()=>{opened++;throw Error('CacheStorage.open must not be invoked for an absent group');}};
 const c=new R2DownloadControls({plan:{format:'bb-published-music-plan-v1',catalog:e,groups:[{id:'a:base',version,priority:'required',entries:[entry]}]},storage,origin:'https://game.example',scope:'/BitstreamBluffs/',subtle:webcrypto.subtle,estimate:async()=>({quota:1e8,usage:0})});
 const state=await c.refresh();expect(state.ready).toBe(false);expect(state.status).toBe('download-required');expect(state.missingBytes).toBe(e.bytes+entry.bytes);expect(keys).toBe(1);expect(opened).toBe(0);
});

test('fast playback readiness skips absent caches without a download or empty-cache creation',async()=>{
 const entry={url:e.url,bytes:e.bytes,sha256:e.sha256};
 const version=[...new Uint8Array(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([entry]))))].map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,20);
 let keys=0,opened=0;const storage={keys:async()=>{keys++;return[];},open:async()=>{opened++;throw Error('Readiness must not create empty cache');}};
 const c=new R2DownloadControls({plan:{format:'bb-published-music-plan-v1',catalog:e,groups:[{id:'song:base',version,priority:'required',entries:[entry]}]},storage,origin:'https://game.example',scope:'/BitstreamBluffs/',subtle:webcrypto.subtle,estimate:async()=>({quota:100,usage:0})});
 expect(await c.quickReady()).toBe(false);expect(keys).toBe(1);expect(opened).toBe(0);
});
