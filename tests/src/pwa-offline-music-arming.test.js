import {jest} from '@jest/globals';
jest.unstable_mockModule('../../src/data/index.js',()=>({content:{},loadContent:()=>({})}));
const {OfflineMusicView}=await import('../../src/ui/OfflineMusicView.js');
function fixture(){const calls=[],a={id:'a'},b={id:'b'},controller={plan:{nextBiome:'garbage-dump-glacier',groups:[a]},_planRevision:0,running:false,mode:'high',state:{status:'download-required',ready:false},start:async()=>{calls.push('download');return {ready:true};},prefetch:async()=>{calls.push('prefetch');return {ready:true};}};const view=Object.create(OfflineMusicView.prototype);view.controller=controller;view.tiered=true;view.pending=false;view.armed=false;view.armedPrefetch=false;view.scene={game:{scene:{isActive:()=>false}}};view._paint=()=>{};return {view,controller,calls,a,b};}
test('a download armed under an old song plan cannot authorize new song downloads',async()=>{const f=fixture();f.view._arm();expect(f.view.armed).toBe(true);f.controller._planRevision++;f.controller.plan={...f.controller.plan,groups:[f.a,f.b]};await f.view._start();expect(f.calls).toEqual([]);expect(f.view.localError).toMatch(/CONFIRM AGAIN/);f.view._arm();await f.view._start();expect(f.calls).toEqual(['download']);});
test('prefetch confirmation is bound to the exact next biome and rejected during replanning',async()=>{const f=fixture();f.view._armPrefetch();expect(f.view.armedPrefetch).toBe(true);f.controller.plan={...f.controller.plan,nextBiome:'micro-mountain'};f.controller._planRevision++;await f.view._startPrefetch();expect(f.calls).toEqual([]);expect(f.view.localError).toMatch(/CONFIRM AGAIN/);f.view._armPrefetch();f.controller.replanning=Promise.resolve();await f.view._startPrefetch();expect(f.calls).toEqual([]);f.controller.replanning=null;f.view._armPrefetch();await f.view._startPrefetch();expect(f.calls).toEqual(['prefetch']);});

test('reopened menu exposes Cancel while an optional prefetch continues in the controller',()=>{
 const f=fixture();f.view.alive=true;f.view.controller.running=Promise.resolve();f.view.controller.state={status:'download-required',prefetchStatus:'downloading',nextBiome:'micro-mountain',ready:false};
 f.view.status={setText:jest.fn()};f.view.note={setText:jest.fn()};
 f.view.menu={items:[
  {label:'MUSIC QUALITY'},{label:'DOWNLOAD / REPAIR'},{label:'CONFIRM DOWNLOAD'},{label:'PRELOAD NEXT BIOME'},
  {label:'CONFIRM PREFETCH'},{label:'CANCEL DOWNLOAD'},{label:'CHECK OFFLINE STATUS'},{label:'APPLY QUALITY (MUSIC STOPPED)'},
 ],refresh:jest.fn()};f.view._paint=OfflineMusicView.prototype._paint.bind(f.view);
 f.view._paint();expect(f.view.menu.items.find(x=>x.label==='CANCEL DOWNLOAD').disabled).toBe(false);
 expect(f.view.menu.items.find(x=>x.label==='DOWNLOAD / REPAIR').disabled).toBe(true);
});
