import {createHash,webcrypto} from 'node:crypto';
import {MusicDownloadController,musicPolicyForPlan} from '../../tools/pwa/music-download-controller.mjs';
import {isRealSongDownloaded,songCacheName} from '../../tools/pwa/music-cache-prototype.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const catalogId='local-one-more-run-bitstream-bluffs';
const base='/music/packs/33_local-one-more-run-bitstream-bluffs/';
function group(id,priority='required'){
  const originalId=catalogId+':'+id;
  const data=quality=>{
    const url='/music-variants/'+quality+'/packs/33_local-one-more-run-bitstream-bluffs/'+id+'.ogg';
    const original=base+id+'.ogg';
    const entries=[{url:base+'pack.json',logicalUrl:base+'pack.json',bytes:4,sha256:sha('pack')},
      {url,logicalUrl:original,bytes:4,sha256:sha(quality==='lite'?'LITE':'FULL')}];
    return {id:originalId+':'+quality,originalId,songId:catalogId,quality,priority,version:'0123456789abcdef0123',entries};
  };
  return {originalId,priority,lite:data('lite'),full:data('full')};
}
const groups=[group('base'),group('debumont'),group('bonus','bonus')];

function expectPolicy(policy,mode,quality='lite'){
  expect(policy.mode).toBe(mode);
  expect(policy.songs).toEqual([{id:catalogId,activeQuality:quality,required:[groups[0].originalId,groups[1].originalId]}]);
}

test('policy excludes bonus lookahead, is deterministic and retains selected groups',()=>{
  for(const mode of ['high','saver','off'])expectPolicy(musicPolicyForPlan(groups,mode),mode);
  expectPolicy(musicPolicyForPlan(groups,'high',{[catalogId]:'full'}),'high','full');
  expectPolicy(musicPolicyForPlan(groups,'saver',{[catalogId]:'full'}),'saver');
  expect(()=>musicPolicyForPlan([groups[0],groups[0]],'high')).toThrow();
  expect(()=>musicPolicyForPlan([groups[2]],'high')).toThrow();
  expect(()=>musicPolicyForPlan(groups,'wrong')).toThrow();
});

class FakeResponse {
  constructor(data,{status=200}={}){this.data=Buffer.from(data);this.status=status;this.ok=status>=200&&status<300;this.type='basic';this.headers={};this.url='';}
  clone(){return new FakeResponse(this.data,{status:this.status})}
  async arrayBuffer(){return Uint8Array.from(this.data).buffer}
  async text(){return this.data.toString()}
  async json(){return JSON.parse(await this.text())}
}
class Cache{
  data=new Map();
  async match(url){return this.data.get(url)?.clone()}
  async put(url,response){this.data.set(url,response.clone())}
  async delete(url){return this.data.delete(url)}
}
class Store{
  caches=new Map();
  async open(name){if(!this.caches.has(name))this.caches.set(name,new Cache());return this.caches.get(name)}
}
const originalResponse=globalThis.Response;
beforeAll(()=>{globalThis.Response=FakeResponse});
afterAll(()=>{globalThis.Response=originalResponse});

function setup(options={}){
  const storage=new Store(),requests=[],posted=[],statuses=[],progress=[];
  const fetcher=options.fetcher||(async url=>{
    requests.push(url);
    return new FakeResponse(url.endsWith('pack.json')?'pack':url.includes('/lite/')?'LITE':'FULL');
  });
  const controller=new MusicDownloadController({groups,storage,origin:'https://game.example',subtle:webcrypto.subtle,
    fetcher,postPolicy:async policy=>posted.push(JSON.parse(JSON.stringify(policy))),onStatus:s=>statuses.push(s),onProgress:p=>progress.push(p),concurrency:1});
  return {controller,storage,requests,posted,statuses,progress};
}
const ready=(storage,g)=>isRealSongDownloaded(g,{storage,origin:'https://game.example',subtle:webcrypto.subtle});

test('High downloads all required Lite before Full, then bonus; promotion is explicit',async()=>{
  const {controller,storage,requests,posted,statuses}=setup();
  await controller.setMode('high');
  expectPolicy(posted.at(-1),'high');
  await controller.whenIdle();
  for(const g of groups){expect(await ready(storage,g.lite)).toBe(true);expect(await ready(storage,g.full)).toBe(true)}
  const variantCalls=requests.filter(url=>url.endsWith('.ogg'));
  expect(variantCalls).toEqual([groups[0].lite.entries[1].url,groups[1].lite.entries[1].url,
    groups[0].full.entries[1].url,groups[1].full.entries[1].url,
    groups[2].lite.entries[1].url,groups[2].full.entries[1].url].map(s=>'https://game.example'+s));
  expectPolicy(posted.at(-1),'high'); // Full downloaded, no automatic quality switch
  expect(await controller.atVerifiedBoundary(catalogId)).toBe(true);
  expectPolicy(posted.at(-1),'high','full');
  expect(await controller.atVerifiedBoundary(catalogId)).toBe(false);
  expect(statuses.at(-1).status).toBe('full-ready-for-future-fetches');
});

test('Space Saver serves Lite only and No Music schedules nothing, neither deletes Full caches',async()=>{
  const {controller,storage,requests,posted}=setup();
  await controller.setMode('high');await controller.whenIdle();
  const count=requests.length;
  await controller.setMode('saver');await controller.whenIdle();
  expectPolicy(posted.at(-1),'saver');
  expect(requests).toHaveLength(count);
  await controller.setMode('off');await controller.whenIdle();
  expectPolicy(posted.at(-1),'off');
  expect(requests).toHaveLength(count);
  for(const g of groups){expect(await ready(storage,g.lite)).toBe(true);expect(await ready(storage,g.full)).toBe(true)}
  expect(await controller.atVerifiedBoundary(catalogId)).toBe(false);
});

test('Partial Full group is not promoted and repair fetches only the missing recording',async()=>{
  const {controller,storage,requests}=setup();
  await controller.setMode('high');await controller.whenIdle();
  const original=groups[0].full;
  const cache=await storage.open(songCacheName(original));
  const entry=original.entries[1];
  expect(await cache.delete('https://game.example'+entry.url)).toBe(true);
  expect(await controller.atVerifiedBoundary(catalogId)).toBe(false);
  const before=requests.length;
  await controller.setMode('high');await controller.whenIdle();
  expect(requests.slice(before)).toEqual(['https://game.example'+entry.url]);
  expect(await controller.atVerifiedBoundary(catalogId)).toBe(true);
});

test('changing to No Music while download in flight aborts later groups and persists OFF',async()=>{
  let started,release;
  const waiting=new Promise(ok=>{release=ok});
  const first=new Promise(ok=>{started=ok});
  const requests=[];
  const fetcher=async(url,{signal})=>{
    requests.push(url);
    started();
    await waiting;
    if(signal.aborted)throw new Error('aborted');
    return new FakeResponse(url.endsWith('pack.json')?'pack':url.includes('/lite/')?'LITE':'FULL');
  };
  const {controller,posted,statuses}=setup({fetcher});
  await controller.setMode('high');
  await first;
  const noMusic=controller.setMode('off');
  release();
  await noMusic;await controller.whenIdle();
  expectPolicy(posted.at(-1),'off');
  expect(controller.mode).toBe('off');
  expect(requests).toHaveLength(1);
  expect(statuses.at(-1).status).toBe('disabled');
});

test('preference persistence errors propagate without initiating background downloading',async()=>{
  let calls=0;
  const {controller}=setup();
  controller.postPolicy=async()=>{calls++;throw new Error('Cannot persist SW preference')};
  await expect(controller.setMode('high')).rejects.toThrow('Cannot persist');
  await expect(controller.whenIdle()).rejects.toThrow('Cannot persist');
  expect(calls).toBe(1);
});

test('an in-flight Full policy update cannot overtake a later No Music choice',async()=>{
  const {controller}=setup();
  const posted=[];
  let release,entered;
  const hold=new Promise(ok=>{release=ok});
  const writing=new Promise(ok=>{entered=ok});
  controller.postPolicy=async p=>{
    posted.push(JSON.parse(JSON.stringify(p)));
    if(p.mode==='high'&&p.songs[0].activeQuality==='full'){
      entered();await hold;
    }
  };
  await controller.setMode('high');await controller.whenIdle();
  const promoted=controller.atVerifiedBoundary(catalogId);
  await writing;
  const off=controller.setMode('off');
  release();
  await promoted;await off;await controller.whenIdle();
  expectPolicy(posted.at(-1),'off');
  expect(controller.mode).toBe('off');
  expect(await controller.atVerifiedBoundary(catalogId)).toBe(false);
});


test('failed No Music persistence leaves previous verified preference effective',async()=>{
  const {controller,posted}=setup();
  await controller.setMode('high');await controller.whenIdle();
  expect(await controller.atVerifiedBoundary(catalogId)).toBe(true);
  const oldPolicy=controller.policy;
  const original=controller.postPolicy;
  controller.postPolicy=async policy=>{
    if(policy.mode==='off')throw new Error('SW preference storage full');
    return original(policy);
  };
  await expect(controller.setMode('off')).rejects.toThrow('SW preference storage full');
  expect(controller.mode).toBe('high');
  expect(controller.active[catalogId]).toBe('full');
  expect(controller.policy).toEqual(oldPolicy);
  expectPolicy(posted.at(-1),'high','full');
  expect(controller.lastError.message).toContain('SW preference storage full');
});
