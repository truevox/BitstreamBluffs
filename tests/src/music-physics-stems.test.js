import { jest } from '@jest/globals';
import { StemMusicDirector } from '../../src/systems/music/StemMusicDirector.js';
import { contactFromMotion, impactFromLanding } from '../../src/systems/music/MusicPhysicsSignals.js';
import { orchestraPreset } from '../../src/systems/music/DynamicOrchestraPresets.js';

const ROLES=['bass','drums','guitar','piano','other'];
function director() {
	const d=Object.create(StemMusicDirector.prototype);
	d.biome='garbage-dump-glacier';
	d.menuMode=false; d.airborne=false; d.speedPxS=400; d.clockStart=23.5;
	d._timbreSignatures=new Map();
	d._scrapContactLast=NaN;
	d._pendingScrapImpact=0; d._pendingSnowImpact=0;
	d.gains=new Map(ROLES.map(role=>[role,{}]));
	d.mixer={
		setEffectParam:jest.fn(()=>true),replaceEffects:jest.fn(()=>true),
		setRoomSend:jest.fn(()=>true),setGain:jest.fn(()=>true)
	};
	d.adaptive={setSpeed:jest.fn(),setAirborne:jest.fn()};
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
