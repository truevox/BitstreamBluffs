import { LEGACY_BIOME_ALIASES } from '../../src/data/biomeAliases.js';
const LEGACY_HOME_BIOME = Object.keys(LEGACY_BIOME_ALIASES)[0];
/**
 * Non-listening merge gate for five physics-driven original-stem biomes.
 * Both the canonical biome name and old-save alias must preserve Snowpack.
 * No test here declares any proposed sound setting owner-approved.
 */
import {jest} from '@jest/globals';
import {StemMusicDirector} from '../../src/systems/music/StemMusicDirector.js';
import {orchestraPreset} from '../../src/systems/music/DynamicOrchestraPresets.js';
import {HydrostaticPressure} from '../../src/systems/music/HydrostaticPressure.js';
import {ScrapPitchCadence} from '../../src/systems/music/ScrapPitchCadence.js';

const stems=['bass','drums','guitar','piano','other'];
function musicFixture(){
	const d=Object.create(StemMusicDirector.prototype);
	d.biome='bitstream-bluffs';d.menuMode=false;d.airborne=false;
	d.clockStart=25.5;d.started=false;d.speedPxS=700;
	d._timbreSignatures=new Map();
	d._scrapContactLast=NaN;
	d._pendingSnowImpact=0;d._pendingScrapImpact=0;d._pendingCrystalImpact=0;
	d._pendingMicroImpact=0;d._pendingHydroImpact=0;
	d.hydrostatic=new HydrostaticPressure();d._hydroLastSent=NaN;
	d.scrapPitch=new ScrapPitchCadence();d.microBees=null;
	d.gains=new Map(stems.map(stem=>[stem,{}]));
	d.mixer={replaceEffects:jest.fn(()=>true),setEffectParam:jest.fn(()=>true),
		setRoomSend:jest.fn(()=>true),setGain:jest.fn(()=>true),selectBiome:jest.fn(()=>true)};
	d.adaptive={setBiome:jest.fn(),setAirborne:jest.fn(),setSpeed:jest.fn()};
	return d;
}
const land={quality:'good',hard:true,impactSpeedPxS:720};

describe('Complete merged five-biome original-stem physics gate',()=>{
	test('old-save archived home-biome alias resolves to canonical Debutmont and *plays* Snowpack DSP',()=>{
		const d=musicFixture();d.setBiome(LEGACY_HOME_BIOME);
		expect(d.biome).toBe('debutmont');
		for(const stem of stems){
			const spec=orchestraPreset('debutmont',stem);
			expect(spec).toEqual(orchestraPreset(LEGACY_HOME_BIOME,stem));
			expect(spec[0].type).toBe('snowpack');
			expect(d.mixer.replaceEffects).toHaveBeenCalledWith(stem,spec,.18);
		}
		d.mixer.setEffectParam.mockClear();d.setAirborne(true);
		for(const stem of stems)
			expect(d.mixer.setEffectParam).toHaveBeenCalledWith(stem,'snowpack','depth',0);
		d.onLanding(land);d.setAirborne(false);
		for(const stem of stems)
			expect(d.mixer.setEffectParam).toHaveBeenCalledWith(stem,'snowpack','impact',expect.any(Number));
		expect(d.clockStart).toBe(25.5);
	});
	test('Garbage contact and real touchdown are independent of pitch-clang policy',()=>{
		const d=musicFixture();d.setBiome('garbage-dump-glacier');
		expect(orchestraPreset(d.biome,'bass').some(x=>x.id==='scrapPitchProbe')).toBe(true);
		expect(orchestraPreset(d.biome,'drums')[0].type).toBe('scrapheap');
		d.setAirborne(true);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','scrapheap','takeoff',expect.any(Number));
		d.onLanding(land);d.setAirborne(false);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','scrapheap','impact',expect.any(Number));
		// Applying the same biome repeatedly must preserve irregular clang timing.
		d.scrapPitch.next(20,.7,()=>[]);
		const scheduled=d.scrapPitch.nextAt;
		d.setBiome('garbage-dump-glacier');
		expect(d.scrapPitch.nextAt).toBe(scheduled);
	});
	test('Underwater depth remembers descent in biome, resets on genuine exit',()=>{
		const d=musicFixture();d.setBiome('underwater-mountain');
		for(const stem of stems)expect(orchestraPreset(d.biome,stem)[0].type).toBe('hydrostatic');
		d.setHydrostaticMotion({terrainY:200,riderY:200,grounded:true,vy:0});
		d.setHydrostaticMotion({terrainY:1100,riderY:1100,grounded:true,vy:0});
		const deep=d.hydrostatic.storedPressure01;
		expect(deep).toBeGreaterThan(.2);
		d.setBiome('underwater-mountain');
		expect(d.hydrostatic.storedPressure01).toBe(deep);
		d.setAirborne(true);d.onLanding(land);d.setAirborne(false);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','hydrostatic','impact',expect.any(Number));
		d.setBiome('micro-mountain');
		expect(d.hydrostatic.storedPressure01).toBe(0);
	});
	test('Micro keeps 135% box across all five originals; only real landing rattles',()=>{
		const d=musicFixture();d.setBiome('micro-mountain');
		for(const stem of stems)
			expect(orchestraPreset('micro-mountain',stem)[0]).toMatchObject({
			id:'microbox',boxiness:1.35,openness:0});
		d.setAirborne(true);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('bass','microbox','openness',1);
		d.onLanding(land);d.setAirborne(false);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','microbox','impact',expect.any(Number));
		expect(d.clockStart).toBe(25.5);
	});
	test('Crystal retains 150% owner-liked resonance, separate wet air-bloom and source-backed impact',()=>{
		const d=musicFixture();d.setBiome('crystal-cavern');
		for(const stem of ['bass','guitar','piano','other'])
			expect(orchestraPreset(d.biome,stem)[0]).toMatchObject({
			id:'crystallattice',strength:1.5,airBloom:1.6});
		d.setAirborne(true);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('bass','crystallattice','openness',1);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','crystalPercussion','gain',.48);
		d.onLanding(land);d.setAirborne(false);
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('bass','crystallattice','impact',expect.any(Number));
		expect(d.mixer.setEffectParam).toHaveBeenCalledWith('drums','crystalPercussion','gain',1);
	});
	test('airborne entry into Micro/Crystal immediately opens the INITIAL source graph',()=>{
		for(const [biome,id] of [['micro-mountain','microbox'],['crystal-cavern','crystallattice']]){
			const d=musicFixture();d.airborne=true;d.setBiome(biome);
			const bass=d.mixer.replaceEffects.mock.calls.find(call=>call[0]==='bass');
			expect(bass[1].find(x=>x.id===id).openness).toBe(1);
			if(biome==='crystal-cavern'){
				const drum=d.mixer.replaceEffects.mock.calls.find(call=>call[0]==='drums');
				expect(drum[1][0]).toMatchObject({id:'crystalPercussion',gain:.48});
			}
		}
	});
});
