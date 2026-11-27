import { coarseGeo, startPlaytestGeo, GEO_KEY } from '../../src/systems/PlaytestGeo.js';
import { createPlaytestUpload } from '../../src/systems/PlaytestUpload.js';
const settle=()=>new Promise(r=>setTimeout(r,0));
const response={country_code:'US',region_code:'VT',ip:'192.0.2.1',city:'Example',latitude:1,longitude:2,postal:'00000',org:'Example'};
const win=(fetch)=>({localStorage,sessionStorage,fetch,AbortController,setTimeout,clearTimeout,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000017'}});
beforeEach(()=>{localStorage.clear();sessionStorage.clear();});
test('allowlist drops raw IP and exact geography; invalid region omitted',()=>{
 expect(coarseGeo(response)).toEqual({country:'US',region:'VT'});
 expect(coarseGeo({country_code:'US',region_code:'<script>'})).toEqual({country:'US'});
 expect(coarseGeo({country_code:'USA'})).toBeNull();
});
test('successful lookup cached across sessions, no raw fields persisted or sent',async()=>{
 let lookups=0, sent=[];
 const w=win(async (url,o)=>{if(url.includes('ipapi.co')){lookups++;expect(o.credentials).toBe('omit');expect(o.referrerPolicy).toBe('no-referrer');return {ok:true,json:async()=>response};}sent.push(JSON.parse(o.body));return {ok:true,json:async()=>({ok:true})};});
 for(let i=0;i<2;i++){const u=createPlaytestUpload(w,'2.25.17','https://example.test',{geoLookup:true});await settle();u.add({type:'sample'});await u.flush();}
 expect(lookups).toBe(1);expect(sent.map(b=>b.geo)).toEqual([{country:'US',region:'VT'},{country:'US',region:'VT'}]);
 expect(JSON.stringify([sent,localStorage.getItem(GEO_KEY)])).not.toMatch(/192\.0\.2\.1|latitude|postal|Example/);
});
test('failed lookup cached; stopped in-flight lookup cannot write or publish',async()=>{
 let calls=0;const w=win(async()=>{calls++;throw Error('offline');});
 startPlaytestGeo(w,()=>{});await settle();startPlaytestGeo(w,()=>{});expect(calls).toBe(1);
 localStorage.removeItem(GEO_KEY);let resolve,seen=0;const p=win(()=>new Promise(r=>resolve=r));
 const stop=startPlaytestGeo(p,()=>seen++);stop();localStorage.removeItem(GEO_KEY);resolve({ok:true,json:async()=>response});await settle();
 expect(seen).toBe(0);expect(localStorage.getItem(GEO_KEY)).toBeNull();
});
