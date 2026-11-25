import {jest} from '@jest/globals';
import {storageProtectionStatus,requestStorageProtection} from '../../tools/pwa/storage-persistence.mjs';
import {MelodyDownloadControls} from '../../tools/pwa/melody-download-controls.mjs';
const plan={format:'bb-melody-candidate-plan-v1',catalog:{},groups:[{id:'base:lite',quality:'lite',priority:'required'}]};
function fixture(storageManager){return new MelodyDownloadControls({plan,options:{storageManager},estimate:async()=>({quota:100,usage:0}),isStopped:()=>true,createQueue:()=>{throw Error('Checking persistence must not create a download queue');}});}
test('querying persisted status is read-only and never prompts or downloads',async()=>{
 const persisted=jest.fn(async()=>false),persist=jest.fn(async()=>true),c=fixture({persisted,persist});
 expect(await c.checkStorageProtection()).toBe('available');expect(c.state.storageProtection).toBe('available');
 expect(persisted).toHaveBeenCalledTimes(1);expect(persist).not.toHaveBeenCalled();
 await expect(c.protectStorage()).rejects.toThrow(/consent/);expect(persist).not.toHaveBeenCalled();
});
test('explicit persistence request calls the browser immediately before the first await',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),persist=jest.fn(()=>pending),c=fixture({persisted:async()=>false,persist});
 const attempt=c.protectStorage({consent:true});expect(persist).toHaveBeenCalledTimes(1);
 resolve(true);expect(await attempt).toBe('granted');expect(c.state.storageProtection).toBe('granted');
});
test('denied, unsupported, and browser errors are advisory and never destroy music',async()=>{
 const denied=fixture({persisted:async()=>false,persist:async()=>false});
 expect(await denied.protectStorage({consent:true})).toBe('denied');expect(denied.state.storageProtection).toBe('denied');
 const unavailable=fixture({persisted:async()=>{throw Error('blocked');},persist:()=>{throw Error('blocked');}});
 expect(await unavailable.checkStorageProtection()).toBe('unavailable');expect(await unavailable.protectStorage({consent:true})).toBe('unavailable');
 const unsupported=fixture({});expect(await unsupported.checkStorageProtection()).toBe('unsupported');expect(await unsupported.protectStorage({consent:true})).toBe('unsupported');
 const ephemeral=fixture({persist:async()=>true});expect(await ephemeral.checkStorageProtection()).toBe('unsupported');
});
test('view protection button displays result, does not download, and remains repeatable after denial',async()=>{
 jest.unstable_mockModule('../../src/data/index.js',()=>({content:{},loadContent:()=>({})}));
 const {OfflineMusicView}=await import('../../src/ui/OfflineMusicView.js');
 const c=fixture({persisted:async()=>false,persist:async()=>false}),view=Object.create(OfflineMusicView.prototype);
 view.controller=c;view.pending=false;view.localError=false;view.localNotice=null;view.tiered=true;view.armed=false;view.armedPrefetch=false;view._paint=jest.fn();
 await view._protect();expect(view.localNotice).toMatch(/NOT GRANT/);expect(c.state.storageProtection).toBe('denied');expect(view.pending).toBe(false);
});
