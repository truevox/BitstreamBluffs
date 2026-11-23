#!/usr/bin/env node
/**
 * Run only from the independently controlled reviewer environment.
 * Do NOT give the App key/installation token to coding agents.
 * Install/run ONLY from an independently controlled, trusted code copy, never
 * from a checked-out developer PR. Do not trust author-provided evidence.
 * All writes use the GitHub App identity and an exact-commit check run.
 */
import { createSign } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { validateEvidence, assertPrHead, reviewEvent, checkConclusion, reviewBody, CHECK_NAME, installationPermissions } from './logic.mjs';

const BASE = 'https://api.github.com';
const repo = process.env.FRIDAY_REVIEW_REPO || 'truevox/BitstreamBluffs';
const slug = process.env.FRIDAY_REVIEW_APP_SLUG;
if (repo !== 'truevox/BitstreamBluffs') throw new Error('Only truevox/BitstreamBluffs is authorized by this tool');
if (!slug || !/^[a-z\d-]{2,80}$/.test(slug)) throw new Error('FRIDAY_REVIEW_APP_SLUG required');

function jwt(appId, pem) {
	const now = Math.floor(Date.now() / 1000);
	const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
	const message = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: appId, iat: now - 60, exp: now + 480 })}`;
	const sig = createSign('RSA-SHA256').update(message).end().sign(pem).toString('base64url');
	return `${message}.${sig}`;
}

async function api(path, token, method = 'GET', data) {
	const response = await fetch(BASE + path, {
		method,
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${token}`,
			'X-GitHub-Api-Version': '2022-11-28',
			...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
		},
		...(data === undefined ? {} : { body: JSON.stringify(data) }),
	});
	const result = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}: ${String(result.message || '').slice(0, 240)}`);
	return result;
}

async function installationToken() {
	const appId = process.env.FRIDAY_REVIEW_APP_ID;
	const installationId = process.env.FRIDAY_REVIEW_INSTALLATION_ID;
	const keyPath = process.env.FRIDAY_REVIEW_PRIVATE_KEY_PATH;
	if (!/^\d+$/.test(appId || '') || !/^\d+$/.test(installationId || '') || !keyPath)
		throw new Error('FRIDAY_REVIEW_APP_ID, INSTALLATION_ID and PRIVATE_KEY_PATH are required');
	const details = await stat(keyPath);
	if (!details.isFile() || (details.mode & 0o077)) throw new Error('App private key must be a regular owner-only file (mode 0600)');
	const pem = await readFile(keyPath, 'utf8');
	const token = await api(`/app/installations/${installationId}/access_tokens`, jwt(appId, pem), 'POST', {
		repositories: ['BitstreamBluffs'], permissions: installationPermissions(),
	});
	if (!token.token) throw new Error('No App installation token returned');
	return token.token;
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length !== 2 || args[0] !== '--evidence') throw new Error('Usage: node tools/review-gate/publish.mjs --evidence FILE');
	const evidencePath = args[1];
	const evidenceStat = await stat(evidencePath);
	if (!evidenceStat.isFile() || evidenceStat.size > 35000) throw new Error('Evidence must be a regular file <= 35 KB');
	const evidence = validateEvidence(JSON.parse(await readFile(evidencePath, 'utf8')));
	const token = await installationToken();
	const installation = await api('/installation', token);
	if (installation.app_slug !== slug || installation.account?.login !== 'truevox')
		throw new Error('Unexpected GitHub App installation identity or owner');
	const base = `/repos/${repo}`;
	assertPrHead(await api(`${base}/pulls/${evidence.pr}`, token), evidence);
	const posted = await api(`${base}/pulls/${evidence.pr}/reviews`, token, 'POST', {
		commit_id: evidence.headSha, event: reviewEvent(evidence.verdict), body: reviewBody(evidence),
	});
	const expectedBot = `${slug}[bot]`;
	if (posted.user?.login !== expectedBot || posted.commit_id?.toLowerCase() !== evidence.headSha ||
		posted.state !== ({ approve:'APPROVED', changes_requested:'CHANGES_REQUESTED', hold:'COMMENTED' })[evidence.verdict])
		throw new Error('GitHub review did not have expected bot identity, commit or state; no passing check published');
	// A push during the review means a verdict on this old head cannot certify the new one.
	assertPrHead(await api(`${base}/pulls/${evidence.pr}`, token), evidence);
	const conclusion = checkConclusion(evidence.verdict);
	await api(`${base}/check-runs`, token, 'POST', {
		name: CHECK_NAME, head_sha: evidence.headSha, status: 'completed', conclusion,
		external_id: `pr-${evidence.pr}-review-${posted.id}`,
		details_url: `https://github.com/${repo}/pull/${evidence.pr}`,
		output: { title: `Independent review: ${evidence.verdict}`,
			summary: `Reviewed exact head ${evidence.headSha} by ${expectedBot}. Review #${posted.id}. ${evidence.summary.slice(0, 1000)}` },
	});
	console.log(`Published ${conclusion} ${CHECK_NAME} on PR #${evidence.pr} at ${evidence.headSha}`);
}

main().catch(e => { console.error('Review gate failed closed:', e.message); process.exitCode = 1; });
