import { jest } from '@jest/globals';
import { normalizePack, CORE_STEMS } from '../../src/systems/music/MusicPack.js';
import { AdaptiveBiomeRouter } from '../../src/systems/music/AdaptiveBiomeRouter.js';

class Param {
	constructor(value = 1) { this.value = value; }
	cancelScheduledValues() { return this; }
	setValueAtTime(value) { this.value = value; return this; }
	linearRampToValueAtTime(value) { this.value = value; return this; }
}
class Node {
	constructor() {
		this.gain = new Param();
		this.connections = [];
	}
	connect(node) { this.connections.push(node); return node; }
	disconnect() { this.connections = []; }
	start(time, offset, duration) {
		this.started = { time, offset, duration };
	}
	stop(time) { this.stopped = time ?? 0; }
}

function mocks() {
	const ctx = { currentTime: 0, state: 'running', sampleRate: 48000,
		createGain: () => new Node(), createBufferSource: () => new Node() };
	const calls = [];
	const levels = Object.fromEntries(CORE_STEMS.map(name => [name, 1]));
	const sources = new Map(CORE_STEMS.map(name => [name, { input: new Node() }]));
	const mixer = {
		sources, levels, calls,
		addSource(name) {
			if (!sources.has(name)) sources.set(name, { input: new Node() });
			return sources.get(name).input;
		},
		setMixGain(name, value) {
			calls.push({ name, value, kind: 'mix' });
			levels[name] = value;
			return true;
		},
		setGain(name, value) {
			calls.push({ name, value, kind: 'motion' });
			return true;
		},
	};
	return { ctx, mixer };
}

function pack(extra = {}) {
	const segmentNames = Object.fromEntries(CORE_STEMS.map(name => [name, name + '.ogg']));
	const result = {
		format: 'bitstream-music-pack-v1', id: 'test-song',
		frameCount: 96000, sampleRate: 48000,
		segments: [
			{ startFrame: 0, frames: 48000, sources: { ...segmentNames } },
			{ startFrame: 48000, frames: 48000, sources: { ...segmentNames } },
		],
		adaptive: {
			featuredStem: 'guitar',
			variants: {
				bass: { debutmont: ['bass1.ogg', 'bass2.ogg'],
					'candy-cane-canyon': ['candybass1.ogg', 'candybass2.ogg'] },
				drums: { debutmont: ['drum1.ogg', 'drum2.ogg'] },
				featured: { debutmont: ['guitar1.ogg', 'guitar2.ogg'],
					'candy-cane-canyon': ['candyfeat1.ogg', 'candyfeat2.ogg'] },
			},
		},
	};
	return { ...result, ...extra };
}

const tick = async (router) => {
	router.pump();
	for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('Independent 4x12 adaptive source manifest', () => {
	test('describes any number of biome assets without exceeding source-name budget', () => {
		const raw = pack();
		const normalized = normalizePack(raw);
		expect(normalized.sourceNames).toHaveLength(6);
		expect(normalized.adaptive.featuredStem).toBe('guitar');
		expect(normalized.adaptive.variants.bass.debutmont).toHaveLength(2);
		expect(Object.keys(normalized.segments[0].sources)).toEqual(expect.arrayContaining(CORE_STEMS));
	});
	test('all 33 biome candidates in three roles coexist with 12 lead keys', () => {
		const raw = pack();
		for (const seg of raw.segments) {
			for (const id of ['bitstream-bluffs', 'debutmont', 'garbage-dump-glacier',
				'pyramid-peak', 'underwater-mountain', 'crystal-cavern',
				'space-mountain', 'candy-cane-canyon', 'sky-jellyfish-mountain',
				'steampunk-slopes', 'micro-mountain', 'vertigo-vents']) {
				seg.sources['voice:' + id] = id + '.ogg';
			}
		}
		for (const role of ['bass', 'drums', 'featured']) {
			for (const id of ['garbage-dump-glacier', 'pyramid-peak', 'underwater-mountain',
				'crystal-cavern', 'space-mountain', 'sky-jellyfish-mountain',
				'steampunk-slopes', 'micro-mountain', 'vertigo-vents']) {
				raw.adaptive.variants[role][id] = [id + '-0.ogg', id + '-1.ogg'];
			}
		}
		// The base fallback fixture deliberately omits Candy percussion.
		// Fill it only here to validate a complete 33-variant full bank.
		raw.adaptive.variants.drums['candy-cane-canyon'] =
			['candydrum0.ogg', 'candydrum1.ogg'];
		const result = normalizePack(raw);
		expect(result.sourceNames).toHaveLength(18);
		expect(Object.values(result.adaptive.variants)
			.flatMap(biomes => Object.values(biomes)).length).toBe(33);
	});
	test('adaptive variants reserve six mixer slots from the 48-bus limit', () => {
		const raw=pack();
		for(let i=0;i<40;i++) {
			for(const seg of raw.segments) seg.sources['pad:'+i]='pad'+i+'.ogg';
		}
		expect(Object.keys(raw.segments[0].sources)).toHaveLength(46);
		expect(()=>normalizePack(raw)).toThrow(/Too many music sources/);
		for(const seg of raw.segments) delete seg.sources['pad:39'];
		for (let i=36;i<39;i++) {
			for(const seg of raw.segments) delete seg.sources['pad:'+i];
		}
		expect(normalizePack(raw).sourceNames).toHaveLength(42);
	});
	test('rejects path traversal, partial segments, unknown biomes and bad featured labels', () => {
		const x = pack(); x.adaptive.variants.bass.debutmont[0] = '../leak.wav';
		expect(() => normalizePack(x)).toThrow(/Invalid biome/);
		const y = pack(); y.adaptive.variants.drums.debutmont = ['short.ogg'];
		expect(() => normalizePack(y)).toThrow(/Invalid biome/);
		const z = pack(); z.adaptive.variants.featured.nowhere = ['0.ogg','1.ogg'];
		expect(() => normalizePack(z)).toThrow(/Invalid biome/);
		const bad = pack(); bad.adaptive.featuredStem = 'vocals';
		expect(() => normalizePack(bad)).toThrow(/Invalid adaptive/);
		const home = pack(); home.adaptive.variants.bass['bitstream-bluffs'] = ['a.ogg','b.ogg'];
		expect(() => normalizePack(home)).toThrow(/Invalid biome/);
	});
	test('adaptive packs reserve room for six reusable mixer buses', () => {
		const raw=pack();
		for(let i=0;i<40;i++){
			for(const segment of raw.segments) {
				segment.sources['texture:'+i] = 'texture-'+i+'.ogg';
			}
		}
		expect(() => normalizePack(raw)).toThrow(/Too many music sources/);
		// 6 core + 12 melody + six adaptive buses is comfortably below 48.
		for(let i=0;i<40;i++){
			for(const segment of raw.segments) delete segment.sources['texture:'+i];
		}
		expect(normalizePack(raw).sourceNames).toHaveLength(6);
	});

	test('old music packs without adaptive metadata remain valid', () => {
		const raw = pack(); delete raw.adaptive;
		expect(normalizePack(raw).adaptive).toBeNull();
	});
});

describe('Fail-safe, source-preserving adaptive mix routing', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); });

	test('full ON replaces all FIVE original instrumental stems; OFF restores sources', async () => {
		const raw=pack();
		// Featured source=Guitar, with Piano and Other independently re-synthesized.
		raw.adaptive.variants.piano={debutmont:['piano1.ogg','piano2.ogg']};
		raw.adaptive.variants.other={debutmont:['other1.ogg','other2.ogg']};
		const {ctx,mixer}=mocks();
		const router=new AdaptiveBiomeRouter(ctx,mixer,async ()=>({duration:1}));
		router.setEnabled(true);
		router.configure(normalizePack(raw),0,{biome:'debutmont',airborne:true});
		await tick(router);
		for(const source of ['guitar','piano','other','bass','drums']) {
			expect(mixer.levels[source]).toBe(0);
		}
		expect(mixer.levels.vocals).toBe(1);
		for(const role of ['featured','piano','other','bass','drums']) {
			expect(router.channels.get(role).current?.live).toBe(true);
		}
		// The originally featured guitar cannot also be routed via the named
		// guitar bus, even if an inconsistent manifest provides it.
		expect(router.channels.get('guitar').current).toBeNull();
		router.setEnabled(false);
		for(const source of ['guitar','piano','other','bass','drums']) {
			expect(mixer.levels[source]).toBe(1);
		}
		for(const role of ['featured','guitar','piano','other','bass','drums']) {
			expect(router.channels.get(role).current).toBeNull();
		}
		router.destroy();
	});

	test('six originals persist and the two unfeatured roles are never ducked', async () => {
		const { ctx, mixer } = mocks();
		const loader = jest.fn(async () => ({ duration: 1 }));
		const router = new AdaptiveBiomeRouter(ctx,mixer,loader);
		router.configure(normalizePack(pack()), 0, { biome: 'debutmont' });
		await tick(router);
		expect(mixer.sources.size).toBe(12);
		expect(loader).toHaveBeenCalledTimes(4);
		expect(mixer.levels.bass).toBe(0);
		expect(mixer.levels.guitar).toBe(0);
		expect(mixer.levels.drums).toBe(1);
		expect(mixer.levels.piano).toBe(1);
		expect(mixer.levels.other).toBe(1);
		expect(mixer.levels.vocals).toBe(1);
		expect(mixer.calls.filter(call => call.kind === 'mix')
			.map(call => call.name)).not.toEqual(expect.arrayContaining(['piano','other','vocals']));
		router.destroy();
	});

	test('drums are original on ground, biome kit airborne, original on landing', async () => {
		const { ctx, mixer } = mocks();
		const router = new AdaptiveBiomeRouter(ctx,mixer,async () => ({ duration: 1 }));
		router.configure(normalizePack(pack()), 0, { biome: 'debutmont' });
		await tick(router);
		expect(mixer.levels.drums).toBe(1);
		router.setAirborne(true);
		await tick(router);
		expect(mixer.levels.drums).toBe(0);
		router.setAirborne(false);
		expect(mixer.levels.drums).toBe(1);
		router.destroy();
	});

	test('switching biomes preserves six sources and returns to originals at home', async () => {
		const { ctx, mixer } = mocks();
		const router = new AdaptiveBiomeRouter(ctx,mixer,async () => ({ duration: 1 }));
		router.configure(normalizePack(pack()), 0, { biome: 'debutmont', airborne: true });
		await tick(router);
		router.setBiome('candy-cane-canyon');
		await tick(router);
		expect(mixer.levels.drums).toBe(1);
		expect(mixer.levels.bass).toBe(0);
		expect(mixer.levels.guitar).toBe(0);
		router.setBiome('bitstream-bluffs');
		for (const name of CORE_STEMS) expect(mixer.levels[name]).toBe(1);
		expect(mixer.sources.size).toBe(12);
		router.destroy();
	});

	test('missing asset or delayed fetch never mutes the original', async () => {
		const { ctx, mixer } = mocks();
		const loader = async () => { throw new Error('missing optional instrument'); };
		const router = new AdaptiveBiomeRouter(ctx,mixer,loader);
		router.configure(normalizePack(pack()),0,{biome:'debutmont',airborne:true});
		await tick(router);
		expect(mixer.levels.bass).toBe(1);
		expect(mixer.levels.guitar).toBe(1);
		expect(mixer.levels.drums).toBe(1);
		expect(router.lastError).toMatch(/missing optional instrument/);
		router.destroy();
	});

	test('expired or superseded async variant work cannot resurrect old sound', async () => {
		const { ctx, mixer } = mocks();
		const deferred = [];
		const router = new AdaptiveBiomeRouter(ctx,mixer,
			() => new Promise(resolve => deferred.push(resolve)));
		router.configure(normalizePack(pack()),0,{biome:'debutmont'});
		await tick(router);
		expect(deferred.length).toBe(4);
		router.setBiome('candy-cane-canyon');
		await tick(router);
		expect(deferred.length).toBe(8);
		for (const finish of deferred.slice(0,4)) finish({duration:1});
		for (let i = 0; i < 8; i++) await Promise.resolve();
		expect(mixer.levels.bass).toBe(1);
		expect(mixer.levels.guitar).toBe(1);
		for (const finish of deferred.slice(4)) finish({duration:1});
		for (let i = 0; i < 8; i++) await Promise.resolve();
		expect(mixer.levels.bass).toBe(0);
		expect(mixer.levels.guitar).toBe(0);
		router.destroy();
	});

	test('mid-chunk biome switches start at the original song-clock offset', async () => {
		const { ctx, mixer } = mocks();
		ctx.currentTime = 0.35;
		const router = new AdaptiveBiomeRouter(ctx,mixer,async () => ({duration:1}));
		router.configure(normalizePack(pack()),0,{biome:'debutmont'});
		await tick(router);
		const current = router.channels.get('featured').current;
		const nodes = [...current.nodes].map(node => node.started);
		expect(nodes).toEqual(expect.arrayContaining([
			expect.objectContaining({time: expect.closeTo(0.375,3),
				offset: expect.closeTo(0.375,3)}),
			expect.objectContaining({time:1,offset:0}),
		]));
		expect(mixer.levels.piano).toBe(1);
		expect(mixer.levels.other).toBe(1);
		router.destroy();
	});

	test('failed new-biome fetch restores original, retires old and backs off', async () => {
		const { ctx, mixer } = mocks();
		const loader = jest.fn(async (index,path) => {
			if (path.startsWith('candy')) throw new Error('missing new biome');
			return { duration:1 };
		});
		const router = new AdaptiveBiomeRouter(ctx,mixer,loader);
		router.configure(normalizePack(pack()),0,{biome:'debutmont'});
		await tick(router);
		expect(mixer.levels.guitar).toBe(0);
		router.setBiome('candy-cane-canyon');
		await tick(router);
		expect(mixer.levels.guitar).toBe(1);
		expect(router.channels.get('featured').current).toBeNull();
		const callsAfterFailure=loader.mock.calls.length;
		for (let i=0;i<30;i++) await tick(router);
		expect(loader.mock.calls.length).toBe(callsAfterFailure);
		router.destroy();
	});

	test('restoration fade is not cancelled by repeated audio pump ticks', async () => {
		const { ctx, mixer } = mocks();
		const router = new AdaptiveBiomeRouter(ctx,mixer,async () => ({duration:1}));
		router.configure(normalizePack(pack()),0,{biome:'debutmont',airborne:true});
		await tick(router);
		router.setBiome('bitstream-bluffs');
		const restores = mixer.calls.filter(call =>
			call.kind==='mix' && call.value===1).length;
		for (let k=0;k<20;k++) await tick(router);
		expect(mixer.calls.filter(call =>
			call.kind==='mix' && call.value===1).length).toBe(restores);
		router.destroy();
	});

	test('future-only replacement schedules on song clock but does not pre-duck', async () => {
		const { ctx, mixer } = mocks();
		const router = new AdaptiveBiomeRouter(ctx, mixer,
			async (index) => index === 0 ? null : {duration:1});
		router.configure(normalizePack(pack()),0,{biome:'debutmont'});
		await tick(router);
		expect(router.channels.get('featured').pending?.scheduled.has(1)).toBe(true);
		expect(mixer.levels.guitar).toBe(1);
		ctx.currentTime=.91;
		await tick(router);
		expect(mixer.levels.guitar).toBe(1);
		ctx.currentTime=.96;
		router.pump();
		expect(router.channels.get('featured').current?.biome).toBe('debutmont');
		expect(mixer.levels.guitar).toBe(0);
		router.destroy();
	});

	test('future-chunk 404 preserves present accompaniment; boundary falls back with backoff', async () => {
		const { ctx, mixer } = mocks();
		const loader = jest.fn(async (index) => {
			if (index === 1) throw new Error('future source segment missing');
			return {duration:1};
		});
		const router=new AdaptiveBiomeRouter(ctx,mixer,loader);
		router.configure(normalizePack(pack()),0,{biome:'debutmont'});
		await tick(router);
		expect(mixer.levels.guitar).toBe(0);
		expect(router.channels.get('featured').current?.biome).toBe('debutmont');
		const count=loader.mock.calls.length;
		for(let i=0;i<20;i++) await tick(router);
		expect(loader.mock.calls.length).toBe(count);
		expect(mixer.levels.guitar).toBe(0);
		ctx.currentTime=.99;
		await tick(router);
		expect(mixer.levels.guitar).toBe(1);
		expect(router.channels.get('featured').pending?.biome).toBe('debutmont');
		const after=loader.mock.calls.length;
		for(let i=0;i<20;i++) await tick(router);
		expect(loader.mock.calls.length).toBe(after);
		router.destroy();
	});

	test('wrong-duration variant never replaces its full original source', async () => {
		const {ctx,mixer}=mocks();
		const router=new AdaptiveBiomeRouter(ctx,mixer,async () => ({duration:.15}));
		router.configure(normalizePack(pack()),0,{biome:'debutmont',airborne:true});
		await tick(router);
		expect(mixer.levels.bass).toBe(1);
		expect(mixer.levels.drums).toBe(1);
		expect(mixer.levels.guitar).toBe(1);
		expect(router.lastError).toMatch(/shorter than source music segment/);
		router.destroy();
	});

	test('rapid biome changes never allocate per-biome mixer buses', async () => {
		const { ctx, mixer } = mocks();
		const router = new AdaptiveBiomeRouter(ctx,mixer,async () => ({duration:1}));
		router.configure(normalizePack(pack()),0,{biome:'debutmont',airborne:true});
		await tick(router);
		for (let k=0;k<15;k++) {
			router.setBiome(k%2 ? 'candy-cane-canyon' : 'debutmont');
			await tick(router);
		}
		expect(mixer.sources.size).toBe(12);
		router.destroy();
	});
});
