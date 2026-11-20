import {WorldDanceEnvelope} from '../../src/systems/WorldDance.js';
import {syntheticMeterAt} from '../../src/systems/music/SyntheticMeterTiming.js';
import {minimapCorner,minimapPlacement,minimapTerrainProfile} from '../../src/ui/RunMinimap.js';
import {billboardThumbnail,billboardScreenY,billboardScreenX,billboardPulseScale}
 from '../../src/entities/SongBillboard.js';

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

test('billboard passes the viewport and chooses a location away from the rider',()=>{
 expect(billboardScreenY(84)).toBe(194);
 expect(billboardScreenY(210)).toBe(74);
 expect(billboardScreenY(84,120)).toBe(71);
 expect(billboardScreenY(84,78)).toBe(44);
 expect(billboardScreenY(84,245)).toBe(194);
 expect(billboardScreenX(565,0,1000)).toBeCloseTo(488);
 expect(billboardScreenX(565,200,1000)).toBe(365);
 expect(billboardScreenX(565,0,1000,false)).toBe(565);
 expect(billboardPulseScale(0)).toEqual({x:1,y:1});
 expect(billboardPulseScale(1)).toEqual({x:1.045,y:.965});
});
