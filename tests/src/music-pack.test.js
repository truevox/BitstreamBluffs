import { normalizeCatalog, normalizePack, resolveMusicAsset } from '../../src/systems/music/MusicPack.js';
import { BIOME_IDS, BIOME_VOICES, HOME_BIOME, voiceSourceForBiome } from '../../src/systems/music/BiomeVoices.js';
import { normalizeCaptions, captionAt, nextBeatTime } from '../../src/systems/music/CaptionSequencer.js';
import { ROOM_PRESETS, createBiomeImpulse, ImpulseBank } from '../../src/systems/music/ImpulseBank.js';

const sourceFiles = () => Object.fromEntries(['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']
	.map(name => [name, name + '.ogg']));
const pack = () => ({
	format: 'bitstream-music-pack-v1', id: 'pope-song', sampleRate: 48000, frameCount: 96000,
	segments: [
		{ startFrame: 0, frames: 48000, sources: sourceFiles() },
		{ startFrame: 48000, frames: 48000, sources: sourceFiles() },
	],
});

describe('Bitstream Music Pack v1', () => {
	test('validates six aligned stems, exact frame boundaries and identity', () => {
		const p = normalizePack(pack());
		expect(p.duration).toBe(2);
		expect(p.segments).toHaveLength(2);
		expect(p.sourceNames).toEqual(['bass','drums','guitar','other','piano','vocals']);
	});
	test('experimental score descriptor is optional and never a stem',()=>{
		const original=pack();
		const scoreHash='a'.repeat(64),candidate='b'.repeat(64);
		original.performance={path:'performance.json',scoreHash};
		original.experimentalPerformance={
			path:'performance-candidate-v2.json',scoreHash:candidate,
			parentScoreHash:scoreHash,
		};
		const parsed=normalizePack(original);
		expect(parsed.experimentalPerformance).toEqual(original.experimentalPerformance);
		expect(parsed.sourceNames).not.toContain('experimentalPerformance');
		expect(parsed.adaptive).toBeDefined();
		original.experimentalPerformance.parentScoreHash='c'.repeat(64);
		expect(()=>normalizePack(original)).toThrow(/Invalid experimental/);
		original.experimentalPerformance.parentScoreHash=scoreHash;
		original.experimentalPerformance.path='../wrong.json';
		expect(()=>normalizePack(original)).toThrow(/Invalid experimental/);
	});
	test('the optional score sidecar is path-safe and revision-pinned',()=>{
		const original=pack();
		expect(normalizePack(original).performance).toBe(null);
		const scoreHash='a'.repeat(64);
		original.performance={path:'performance.json',scoreHash};
		expect(normalizePack(original).performance).toEqual({
			path:'performance.json',scoreHash,
		});
		original.performance.path='../private.json';
		expect(()=>normalizePack(original)).toThrow(/Invalid performance/);
		original.performance.path='performance.json';
		original.performance.scoreHash='unsigned';
		expect(()=>normalizePack(original)).toThrow(/Invalid performance/);
	});

	test('accepts arbitrary derived voice sources and bounded DSP chains', () => {
		const p = pack();
		for (const seg of p.segments) seg.sources['voice:bitstream-bluffs'] = 'chip.ogg';
		p.effects = { 'voice:bitstream-bluffs': [
			{ id: 'chip-filter', type: 'filter', mode: 'lowpass', frequency: 5000 },
			{ id: 'micro-echo', type: 'delay', time: 0.04, wet: 0.2 },
		] };
		p.captions = 'captions/words.json';
		p.tempo = 160;
		const result = normalizePack(p);
		expect(result.effects['voice:bitstream-bluffs']).toHaveLength(2);
		expect(result.captions).toBe('captions/words.json');
		expect(result.bpm).toBe(160);
	});
	test('source-bound physical DSP processors can be described safely by manifests', () => {
		const original=pack();
		original.effects={drums:[{id:'metal',type:'scrapheap',contact:.3}],
			bass:[{id:'snow',type:'snowpack',depth:.6}]};
		const result=normalizePack(original);
		expect(result.effects.drums[0].type).toBe('scrapheap');
		expect(result.effects.bass[0].type).toBe('snowpack');
		original.effects.drums[0].type='arbitrary-script';
		expect(()=>normalizePack(original)).toThrow(/Invalid music processor/);
	});
	test('data-driven non-vocal derived textures are valid and limited', () => {
		const p = pack();
		for (const seg of p.segments) seg.sources['pad:space'] = 'derived-pad.ogg';
		p.layers = { 'pad:space': 0.37 };
		const result = normalizePack(p);
		expect(result.layers['pad:space']).toBe(0.37);
		p.layers = { vocals: 1 };
		expect(() => normalizePack(p)).toThrow(/Invalid derived layer/);
		p.layers = { 'pad:space': 12 };
		expect(() => normalizePack(p)).toThrow(/Invalid derived layer/);
	});
	test('rejects empty, gapped, inconsistent or escaping source maps', () => {
		const bad = pack(); bad.segments[1].startFrame++;
		expect(() => normalizePack(bad)).toThrow(/Noncontiguous/);
		const escape = pack(); escape.segments[0].sources.drums = '../secret.wav';
		expect(() => normalizePack(escape)).toThrow(/unsafe stem/);
		const absent = pack(); delete absent.segments[1].sources.bass;
		expect(() => normalizePack(absent)).toThrow();
		const mismatched = pack();
		mismatched.segments[1].sources['voice:bitstream-bluffs'] = 'v.ogg';
		expect(() => normalizePack(mismatched)).toThrow(/Stem names change/);
	});
	test('rejects executable/unknown effects and duplicate processors', () => {
		const p = pack();
		p.effects = { drums: [{ id: 'oops', type: 'eval', code: 'bad' }] };
		expect(() => normalizePack(p)).toThrow(/Invalid music processor/);
		p.effects = { drums: [{ id: 'a', type: 'gain' },{ id: 'a', type: 'gain' }] };
		expect(() => normalizePack(p)).toThrow(/Invalid music processor/);
	});
	test('catalog never accepts traversal or duplicate IDs', () => {
		expect(normalizeCatalog({ format:'bitstream-music-catalog-v1',
			tracks:[{id:'a',title:'A',manifest:'packs/a/pack.json'}] }).tracks).toHaveLength(1);
		expect(() => normalizeCatalog({ format:'bitstream-music-catalog-v1',
			tracks:[{id:'a',manifest:'../escape.json'}] })).toThrow();
		expect(resolveMusicAsset(new URL('https://example.com/music/catalog.json'), 'packs/a/pack.json'))
			.toBe('https://example.com/music/packs/a/pack.json');
	});
});

describe('Twelve mountain identities', () => {
	test('base virtual mountain and all eleven unlockable biomes have unique instruments', () => {
		expect(BIOME_IDS).toHaveLength(12);
		expect(BIOME_IDS).toContain(HOME_BIOME);
		expect(Object.keys(ROOM_PRESETS).sort()).toEqual(BIOME_IDS.slice().sort());
		expect(new Set(BIOME_IDS.map(id => BIOME_VOICES[id].instrument)).size).toBe(12);
		expect(voiceSourceForBiome('crystal-cavern')).toBe('voice:crystal-cavern');
		expect(voiceSourceForBiome('missing')).toBe('voice:bitstream-bluffs');
	});
	test('generated impulse fits RAM and is repeatable', () => {
		const ctx = {
			sampleRate: 48000,
			createBuffer(channels, length) {
				const data = Array.from({length:channels}, () => new Float32Array(length));
				return { length, getChannelData(i) {return data[i];} };
			},
		};
		const a = createBiomeImpulse(ctx,'micro-mountain');
		const b = createBiomeImpulse(ctx,'micro-mountain');
		expect(a.length).toBeLessThan(48000);
		expect(a.getChannelData(0).slice(0,200)).toEqual(b.getChannelData(0).slice(0,200));
		expect(createBiomeImpulse(ctx,'sky-jellyfish-mountain','mobile').length).toBeLessThanOrEqual(55200);
		const bank = new ImpulseBank(ctx,2);
		expect(bank.get('debutmont')).toBe(bank.get('debutmont'));
		bank.get('crystal-cavern'); bank.get('pyramid-peak');
		expect(bank.cache.size).toBe(2);
	});
});

describe('Lyric timelines', () => {
	test('word lookup and beat times follow the audio clock', () => {
		const {words} = normalizeCaptions({format:'bitstream-lyrics-v1',
			words:[{start:0.2,end:0.6,text:'ONE'},{start:0.7,end:1.1,text:'MORE'}]},3);
		expect(captionAt(words,0.4)?.text).toBe('ONE');
		expect(captionAt(words,0.65)).toBeNull();
		expect(captionAt(words,0.8)?.text).toBe('MORE');
		expect(nextBeatTime(10,0.6,120)).toBe(11);
	});
	test('rejects invalid timestamps and text', () => {
		expect(() => normalizeCaptions({format:'bitstream-lyrics-v1',
			words:[{start:0,end:4,text:'too long'}]},2)).toThrow();
		expect(() => normalizeCaptions({format:'bitstream-lyrics-v1',
			words:[{start:0.7,end:1,text:'a'},{start:0.5,end:0.9,text:'b'}]},2)).toThrow();
	});
});
