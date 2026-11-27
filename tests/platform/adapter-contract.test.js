import {PLATFORM_ABI,REWARD_STATES,createPlatformForTarget,isPlatformAdapter,
 createFakePlatform,createWebPlatform} from '../../src/platform/adapter.js';

function fakeStorage(){const map=new Map();return {map,
 getItem:key=>map.has(key)?map.get(key):null,
 setItem:(key,value)=>map.set(key,value),
 removeItem:key=>map.delete(key),
};}
const variants={
 web:()=>createWebPlatform({storage:fakeStorage()}),
 fake:()=>createFakePlatform(),
 crazygames:()=>createPlatformForTarget('crazygames'),
 steam:()=>createPlatformForTarget('steam'),
};

// One contract suite executed identically for ALL FOUR target surfaces.
describe.each(Object.entries(variants))('%s platform adapter contract', (name,create)=>{
 test('versioned interface has explicit immutable capability flags',()=>{
  const p=create();expect(isPlatformAdapter(p)).toBe(true);
  expect(p.id).toBe(name);expect(p.abi).toBe(PLATFORM_ABI);
  expect(Object.isFrozen(p)).toBe(true);expect(Object.isFrozen(p.capabilities)).toBe(true);
 });
 test('storage reads, writes and removes consistently, or refuses without throwing',async()=>{
  const p=create(),key='a-contract-key';
  const before=await p.storage.read(key);
  const write=await p.storage.write(key,'value');
  const after=await p.storage.read(key);
  const remove=await p.storage.remove(key);
  if(p.capabilities.storage){
   expect(before).toEqual({ok:true,found:false,value:null});
   expect(write).toEqual({ok:true});expect(after).toEqual({ok:true,found:true,value:'value'});
   expect(remove).toEqual({ok:true});expect(await p.storage.read(key)).toEqual(before);
  }else{
   expect(before).toEqual({ok:false,code:'unavailable'});
   expect(write).toEqual(before);expect(after).toEqual(before);expect(remove).toEqual(before);
  }
 });
 test('invalid keys and payloads fail closed on all targets',async()=>{
  const p=create();for(const key of ['', '../\u0000', 'a'.repeat(129)]){
   expect(await p.storage.read(key)).toEqual({ok:false,code:'invalid-key'});
   expect(await p.storage.write(key,'v')).toEqual({ok:false,code:'invalid-key'});
   expect(await p.storage.remove(key)).toEqual({ok:false,code:'invalid-key'});
  }
  expect(await p.storage.write('good',{raw:true})).toEqual({ok:false,code:'invalid-value'});
 });
 test('ownership and reward API are always safe, never grant by omission',async()=>{
  const p=create();const ownership=await p.ownership.get('pro');
  if(!p.capabilities.ownership)expect(ownership).toEqual({status:'unavailable'});
  else expect(ownership).toEqual({status:'not-owned'});
  const reward=await p.requestReward({placement:'lab-speed'});
  expect(REWARD_STATES).toContain(reward.status);
  if(!p.capabilities.rewards)expect(reward.status).toBe('unavailable');
 });
});

test('own website NEVER calls an ad or ownership API; unavailable is explicit',async()=>{
 const p=createPlatformForTarget('web',{storage:fakeStorage()});
 expect(p.capabilities.rewards).toBe(false);
 expect(await p.requestReward({placement:'ride'})).toEqual({status:'unavailable'});
 expect(await p.ownership.get('steam-license')).toEqual({status:'unavailable'});
});
test('web storage failures and quotas are explicit and do not report durable success',async()=>{
 const bad=createWebPlatform({storage:()=>{throw Error('SecurityError');}});
 expect(await bad.storage.read('k')).toEqual({ok:false,code:'unavailable'});
 expect(await bad.storage.write('k','v')).toEqual({ok:false,code:'unavailable'});
 const quota=createWebPlatform({storage:{getItem:()=>null,setItem:()=>{const e=new Error('full');e.name='QuotaExceededError';throw e;},removeItem:()=>{}}});
 expect(await quota.storage.write('k','v')).toEqual({ok:false,code:'quota-exceeded'});
});
test('fake reward outcomes are controlled, double requests never both complete',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});
 const p=createFakePlatform({owned:['basic'],rewards:[()=>pending,'completed','closed-early','no-ad','blocked']});
 expect(await p.ownership.get('basic')).toEqual({status:'owned'});
 const first=p.requestReward({placement:'lab'});
 expect(await p.requestReward({placement:'lab'})).toEqual({status:'busy'});
 release('completed');expect(await first).toEqual({status:'completed'});
 for(const status of ['completed','closed-early','no-ad','blocked'])
  expect(await p.requestReward({placement:'lab'})).toEqual({status});
 expect(await p.requestReward({placement:'lab'})).toEqual({status:'no-ad'});
});
test('unknown target cannot silently fall back to free or pretend to be Steam',()=>{
 expect(()=>createPlatformForTarget('mystery')).toThrow('Unknown deferred platform');
});

test('web platform writes only namespaced keys and never overwrites legacy saves',async()=>{
 const s=fakeStorage();s.setItem('bb.profile','existing-profile');
 s.setItem('bb.settings','existing-settings');
 const p=createWebPlatform({storage:s});
 expect(await p.storage.write('profile','new-platform-data')).toEqual({ok:true});
 expect(s.getItem('bb.profile')).toBe('existing-profile');
 expect(s.getItem('bb.settings')).toBe('existing-settings');
 expect(s.getItem('bb.platform.v1.profile')).toBe('new-platform-data');
 expect(await p.storage.remove('profile')).toEqual({ok:true});
 expect(s.getItem('bb.profile')).toBe('existing-profile');
});
