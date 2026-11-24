import {confidentCrystalNotes,crystalHz} from '../../src/systems/music/CrystalChroma.js';

describe('Crystal Chroma: pitches only with current-source confidence',()=>{
	const sampleRate=48000,fftSize=4096;
	const bins=()=>new Float32Array(fftSize/2).fill(-94);
	const inject=(db,midi,peak=-30)=>{
		const bin=Math.round(crystalHz(midi)*fftSize/sampleRate);
		db[bin-1]=peak-8;db[bin]=peak;db[bin+1]=peak-7;
	};
	test('silence, NaNs, broadband noise and malformed input produce NO invented notes',()=>{
		expect(confidentCrystalNotes(bins(),{sampleRate,fftSize})).toEqual([]);
		expect(confidentCrystalNotes(new Float32Array(128),{sampleRate,fftSize})).toEqual([]);
		expect(confidentCrystalNotes(null,{sampleRate,fftSize})).toEqual([]);
		const noisy=new Float32Array(fftSize/2).fill(-24);
		expect(confidentCrystalNotes(noisy,{sampleRate,fftSize})).toEqual([]);
		noisy[50]=NaN;
		expect(confidentCrystalNotes(noisy,{sampleRate,fftSize})).toEqual([]);
	});
	test('returns only clearly supported current measured pitches, never guessed key',()=>{
		const db=bins();inject(db,69);inject(db,76,-35);
		const notes=confidentCrystalNotes(db,{sampleRate,fftSize});
		expect(notes.length).toBeGreaterThan(0);
		expect(notes.length).toBeLessThanOrEqual(2);
		for(const note of notes){
			expect([69,76]).toContain(note.midi);
			expect(note.hz).toBeCloseTo(crystalHz(note.midi));
		}
	});
	test('weak peaks never become synthetic chord',()=>{
		const db=bins();inject(db,69,-75);
		expect(confidentCrystalNotes(db,{sampleRate,fftSize})).toEqual([]);
	});
});
