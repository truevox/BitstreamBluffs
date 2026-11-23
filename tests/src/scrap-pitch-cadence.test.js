import {ScrapPitchCadence} from '../../src/systems/music/ScrapPitchCadence.js';
import {crystalHz} from '../../src/systems/music/CrystalChroma.js';
const note=(midi=69)=>({midi,hz:crystalHz(midi),confidence:.3});

describe('Garbage source-pitch cadence: irregular yet always measured',()=>{
	test('seeded time schedule reproduces exactly, reads analyser only at actual due time',()=>{
		const steps=Array.from({length:600},(_,i)=>i*.075);
		const run=()=>{
			const c=new ScrapPitchCadence(),emitted=[];let reads=0;
			for(const now of steps){
				const event=c.next(now,.55,()=>{reads++;return [note(65),note(69)];});
				if(event)emitted.push([now,event.midi,event.hz,event.strength]);
			}
			return {emitted,reads};
		};
		const a=run(),b=run();
		expect(a).toEqual(b);
		expect(a.emitted.length).toBeGreaterThan(10);
		expect(a.emitted.length).toBeLessThan(35);
		expect(a.reads).toBe(a.emitted.length);
		expect(new Set(a.emitted.map(e=>e[1]))).toEqual(new Set([65,69]));
		for(let i=1;i<a.emitted.length;i++)
			expect(a.emitted[i][0]-a.emitted[i-1][0]).toBeGreaterThanOrEqual(.74);
		for(const event of a.emitted)expect(event[2]).toBeCloseTo(crystalHz(event[1]));
	});
	test('no unverified note or disabled contact; missing bass skips without burst catch-up',()=>{
		const c=new ScrapPitchCadence();let reads=0;
		expect(c.next(5,0,()=>{reads++;return [note()];})).toBeNull();
		expect(c.next(5,.55,()=>{reads++;return [note()];})).toBeNull();
		const due=c.nextAt;
		expect(c.next(due-.01,.55,()=>{reads++;return [note()];})).toBeNull();
		expect(reads).toBe(0);
		expect(c.next(due,.55,()=>{reads++;return [];})).toBeNull();
		expect(reads).toBe(1);
		const next=c.nextAt;
		expect(next).toBeGreaterThan(due+.74);
		expect(c.next(next,.55,()=>{reads++;return [{...note(69),confidence:.02}];})).toBeNull();
		expect(reads).toBe(2);
		c.resetTiming();
		expect(Number.isNaN(c.nextAt)).toBe(true);
		c.reset();
		expect(c.seed).toBe(c.initialSeed);
	});
});
