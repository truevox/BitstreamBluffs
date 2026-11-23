/**
 * Seeded/irregular Scrapheap clang cadence — pure event policy. No timers,
 * no Math.random, no transport mutation, no guesses when original musical
 * bass has no confidently measured source pitch. Both game and audition use
 * THIS exact class, so listener and game behavior remain equivalent.
 */
export class ScrapPitchCadence {
	constructor(seed=0xB1A6B00F){
		this.initialSeed=(Number.isInteger(seed)?seed:0xB1A6B00F)>>>0;
		this.reset();
	}
	reset(){this.seed=this.initialSeed;this.resetTiming();}
	resetTiming(){this.nextAt=NaN;}
	_random(){
		this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;
		return this.seed/4294967296;
	}
	/** Only reads/analyzes original bass when a sparse clang is DUE. */
	next(now,contact,readNotes,rate=1){
		if(!Number.isFinite(now)||!Number.isFinite(contact)||contact<.16){
			this.resetTiming();return null;
		}
		const speed=Number.isFinite(rate)?Math.max(.5,Math.min(2,rate)):1;
		if(!Number.isFinite(this.nextAt)){
			this.nextAt=now+(.35+this._random()*.75)/speed;
			return null;
		}
		if(now<this.nextAt)return null;
		this.nextAt=now+(.75+this._random()*1.55)/speed;
		const notes=typeof readNotes==='function'?readNotes():null;
		if(!Array.isArray(notes)||!notes.length)return null;
		const selected=notes[Math.floor(this._random()*notes.length)];
		if(!selected||!Number.isFinite(selected.confidence)||selected.confidence<.05)
			return null;
		return {midi:selected.midi,hz:selected.hz,confidence:selected.confidence,
			strength:Math.min(1,Math.max(0,contact))};
	}
}
