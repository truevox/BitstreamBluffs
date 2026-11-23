import * as reviewGate from '../../tools/review-gate/logic.mjs';
import { CHECK_NAME, validateEvidence, assertPrHead, reviewEvent, checkConclusion, reviewBody } from '../../tools/review-gate/logic.mjs';
const sha = 'a'.repeat(40);
const good = () => ({pr:42, headSha:sha, verdict:'approve', reviewerAgent:'Astra Friday',
	authorAgent:'Morgan', summary:'Reviewed exact code and test evidence', findings:[],
	tests:[{name:'focused Jest',result:'passed'}]});
const pr = () => ({number:42,state:'open',merged:false,draft:false,head:{sha}});

test('only an exact open ready head is eligible for passing review', () => {
	const e = validateEvidence(good());
	expect(assertPrHead(pr(),e)).toBe(true);
	for (const p of [{...pr(),head:{sha:'b'.repeat(40)}},{...pr(),draft:true},
		{...pr(),state:'closed'},{...pr(),number:55},{...pr(),merged:true}])
		expect(() => assertPrHead(p,e)).toThrow();
});

test('fail closed on missing, duplicated or contradictory reviewer evidence', () => {
	for (const x of [null,{}, {...good(), headSha:'bad'}, {...good(),pr:0},
		{...good(),verdict:'pass'}, {...good(),authorAgent:'astra friday'},
		{...good(),summary:''}, {...good(),tests:null}, {...good(),findings:null},
		{...good(),tests:[{name:'jest',result:'impressive'}]},
		{...good(),findings:[{severity:'blocking',description:'still broken'}]},
		{...good(),tests:[{name:'jest',result:'failed'}]}])
		expect(() => validateEvidence(x)).toThrow();
});

test('explicit holds and requested changes never produce passing check runs', () => {
	const hold=validateEvidence({...good(),verdict:'hold',findings:[{severity:'blocking',description:'listen first'}]});
	const changes=validateEvidence({...good(),verdict:'changes_requested',tests:[{name:'regression',result:'failed'}]});
	expect(reviewEvent(hold.verdict)).toBe('COMMENT');
	expect(reviewEvent(changes.verdict)).toBe('REQUEST_CHANGES');
	expect(checkConclusion(hold.verdict)).toBe('failure');
	expect(checkConclusion(changes.verdict)).toBe('failure');
	expect(reviewEvent('approve')).toBe('APPROVE');
	expect(checkConclusion('approve')).toBe('success');
	expect(reviewBody(hold)).toContain('Exact PR head');
	expect(CHECK_NAME).toBe('friday-independent-review');
});

test('review token requests only permissions granted to the installed app', () => {
	expect(typeof reviewGate.installationPermissions).toBe('function');
	expect(reviewGate.installationPermissions()).toEqual({ pull_requests: 'write', checks: 'write' });
});
