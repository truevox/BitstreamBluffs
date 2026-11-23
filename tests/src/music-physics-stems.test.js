import { jest } from '@jest/globals';
import { StemMusicDirector } from '../../src/systems/music/StemMusicDirector.js';
import { contactFromMotion, impactFromLanding } from '../../src/systems/music/MusicPhysicsSignals.js';
import { orchestraPreset } from '../../src/systems/music/DynamicOrchestraPresets.js';
import { HydrostaticPressure } from '../../src/systems/music/HydrostaticPressure.js';

const ROLES=['bass','drums','guitar','piano','other'];
function director() {
	const d=Object.create(StemMusicDirector.prototype);
	d.biome='garbage-dump-glacier';
	d.menuMode=false; d.airborne=false; d.speedPxS=400; d.clockStart=23.5;
	d._timbreSignatures=new Map();
	d._scrapContactLast=NaN;
	d._pendingScrapImpact=0; d._pendingSnowImpact=0; d._pendingHydroImpact=0;
	d.hydrostatic=new HydrostaticPressure();d._hydroLastSent=NaN;
	d.gains=new Map(ROLES.map(role=>[role,{}]));
	d.mixer={
		setEffectParam:jest.fn(()=>true),replaceEffects:jest.fn(()=>true),
		setRoomSend:jest.fn(()=>true),setGain:jest.fn(()=>true),
		selectBiome:jest.fn(()=>true)
	};
	d.adaptive={setSpeed:jest.fn(),setAirborne:jest.fn(),setBiome:jest.fn()};
	d.started=false;
	return d;
}

describe('Original-stem physics signals are read-only and source-grounded',()=>{
	test('ground contact comes from actual speed, not invented roughness or tempo',()=>{
		expect(contactFromMotion(NaN,true)).toBe(0);
		expect(contactFromMotion('900',true)).toBe(0);
		expect(contactFromMotion(900,false)).toBe(0);
		expect(contactFromMotion(0,true)).toBe(0);
		expect(contactFromMotion(100,true)).toBe(0);
		expect(contactFromMotion(650,true)).toBeCloseTo(.5);
		expect(contactFromMotion(3000,true)).toBe(1);
	});
	test('impact normalization rejects missing, crash and invalid landings',()=>{
		expect(impactFromLanding({impactSpeedPxS:0,hard:true})).toBe(0);
		expect(impactFromLanding({impactSpeedPxS:Infinity})).toBe(0);
		expect(impactFromLanding({impactSpeedPxS:600,quality:'crash'})).toBe(0);
		expect(impactFromLanding({impactSpeedPxS:900,hard:true,quality:'good'})).toBeGreaterThan(.55);
		expect(impactFromLanding({impactSpeedPxS:5000,hard:true})).toBe(1);
	});
	test('Garbage drum preset adds source-excited inharmonic Scrapheap, no MIDI re-performance',()=>{
		const d=director();d._applyMusicTimbres();
		const drum=d.mixer.replaceEffects.mock.calls.find(args=>args[0]==='drums');
		expect(drum[1]).toEqual(orchestraPreset('garbage-dump-glacier','drums'));
		expect(drum[1].some(fx=>fx.id==='scrapheap'&&fx.type==='scrapheap')).toBe(true);
		expect(orchestraPreset('debumont','drums').some(fx=>fx.type==='scrapheap')).toBe(false);
	});
	test('ground speed changes update only contact, not effects graph or song clock',()=>{
		const d=director();
		d._applyMusicTimbres();
		d.mixer.setEffectParam.mockClear();
		d.mixer.replaceEffects.mockClear();
		d.setSpeed(650);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','scrapheap','contact',.5);
		d.mixer.setEffectParam.mockClear();
		d.setSpeed(669);
		expect(d.mixer.setEffectParam.mock.calls.some(c=>c[1]==='scrapheap')).toBe(false);
		d.setSpeed(1100);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','scrapheap','contact',expect.any(Number));
		expect(d.mixer.replaceEffects).not.toHaveBeenCalled();
		expect(d.clockStart).toBe(23.5);
	});
	test('airtime removes contact; landing pulse waits for authoritative grounded transition',()=>{
		const d=director();d._applyMusicTimbres();
		d.mixer.setEffectParam.mockClear();
		d.setAirborne(true);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','scrapheap','contact',0);
		d.mixer.setEffectParam.mockClear();
		d.onLanding({quality:'good',impactSpeedPxS:700,hard:true});
		expect(d._pendingScrapImpact).toBeGreaterThan(0);
		expect(d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='impact')).toHaveLength(0);
		d.setAirborne(false);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','scrapheap','impact',expect.any(Number));
		expect(d._pendingScrapImpact).toBe(0);
		const before=d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='impact').length;
		d.setAirborne(false);
		expect(d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='impact')).toHaveLength(before);
		expect(d.clockStart).toBe(23.5);
	});
	test('real grounded-to-airborne transition triggers one suction, scales with actual speed and never leaks to menus',()=>{
		const d=director();d.speedPxS=650;
		d.setAirborne(true);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','scrapheap','takeoff',.5);
		const before=d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='takeoff').length;
		d.setAirborne(true);
		expect(d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='takeoff')).toHaveLength(before);
		d.setAirborne(false);
		expect(d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='takeoff')).toHaveLength(before);
		d.setSpeed(0);
		d.setAirborne(true);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','scrapheap','takeoff',.18);
		d.setAirborne(false);
		d.menuMode=true;
		d.mixer.setEffectParam.mockClear();
		d.setAirborne(true);
		expect(d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='takeoff')).toHaveLength(0);
		d.menuMode=false;
		d.biome='debumont';
		d.setAirborne(true);
		expect(d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='takeoff')).toHaveLength(0);
		expect(d.clockStart).toBe(23.5);
	});
	test('Crystal grounded originals ring consonantly; flight opens lattice, drums duck, landing triggers only measured-piano response',()=>{
		for(const stem of ['bass','guitar','piano','other'])
			expect(orchestraPreset('crystal-cavern',stem)).toEqual([
				{type:'crystallattice',id:'crystallattice',strength:1.5,openness:0,airBloom:1.6,
				 detectChroma:stem==='bass',bassFeed:stem==='bass'}]);
		expect(orchestraPreset('crystal-cavern','drums')).toEqual([{type:'gain',id:'crystalPercussion',gain:1}]);
		const d=director();d.biome='crystal-cavern';
		d.setAirborne(true);
		for(const stem of ['bass','guitar','piano','other'])
			expect(d.mixer.setEffectParam).toHaveBeenCalledWith(stem,'crystallattice','openness',1);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','crystalPercussion','gain',.48);
		d.mixer.setEffectParam.mockClear();
		d.setAirborne(true);
		expect(d.mixer.setEffectParam.mock.calls.filter(c=>c[1]==='crystallattice')).toHaveLength(0);
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:690});
		expect(d._pendingCrystalImpact).toBeGreaterThan(0);
		d.setAirborne(false);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','crystalPercussion','gain',1);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('bass','crystallattice','impact',expect.any(Number));
		expect(d._pendingCrystalImpact).toBe(0);
		d.setBiome('debumont');
		expect(d._pendingCrystalImpact).toBe(0);
	});
	test('Micro Mountain uses five original microbox processors, independently from MIDI voice',()=>{
		for(const stem of ROLES){
			const fx=orchestraPreset('micro-mountain',stem);
			expect(fx).toEqual([{type:'microbox',id:'microbox',openness:0,
				boxiness:1.35,impactWeight:1}]);
		}
	});
	test('Micro Mountain opens box once per grounded→airborne edge and shakes box only on real landing',()=>{
		const d=director();d.biome='micro-mountain';
		d.setAirborne(true);
		for(const stem of ROLES)expect(d.mixer.setEffectParam).toHaveBeenCalledWith(stem,'microbox','openness',1);
		d.mixer.setEffectParam.mockClear();
		d.setAirborne(true);
		expect(d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='openness')).toHaveLength(0);
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:600});
		expect(d._pendingMicroImpact).toBeGreaterThan(0);
		d.setAirborne(false);
		for(const stem of ROLES)expect(d.mixer.setEffectParam).toHaveBeenCalledWith(stem,'microbox','openness',0);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','microbox','impact',expect.any(Number));
		expect(d._pendingMicroImpact).toBe(0);
		d.setBiome('debumont');
		expect(d._pendingMicroImpact).toBe(0);
	});
	test('Hydrostatic original-stem preset exists only in Underwater, bass stays warm',()=>{

		for(const stem of ROLES) {
			const fx=orchestraPreset('underwater-mountain',stem);
			expect(fx).toEqual([{type:'hydrostatic',id:'hydrostatic',pressure:0,
				sensitivity:stem==='bass'?.68:1}]);
		}
		expect(orchestraPreset('garbage-dump-glacier','drums')[0].type).toBe('scrapheap');
	});
	test('Underwater depth accumulates only true terrain descent; jump relief and uphill never clear it',()=>{
		const d=director();d.biome='underwater-mountain';d._applyMusicTimbres();
		d.mixer.setEffectParam.mockClear();
		d.setHydrostaticMotion({terrainY:400,riderY:400,vy:0,grounded:true});
		const ground=d.setHydrostaticMotion({terrainY:990,riderY:990,vy:0,grounded:true});
		expect(ground).toBe(true);
		const saved=d.hydrostatic.storedPressure01;
		expect(saved).toBeGreaterThan(.5);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','hydrostatic','pressure',expect.any(Number));
		d.setHydrostaticMotion({terrainY:760,riderY:730,vy:-490,grounded:false});
		expect(d.hydrostatic.storedPressure01).toBe(saved);
		expect(d.hydrostatic.audiblePressure01).toBeLessThan(saved);
		d.setHydrostaticMotion({terrainY:790,riderY:760,vy:440,grounded:false});
		const duringFall=d.hydrostatic.audiblePressure01;
		expect(duringFall).toBeGreaterThan(0);
		d.setHydrostaticMotion({terrainY:790,riderY:790,vy:0,grounded:true});
		expect(d.hydrostatic.audiblePressure01).toBe(saved);
		const memory=d.hydrostatic.deepestTerrainDescentPx;
		d.setBiome('underwater-mountain');
		expect(d.hydrostatic.deepestTerrainDescentPx).toBe(memory);
		d.setBiome('debumont');
		expect(d.hydrostatic.storedPressure01).toBe(0);
		d.setBiome('underwater-mountain');
		d.setHydrostaticMotion({terrainY:1200,riderY:1200,vy:0,grounded:true});
		expect(d.hydrostatic.deepestTerrainDescentPx).toBe(0);
		d.biome='micro-mountain';d.mixer.setEffectParam.mockClear();
		expect(d.setHydrostaticMotion({terrainY:3000,riderY:3000,grounded:true})).toBe(false);
		expect(d.mixer.setEffectParam).not.toHaveBeenCalled();
	});
	test('Underwater landing pressure wave follows a real event, not a fake beat',()=>{
		const d=director();d.biome='underwater-mountain';d.airborne=true;
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:750});
		expect(d._pendingHydroImpact).toBeGreaterThan(.1);
		expect(d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='impact')).toHaveLength(0);
		d.setAirborne(false);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','hydrostatic','impact',expect.any(Number));
		expect(d._pendingHydroImpact).toBe(0);
		d.mixer.setEffectParam.mockClear();
		d.onLanding({quality:'crash',impactSpeedPxS:950,hard:true});
		expect(d.mixer.setEffectParam).not.toHaveBeenCalled();
	});
	test('post-grounded landing works, missing and wrong biome signals never leak',()=>{
		const d=director();d.mixer.setEffectParam.mockClear();
		d.onLanding({quality:'perfect',impactSpeedPxS:300,hard:false});
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','scrapheap','impact',expect.any(Number));
		d.mixer.setEffectParam.mockClear();
		d.onLanding({quality:'crash',impactSpeedPxS:900,hard:true});
		expect(d.mixer.setEffectParam).not.toHaveBeenCalled();
		d.biome='pyramid-peak';
		d.onLanding({quality:'good',impactSpeedPxS:900,hard:true});
		expect(d.mixer.setEffectParam).not.toHaveBeenCalled();
		d.biome='garbage-dump-glacier';d.menuMode=true;
		d.onLanding({quality:'good',impactSpeedPxS:900,hard:true});
		expect(d.mixer.setEffectParam).not.toHaveBeenCalled();
	});
});
