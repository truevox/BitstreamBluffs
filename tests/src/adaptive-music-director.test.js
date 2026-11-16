import { jest } from '@jest/globals';
import { CORE_STEMS } from '../../src/systems/music/MusicPack.js';
import { StemMusicDirector } from '../../src/systems/music/StemMusicDirector.js';

function bareDirector(featuredStem = 'guitar') {
	const director = Object.create(StemMusicDirector.prototype);
	const gainCalls=[];
	const effectCalls=[];
	director.mixer = {
		setGain: (...args) => {gainCalls.push(args);return true;},
		setEffectParam: (...args) => {effectCalls.push(args);return true;},
		selectBiome: jest.fn(),
	};
	director.pack = { adaptive: { featuredStem }, sourceNames: [
		...CORE_STEMS, 'voice:debumont' ], layers: {} };
	director.biome = 'debumont';
	director.airborne = false;
	director.started = false;
	director.adaptive = {
		setAirborne: jest.fn(), setBiome: jest.fn(), setSpeed: jest.fn() };
	director._refreshVoices = jest.fn();
	return {director,gainCalls,effectCalls};
}

describe('StemMusicDirector optional adaptive integration', () => {
	test('both unselected source stems remain wanted, along with all six originals', () => {
		const {director} = bareDirector('guitar');
		const wanted = director._wantedNames(director.pack);
		expect(wanted).toEqual(expect.arrayContaining(CORE_STEMS));
		expect(wanted).toContain('piano');
		expect(wanted).toContain('other');
		expect(wanted).toContain('voice:debumont');
		expect(wanted.filter(name => name.startsWith('adaptive:'))).toHaveLength(0);
	});
	test('original and adaptive stem faders stay synchronized for selected sources', () => {
		const {director,gainCalls} = bareDirector('guitar');
		director.setStemGain('guitar',.37);
		expect(gainCalls.map(call => call.slice(0,2))).toEqual([
			['guitar',.37],['adaptive:featured',.37],
		]);
		gainCalls.length=0;
		director.setStemGain('piano',.65);
		expect(gainCalls.map(call => call[0])).toEqual(['piano']);
		gainCalls.length=0;
		director.setStemGain('bass',.45);
		expect(gainCalls.map(call => call[0])).toEqual(['bass','adaptive:bass']);
	});
	test('cross-song featured identity restores independent user gain levels', () => {
		const {director,gainCalls}=bareDirector('other');
		director._stemUserLevels=new Map([
			['bass',.8],['drums',.55],['guitar',.27],['piano',.92],['other',.63],
		]);
		director._syncAdaptiveUserLevels();
		expect(gainCalls.slice(-3).map(call=>call.slice(0,2)))
			.toEqual([['adaptive:bass',.8],['adaptive:drums',.55],
				['adaptive:featured',.63]]);
		director.pack.adaptive.featuredStem='piano';
		director._syncAdaptiveUserLevels();
		expect(gainCalls.at(-1).slice(0,2)).toEqual(['adaptive:featured',.92]);
	});
	test('changing biome forwards to the adaptive router without touching source levels', () => {
		const {director,gainCalls} = bareDirector();
		director.setBiome('crystal-cavern');
		expect(director.adaptive.setBiome).toHaveBeenCalledWith('crystal-cavern');
		expect(gainCalls).toHaveLength(0);
	});
	test('airborne drums use full source when adaptive, legacy packs keep old duck', () => {
		const {director,gainCalls} = bareDirector();
		director.setAirborne(true);
		expect(gainCalls.at(-1)[0]).toBe('drums');
		expect(gainCalls.at(-1)[1]).toBe(1);
		expect(director.adaptive.setAirborne).toHaveBeenCalledWith(true);
		const legacy = bareDirector();
		legacy.director.pack.adaptive = null;
		legacy.director.setAirborne(true);
		expect(legacy.gainCalls.at(-1)[1]).toBe(.58);
	});
	test('speed and combo remain independent; featured Other receives combo automation', () => {
		const {director,gainCalls,effectCalls} = bareDirector('other');
		director.setSpeed(600);
		expect(director.adaptive.setSpeed).toHaveBeenCalledWith(600);
		expect(effectCalls.at(-1)[0]).toBe('other');
		director.setCombo(3);
		expect(gainCalls.slice(-2).map(call => call[0]))
			.toEqual(['other','adaptive:featured']);
	});
	test('adaptive segment fetch deduplicates and caches by source path', async () => {
		const {director} = bareDirector();
		director.packBase = 'https://example.org/preview/packs/test/pack.json';
		director._token = 9;
		director.clockStart = 0;
		director.disposed = false;
		director.cache = new Map();
		director.inflight = new Map();
		director.ctx = {decodeAudioData: async () => ({duration:1})};
		const originalFetch=global.fetch;
		global.fetch = jest.fn(async () => ({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)}));
		try {
			const [one,two] = await Promise.all([
				director._fetchAdaptiveSegment(0,'bass/a.ogg'),
				director._fetchAdaptiveSegment(0,'bass/a.ogg'),
			]);
			expect(one).toBe(two);
			expect(global.fetch).toHaveBeenCalledTimes(1);
			expect(global.fetch).toHaveBeenCalledWith(
				'https://example.org/preview/packs/test/bass/a.ogg');
			expect(await director._fetchAdaptiveSegment(0,'bass/a.ogg')).toBe(one);
			await expect(director._fetchAdaptiveSegment(0,'../private.mp3'))
				.rejects.toThrow(/Unsafe music asset path/);
		} finally {
			global.fetch=originalFetch;
		}
	});
});
