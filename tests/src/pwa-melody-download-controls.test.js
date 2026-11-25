import {jest} from '@jest/globals';
jest.unstable_mockModule('../../src/data/index.js',()=>({content:{},loadContent:()=>({})}));
import {MelodyDownloadControls} from '../../tools/pwa/melody-download-controls.mjs';
const plan={format:'bb-melody-candidate-plan-v1',catalog:{},groups:[{quality:'lite'},{quality:'full'}]};
function fixture(){const calls=[],ready={lite:false,full:false};let stop=true,fullAllowed=true;const c=new MelodyDownloadControls({plan,options:{},estimate:()=>{},isStopped:()=>stop,activate:async(p,q)=>calls.push('apply:'+q),createQueue:({plan})=>{const q=plan.groups[0].quality;return {refresh:async()=>({ready:ready[q],missingBytes:ready[q]?0:10,status:ready[q]?'ready':'download-required'}),start:async()=>{calls.push(q);if(q==='full'&&!fullAllowed)return {ready:false,status:'insufficient-storage',missingBytes:10,availableBytes:5};ready[q]=true;return {ready:true,status:'ready'};},cancel:()=>{}};}});return {c,calls,ready,setStopped:v=>stop=v,allowFull:v=>fullAllowed=v};}
test('mode selection and status never transfer; High stages Lite before Full, and applies only at stop',async()=>{const f=fixture();await f.c.refresh();await expect(f.c.start()).rejects.toThrow(/consent/);expect(f.calls).toEqual([]);await f.c.start({consent:true});expect(f.calls).toEqual(['lite','full']);f.setStopped(false);await expect(f.c.apply()).rejects.toThrow(/Stop music/);f.setStopped(true);await f.c.apply();expect(f.calls.at(-1)).toBe('apply:lite');await f.c.apply();expect(f.calls.at(-1)).toBe('apply:full');});
test('Full quota failure retains Lite; Space Saver and No Music never stage Full',async()=>{const f=fixture();f.allowFull(false);expect((await f.c.start({consent:true})).status).toBe('lite-ready');await f.c.apply();expect(f.calls.at(-1)).toBe('apply:lite');await f.c.setMode('space-saver');await f.c.start({consent:true});expect(f.calls.at(-1)).toBe('lite');await f.c.setMode('no-music');const n=f.calls.length;await f.c.start({consent:true});expect(f.calls.length).toBe(n);await f.c.apply();expect(f.calls.at(-1)).toBe('apply:null');});

test('automatic playback-boundary promotion requires the transport barrier and never downloads',async()=>{const f=fixture();await f.c.start({consent:true});await f.c.apply();expect(f.c.quality).toBe('lite');const n=f.calls.length;expect((await f.c.beforePlayback()).reason).toBe('await-boundary');expect(f.calls.length).toBe(n);let held=false;f.c.withStoppedTransport=async fn=>{held=true;try{return await fn();}finally{held=false;}};f.c.activate=async(p,q)=>{expect(held).toBe(true);f.calls.push('apply:'+q);};f.setStopped(false);expect((await f.c.beforePlayback()).changed).toBe(false);f.setStopped(true);const a=f.c.beforePlayback(),b=f.c.beforePlayback();expect(a).toBe(b);expect(await a).toEqual({changed:true,quality:'full'});expect(f.calls.slice(n)).toEqual(['apply:full']);expect(held).toBe(false);});

test('replan keeps verified downloads, replaces stale queues and never transfers by itself',async()=>{
 const f=fixture();await f.c.start({consent:true});await f.c.apply();const n=f.calls.length;
 const newPlan={...plan,groups:[...plan.groups,{id:'song-2:base:lite',quality:'lite',priority:'required'}],nextBiome:'micro-mountain'};
 const stale=f.c.replan({...plan,nextBiome:'garbage-dump-glacier'}),latest=f.c.replan(newPlan);
 await Promise.all([stale,latest]);expect(f.c.plan).toBe(newPlan);expect(f.c.quality).toBe('lite');expect(f.calls).toHaveLength(n);expect(f.c.state.planRevision).toBe(2);expect(f.c.state.nextBiome).toBe('micro-mountain');
});

test('lookahead is explicit, idle-only, data-saver-aware, budgeted Lite-first and cancellable',async()=>{
 const groups=['a','b'].flatMap((song,i)=>['lite','full'].map((quality,q)=>({id:`${song}:lead:micro-mountain:${quality}`,originalId:`${song}:lead:micro-mountain`,songId:song,priority:'bonus',quality,bytes:q?22:10,entries:[{url:'https://example/'+quality+song,bytes:q?22:10,sha256:'0'.repeat(64)}]})));
 const queues=[],seen=[];const c=new MelodyDownloadControls({plan:{...plan,nextBiome:'micro-mountain',groups},options:{connection:{saveData:false}},estimate:async()=>({quota:100,usage:0}),isStopped:()=>true,createQueue:({plan})=>{const q={plan,start:async()=>{seen.push('transfer');return {ready:true,status:'ready'};},cancel:()=>seen.push('cancel'),refresh:async()=>({ready:false,missingBytes:100,status:'download-required'})};queues.push(q);return q;}});
 await expect(c.prefetch({idle:true})).rejects.toThrow(/consent/);await expect(c.prefetch({consent:true,idle:false})).rejects.toThrow(/idle/);expect(queues).toHaveLength(0);
 c.options.connection.saveData=true;await expect(c.prefetch({consent:true,idle:true})).rejects.toThrow(/Save Data/);c.options.connection.saveData=false;
 expect((await c.prefetch({consent:true,idle:true,maxBytes:21})).prefetchStatus).toBe('partial');expect(queues[0].plan.groups.map(g=>g.id)).toEqual(['a:lead:micro-mountain:lite','b:lead:micro-mountain:lite']);expect(queues[0].plan.groups.every(g=>g.priority==='required')).toBe(true);
 expect((await c.prefetch({consent:true,idle:true,maxBytes:64})).prefetchStatus).toBe('ready');expect(queues[1].plan.groups).toHaveLength(4);expect(seen).toEqual(['transfer','transfer']);
 c.mode='no-music';expect((await c.prefetch({consent:true,idle:true})).prefetchStatus).toBe('not-applicable');expect(seen).toHaveLength(2);
});

test('insufficient Full storage remains visible while verified Lite remains playable',async()=>{
 const f=fixture();f.allowFull(false);const state=await f.c.start({consent:true});expect(state).toMatchObject({status:'lite-ready',liteReady:true,upgradeStatus:'insufficient-storage',upgradeMissingBytes:10,availableBytes:5});
 const {downloadStatusText}=await import('../../src/ui/OfflineMusicView.js');expect(downloadStatusText(state)).toBe('LITE READY; FULL NEEDS 0.00 MB / 0.00 MB FREE');
});

test('a source event invalidates old consent synchronously while hashes are pending',async()=>{
 const f=fixture(),c=f.c;const oldRevision=c._planRevision;
 const ticket=c.markContextChanged();expect(c._planRevision).toBe(oldRevision+1);
 await expect(c.start({consent:true})).rejects.toThrow(/refreshing/);
 await expect(c.prefetch({consent:true,idle:true})).rejects.toThrow(/refresh/);
 const unchanged={...plan,groups:plan.groups.map(g=>({...g}))};
 await c.replan(unchanged,{contextTicket:ticket});expect(c.plan).toBe(plan);expect(c._contextRefreshTicket).toBeNull();
});

test('irrelevant profile writes do not cancel an active explicitly consented download',async()=>{
 let release,signalReceived;const calls=[];
 const gate=new Promise(r=>release=r),begun=new Promise(r=>signalReceived=r);
 const c=new MelodyDownloadControls({plan,options:{},estimate:()=>{},isStopped:()=>true,createQueue:({plan:subset})=>({
  refresh:async()=>({ready:false,status:'download-required',missingBytes:10}),
  start:async()=>{signalReceived();await gate;calls.push('finished');return {ready:true,status:'ready'};},cancel:()=>{calls.push('cancel');},
 })});
 const downloading=c.start({consent:true});await begun;const revision=c.markContextChanged();
 await c.replan({...plan,groups:plan.groups.map(g=>({...g}))},{contextTicket:revision});
 expect(c.running).toBe(downloading);expect(calls).toEqual([]);release();await downloading;
 expect(calls).toEqual(['finished','finished']);expect(c.state.status).toBe('ready');
});

test('a verified biome lead is appended at the active quality without stopping a playing track',async()=>{
 const base={id:'a:base:lite',originalId:'a:base',quality:'lite',priority:'required',version:'a'},lead={id:'a:lead:garbage-dump-glacier:lite',originalId:'a:lead:garbage-dump-glacier',quality:'lite',priority:'required',version:'b'};
 const old={...plan,groups:[base],nextBiome:'garbage-dump-glacier'},calls=[];
 const c=new MelodyDownloadControls({plan:old,mode:'space-saver',options:{worker:{id:'worker'}},estimate:()=>{},isStopped:()=>false,createQueue:()=>({refresh:async()=>({ready:true,status:'ready',missingBytes:0})}),append:async(groups)=>{calls.push(groups.map(g=>g.id));return {added:groups.length,groupIds:groups.map(g=>g.id)};}});
 c.quality='lite';c._appliedGroupIds=new Set([base.id]);
 const updated={...old,nextBiome:'pyramid-peak',groups:[base,lead]};await c.replan(updated);
 expect(c.plan).toBe(updated);expect(c.quality).toBe('lite');expect(c.state.ready).toBe(true);expect(calls).toEqual([[lead.id]]);expect(c._appliedGroupIds.has(lead.id)).toBe(true);
 await c._extendActiveTier();expect(calls).toHaveLength(1);
});

test('cancel during asynchronous Lite extension never starts the Full queue',async()=>{
 let release,notify;const gate=new Promise(r=>release=r),started=new Promise(r=>notify=r),calls=[];
 const lite={id:'a:base:lite',quality:'lite',priority:'required',version:'v1'};
 const c=new MelodyDownloadControls({plan:{...plan,groups:[lite]},mode:'high',options:{worker:{}},estimate:async()=>({quota:1e9,usage:0}),isStopped:()=>false,
  createQueue:({plan:p})=>({refresh:async()=>({ready:true,missingBytes:0}),start:async()=>{calls.push(p.groups[0]?.quality);return {ready:true,status:'ready'};},cancel:()=>calls.push('cancel:'+p.groups[0]?.quality)}),
  append:async()=>{notify();await gate;return{added:1,groupIds:[lite.id]};}});
 c.quality='lite';const pending=c.start({consent:true});await started;c.cancel();release();const result=await pending;
 expect(result.status).toBe('cancelled');expect(calls).toEqual(['lite','cancel:lite']);
});
