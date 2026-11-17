import { ScoreCorrectionDraft } from '../../src/systems/music/ScoreCorrectionDraft.js';

const score=()=>({
	songId:'test-score',scoreHash:'a'.repeat(64),
	frameCount:48000*12,
	events:{
		melody:[],bass:[],drums:[{
			id:'dr-001',startFrame:24000,class:'kick',
		},{id:'dr-002',startFrame:24480,class:'snare'}],
		guitar:[{
			id:'gu-001',startFrame:24000,endFrame:36000,pitch:60,class:'note',
		},{id:'gu-002',startFrame:24480,endFrame:37000,pitch:72,class:'note'}],
		piano:[],other:[],
	},
});

describe('Non-destructive score correction draft for in-game inspector',()=>{
	test('multiple 10ms nudges and octave correction remain a single atomic operation',()=>{
		const source=score(),original=JSON.stringify(source);
		const draft=new ScoreCorrectionDraft(source);
		expect(draft.modify('gu-001','nudge',-480)).toBe(true);
		expect(draft.modify('gu-001','nudge',-480)).toBe(true);
		expect(draft.modify('gu-001','octave',12)).toBe(true);
		expect(draft.count).toBe(1);
		expect(draft.preview('gu-001')).toMatchObject({
			startFrame:23040,endFrame:35040,pitch:72,status:'correct',
		});
		const patch=draft.export();
		expect(patch).toMatchObject({
			format:'bitstream-performance-patches-v1',
			status:'draft-unreviewed-not-applied-to-audio',
			songId:source.songId,baseScoreHash:source.scoreHash,
		});
		expect(patch.operations).toEqual([{
			id:'gu-001',action:'correct',
			startFrame:23040,endFrame:35040,pitch:72,
		}]);
		expect(JSON.stringify(source)).toBe(original);
	});
	test('clamping negative samples, releases, and overrange pitches',()=>{
		const draft=new ScoreCorrectionDraft(score());
		expect(draft.modify('gu-001','nudge',-4800)).toBe(true);
		expect(draft.modify('gu-001','nudge',-4800)).toBe(true);
		expect(draft.modify('gu-001','nudge',-4800)).toBe(true);
		expect(draft.modify('gu-001','nudge',-4800)).toBe(true);
		expect(draft.modify('gu-001','nudge',-4800)).toBe(true);
		expect(draft.modify('gu-001','nudge',-480)).toBe(false);
		expect(draft.modify('gu-001','octave',12)).toBe(true);
		expect(draft.modify('gu-001','octave',12)).toBe(true);
		expect(draft.modify('gu-001','octave',12)).toBe(true);
		expect(draft.modify('gu-001','octave',12)).toBe(true);
		expect(draft.modify('gu-001','octave',12)).toBe(true);
		expect(draft.modify('gu-001','octave',12)).toBe(false);
		expect(draft.preview('gu-001').pitch).toBe(120);
	});
	test('refuses a draft that would move attacks across adjacent original notes',()=>{
		const draft=new ScoreCorrectionDraft(score());
		// Guitar notes are 10ms apart; the first may meet the second but
		// cannot overtake it without a coordinated chord/group correction.
		expect(draft.modify('gu-001','nudge',480)).toBe(true);
		expect(draft.modify('gu-001','nudge',480)).toBe(false);
		expect(draft.preview('gu-001').startFrame).toBe(24480);
		expect(draft.count).toBe(1);
		// Drums may coincide, but cannot reorder the source class sequence.
		expect(draft.modify('dr-001','nudge',480)).toBe(true);
		expect(draft.modify('dr-001','nudge',480)).toBe(false);
		// The patch remains exactly one valid correction for each role.
		expect(draft.export().operations).toHaveLength(2);
	});
	test('drum class is immutable; simultaneous hit timing only',()=>{
		const draft=new ScoreCorrectionDraft(score());
		expect(draft.modify('dr-001','octave',12)).toBe(false);
		expect(draft.modify('dr-001','nudge',480)).toBe(true);
		expect(draft.preview('dr-001')).toMatchObject({
			startFrame:24480,class:'kick',status:'correct',
		});
		expect(draft.export().operations).toEqual([{
			id:'dr-001',action:'correct',startFrame:24480,
		}]);
	});
	test('revert any event, remove draft when it returns to source',()=>{
		const draft=new ScoreCorrectionDraft(score());
		expect(draft.export()).toBe(null);
		expect(draft.modify('gu-001','nudge',480)).toBe(true);
		expect(draft.modify('gu-001','nudge',-480)).toBe(true);
		expect(draft.count).toBe(0);
		draft.modify('gu-001','accept');
		expect(draft.preview('gu-001').status).toBe('accept');
		expect(draft.modify('gu-001','undo')).toBe(true);
		expect(draft.export()).toBe(null);
	});
	test('reject one event but never touch its neighbor or original',()=>{
		const source=score();
		const draft=new ScoreCorrectionDraft(source);
		expect(draft.modify('gu-001','reject')).toBe(true);
		expect(draft.preview('gu-001').status).toBe('reject');
		expect(draft.preview('gu-002').status).toBe('source-candidate');
		expect(source.events.guitar).toHaveLength(2);
		expect(draft.export().operations[0]).toEqual({
			action:'reject',id:'gu-001',
		});
	});
	test('wrong event ID or unknown action is rejected',()=>{
		const draft=new ScoreCorrectionDraft(score());
		expect(draft.modify('gu-wrong','accept')).toBe(false);
		expect(draft.modify('gu-001','random')).toBe(false);
		expect(draft.count).toBe(0);
	});
	test('different score revisions cannot reuse source drafts',()=>{
		const a=new ScoreCorrectionDraft(score());
		a.modify('gu-001','reject');
		const other=score();other.scoreHash='b'.repeat(64);
		const b=new ScoreCorrectionDraft(other);
		expect(b.count).toBe(0);
		expect(a.export().baseScoreHash).not.toBe(b.scoreHash);
	});
});
