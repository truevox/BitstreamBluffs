import {createHash,webcrypto} from 'node:crypto';
import {musicDownloadOrder,chooseMusicQuality,musicMode} from '../../tools/pwa/music-quality-policy.mjs';
import {makeTieredGroup,buildTieredMusicPlan} from '../../tools/pwa/music-quality-groups.mjs';
import {downloadRealSong,isRealSongDownloaded} from '../../tools/pwa/music-cache-prototype.mjs';
import {renderMusicRouteWorker} from '../../tools/pwa/music-route-worker.mjs';

const hash=(s)=>createHash('sha256').update(s).digest('hex');
const id='local-one-more-run-bitstream-bluffs';
const base='/music/packs/33_local-one-more-run-bitstream-bluffs/';
const stem=base+'0000-drums.ogg';
const pack=base+'pack.json';
const source={id:id+':base',songId:id,kind:'base',priority:'required',entries:[
  {url:pack,bytes:4,sha256:hash('pack')},{url:stem,bytes:4,sha256:hash('STEM')},
]};
const variant=quality=>({quality,entries:[{url:stem,
  variantUrl:'/music-variants/'+quality+stem.slice('/music'.length),
  sourceSha256:hash('STEM'),bytes:4,sha256:hash(quality==='lite'?'LITE':'FULL'),
  channels:1,sampleRate:48000,sourceDuration:12.0065,duration:12.0065}]});
const pair={priority:'required',lite:makeTieredGroup(source,'lite',variant('lite')),
  full:makeTieredGroup(source,'full',variant('full'))};

test('mode accepts three player choices and rejects arbitrary values',()=>{
  for(const mode of ['high','saver','off'])expect(musicMode(mode)).toBe(mode);
  for(const bad of ['',null,'auto','low','none',0])expect(()=>musicMode(bad)).toThrow();
});

test('high quality downloads every required Lite before the first Full; no music downloads nothing',()=>{
  const bonus={...pair,priority:'bonus',lite:{id:'bonus:lite'},full:{id:'bonus:full'}};
  const required2={...pair,lite:{id:'r2:lite'},full:{id:'r2:full'}};
  const groups=[bonus,pair,required2];
  expect(musicDownloadOrder('high',groups).map(x=>x.group.id)).toEqual([
    pair.lite.id,required2.lite.id,pair.full.id,required2.full.id,
    'bonus:lite','bonus:full',
  ]);
  expect(musicDownloadOrder('saver',groups).map(x=>x.group.id)).toEqual([
    pair.lite.id,required2.lite.id,'bonus:lite',
  ]);
  expect(musicDownloadOrder('off',groups)).toEqual([]);
});

test('quality promotion waits for complete verified Full and an explicit safe boundary',()=>{
  const ready=[{lite:true,full:true},{lite:true,full:true}];
  expect(chooseMusicQuality({mode:'high',required:ready,atBoundary:false}).quality).toBe('lite');
  expect(chooseMusicQuality({mode:'high',required:ready,atBoundary:true}).quality).toBe('full');
  expect(chooseMusicQuality({mode:'high',current:'full',required:ready}).quality).toBe('full');
  expect(chooseMusicQuality({mode:'high',required:[{lite:true,full:true},{lite:true,full:false}],atBoundary:true}).quality).toBe('lite');
  expect(chooseMusicQuality({mode:'saver',current:'full',required:ready}).quality).toBe('lite');
  expect(chooseMusicQuality({mode:'saver',required:[{lite:false,full:true}]})).toMatchObject({audible:false,quality:null});
  expect(chooseMusicQuality({mode:'off',current:'full',required:ready})).toMatchObject({audible:false,quality:null});
  expect(chooseMusicQuality({mode:'high',required:[{lite:false,full:true}],atBoundary:false}).quality).toBe('full');
  expect(chooseMusicQuality({mode:'high',required:[]})).toMatchObject({audible:false,reason:'download-lite'});
});

test('source-bound mono variants only replace original Ogg bytes, never pack.json or captions',()=>{
  const t=makeTieredGroup(source,'lite',variant('lite'));
  expect(t.id).toBe(id+':base:lite');
  expect(t.entries).toEqual([
    {url:pack,logicalUrl:pack,bytes:4,sha256:hash('pack')},
    {url:'/music-variants/lite'+stem.slice('/music'.length),logicalUrl:stem,bytes:4,sha256:hash('LITE')},
  ]);
  const plan=buildTieredMusicPlan({groups:[source]}, {lite:variant('lite'),full:variant('full')},'high');
  expect(plan.downloads.map(x=>x.quality)).toEqual(['lite','full']);
  expect(plan.downloads[0].group.totalBytes).toBe(8);
  const invalid=variant('lite');invalid.entries[0].sourceSha256=hash('NOT THE REAL SONG');
  expect(()=>makeTieredGroup(source,'lite',invalid)).toThrow(/tampered/);
  invalid.entries[0].sourceSha256=hash('STEM');invalid.entries[0].channels=2;
  expect(()=>makeTieredGroup(source,'lite',invalid)).toThrow(/non-mono/);
});

class FakeResponse {
  constructor(data,{status=200}={}) {this.buffer=Buffer.from(data);this.status=status;this.ok=status>=200&&status<300;this.type='basic';this.headers={};this.url='';}
  clone(){return new FakeResponse(this.buffer,{status:this.status})}
  async arrayBuffer(){return Uint8Array.from(this.buffer).buffer}
  async text(){return this.buffer.toString()}
  async json(){return JSON.parse(await this.text())}
}
class Cache {
  data=new Map();
  async match(url){return this.data.get(url)?.clone()}
  async put(url,response){this.data.set(url,response.clone())}
  async delete(url){return this.data.delete(url)}
}
class Store {
  caches=new Map();
  async open(name){if(!this.caches.has(name))this.caches.set(name,new Cache());return this.caches.get(name)}
}
const originalResponse=globalThis.Response;
beforeAll(()=>{globalThis.Response=FakeResponse});
afterAll(()=>{globalThis.Response=originalResponse});

test('real downloader verifies each tier independently and never treats partial Full as upgraded',async()=>{
  const storage=new Store();
  const options={storage,origin:'https://game.example',subtle:webcrypto.subtle,
    fetcher:async url=>{
      if(url.endsWith('pack.json'))return new FakeResponse('pack');
      if(url.startsWith('https://game.example/music-variants/lite/'))return new FakeResponse('LITE');
      if(url.startsWith('https://game.example/music-variants/full/'))return new FakeResponse('FULL');
      throw Error('Unexpected tier request: '+url);
    },concurrency:1};
  const lite=pair.lite,full=pair.full;
  expect(await isRealSongDownloaded(lite,options)).toBe(false);
  await downloadRealSong(lite,options);
  expect(await isRealSongDownloaded(lite,options)).toBe(true);
  expect(await isRealSongDownloaded(full,options)).toBe(false);
  await downloadRealSong(full,options);
  expect(await isRealSongDownloaded(full,options)).toBe(true);
  const c=await storage.open('bb-real-music-v1-'+full.id+'-'+full.version);
  c.data.delete(options.origin+full.entries[1].url);
  expect(await isRealSongDownloaded(full,options)).toBe(false);
  expect(await isRealSongDownloaded(lite,options)).toBe(true);
  const restored=await downloadRealSong(full,options);
  expect(restored.reused).toBe(1);
  expect(await isRealSongDownloaded(full,options)).toBe(true);
  // Source metadata was never copied into the physical quality namespace.
  expect(await c.match(options.origin+pack)).toBeDefined();
});

test('worker persists explicit choice and uses only selected quality for logical source URLs',()=>{
  const text=renderMusicRouteWorker();
  expect(text).toContain("QUALITY_POLICY_CACHE='bb-music-preference-v1'");
  expect(text).toContain('bb-set-music-preference');
  expect(text).toContain("policy.mode==='off'");
  expect(text).toContain("policy.mode==='saver'?'lite':song.activeQuality");
  expect(text).toContain('validRecording(group.cache,group.entries.get(path))');
});
