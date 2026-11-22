import { jest } from '@jest/globals';
import { defaultSettings,sanitizeSettings } from '../../src/systems/SaveStore.js';
import { BIOME_IDS,HOME_BIOME } from '../../src/systems/music/BiomeVoices.js';
import { melodyPreset,orchestraPreset } from '../../src/systems/music/DynamicOrchestraPresets.js';
import { StemMusicDirector } from '../../src/systems/music/StemMusicDirector.js';
import { AdaptiveBiomeRouter } from '../../src/systems/music/AdaptiveBiomeRouter.js';

const home='voice:bitstream-bluffs';
function fakeDirector() {
	const d=Object.create(StemMusicDirector.prototype);
	d.biome='debumont';
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
		expect(map.get(home)).toEqual(melodyPreset('debumont'));
		for(const stem of ['bass','drums','guitar','piano','other']){
			expect(map.get(stem)).toEqual(orchestraPreset('debumont',stem));
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
			featured:{debumont:['first.ogg']},bass:{},drums:{debumont:['drums.ogg']}}}};
		r.biome='debumont';
		r.airborne=true;
		r.enabled=false;
		expect(r._variant('featured')).toBeNull();
		expect(r._variant('drums')).toBeNull();
		r.enabled=true;
		expect(r._variant('featured')).toBe('debumont');
		expect(r._variant('drums')).toBe('debumont');
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
		expect(()=>orchestraPreset('debumont','vocals')).toThrow();
		expect(orchestraPreset('debumont','bass').length).toBeGreaterThan(0);
		expect(orchestraPreset('no-such-biome','guitar')).toEqual([]);
	});
});
