import { jest } from '@jest/globals';
import { defaultSettings,sanitizeSettings } from '../../src/systems/SaveStore.js';
import { BIOME_IDS,HOME_BIOME } from '../../src/systems/music/BiomeVoices.js';
import { melodyPreset,orchestraPreset } from '../../src/systems/music/DynamicOrchestraPresets.js';
import { StemMusicDirector } from '../../src/systems/music/StemMusicDirector.js';
import { AdaptiveBiomeRouter } from '../../src/systems/music/AdaptiveBiomeRouter.js';
import { snowpackImpactFromLanding } from '../../src/systems/music/SnowpackImpact.js';

const home='voice:bitstream-bluffs';
function fakeDirector() {
	const d=Object.create(StemMusicDirector.prototype);
	d.biome='debutmont';
	d.gains=new Map(['bass','drums','guitar','piano','other',home].map(s=>[s,{}]));
	d.pack={sourceNames:['vocals','drums','bass','guitar','piano','other',home]};
	d.dynamicOrchestra=false;
	d._timbreSignatures=new Map();
	d._stemUserLevels=new Map();
	d.mixer={replaceEffects:jest.fn(()=>true),setRoomSend:jest.fn(()=>true),
		setGain:jest.fn(()=>true),setEffectParam:jest.fn(),selectBiome:jest.fn()};
	d.adaptive={setEnabled:jest.fn(),setSpeed:jest.fn(),setAirborne:jest.fn(),
		setBiome:jest.fn()};
	d.started=false;
	d.speedPxS=0;
	d.airborne=false;
	return d;
}
describe('Dynamic Orchestra gates only replacement recordings, not original-stem DSP',()=>{
	test('defaults OFF and survives strict settings sanitation',()=>{
		expect(defaultSettings().dynamicOrchestra).toBe(false);
		expect(sanitizeSettings({dynamicOrchestra:true}).dynamicOrchestra).toBe(true);
		expect(sanitizeSettings({dynamicOrchestra:false}).dynamicOrchestra).toBe(false);
		expect(sanitizeSettings({dynamicOrchestra:'true'}).dynamicOrchestra).toBe(false);
	});
	test('lead sound differs for each of eleven biomes plus home',()=>{
		const signatures=new Set(BIOME_IDS.map(b=>JSON.stringify(melodyPreset(b))));
		expect(signatures.size).toBe(BIOME_IDS.length);
		expect(melodyPreset(HOME_BIOME).length).toBeGreaterThan(0);
	});
	test('OFF keeps original instrument samples but runs all biome source FX and room sends',()=>{
		const d=fakeDirector();
		d._applyMusicTimbres();
		const map=new Map(d.mixer.replaceEffects.mock.calls.map(x=>[x[0],x[1]]));
		expect(map.get(home)).toEqual(melodyPreset('debutmont'));
		for(const stem of ['bass','drums','guitar','piano','other']){
			expect(map.get(stem)).toEqual(orchestraPreset('debutmont',stem));
			expect(map.get(stem).length).toBeGreaterThan(0);
			// NULL resets each input's standard biome space send. OFF must
			// never force zero or bypass its source effects.
			expect(d.mixer.setRoomSend).toHaveBeenCalledWith(stem,null);
		}
		expect(d.adaptive.setEnabled).not.toHaveBeenCalled();
	});
	test('ON/OFF changes ONLY adaptive replacement routing, leaves processing + clock untouched',()=>{
		const d=fakeDirector();
		d.started=true;
		d.clockStart=12.78;
		d.trackIndex=2;
		d._applyMusicTimbres(); // normally applied on song start/biome change
		const before=new Map(d.mixer.replaceEffects.mock.calls.map(x=>[x[0],x[1]]));
		d.mixer.replaceEffects.mockClear();
		d.mixer.setRoomSend.mockClear();
		d.setDynamicOrchestra(true);
		expect(d.adaptive.setEnabled).toHaveBeenLastCalledWith(true);
		expect(d.started).toBe(true);
		expect(d.clockStart).toBe(12.78);
		expect(d.trackIndex).toBe(2);
		// No FX rebuild, no source dryness/mute just because DO toggles.
		expect(d.mixer.replaceEffects).not.toHaveBeenCalled();
		expect(d.mixer.setRoomSend).not.toHaveBeenCalled();
		d.setDynamicOrchestra(false);
		expect(d.adaptive.setEnabled).toHaveBeenLastCalledWith(false);
		expect(d.mixer.replaceEffects).not.toHaveBeenCalled();
		expect(d.mixer.setRoomSend).not.toHaveBeenCalled();
		for(const stem of ['bass','drums','guitar','piano','other',home])
			expect(before.get(stem).length).toBeGreaterThan(0);
		// Returning to OFF does not stop an original-source effects chain.
		d.biome='crystal-cavern';
		d._applyMusicTimbres();
		for(const stem of ['bass','drums','guitar','piano','other']){
			expect(d.mixer.replaceEffects).toHaveBeenCalledWith(
				stem,orchestraPreset('crystal-cavern',stem),.18);
		}
	});
	test('original bass speed motion works with adaptive OFF and no replacement files',()=>{
		const d=fakeDirector();
		d.adaptive=null;
		d.pack.adaptive=null;
		d.setSpeed(0);
		expect(d.mixer.setGain).toHaveBeenCalledWith('bass',.2,{motion:true,time:.16});
		d.setSpeed(1500);
		expect(d.mixer.setGain).toHaveBeenCalledWith('bass',1.18,{motion:true,time:.16});
	});
	test('original drums duck while airborne in either orchestra mode',()=>{
		const d=fakeDirector();
		d.setAirborne(true);
		expect(d.mixer.setGain).toHaveBeenCalledWith('drums',.22,{motion:true,time:.15});
		d.setAirborne(false);
		expect(d.mixer.setGain).toHaveBeenCalledWith('drums',1,{motion:true,time:.15});
	});
	test('future physical note-replacements remain gated OFF, ON enables them',()=>{
		const r=Object.create(AdaptiveBiomeRouter.prototype);
		r.pack={adaptive:{featuredStem:'other',variants:{
			featured:{debutmont:['first.ogg']},bass:{},drums:{debutmont:['drums.ogg']}}}};
		r.biome='debutmont';
		r.airborne=true;
		r.enabled=false;
		expect(r._variant('featured')).toBeNull();
		expect(r._variant('drums')).toBeNull();
		r.enabled=true;
		expect(r._variant('featured')).toBe('debutmont');
		expect(r._variant('drums')).toBe('debutmont');
	});
	test('Debumont powder lifts on jump and settles on landing without rebuilding FX',()=> {
		const d=fakeDirector();
		d.clockStart=12.78;
		d._applyMusicTimbres();
		d.mixer.replaceEffects.mockClear();
		d.mixer.setEffectParam.mockClear();
		d.setAirborne(true);
		const stems=['bass','drums','guitar','piano','other'];
		for (const stem of stems)
			expect(d.mixer.setEffectParam).toHaveBeenCalledWith(stem,'snowpack','depth',0);
		expect(d.mixer.replaceEffects).not.toHaveBeenCalled();
		expect(d.clockStart).toBe(12.78);
		d.mixer.setEffectParam.mockClear();
		d.setAirborne(false);
		for (const stem of stems)
			expect(d.mixer.setEffectParam).toHaveBeenCalledWith(stem,'snowpack','depth',
				orchestraPreset('debumont',stem)[0].depth);
		expect(d.mixer.replaceEffects).not.toHaveBeenCalled();
		expect(d.clockStart).toBe(12.78);
	});
	test('canonical Debutmont aliases preserve Snowpack resonance and impact',()=> {
		const d=fakeDirector();
		d.biome='debutmont';
		for (const stem of ['bass','drums','guitar','piano','other']) {
			expect(orchestraPreset('debutmont',stem)[0].type).toBe('snowpack');
			expect(orchestraPreset('debumont',stem)).toEqual(orchestraPreset('debutmont',stem));
		}
		d.setBiome('debumont');
		expect(d.biome).toBe('debutmont');
	});
	test('physical snow pulses are finite, bounded and do not fabricate impacts',()=> {
		expect(snowpackImpactFromLanding(null)).toBe(0);
		expect(snowpackImpactFromLanding({impactSpeedPxS:NaN})).toBe(0);
		expect(snowpackImpactFromLanding({impactSpeedPxS:0,hard:true})).toBe(0);
		expect(snowpackImpactFromLanding({impactSpeedPxS:700,quality:'crash'})).toBe(0);
		const gentle=snowpackImpactFromLanding({impactSpeedPxS:300,quality:'good'});
		const hard=snowpackImpactFromLanding({impactSpeedPxS:700,hard:true,quality:'good'});
		expect(gentle).toBeGreaterThan(0);
		expect(hard).toBeGreaterThan(gentle);
		expect(snowpackImpactFromLanding({impactSpeedPxS:5000,hard:true})).toBe(1);
	});
	test('landing event before grounded update queues pulse then lands once',()=> {
		const d=fakeDirector();
		d.setAirborne(true);
		d.mixer.setEffectParam.mockClear();
		d.onLanding({impactSpeedPxS:700,hard:true,quality:'good'});
		expect(d.mixer.setEffectParam).not.toHaveBeenCalled();
		d.setAirborne(false);
		for (const stem of ['bass','drums','guitar','piano','other'])
			expect(d.mixer.setEffectParam).toHaveBeenCalledWith(stem,'snowpack','impact',
				expect.any(Number));
		expect(d._pendingSnowImpact).toBe(0);
		const count=d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='impact').length;
		d.setAirborne(false);
		expect(d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='impact')).toHaveLength(count);
	});
	test('landing event after grounded update applies pulse immediately; excludes wrong biomes/menu',()=> {
		const d=fakeDirector();
		d.setAirborne(true); d.setAirborne(false);
		d.mixer.setEffectParam.mockClear();
		d.onLanding({impactSpeedPxS:340,quality:'perfect',hard:false});
		expect(d.mixer.setEffectParam.mock.calls.filter(c=>c[2]==='impact')).toHaveLength(5);
		d.mixer.setEffectParam.mockClear();
		d.onLanding({impactSpeedPxS:900,quality:'crash',hard:true});
		expect(d.mixer.setEffectParam).not.toHaveBeenCalled();
		d.biome='space-mountain';
		d.onLanding({impactSpeedPxS:900,quality:'good',hard:true});
		expect(d.mixer.setEffectParam).not.toHaveBeenCalled();
		d.biome='debutmont';d.menuMode=true;
		d.onLanding({impactSpeedPxS:900,quality:'good',hard:true});
		expect(d.mixer.setEffectParam).not.toHaveBeenCalled();
	});
	test('entering Debumont midair starts dry; other biomes are unchanged',()=> {
		const d=fakeDirector();
		d.airborne=true;
		d._applyMusicTimbres();
		const chainMap=new Map(d.mixer.replaceEffects.mock.calls.map(c=>[c[0],c[1]]));
		for (const stem of ['bass','drums','guitar','piano','other'])
			expect(chainMap.get(stem)).toEqual([{type:'snowpack',id:'snowpack',depth:0}]);
		d.mixer.replaceEffects.mockClear();
		d._applyMusicTimbres();
		expect(d.mixer.replaceEffects).not.toHaveBeenCalled();
		d.biome='vertigo-vents';
		d.mixer.setEffectParam.mockClear();
		d.setAirborne(false);
		expect(d.mixer.setEffectParam).not.toHaveBeenCalled();
		d._applyMusicTimbres();
		expect(d.mixer.replaceEffects).toHaveBeenCalled();
	});

	test('source stem presets cannot address vocals or unknown busses',()=>{
		expect(()=>orchestraPreset('debutmont','vocals')).toThrow();
		expect(orchestraPreset('debutmont','bass').length).toBeGreaterThan(0);
		expect(orchestraPreset('no-such-biome','guitar')).toEqual([]);
	});
});
