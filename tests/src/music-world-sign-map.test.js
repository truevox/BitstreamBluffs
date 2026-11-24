import {jest} from '@jest/globals';
import {readFileSync} from 'node:fs';
import {trackYoutubeId,youtubeArtSources,catalogTrack,BillboardArtLoader,youtubeArtKey,GENERIC_ART_KEY,
 CATALOG_CACHE_KEY,billboardArtLoader} from '../../src/entities/BillboardArt.js';
import {WorldDanceEnvelope} from '../../src/systems/WorldDance.js';
import {syntheticMeterAt} from '../../src/systems/music/SyntheticMeterTiming.js';
import {minimapCorner,minimapPlacement,minimapTerrainProfile,chooseMinimapSlot,minimapAheadPx,
 RunMinimap,MINIMAP_SWITCH_DWELL_MS} from '../../src/ui/RunMinimap.js';
import {SongBillboard,billboardTitle,marqueeOffset,tickerWindow,billboardLayer,billboardPostLength,BILLBOARD_DEPTH,billboardScreenY,billboardScreenX,billboardPulseScale,billboardAlpha,billboardRect,
 BILLBOARD_BEHIND_RIDER_ALPHA,BILLBOARD_LIFETIME_MS,BILLBOARD_TITLE_PX} from '../../src/entities/SongBillboard.js';
import {measureText} from '../../src/ui/PixelFont.js';

const sample=(t,level=.38,revision='take-1')=>({timeMs:t,bass:level,mid:level,revision});
const meter=(s,revision='take-1')=>({...syntheticMeterAt(s),transportRevision:revision});

test('cosmetic synthetic beat and measure accents happen once at index edges, with stronger downbeats',()=>{
 const w=new WorldDanceEnvelope();
 expect(w.update(sample(100, .4),16,meter(.1))).toBe(0); // no startup accent
 const off=w.update(sample(510,.4),40,meter(.51));
 expect(off).toBeGreaterThan(0);
 expect(w.meterPulse).toBeCloseTo(.32);
 const repeated=w.update(sample(530,.4),20,meter(.53));
 expect(repeated).toBeLessThan(off);
 const down=w.update(sample(2040,.4),40,meter(2.04));
 expect(w.meterPulse).toBeCloseTo(.85);
 expect(down).toBeGreaterThan(off*1.4);
 const repeatDown=w.update(sample(2060,.4),20,meter(2.06));
 expect(repeatDown).toBeLessThan(down);
});

test('transport revision and real audio silence cannot produce fake meter animation',()=>{
 const w=new WorldDanceEnvelope();
 w.update(sample(10,.4),15,meter(.1));
 w.update(sample(520,.4),40,meter(.51));
 expect(w.strength).toBeGreaterThan(0);
 expect(w.update(null,16,meter(1))).toBe(0);
 expect(w.meterPulse).toBe(0);
 expect(w.update(sample(2020,0),50,meter(2.02))).toBe(0);
 expect(w.update(sample(2530,0),50,meter(2.53))).toBe(0);
 expect(w.update(sample(3000,.3,'take-2'),35,meter(3,'take-2'))).toBe(0);
 expect(w.update(sample(3510,.3,'take-2'),40,meter(3.51,'take-1'))).toBe(0);
 expect(w.meterPulse).toBe(0);
});

test('minimap avoids the lower-left rider and maps actual signed terrain heights',()=>{
 expect(minimapCorner(45,238)).toBe('top-right');
 expect(minimapCorner(42,90)).toBe('bottom-left');
 expect(minimapCorner(300,242)).toBe('bottom-left');
 expect(minimapPlacement('top-right')).toEqual({x:368,y:80,w:104,h:49});
 const terrain=x=>x<500?120+(x-200)*.1:150+(x-500)*-.1;
 const profile=minimapTerrainProfile(terrain,400);
 expect(profile.points).toHaveLength(27);
 expect(profile.riderU).toBeGreaterThan(0);
 expect(profile.riderU).toBeLessThan(.5);
 expect(profile.points.every(p=>p.v>=.179999&&p.v<=.820001)).toBe(true);
 expect(minimapTerrainProfile(()=>NaN,300)).toBeNull();
 expect(minimapTerrainProfile(null,300)).toBeNull();
});

test('billboard passes the viewport in a sky lane above the rider, kept above actual terrain',()=>{
 expect(billboardScreenY(210)).toBe(80);           // rider low: classic lane
 expect(billboardScreenY(100)).toBe(52);           // bottom edge 80 = 2 px above the rider's head (100-18)
 expect(billboardScreenY(84,120)).toBe(36);
 expect(billboardScreenY(210,78)).toBe(42);        // never sinks into the terrain
 expect(billboardScreenY(40)).toBe(36);            // no lane left: stays on screen (and dims, below)
 expect(billboardScreenX(565,0,1000)).toBeCloseTo(488);
 expect(billboardScreenX(565,200,1000)).toBe(365);
 expect(billboardScreenX(565,0,1000,false)).toBe(565);
 expect(billboardPulseScale(0)).toEqual({x:1,y:1});
 expect(billboardPulseScale(1)).toEqual({x:1.045,y:.965});
});

test('billboard dims while it has to cross the rider and fades out at the end of its life',()=>{
 const rider={x:100,y:60,w:32,h:34};
 expect(billboardAlpha(billboardRect(300,40),rider,1000)).toBe(1);
 expect(billboardAlpha(billboardRect(110,60),rider,1000)).toBe(BILLBOARD_BEHIND_RIDER_ALPHA);
 expect(billboardAlpha(billboardRect(300,40),null,BILLBOARD_LIFETIME_MS-300)).toBeCloseTo(.5);
 expect(billboardAlpha(billboardRect(300,40),null,BILLBOARD_LIFETIME_MS+10)).toBe(0);
});

test('minimap keeps clear of touch buttons and the bottom HUD row, and the rider always wins',()=>{
 // No keep-outs: owner rule unchanged.
 expect(chooseMinimapSlot(182,90,[]).corner).toBe('bottom-left');
 expect(chooseMinimapSlot(60,210,[]).corner).toBe('top-right');
 // iPad-size left touch cluster (x 7-115, y 200-270): lift the map above it.
 const ipad=chooseMinimapSlot(182,90,[{x:7,y:200,w:108,h:70}]);
 expect(ipad.corner).toBe('left-raised');
 expect(ipad.y+ipad.h).toBeLessThanOrEqual(196);
 // A cluster too tall to clear goes top-right instead.
 expect(chooseMinimapSlot(182,90,[{x:7,y:120,w:108,h:150}]).corner).toBe('top-right');
 // Everything blocked: never on the rider, least-covered slot otherwise.
 const blocked=[{x:0,y:0,w:480,h:270}];
 const slot=chooseMinimapSlot(420,100,blocked);
 expect(slot.corner).not.toBe('top-right');
});

test('minimap corner changes wait for a dwell, except when the current slot hits the rider',()=>{
 const m=Object.create(RunMinimap.prototype);
 Object.assign(m,{rect:{corner:'bottom-left',x:8,y:178,w:104,h:49},lastCorner:'bottom-left',_pending:null,_pendingMs:0});
 const tr={corner:'top-right',x:368,y:80,w:104,h:49};
 expect(m._settle(tr,null,110).corner).toBe('bottom-left');
 expect(m._settle(tr,null,MINIMAP_SWITCH_DWELL_MS-120).corner).toBe('bottom-left');
 expect(m._settle(tr,null,130).corner).toBe('top-right');
 const m2=Object.create(RunMinimap.prototype);
 Object.assign(m2,{rect:{corner:'bottom-left',x:8,y:178,w:104,h:49},lastCorner:'bottom-left',_pending:null,_pendingMs:0});
 expect(m2._settle(tr,{x:40,y:190,w:32,h:34},110).corner).toBe('top-right');
});

test('minimap looks further ahead than the zoomed-out screen already shows',()=>{
 expect(minimapAheadPx(182,1)).toBe(550);
 expect(minimapAheadPx(100,0.5)).toBe(1216);
 expect(minimapAheadPx(100,0.45)).toBe(1351);
 expect(minimapAheadPx(36,0.2)).toBe(1400);
});

const catalog=JSON.parse(readFileSync(new URL('../../public/music/catalog.json',import.meta.url)));
const OMR='local-one-more-run-bitstream-bluffs';

test('artwork resolver: the catalog alone decides, with no allowlist and no per-song code',()=>{
 const byId=Object.fromEntries(catalog.tracks.map(t=>[t.id,t]));
 for(const id of ['FEsxYVStla4','WRBGQUqD54U','FYImnz5-hXs'])expect(trackYoutubeId(byId[id])).toBe(id);
 expect(trackYoutubeId(byId[OMR])).toBeNull();                         // One More Run: generic, like any local song
 expect(trackYoutubeId({id:'local-some-other-song',title:'X'})).toBeNull(); // arbitrary second local song
 expect(trackYoutubeId({...byId[OMR],youtubeId:'abcDEF_12-3'})).toBe('abcDEF_12-3'); // new metadata just works
 expect(trackYoutubeId({id:'FEsxYVStla4'})).toBe('FEsxYVStla4');      // legacy: id is the YouTube ID
 expect(trackYoutubeId({id:'FEsxYVStla4',youtubeId:null})).toBeNull(); // explicit opt-out
 for(const bad of ['../../etc/pwd','short','toolongtoolong1','has space1',42,{}])
  expect(trackYoutubeId({id:'x',youtubeId:bad})).toBeNull();
 expect(youtubeArtSources('abcDEF_12-3')).toEqual(['music/thumbnails/abcDEF_12-3.jpg',
  'https://i.ytimg.com/vi/abcDEF_12-3/mqdefault.jpg']);
 expect(youtubeArtSources('../x')).toEqual([]);
 // Event payload {id,title} is joined to the catalog row by id.
 expect(catalogTrack(catalog,{id:'FYImnz5-hXs',title:'Varmont Is Saved'}).youtubeId).toBe('FYImnz5-hXs');
 expect(catalogTrack(null,{id:OMR,title:'One More Run'})).toEqual({id:OMR,title:'One More Run'});
});

/** Fake browser Image: outcome per URL ('ok' | 'error' | 'empty'). */
const fakeImages=(outcomes,log=[])=>()=>{
 const img={naturalWidth:0};
 Object.defineProperty(img,'src',{set(url){log.push(url);
  queueMicrotask(()=>{const o=outcomes[url]||'error';
   if(o==='ok'){img.naturalWidth=320;img.onload();}else if(o==='empty')img.onload();else img.onerror();});}});
 return img;
};
const fakeTextures=()=>{const keys=new Set();return {keys,exists:k=>keys.has(k),addImage:k=>keys.add(k)};};
const flush=()=>new Promise(r=>setTimeout(r,0));

test('thumbnail loader: bundled first, YouTube second, failure falls back, each ID loads once',async()=>{
 const tex=fakeTextures(),log=[];
 const id='abcDEF_12-3',[local,remote]=youtubeArtSources(id);
 const l=new BillboardArtLoader(tex,fakeImages({[remote]:'ok'},log));
 const done=jest.fn();
 expect(l.ensure(id,done)).toBe('loading');
 expect(l.ensure(id)).toBe('loading');          // no second request while loading
 await flush();await flush();
 expect(done).toHaveBeenCalledWith(true);
 expect(tex.exists(youtubeArtKey(id))).toBe(true);
 expect(log).toEqual([local,remote]);
 expect(l.ensure(id)).toBe('ready');
 // Missing everywhere (offline / CORS / bad ID): settles false once, remembered, no retry storm.
 const missing='zzzzzzzzzzz',bad=jest.fn();
 l.ensure(missing,bad);await flush();await flush();
 expect(bad).toHaveBeenCalledWith(false);
 const before=log.length;
 expect(l.ensure(missing)).toBe('failed');
 expect(log.length).toBe(before);
 // A zero-size decode counts as a failure, not a blank texture.
 const l2=new BillboardArtLoader(fakeTextures(),fakeImages({[youtubeArtSources('emptyIMAGE1')[0]]:'empty'}));
 const e=jest.fn();l2.ensure('emptyIMAGE1',e);await flush();await flush();
 expect(e).toHaveBeenCalledWith(false);
 // No Image in this environment: settles false, never throws.
 const l3=new BillboardArtLoader(fakeTextures(),()=>null);
 const n=jest.fn();l3.ensure('abcDEF_12-3',n);expect(n).toHaveBeenCalledWith(false);
});

/** Minimal Phaser-ish scene for SongBillboard.showTrack. */
function fakeScene(tex,catalogJson){
 // Each fake game object returns itself from every setter, recording texture and text.
 const obj=()=>{const t={frame:{width:320,height:180}};const self=new Proxy(t,{get:(o,k)=>k in o?o[k]:(...a)=>{
  if(k==='setTexture')o.texture={key:a[0]};if(k==='setText')o.text=a[0];return self;}});return self;};
 const textures={...tex,get:()=>({setFilter(){}})};
 return {textures,game:{textures,cache:{json:{get:k=>k===CATALOG_CACHE_KEY?catalogJson:null}}},
  cameras:{main:{scrollX:0}},
  add:{graphics:obj,image:obj,bitmapText:obj}};
}
const playing={jukeboxSnapshot:()=>({state:'playing'})};

test('billboard titles fit the sign at 1x pixel scale',()=>{
 expect(billboardTitle('One More Run (The Ballad of Bitstream Bluffs)')).toBe('ONE MORE RUN');
 expect(billboardTitle('Every Hacker (Runs Out of Code) - Part 2 of 2')).toBe('EVERY HACKER');
 expect(billboardTitle('Varmont Is Saved')).toMatch(/^VARMONT IS/);
 expect(billboardTitle('(Untitled)')).toMatch(/^\(UNTITLED/);
 // Long titles scroll: hold, move at 20 px/s, hold at the end, jump back.
 expect(marqueeOffset(500,40)).toBe(0);
 expect(marqueeOffset(1400,40)).toBe(10);
 expect(marqueeOffset(3300,40)).toBe(40);
 expect(marqueeOffset(3850,40)).toBe(0);  // period 900+2000+900 ms
 expect(marqueeOffset(1400,0)).toBe(0);
 // The ticker shows whole characters only, fits the sign, and ends on the title's tail.
 const t='ONE MORE RUN (THE BALLAD OF BITSTREAM BLUFFS)',travel=measureText(t)-BILLBOARD_TITLE_PX;
 expect(t.startsWith(tickerWindow(t,0))).toBe(true);
 for(let px=0;px<=travel;px+=3){const w=tickerWindow(t,px);expect(t.includes(w)).toBe(true);expect(measureText(w)).toBeLessThanOrEqual(BILLBOARD_TITLE_PX);}
 expect(t.endsWith(tickerWindow(t,travel))).toBe(true);
 expect(tickerWindow('SHORT',0)).toBe('SHORT');
});

test('billboard posts reach past the bottom of the screen; passes alternate background / foreground',()=>{
 for(const y of [36,52,80])expect(y+28+billboardPostLength(y)).toBeGreaterThan(270);
 expect(billboardLayer(0)).toBe('background');
 expect(billboardLayer(1)).toBe('foreground');
 expect(billboardLayer(2)).toBe('background');
 expect(BILLBOARD_DEPTH.background+3).toBeLessThan(5);    // whole sign, light included, behind the terrain mesh
 expect(BILLBOARD_DEPTH.foreground).toBeGreaterThan(20);  // in front of the rider

 // The passing sign is a minimap keep-out: top-right gives way to bottom-left.
 const sign={x:350,y:38,w:80,h:70};
 expect(chooseMinimapSlot(112,161,[]).corner).toBe('top-right');
 expect(chooseMinimapSlot(112,161,[sign]).corner).toBe('bottom-left');
});

test('song change sets title and art together; late or stale thumbnails never repaint',async()=>{
 const tex=fakeTextures();tex.keys.add(GENERIC_ART_KEY);tex.keys.add(youtubeArtKey('FEsxYVStla4'));
 const scene=fakeScene(tex,catalog);
 const b=new SongBillboard(scene),audio={...playing};
 expect(b.showTrack({id:OMR,title:'One More Run (The Ballad of Bitstream Bluffs)'},audio)).toBe(true);
 expect(b.artKey).toBe(GENERIC_ART_KEY);
 expect(b.hasVideo).toBe(false);
 expect(b.artPending).toBe(false);
 expect(b.showTrack({id:OMR,title:'again'},audio)).toBe(false); // once per song
 expect(b.showTrack({id:'FEsxYVStla4',title:'Pope Leo Wants the AI Root Password'},audio)).toBe(true);
 expect(b.artKey).toBe('bb-youtube-FEsxYVStla4');
 expect(b.title.text).toBe(billboardTitle('Pope Leo Wants the AI Root Password'));
 expect(b.art.texture.key).toBe('bb-youtube-FEsxYVStla4');
 // A brand-new catalog youtubeId that is still loading: sign holds off-screen,
 // then a song change before it arrives means the late image must not apply.
 const cat2={tracks:[...catalog.tracks.map(t=>t.id===OMR?{...t,youtubeId:'newVIDEO_01'}:t),{id:'local-two',title:'Two',manifest:'x'}]};
 const scene2=fakeScene(tex,cat2);
 const loader=billboardArtLoader(scene2.game);
 let finish;loader.ensure=(id,done)=>{finish=done;return 'loading';};
 const b2=new SongBillboard(scene2),audio2={...playing};
 b2.showTrack({id:OMR,title:'One More Run'},audio2);
 expect(b2.youtubeId).toBe('newVIDEO_01');
 expect(b2.artPending).toBe(true);
 expect(b2.artKey).toBe(GENERIC_ART_KEY);
 const stale=finish;
 b2.showTrack({id:'local-two',title:'Two'},audio2);
 expect(b2.youtubeId).toBeNull();
 tex.keys.add(youtubeArtKey('newVIDEO_01'));
 stale(true);
 expect(b2.artKey).toBe(GENERIC_ART_KEY);   // the second song keeps its own (generic) art
});
