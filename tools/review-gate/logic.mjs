/** Trust boundary for an independently authenticated GitHub App review. */
export const CHECK_NAME = 'friday-independent-review';
export function installationPermissions() {
	return { pull_requests: 'write', checks: 'write' };
}
const SHA = /^[0-9a-f]{40}$/i;
const VALID = new Set(['approve', 'changes_requested', 'hold']);

export function validateEvidence(evidence) {
	if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error('Missing review evidence');
	if (!Number.isInteger(evidence.pr) || evidence.pr < 1) throw new Error('Invalid PR number');
	if (typeof evidence.headSha !== 'string' || !SHA.test(evidence.headSha)) throw new Error('Invalid exact-head SHA');
	if (!VALID.has(evidence.verdict)) throw new Error('Invalid verdict');
	if (typeof evidence.reviewerAgent !== 'string' || !evidence.reviewerAgent.trim() || evidence.reviewerAgent.length > 128)
		throw new Error('Missing independent reviewer identity');
	if (typeof evidence.authorAgent !== 'string' || !evidence.authorAgent.trim() || evidence.authorAgent.length > 128 ||
		evidence.reviewerAgent.trim().toLowerCase() === evidence.authorAgent.trim().toLowerCase())
		throw new Error('Reviewer and author must have distinct agent identities');
	if (typeof evidence.summary !== 'string' || !evidence.summary.trim() || evidence.summary.length > 12000)
		throw new Error('Missing bounded review summary');
	if (!Array.isArray(evidence.findings) || evidence.findings.length > 100 ||
		evidence.findings.some(f => !f || typeof f !== 'object' ||
			!['blocking', 'nonblocking'].includes(f.severity) ||
			typeof f.description !== 'string' || !f.description.trim() || f.description.length > 2000))
		throw new Error('Invalid findings list');
	if (!Array.isArray(evidence.tests) || evidence.tests.length > 100 ||
		evidence.tests.some(t => !t || typeof t !== 'object' ||
			typeof t.name !== 'string' || !t.name.trim() || t.name.length > 200 ||
			!['passed', 'failed', 'not_run'].includes(t.result)))
		throw new Error('Invalid test evidence list');
	if (evidence.verdict === 'approve' && (evidence.findings.some(f => f.severity === 'blocking') ||
		evidence.tests.some(t => t.result === 'failed')))
		throw new Error('Cannot approve with blocking findings or failed tests');
	return { ...evidence, headSha: evidence.headSha.toLowerCase() };
}

export function assertPrHead(pr, evidence) {
	if (!pr || pr.number !== evidence.pr || pr.state !== 'open' || pr.merged === true ||
		!pr.head || pr.head.sha?.toLowerCase() !== evidence.headSha) throw new Error('PR head changed, closed, or mismatched');
	if (evidence.verdict === 'approve' && pr.draft === true) throw new Error('Draft PR cannot receive a merge-ready verdict');
	return true;
}

export function reviewEvent(verdict) {
	return verdict === 'approve' ? 'APPROVE' : verdict === 'changes_requested' ? 'REQUEST_CHANGES' : 'COMMENT';
}

export function checkConclusion(verdict) {
	return verdict === 'approve' ? 'success' : 'failure';
}

export function reviewBody(evidence) {
	const out = [
		`## Independent review: ${evidence.verdict}`,
		`Exact PR head: \`${evidence.headSha}\``,
		`Reviewer agent: ${evidence.reviewerAgent}; author agent: ${evidence.authorAgent}`,
		'', evidence.summary.trim(), '',
		'### Findings',
		...(evidence.findings.length ? evidence.findings.map(f => `- **${f.severity}:** ${f.description}`) : ['- No findings recorded.']),
		'', '### Validation',
		...(evidence.tests.length ? evidence.tests.map(t => `- ${t.result}: ${t.name}`) : ['- No tests run in this review.']),
		'', 'This review is an agent assessment, not a human approval or a claim of test coverage beyond the evidence above.',
	];
	return out.join('\n').slice(0, 30000);
}

// A green check certifies one specific review, not merely a matching SHA.
export function reviewCheckIsCurrent(check, pr, reviews, bot) {
	if (!check || !pr || pr.state !== 'open' || !pr.head?.sha || !Array.isArray(reviews) || !bot ||
		check.name !== CHECK_NAME || check.status !== 'completed' || check.conclusion !== 'success' ||
		check.head_sha?.toLowerCase() !== pr.head.sha.toLowerCase()) return false;
	const botReviews = reviews.filter(r => r.user?.login === bot && r.state !== 'PENDING');
	if (!botReviews.length || botReviews.some(r => !Number.isInteger(r.id) || !Number.isFinite(Date.parse(r.submitted_at)))) return false;
	botReviews.sort((a, b) => Date.parse(a.submitted_at) - Date.parse(b.submitted_at) || a.id - b.id);
	const latest = botReviews.at(-1);
	return latest.state === 'APPROVED' && latest.commit_id?.toLowerCase() === pr.head.sha.toLowerCase() &&
		check.external_id === `pr-${pr.number}-review-${latest.id}`;
}

export async function reconcileChecks({ pr, reviews, checks, bot, appId, invalidate }) {
	if (!Number.isInteger(pr?.number) || !Array.isArray(reviews) || !Array.isArray(checks) ||
		!Number.isInteger(appId) || typeof bot !== 'string' || typeof invalidate !== 'function')
		throw new Error('Invalid reconciliation input');
	const invalidated = [];
	for (const check of checks) {
		if (check.app?.id !== appId || check.name !== CHECK_NAME || check.status !== 'completed' ||
			check.conclusion !== 'success') continue;
		const associated = /^pr-(\d+)-review-(\d+)$/.exec(check.external_id || '');
		if (associated && Number(associated[1]) !== pr.number) continue;
		if (!reviewCheckIsCurrent(check, pr, reviews, bot)) {
			await invalidate(check.id);
			invalidated.push(check.id);
		}
	}
	return invalidated;
}

export async function reconcilePullRequest({ number, bot, appId, api }) {
	if (!Number.isInteger(number) || number < 1 || typeof api !== 'function') throw new Error('Invalid PR or API');
	const base = '/repos/truevox/BitstreamBluffs';
	const pr = await api(`${base}/pulls/${number}`);
	if (pr.number !== number || pr.state !== 'open' || !SHA.test(pr.head?.sha || '')) throw new Error('PR is not open or has invalid head');
	async function allPages(path, field) {
		const items = [];
		for (let page = 1; page <= 100; page++) {
			const response = await api(`${path}?per_page=100&page=${page}`);
			const batch = field ? response?.[field] : response;
			if (!Array.isArray(batch)) throw new Error('Unexpected paginated GitHub response');
			items.push(...batch);
			if (batch.length < 100) return items;
		}
		throw new Error('GitHub pagination limit reached');
	}
	const reviews = await allPages(`${base}/pulls/${number}/reviews`);
	const checks = await allPages(`${base}/commits/${pr.head.sha}/check-runs`, 'check_runs');
	return reconcileChecks({ pr, reviews, checks, bot, appId, invalidate: id => api(`${base}/check-runs/${id}`, 'PATCH', {
		conclusion: 'failure', output: { title: 'Independent review invalidated', summary: 'The exact approval is no longer the latest valid review for this pull request.' },
	}) });
}

export function assertInstallationIdentity(installation, appId, slug) {
	if (!Number.isInteger(appId) || installation?.app_id !== appId || installation.app_slug !== slug || installation.account?.login !== 'truevox')
		throw new Error('Unexpected GitHub App installation identity or owner');
	return true;
}
