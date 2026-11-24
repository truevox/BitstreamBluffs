/**
 * Conservative spectral evidence for physical crystal landing accents.
 * Uses ONLY currently sounding original-stem analyser magnitudes. The pitch
 * labels below are equal-tempered test frequencies, NOT a guessed song key,
 * a generated note score, or a claim that a dominant overtone is a melody.
 * When evidence is missing/weak the correct answer is [] (no pitched cascade).
 */
export const CRYSTAL_MIDI_LOW=60;
export const CRYSTAL_MIDI_HIGH=83;
export const crystalHz=midi=>440*Math.pow(2,(midi-69)/12);

const median=values=>{
	const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
	return sorted.length ? sorted[Math.floor(sorted.length/2)] : -Infinity;
};

export function confidentCrystalNotes(db,{sampleRate=48000,fftSize=4096,maxNotes=2}={}){
	if(!(db instanceof Float32Array)||!Number.isFinite(sampleRate)||sampleRate<8000||
		!Number.isInteger(fftSize)||fftSize<1024||db.length<fftSize/2)return [];
	const hzPerBin=sampleRate/fftSize;
	const from=Math.max(1,Math.floor(190/hzPerBin));
	const to=Math.min(db.length-1,Math.ceil(2100/hzPerBin));
	const background=[];
	for(let i=from;i<to;i+=2)if(Number.isFinite(db[i]))background.push(db[i]);
	const floor=median(background);
	if(!Number.isFinite(floor))return [];
	const candidates=[];
	for(let midi=CRYSTAL_MIDI_LOW;midi<=CRYSTAL_MIDI_HIGH;midi++){
		const hz=crystalHz(midi);
		const center=Math.round(hz/hzPerBin);
		if(center<4||center>db.length-6)continue;
		const peak=Math.max(db[center-1],db[center],db[center+1]);
		const neighbor=median([db[center-4],db[center-3],db[center+3],db[center+4]]);
		const prominence=peak-neighbor;
		const global=peak-floor;
		// Both source loudness and LOCAL prominence matter. A broadly noisy
		// transient must not become a bright, invented chord.
		if(Number.isFinite(peak)&&peak>-68&&global>=12&&prominence>=4.5)
			candidates.push({midi,hz,confidence:Math.min(1,(prominence-4.5)/20),
				score:prominence+Math.min(20,global)*.4});
	}
	candidates.sort((a,b)=>b.score-a.score||a.midi-b.midi);
	const out=[];
	for(const c of candidates){
		if(out.some(other=>Math.abs(other.midi-c.midi)<3||
			Math.abs(other.midi-c.midi)===12))continue;
		out.push(Object.freeze({midi:c.midi,hz:c.hz,confidence:c.confidence}));
		if(out.length>=Math.min(2,Math.max(1,maxNotes)))break;
	}
	return out;
}
