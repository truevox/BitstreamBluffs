#!/usr/bin/env node
// Invoke only from a trusted, separately controlled publisher runtime.
import { createSign } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { reconcilePullRequest, installationPermissions, assertInstallationIdentity } from './logic.mjs';

const [mode, arg, ...extra] = process.argv.slice(2);
if (!['--dry-run', '--apply'].includes(mode) || !/^\d+$/.test(arg || '') || extra.length) throw new Error('Usage: reconcile.mjs --dry-run|--apply PR_NUMBER');
const appId = process.env.FRIDAY_REVIEW_APP_ID;
const installationId = process.env.FRIDAY_REVIEW_INSTALLATION_ID;
const slug = process.env.FRIDAY_REVIEW_APP_SLUG;
const keyPath = process.env.FRIDAY_REVIEW_PRIVATE_KEY_PATH;
if (!/^\d+$/.test(appId || '') || !/^\d+$/.test(installationId || '') || !/^[a-z\d-]{2,80}$/.test(slug || '') || !keyPath)
	throw new Error('App ID, installation ID, slug, and private key path are required');
const info = await stat(keyPath);
if (!info.isFile() || (info.mode & 0o077)) throw new Error('App key must be an owner-only file');
const pem = await readFile(keyPath, 'utf8');
const now = Math.floor(Date.now() / 1000);
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const msg = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: appId, iat: now - 60, exp: now + 480 })}`;
const jwt = `${msg}.${createSign('RSA-SHA256').update(msg).end().sign(pem).toString('base64url')}`;
async function request(path, token, method = 'GET', data) {
	const response = await fetch(`https://api.github.com${path}`, { method, headers: {
		Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
		'X-GitHub-Api-Version': '2022-11-28', ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
	}, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
	const result = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}: ${String(result.message || '').slice(0, 240)}`);
	return result;
}
const app = await request('/app', jwt);
if (app.id !== Number(appId) || app.slug !== slug) throw new Error('Unexpected app identity');
assertInstallationIdentity(await request(`/app/installations/${installationId}`, jwt), Number(appId), slug);
const scoped = await request(`/app/installations/${installationId}/access_tokens`, jwt, 'POST', { repositories: ['BitstreamBluffs'], permissions: installationPermissions() });
if (!scoped.token) throw new Error('No installation token returned');
const api = async (path, method = 'GET', data) => {
	if (mode === '--dry-run' && method !== 'GET') {
		console.log(`Would invalidate ${path}`);
		return {};
	}
	return request(path, scoped.token, method, data);
};
const invalidated = await reconcilePullRequest({ number: Number(arg), bot: `${slug}[bot]`, appId: Number(appId), api });
console.log(`${mode === '--dry-run' ? 'Would invalidate' : 'Invalidated'} ${invalidated.length} stale check(s) on PR #${arg}`);
