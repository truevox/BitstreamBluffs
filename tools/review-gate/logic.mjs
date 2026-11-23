/** Trust boundary for an independently authenticated GitHub App review. */
export const CHECK_NAME = 'friday-independent-review';
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
