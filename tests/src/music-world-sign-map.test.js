import {WorldDanceEnvelope} from '../../src/systems/WorldDance.js';
import {syntheticMeterAt} from '../../src/systems/music/SyntheticMeterTiming.js';
import {minimapCorner,minimapPlacement,minimapTerrainProfile,chooseMinimapSlot,minimapAheadPx,
 RunMinimap,MINIMAP_SWITCH_DWELL_MS} from '../../src/ui/RunMinimap.js';
import {billboardThumbnail,billboardScreenY,billboardScreenX,billboardPulseScale,billboardAlpha,billboardRect,
 BILLBOARD_BEHIND_RIDER_ALPHA,BILLBOARD_LIFETIME_MS} from '../../src/entities/SongBillboard.js';

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

test('billboard has actual Youtube artwork only for known music IDs, local track is truthful',()=>{
 expect(billboardThumbnail('WRBGQUqD54U')).toBe('bb-youtube-WRBGQUqD54U');
 expect(billboardThumbnail('FEsxYVStla4')).toBeTruthy();
 expect(billboardThumbnail('FYImnz5-hXs')).toBeTruthy();
 expect(billboardThumbnail('local-one-more-run-bitstream-bluffs')).toBeNull();
 expect(billboardThumbnail('../x')).toBeNull();
});

test('billboard passes the viewport in a sky lane above the rider, kept above actual terrain',()=>{
 expect(billboardScreenY(210)).toBe(74);           // rider low: classic lane
 expect(billboardScreenY(84)).toBe(32);            // bottom edge 60 = rider head (84-24)
 expect(billboardScreenY(84,120)).toBe(32);
 expect(billboardScreenY(210,78)).toBe(42);        // never sinks into the terrain
 expect(billboardScreenY(40)).toBe(31);            // no lane left: stays on screen (and dims, below)
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
