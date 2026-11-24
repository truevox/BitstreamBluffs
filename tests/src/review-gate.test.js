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

test('a passing check is valid only while the exact bot review remains the latest approval', () => {
	const approve = { id: 7, state: 'APPROVED', commit_id: sha, user: { login: 'gal-friday-review[bot]' }, submitted_at: '2026-11-23T12:00:00Z' };
	const check = { name: CHECK_NAME, status: 'completed', conclusion: 'success', external_id: 'pr-42-review-7', head_sha: sha };
	expect(typeof reviewGate.reviewCheckIsCurrent).toBe('function');
	expect(reviewGate.reviewCheckIsCurrent(check, pr(), [approve], 'gal-friday-review[bot]')).toBe(true);
	for (const bad of [
		[{ ...approve, state: 'DISMISSED' }],
		[approve, { ...approve, id: 8, state: 'CHANGES_REQUESTED', submitted_at: '2026-11-23T12:01:00Z' }],
		[approve, { ...approve, id: 8, state: 'COMMENTED', submitted_at: '2026-11-23T12:01:00Z' }],
		[{ ...approve, commit_id: 'b'.repeat(40) }],
		[],
	]) expect(reviewGate.reviewCheckIsCurrent(check, pr(), bad, 'gal-friday-review[bot]')).toBe(false);
	expect(reviewGate.reviewCheckIsCurrent({ ...check, external_id: 'pr-42-review-8' }, pr(), [approve], 'gal-friday-review[bot]')).toBe(false);
	expect(reviewGate.reviewCheckIsCurrent(check, { ...pr(), head: { sha: 'b'.repeat(40) } }, [approve], 'gal-friday-review[bot]')).toBe(false);
});

test('reconciliation invalidates stale app checks without altering unrelated checks', async () => {
	expect(typeof reviewGate.reconcileChecks).toBe('function');
	const { reconcileChecks } = reviewGate;
	const bot = 'gal-friday-review[bot]';
	const check = { id: 9, app: { id: 123 }, name: CHECK_NAME, status: 'completed', conclusion: 'success', external_id: 'pr-42-review-7', head_sha: sha };
	const calls = [];
	await reconcileChecks({ pr: pr(), reviews: [{ id: 7, state: 'DISMISSED', commit_id: sha, user: { login: bot }, submitted_at: '2026-11-23T12:00:00Z' }], checks: [check, { ...check, id: 10, app: { id: 999 } }, { ...check, id: 11, external_id: 'pr-99-review-7' }, { ...check, id: 12, external_id: null }], bot, appId: 123, invalidate: async id => calls.push(id) });
	expect(calls).toEqual([9, 12]);
});

test('reconciliation fetches every page and sends a failing update for a dismissed review', async () => {
	expect(typeof reviewGate.reconcilePullRequest).toBe('function');
	const bot = 'gal-friday-review[bot]';
	const requests = [];
	const check = { id: 9, app: { id: 123 }, name: CHECK_NAME, status: 'completed', conclusion: 'success', external_id: 'pr-42-review-7', head_sha: sha };
	const api = async (path, method, payload) => {
		requests.push({ path, method, payload });
		if (path === '/repos/truevox/BitstreamBluffs/pulls/42') return pr();
		if (path.includes('/reviews?') && path.endsWith('page=1')) return Array.from({ length: 100 }, (_, id) => ({ id, state: 'COMMENTED', user: { login: 'someone-else' } }));
		if (path.includes('/reviews?') && path.endsWith('page=2')) return [{ id: 7, state: 'DISMISSED', commit_id: sha, user: { login: bot }, submitted_at: '2026-11-23T12:00:00Z' }];
		if (path.includes('/check-runs?')) return { check_runs: [check] };
		if (method === 'PATCH') return {};
		throw new Error('Unexpected request: ' + path);
	};
	expect(await reviewGate.reconcilePullRequest({ number: 42, bot, appId: 123, api })).toEqual([9]);
	expect(requests.some(r => r.path.includes('/reviews?') && r.path.endsWith('page=2'))).toBe(true);
	expect(requests.find(r => r.method === 'PATCH')).toMatchObject({ path: '/repos/truevox/BitstreamBluffs/check-runs/9', payload: { conclusion: 'failure' } });
});

test('installation identity must match app ID, slug, and owner', () => {
	expect(typeof reviewGate.assertInstallationIdentity).toBe('function');
	const identity = { app_id: 123, app_slug: 'gal-friday-review', account: { login: 'truevox' } };
	expect(reviewGate.assertInstallationIdentity(identity, 123, 'gal-friday-review')).toBe(true);
	for (const bad of [{ ...identity, app_id: 124 }, { ...identity, app_slug: 'other' }, { ...identity, account: { login: 'other' } }, null])
		expect(() => reviewGate.assertInstallationIdentity(bad, 123, 'gal-friday-review')).toThrow();
});

test('reconciliation preserves a valid current approval and reports update failures', async () => {
	const bot = 'gal-friday-review[bot]';
	const review = { id: 7, state: 'APPROVED', commit_id: sha, user: { login: bot }, submitted_at: '2026-11-23T12:00:00Z' };
	const check = { id: 9, app: { id: 123 }, name: CHECK_NAME, status: 'completed', conclusion: 'success', external_id: 'pr-42-review-7', head_sha: sha };
	let calls = 0;
	const invalidate = async () => { calls++; throw new Error('GitHub unavailable'); };
	expect(await reviewGate.reconcileChecks({ pr: pr(), reviews: [review], checks: [check], bot, appId: 123, invalidate })).toEqual([]);
	expect(calls).toBe(0);
	await expect(reviewGate.reconcileChecks({ pr: pr(), reviews: [{ ...review, state: 'DISMISSED' }], checks: [check], bot, appId: 123, invalidate })).rejects.toThrow('GitHub unavailable');
});

test('sweep reconciles every open PR and surfaces partial failures', async () => {
	expect(typeof reviewGate.reconcileAllPullRequests).toBe('function');
	const seen = [];
	const api = async path => {
		if (path.includes('/pulls?')) return [{ number: 10 }, { number: 11 }];
		throw new Error('Unexpected API path');
	};
	const reconcile = async ({ number }) => {
		seen.push(number);
		if (number === 10) throw new Error('bad PR');
		return [55];
	};
	const outcome = await reviewGate.reconcileAllPullRequests({ api, reconcile });
	expect(seen).toEqual([10, 11]);
	expect(outcome).toEqual({ scanned: 2, invalidated: 1, failures: [{ number: 10, message: 'bad PR' }] });
});
