import { jest } from '@jest/globals';
import { StemMusicDirector } from '../../src/systems/music/StemMusicDirector.js';
import { contactFromMotion, impactFromLanding } from '../../src/systems/music/MusicPhysicsSignals.js';
import { orchestraPreset } from '../../src/systems/music/DynamicOrchestraPresets.js';
import { HydrostaticPressure } from '../../src/systems/music/HydrostaticPressure.js';
import {ScrapPitchCadence} from '../../src/systems/music/ScrapPitchCadence.js';
import {geyserStep} from '../../src/systems/PhysicsTuner.js';
import {AudioSynth} from '../../src/systems/AudioSynth.js';

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
	test('Arcade bridge progress follows real generator geometry; standalone uses same chain',()=>{
		const d=director();d.biome='bitstream-bluffs';d.started=true;
		d._arcadeLastBridge=null;d._arcadeLastProgress=NaN;
		d._applyMusicTimbres();
		for(const stem of ROLES)expect(d.mixer.replaceEffects).toHaveBeenCalledWith(
			stem,orchestraPreset('bitstream-bluffs',stem),.18);
		d.mixer.setEffectParam.mockClear();
		expect(d.setArcadeTransition({bridge:true,progress:0})).toBe(true);
		for(const stem of ROLES){
			expect(d.mixer.setEffectParam).toHaveBeenCalledWith(stem,'arcadeglue','bridge',true);
			expect(d.mixer.setEffectParam).toHaveBeenCalledWith(stem,'arcadeglue','progress',0);
		}
		d.mixer.setEffectParam.mockClear();
		expect(d.setArcadeTransition({bridge:true,progress:.005})).toBe(true);
		expect(d.mixer.setEffectParam).not.toHaveBeenCalled();
		for(const progress of [.25,.5,.75,1])
			expect(d.setArcadeTransition({bridge:true,progress})).toBe(true);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums',
			'arcadeglue','progress',1);
		d.mixer.setEffectParam.mockClear();
		expect(d.setArcadeTransition({bridge:false,progress:0})).toBe(true);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('other','arcadeglue','bridge',false);
		// As a genuine destination, Arcade remains rich even without a bridge.
		expect(d.biome).toBe('bitstream-bluffs');
		expect(d.clockStart).toBe(23.5);
		d.setBiome('debutmont');d.mixer.setEffectParam.mockClear();
		expect(d.setArcadeTransition({bridge:true,progress:.5})).toBe(false);
		expect(d.mixer.setEffectParam).not.toHaveBeenCalled();
	});
	test('Arcade rejects invalid, menu/paused and future-standalone malformed bridge data',()=>{
		const d=director();d.biome='bitstream-bluffs';d.started=true;
		d._arcadeLastBridge=null;d._arcadeLastProgress=NaN;
		for(const bad of [{bridge:'true',progress:.5},{bridge:true,progress:NaN},
			{bridge:true,progress:-.01},{bridge:true,progress:1.01},
			{bridge:true,progress:Infinity},{}])
			expect(d.setArcadeTransition(bad)).toBe(false);
		const good={bridge:true,progress:.5};
		d.menuMode=true;expect(d.setArcadeTransition(good)).toBe(false);
		d.menuMode=false;d.transportPaused=true;
		expect(d.setArcadeTransition(good)).toBe(false);
		d.transportPaused=false;d.started=false;
		expect(d.setArcadeTransition(good)).toBe(false);
		expect(d.mixer.setEffectParam).not.toHaveBeenCalled();
		const synth=Object.create(AudioSynth.prototype);
		synth._musicMode='run';synth._paused=false;
		synth._stemMusic={setArcadeTransition:jest.fn(()=>true)};
		expect(synth.setArcadeTransition(good)).toBe(true);
		synth._paused=true;expect(synth.setArcadeTransition(good)).toBe(false);
		synth._musicMode='menu';synth._paused=false;
		expect(synth.setArcadeTransition(good)).toBe(false);
		expect(synth._stemMusic.setArcadeTransition).toHaveBeenCalledTimes(1);
	});
	test('every run starts with Debutmont melody, not the Arcade bridge or its lead',()=>{
		const audio=Object.create(AudioSynth.prototype);
		audio._stemMusic={setMenuMode:jest.fn(),setBiome:jest.fn(),started:true,
			transportPaused:false};
		audio._onBsodState=jest.fn();
		audio._setPaused=jest.fn();
		audio.startMusic=jest.fn();
		audio._enterRunMusic('seed');
		expect(audio._musicMode).toBe('run');
		expect(audio._stemMusic.setBiome).toHaveBeenCalledWith('debutmont');
		expect(audio._stemMusic.setBiome).not.toHaveBeenCalledWith('bitstream-bluffs');
		expect(audio.startMusic).not.toHaveBeenCalled(); // no track restart
	});

	test('Pyramid real unwarded thermal zone controls source resonance and a single true gust',()=>{
		const d=director();d.biome='pyramid-peak';d.started=true;
		d._thermalLastLoft=NaN;d._thermalWasActive=false;d._pendingPyramidImpact=0;
		const preset=orchestraPreset('pyramid-peak','drums');
		expect(preset).toEqual([{type:'sunstone',id:'sunstone',loft:0,
			resonance:1.25,drift:1,gustLevel:1.2,stoneLevel:1.15}]);
		d._applyMusicTimbres();
		for(const stem of ROLES)expect(d.mixer.replaceEffects).toHaveBeenCalledWith(
			stem,orchestraPreset('pyramid-peak',stem),.18);
		d.mixer.setEffectParam.mockClear();
		const noThermal={active:false,gravityPxS2:600,vy:-650,grounded:false};
		expect(d.setThermalMotion(noThermal)).toBe(false);
		expect(d.mixer.setEffectParam.mock.calls.some(c=>c[2]==='gust')).toBe(false);
		// Merely standing on thermal ground does not invent airborne gust.
		expect(d.setThermalMotion({active:true,gravityPxS2:738,vy:0,grounded:true})).toBe(false);
		d.mixer.setEffectParam.mockClear();
		d.setAirborne(true);
		const rising={active:true,gravityPxS2:738,vy:-880,grounded:false};
		expect(d.setThermalMotion(rising)).toBe(true);
		for(const stem of ROLES)expect(d.mixer.setEffectParam).toHaveBeenCalledWith(
			stem,'sunstone','loft',expect.any(Number));
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('other','sunstone','gust',expect.any(Number));
		const gusts=d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='gust').length;
		expect(gusts).toBe(1);
		expect(d.setThermalMotion(rising)).toBe(true);
		expect(d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='gust')).toHaveLength(1);
		d.setBiome('pyramid-peak'); // same biome reapplication must not invent a thermal entrance
		expect(d.setThermalMotion(rising)).toBe(true);
		expect(d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='gust')).toHaveLength(1);
		// Exit active thermal then reenter => ONE new authentic gust.
		expect(d.setThermalMotion({...rising,active:false})).toBe(false);
		expect(d.setThermalMotion(rising)).toBe(true);
		expect(d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='gust')).toHaveLength(2);
		// Real valid landing queues until confirmed grounded, then stone.
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:800});
		expect(d._pendingPyramidImpact).toBeGreaterThan(0);
		expect(d.mixer.setEffectParam.mock.calls.some(c=>c[2]==='stone')).toBe(false);
		d.setAirborne(false);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith(
			'drums','sunstone','stone',expect.any(Number));
		expect(d._pendingPyramidImpact).toBe(0);
		expect(d.clockStart).toBe(23.5);
		d.setBiome('debutmont');d.mixer.setEffectParam.mockClear();
		expect(d.setThermalMotion(rising)).toBe(false);
		expect(d.mixer.setEffectParam.mock.calls.some(c=>c[1]==='sunstone')).toBe(false);
	});
	test('Pyramid invalid gravity, crash, wrong zone, menu and pause cannot create thermal gust',()=>{
		const d=director();d.biome='pyramid-peak';d.started=true;
		d._thermalLastLoft=NaN;d._thermalWasActive=false;d._pendingPyramidImpact=0;
		const yes={active:true,gravityPxS2:738,vy:-670,grounded:false};
		for(const bad of [{...yes,active:'true'},{...yes,grounded:1},
			{...yes,vy:NaN},{...yes,gravityPxS2:0},{...yes,gravityPxS2:Infinity}])
			expect(d.setThermalMotion(bad)).toBe(false);
		d.onLanding({quality:'crash',hard:true,impactSpeedPxS:1000});
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:Infinity});
		expect(d._pendingPyramidImpact).toBe(0);
		d.menuMode=true;d.mixer.setEffectParam.mockClear();
		expect(d.setThermalMotion(yes)).toBe(false);
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:900});
		d.setAirborne(true);
		expect(d._pendingPyramidImpact).toBe(0);
		expect(d.mixer.setEffectParam.mock.calls.some(c=>c[1]==='sunstone')).toBe(false);
		d.menuMode=false;d.transportPaused=true;d.airborne=false;
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:900});
		expect(d.setThermalMotion(yes)).toBe(false);
		expect(d._pendingPyramidImpact).toBe(0);
		const synth=Object.create(AudioSynth.prototype);
		synth._musicMode='run';synth._paused=false;
		synth._stemMusic={setThermalMotion:jest.fn(()=>true)};
		expect(synth.setThermalMotion(yes)).toBe(true);
		synth._paused=true;expect(synth.setThermalMotion(yes)).toBe(false);
		synth._musicMode='menu';synth._paused=false;expect(synth.setThermalMotion(yes)).toBe(false);
		expect(synth._stemMusic.setThermalMotion).toHaveBeenCalledTimes(1);
	});

	test('Space Mountain reads actual low gravity and terrain altitude without moving source song clock',()=>{
		const d=director();d.biome='space-mountain';d.started=true;
		d._pendingSpaceImpact=0;d._spaceLastField=NaN;d._spaceLastGravity=NaN;
		const preset=orchestraPreset('space-mountain','drums');
		expect(preset).toEqual([{type:'orbitfield',id:'orbitfield',spread:1.15,
			drift:1,weightless:0,lowGravity:0,reentryLevel:1.25,ejectLevel:.8}]);
		d._applyMusicTimbres();
		for(const stem of ROLES)expect(d.mixer.replaceEffects).toHaveBeenCalledWith(
			stem,orchestraPreset('space-mountain',stem),.18);
		d.mixer.setEffectParam.mockClear();
		expect(d.setSpaceMotion({gravityPxS2:630,terrainY:600,riderY:600,vy:0,grounded:true})).toBe(true);
		for(const stem of ROLES)expect(d.mixer.setEffectParam).toHaveBeenCalledWith(
			stem,'orbitfield','lowGravity',expect.closeTo(.3,4));
		for(const stem of ROLES)expect(d.mixer.setEffectParam).toHaveBeenCalledWith(
			stem,'orbitfield','weightless',0);
		const initial=d.mixer.setEffectParam.mock.calls.length;
		expect(d.setSpaceMotion({gravityPxS2:630,terrainY:600,riderY:600,vy:0,grounded:true})).toBe(true);
		expect(d.mixer.setEffectParam).toHaveBeenCalledTimes(initial);
		d.mixer.setEffectParam.mockClear();
		d.setAirborne(true);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('other','orbitfield','eject',.25);
		expect(d.setSpaceMotion({gravityPxS2:630,terrainY:600,riderY:-100,vy:-450,grounded:false})).toBe(true);
		for(const stem of ROLES)expect(d.mixer.setEffectParam).toHaveBeenCalledWith(
			stem,'orbitfield','weightless',expect.closeTo(.925,3));
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:900});
		expect(d._pendingSpaceImpact).toBeGreaterThan(.5);
		expect(d.mixer.setEffectParam.mock.calls.some(c=>c[2]==='reentry')).toBe(false);
		d.setAirborne(false);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith(
			'drums','orbitfield','reentry',expect.any(Number));
		expect(d._pendingSpaceImpact).toBe(0);
		expect(d.clockStart).toBe(23.5);
		d.setBiome('debutmont');d.mixer.setEffectParam.mockClear();
		expect(d.setSpaceMotion({gravityPxS2:630,terrainY:600,riderY:-100,vy:-450,grounded:false})).toBe(false);
		expect(d.mixer.setEffectParam.mock.calls.some(c=>c[1]==='orbitfield')).toBe(false);
	});
	test('Space low-gravity input validation, menu and crash landing fail closed',()=>{
		const d=director();d.biome='space-mountain';d.started=true;
		d._pendingSpaceImpact=0;d._spaceLastField=NaN;d._spaceLastGravity=NaN;
		const valid={gravityPxS2:630,terrainY:600,riderY:400,vy:-200,grounded:false};
		for(const bad of [{...valid,grounded:'false'},{...valid,gravityPxS2:Infinity},
			{...valid,riderY:NaN},{...valid,gravityPxS2:0}]){
			expect(d.setSpaceMotion(bad)).toBe(false);
		}
		d.onLanding({quality:'crash',hard:true,impactSpeedPxS:1000});
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:Infinity});
		expect(d._pendingSpaceImpact).toBe(0);
		d.menuMode=true;d.mixer.setEffectParam.mockClear();
		expect(d.setSpaceMotion(valid)).toBe(false);
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:900});
		expect(d._pendingSpaceImpact).toBe(0);
		d.setAirborne(true);
		expect(d.mixer.setEffectParam.mock.calls.some(c=>c[1]==='orbitfield')).toBe(false);
		d.menuMode=false;d.transportPaused=true;d.airborne=false;
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:900});
		d.setAirborne(true);
		expect(d._pendingSpaceImpact).toBe(0);
		expect(d.mixer.setEffectParam.mock.calls.some(c=>c[2]==='reentry'||c[2]==='eject')).toBe(false);
		expect(d.setSpaceMotion(valid)).toBe(false);
		const synth=Object.create(AudioSynth.prototype);
		synth._musicMode='run';synth._paused=false;
		synth._stemMusic={setSpaceMotion:jest.fn(()=>true)};
		expect(synth.setSpaceMotion(valid)).toBe(true);
		synth._paused=true;expect(synth.setSpaceMotion(valid)).toBe(false);
		synth._musicMode='menu';synth._paused=false;expect(synth.setSpaceMotion(valid)).toBe(false);
		expect(synth._stemMusic.setSpaceMotion).toHaveBeenCalledTimes(1);
	});

	test('Candy Cane original-stem sparkle follows actual speed while Sugar Rush physics is untouched',()=>{
		const d=director();d.biome='candy-cane-canyon';d._pendingCandyImpact=0;
		d._candyLastSpeed=NaN;d.speedPxS=0;
		const preset=orchestraPreset('candy-cane-canyon','drums');
		expect(preset).toEqual([{type:'sugarfizz',id:'sugarfizz',speed:0,
			airborne:false,sweetness:1.25,fizz:1.5,popLevel:1.3,wrapperLevel:.9}]);
		d._applyMusicTimbres();
		for(const stem of ROLES)expect(d.mixer.replaceEffects).toHaveBeenCalledWith(
			stem,orchestraPreset('candy-cane-canyon',stem),.18);
		d.mixer.setEffectParam.mockClear();
		d.setSpeed(1440); // true existing speed, NOT a fabricated musical metronome
		for(const stem of ROLES)expect(d.mixer.setEffectParam).toHaveBeenCalledWith(
			stem,'sugarfizz','speed',expect.closeTo(.8,4));
		const speedCount=d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='speed').length;
		d.setSpeed(1450);
		expect(d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='speed')).toHaveLength(speedCount);
		d.mixer.setEffectParam.mockClear();
		d.setAirborne(true);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('other','sugarfizz','wrapper',.8055555555555556);
		for(const stem of ROLES)expect(d.mixer.setEffectParam).toHaveBeenCalledWith(
			stem,'sugarfizz','airborne',true);
		const wrapperCount=d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='wrapper').length;
		d.setAirborne(true);
		expect(d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='wrapper')).toHaveLength(wrapperCount);
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:860});
		expect(d._pendingCandyImpact).toBeGreaterThan(.4);
		expect(d.mixer.setEffectParam.mock.calls.some(c=>c[2]==='pop')).toBe(false);
		d.setAirborne(false);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith(
			'drums','sugarfizz','pop',expect.any(Number));
		expect(d._pendingCandyImpact).toBe(0);
		expect(d.clockStart).toBe(23.5);
		d.setBiome('debutmont');d.mixer.setEffectParam.mockClear();
		d.setSpeed(1800);
		expect(d.mixer.setEffectParam.mock.calls.some(c=>c[1]==='sugarfizz')).toBe(false);
	});
	test('Candy Cane menu, crash, invalid landing and already airborne entry are safe',()=>{
		const d=director();d.biome='candy-cane-canyon';d._pendingCandyImpact=0;
		d.airborne=true;d._applyMusicTimbres();
		for(const stem of ROLES)expect(d.mixer.replaceEffects.mock.calls
			.find(c=>c[0]===stem)?.[1]?.[0]).toMatchObject({type:'sugarfizz',airborne:true});
		d.onLanding({quality:'crash',hard:true,impactSpeedPxS:1100});
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:NaN});
		expect(d._pendingCandyImpact).toBe(0);
		d.menuMode=true;d.mixer.setEffectParam.mockClear();
		d.setAirborne(false);d.setAirborne(true);
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:750});
		expect(d._pendingCandyImpact).toBe(0);
		expect(d.mixer.setEffectParam.mock.calls.some(c=>c[1]==='sugarfizz')).toBe(false);
		d.menuMode=false;d.transportPaused=true;d.airborne=false;
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:900});
		d.setAirborne(true);
		expect(d._pendingCandyImpact).toBe(0);
		expect(d.mixer.setEffectParam.mock.calls.some(c=>c[2]==='wrapper'||c[2]==='pop')).toBe(false);
	});

	test('Vertigo eruption only on actual same-physics-tick geyser cooldown increase, not a jump',()=>{
		const d=director();d.biome='vertigo-vents';d.started=true;
		d._pendingVentCrust=0;d._ventLastLift=NaN;
		const preset=orchestraPreset('vertigo-vents','drums');
		expect(preset).toEqual([{type:'ventforge',id:'ventforge',
			rumble:1.25,shimmer:1.25,updraft:0,blast:1.3,crust:.8}]);
		d._applyMusicTimbres();
		for(const stem of ROLES)expect(d.mixer.replaceEffects).toHaveBeenCalledWith(
			stem,orchestraPreset('vertigo-vents',stem),.18);
		d.mixer.setEffectParam.mockClear();
		// Ordinary player jump: negative actual velocity can color music but
		// MUST NOT trigger an eruption when cooldown stays unchanged.
		expect(d.setGeyserMotion({beforeCooldownMs:0,afterCooldownMs:0,
			launchAvailable:true,vy:-720})).toBe(false);
		expect(d.mixer.setEffectParam.mock.calls.some(call=>call[2]==='eruption')).toBe(false);
		d.mixer.setEffectParam.mockClear();
		expect(d.setGeyserMotion({beforeCooldownMs:0,afterCooldownMs:892,
			launchAvailable:true,vy:-1150})).toBe(true);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','ventforge','eruption',
			expect.any(Number));
		const count=d.mixer.setEffectParam.mock.calls.filter(call=>call[2]==='eruption').length;
		expect(d.setGeyserMotion({beforeCooldownMs:892,afterCooldownMs:884,
			launchAvailable:true,vy:-1050})).toBe(false);
		expect(d.setGeyserMotion({beforeCooldownMs:0,afterCooldownMs:897,
			launchAvailable:false,vy:-1100})).toBe(false);
		expect(d.setGeyserMotion({beforeCooldownMs:0,afterCooldownMs:900,
			launchAvailable:true,vy:Infinity})).toBe(false);
		expect(d.mixer.setEffectParam.mock.calls.filter(call=>call[2]==='eruption')).toHaveLength(count);
		// Legitimate landing pulse arrives before authoritative grounded.
		d.airborne=true;
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:850});
		expect(d._pendingVentCrust).toBeGreaterThan(0);
		d.setAirborne(false);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','ventforge',
			'crustImpact',expect.any(Number));
		expect(d._pendingVentCrust).toBe(0);
		expect(d.clockStart).toBe(23.5); // no song restart or beat change
		d.setBiome('debutmont');
		d.mixer.setEffectParam.mockClear();
		expect(d.setGeyserMotion({beforeCooldownMs:0,afterCooldownMs:900,
			launchAvailable:true,vy:-1000})).toBe(false);
		expect(d.mixer.setEffectParam.mock.calls.some(call=>call[1]==='ventforge')).toBe(false);
	});
	test('Vertigo sound follows actual geyserStep launch cooldown, never an invented jump beat',()=>{
		const vent={velocityPxS:620,cooldownMs:900};
		const launched=geyserStep({grounded:true,launch:vent,cooldownLeftMs:0});
		expect(launched.fire).toBe(true);
		const d=director();d.biome='vertigo-vents';d.started=true;d._ventLastLift=NaN;
		const actual={beforeCooldownMs:0,afterCooldownMs:launched.cooldownMs-8,
			vy:launched.dvy,launchAvailable:true};
		expect(d.setGeyserMotion(actual)).toBe(true);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','ventforge',
			'eruption',expect.any(Number));
		const cooldown=geyserStep({grounded:true,launch:vent,cooldownLeftMs:600});
		expect(cooldown.fire).toBe(false);
		d.mixer.setEffectParam.mockClear();
		expect(d.setGeyserMotion({beforeCooldownMs:600,afterCooldownMs:592,
			vy:-450,launchAvailable:true})).toBe(false);
		expect(d.mixer.setEffectParam.mock.calls.some(call=>call[2]==='eruption')).toBe(false);
		const ordinaryHop=geyserStep({grounded:false,launch:vent,cooldownLeftMs:0});
		expect(ordinaryHop.fire).toBe(false);
		expect(d.setGeyserMotion({beforeCooldownMs:0,afterCooldownMs:0,
			vy:-620,launchAvailable:true})).toBe(false);
		// The AudioSynth adapter refuses pause/menu instead of fabricating a geyser.
		const synth=Object.create(AudioSynth.prototype);
		synth._musicMode='run';synth._paused=false;
		synth._stemMusic={setGeyserMotion:jest.fn(()=>true)};
		expect(synth.setGeyserMotion(actual)).toBe(true);
		expect(synth._stemMusic.setGeyserMotion).toHaveBeenCalledWith(actual);
		synth._paused=true;
		expect(synth.setGeyserMotion(actual)).toBe(false);
		synth._musicMode='menu';synth._paused=false;
		expect(synth.setGeyserMotion(actual)).toBe(false);
		expect(synth._stemMusic.setGeyserMotion).toHaveBeenCalledTimes(1);
	});

	test('Vertigo menu, crash, disabled transport and invalid snapshots fail closed',()=>{
		const d=director();d.biome='vertigo-vents';d.started=true;d._pendingVentCrust=0;
		d.onLanding({quality:'crash',hard:true,impactSpeedPxS:1200});
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:NaN});
		expect(d._pendingVentCrust).toBe(0);
		d.menuMode=true;
		expect(d.setGeyserMotion({beforeCooldownMs:0,afterCooldownMs:900,
			launchAvailable:true,vy:-1300})).toBe(false);
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:700});
		expect(d._pendingVentCrust).toBe(0);
		d.menuMode=false;d.transportPaused=true;
		expect(d.setGeyserMotion({beforeCooldownMs:0,afterCooldownMs:900,
			launchAvailable:true,vy:-1300})).toBe(false);
		d.transportPaused=false;d.started=false;
		expect(d.setGeyserMotion({beforeCooldownMs:0,afterCooldownMs:900,
			launchAvailable:true,vy:-1300})).toBe(false);
		expect(d.mixer.setEffectParam.mock.calls.some(call=>call[2]==='eruption')).toBe(false);
	});

	test('Jellyfish authentic elastic bounce, flight bloom and source song clock preservation',()=>{
		const d=director();d.biome='sky-jellyfish-mountain';d._pendingJellyImpact=0;
		const preset=orchestraPreset('sky-jellyfish-mountain','drums');
		expect(preset).toEqual([{type:'jellybloom',id:'jellybloom',
			airborne:false,buoyancy:1.35,floatRate:1,spring:1.3,liftLevel:.95}]);
		d._applyMusicTimbres();
		for(const stem of ROLES)expect(d.mixer.replaceEffects).toHaveBeenCalledWith(
			stem,orchestraPreset('sky-jellyfish-mountain',stem),.18);
		d.mixer.setEffectParam.mockClear();
		d.setAirborne(true);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('other','jellybloom','lift',.80);
		for(const stem of ROLES)expect(d.mixer.setEffectParam).toHaveBeenCalledWith(stem,'jellybloom','airborne',true);
		const liftCount=d.mixer.setEffectParam.mock.calls.filter(call=>call[2]==='lift').length;
		d.setAirborne(true);
		expect(d.mixer.setEffectParam.mock.calls.filter(call=>call[2]==='lift')).toHaveLength(liftCount);
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:840});
		expect(d._pendingJellyImpact).toBeGreaterThan(.4);
		expect(d.mixer.setEffectParam.mock.calls.some(call=>call[2]==='impact')).toBe(false);
		d.setAirborne(false);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','jellybloom','impact',expect.any(Number));
		expect(d._pendingJellyImpact).toBe(0);
		expect(d.clockStart).toBe(23.5);
		d.setBiome('debutmont');
		d.mixer.setEffectParam.mockClear();
		d.setAirborne(true);
		expect(d.mixer.setEffectParam.mock.calls.some(call=>call[1]==='jellybloom')).toBe(false);
	});
	test('Jellyfish crash, invalid and menu landings are fail-closed; airborne entry begins blooming',()=>{
		const d=director();d.biome='sky-jellyfish-mountain';d._pendingJellyImpact=0;
		d.airborne=true;d._applyMusicTimbres();
		for(const stem of ROLES){
			const effect=d.mixer.replaceEffects.mock.calls.find(call=>call[0]===stem)?.[1]?.[0];
			expect(effect).toMatchObject({type:'jellybloom',airborne:true});
		}
		d.onLanding({quality:'crash',hard:true,impactSpeedPxS:1000});
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:NaN});
		expect(d._pendingJellyImpact).toBe(0);
		d.menuMode=true;d.mixer.setEffectParam.mockClear();
		d.setAirborne(false);d.setAirborne(true);
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:950});
		expect(d._pendingJellyImpact).toBe(0);
		expect(d.mixer.setEffectParam.mock.calls.some(call=>call[1]==='jellybloom')).toBe(false);
	});

	test('Steampunk chug follows actual speed; one real takeoff vents, one landing clangs, no song rescore',()=>{
		const d=director();d.biome='steampunk-slopes';d._pendingSteamImpact=0;d._steamLastSent=NaN;
		const preset=orchestraPreset('steampunk-slopes','drums');
		expect(preset).toEqual([{type:'steamworks',id:'steamworks',weight:1,
			speed:0,airborne:false,intensity:1.25,steam:1.5,impactWeight:1.35,accentWeight:1.0}]);
		d._applyMusicTimbres();
		for(const stem of ROLES)expect(d.mixer.replaceEffects).toHaveBeenCalledWith(
			stem,orchestraPreset('steampunk-slopes',stem),.18);
		d.mixer.setEffectParam.mockClear();
		d.setSpeed(800);
		for(const stem of ROLES)expect(d.mixer.setEffectParam)
			.toHaveBeenCalledWith(stem,'steamworks','speed',.5);
		d.mixer.setEffectParam.mockClear();d.setSpeed(817);
		expect(d.mixer.setEffectParam.mock.calls.some(c=>c[1]==='steamworks')).toBe(false);
		d.setAirborne(true);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','steamworks','release',expect.any(Number));
		const released=d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='release').length;
		d.setAirborne(true);
		expect(d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='release')).toHaveLength(released);
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:700});
		expect(d._pendingSteamImpact).toBeGreaterThan(0);
		const before=d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='impact').length;
		d.setAirborne(false);
		expect(d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='impact')).toHaveLength(before+1);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','steamworks','impact',expect.any(Number));
		expect(d.clockStart).toBe(23.5);
		d.setBiome('debutmont');
		expect(d._pendingSteamImpact).toBe(0);
		d.mixer.setEffectParam.mockClear();d.setSpeed(1200);
		expect(d.mixer.setEffectParam.mock.calls.some(c=>c[1]==='steamworks')).toBe(false);
	});
	test('Steampunk ignores crash landings and menu events, airborne entry begins disengaged',()=>{
		const d=director();d.biome='steampunk-slopes';d._pendingSteamImpact=0;
		d._steamLastSent=NaN;d.airborne=true;
		d._applyMusicTimbres();
		for(const stem of ROLES){
			const fx=d.mixer.replaceEffects.mock.calls.find(c=>c[0]===stem)?.[1][0];
			expect(fx.airborne).toBe(true);
		}
		d.onLanding({quality:'crash',hard:true,impactSpeedPxS:1400});
		expect(d._pendingSteamImpact).toBe(0);
		d.menuMode=true;d.mixer.setEffectParam.mockClear();
		d.setAirborne(false);d.setAirborne(true);
		d.onLanding({quality:'good',hard:true,impactSpeedPxS:900});
		expect(d.mixer.setEffectParam.mock.calls.some(c=>c[1]==='steamworks')).toBe(false);
			expect(d._pendingSteamImpact).toBe(0);
	});
	test('Steampunk music gear click requires genuine revision-matched recorded source accent',()=>{
		const d=director();d.biome='steampunk-slopes';d._lastSteamMusicAccentMs=-Infinity;
		d.started=true;d._token=14;d.track={id:'one-more-run'};
		d.clockStart=10;
		const genuine={timeMs:20000,revision:'14:one-more-run:10',bass:.75,mid:.35};
		expect(d.onSteampunkMusicAccent(genuine)).toBe(true);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','steamworks','musicAccent',
			expect.any(Number));
		d.mixer.setEffectParam.mockClear();
		expect(d.onSteampunkMusicAccent(genuine)).toBe(false);
		expect(d.onSteampunkMusicAccent({...genuine,timeMs:20100})).toBe(false);
		expect(d.onSteampunkMusicAccent({...genuine,timeMs:20400,revision:'fake-song'})).toBe(false);
		expect(d.onSteampunkMusicAccent({...genuine,timeMs:20400,bass:NaN})).toBe(false);
		expect(d.mixer.setEffectParam).not.toHaveBeenCalled();
		for (const condition of [{airborne:true},{airborne:false,menuMode:true},
			{menuMode:false,biome:'garbage-dump-glacier'},{biome:'steampunk-slopes',transportPaused:true}]){
			Object.assign(d,condition);
			expect(d.onSteampunkMusicAccent({...genuine,timeMs:20500})).toBe(false);
		}
		d.transportPaused=false;d.biome='steampunk-slopes';d.menuMode=false;d.airborne=false;
		expect(d.onSteampunkMusicAccent({...genuine,timeMs:20600})).toBe(true);
	});
	test('Garbage drum preset adds source-excited inharmonic Scrapheap, no MIDI re-performance',()=>{
		const d=director();d._applyMusicTimbres();
		const drum=d.mixer.replaceEffects.mock.calls.find(args=>args[0]==='drums');
		expect(drum[1]).toEqual(orchestraPreset('garbage-dump-glacier','drums'));
		expect(drum[1].some(fx=>fx.id==='scrapheap'&&fx.type==='scrapheap')).toBe(true);
		expect(orchestraPreset('debumont','drums').some(fx=>fx.type==='scrapheap')).toBe(false);
	});
	test('Repeated same Garbage biome preserves pending seeded clang opportunity',()=>{
		const d=director();d.scrapPitch=new ScrapPitchCadence();
		d.scrapPitch.next(25,.7,()=>[]);
		const next=d.scrapPitch.nextAt,seed=d.scrapPitch.seed;
		d.setBiome('garbage-dump-glacier');
		expect(d.scrapPitch.nextAt).toBe(next);
		expect(d.scrapPitch.seed).toBe(seed);
		d.setBiome('debumont');
		expect(Number.isNaN(d.scrapPitch.nextAt)).toBe(true);
		d.setBiome('garbage-dump-glacier');
		expect(d.scrapPitch.seed).toBe(d.scrapPitch.initialSeed);
	});
	test('Garbage pitch scan only on irregular grounded events, never in air/menu or on no evidence',()=>{
		const d=director();d.scrapPitch=new ScrapPitchCadence();d.started=true;
		d.speedPxS=850;
		d.mixer.readEffect=jest.fn(()=>[{midi:69,hz:440,confidence:.35}]);
		expect(d._maybeScrapPitchClang(1)).toBe(false);
		const due=d.scrapPitch.nextAt;
		expect(d._maybeScrapPitchClang(due-.01)).toBe(false);
		expect(d.mixer.readEffect).not.toHaveBeenCalled();
		expect(d._maybeScrapPitchClang(due)).toBe(true);
		expect(d.mixer.readEffect).toHaveBeenCalledWith('bass','scrapPitchProbe','notes');
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','scrapheap','pitchedClang',
			{midi:69,hz:440,confidence:.35,strength:expect.any(Number)});
		d.mixer.setEffectParam.mockClear();d.airborne=true;
		expect(d._maybeScrapPitchClang(100)).toBe(false);
		expect(d.mixer.setEffectParam).not.toHaveBeenCalled();
		d.airborne=false;d.menuMode=true;
		expect(d._maybeScrapPitchClang(102)).toBe(false);
		d.menuMode=false;d.biome='debumont';
		expect(d._maybeScrapPitchClang(104)).toBe(false);
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
	test('post-grounded impacts stay biome-scoped: Scrapheap and Pyramid each play their physical sound; crash/menu stay silent',()=>{
		const d=director();d.mixer.setEffectParam.mockClear();
		d.onLanding({quality:'perfect',impactSpeedPxS:300,hard:false});
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','scrapheap','impact',expect.any(Number));
		d.mixer.setEffectParam.mockClear();
		d.onLanding({quality:'crash',impactSpeedPxS:900,hard:true});
		expect(d.mixer.setEffectParam).not.toHaveBeenCalled();
		d.biome='pyramid-peak';
		d.onLanding({quality:'good',impactSpeedPxS:900,hard:true});
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','sunstone',
			'stone',expect.any(Number));
		d.mixer.setEffectParam.mockClear();
		d.biome='garbage-dump-glacier';d.menuMode=true;
		d.onLanding({quality:'good',impactSpeedPxS:900,hard:true});
		expect(d.mixer.setEffectParam).not.toHaveBeenCalled();
	});
});
