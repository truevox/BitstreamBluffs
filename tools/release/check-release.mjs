#!/usr/bin/env node
/** Fast, zero-dependency prebuild/postbuild/CI gate. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forbiddenAssetPath, inspectDistribution } from './asset-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = new Set(process.argv.slice(2));
if (args.size && [...args].some(x => !['--git-only', '--dist-only'].includes(x))) {
	throw new Error('Usage: check-release.mjs [--git-only|--dist-only]');
}
if (args.has('--git-only') && args.has('--dist-only')) throw new Error('Choose one scan mode');
const gitOnly = args.has('--git-only');
const distOnly = args.has('--dist-only');
const problems = [];

if (!distOnly) {
	const raw = execFileSync('git', ['-C', root, 'ls-files', '--cached', '-z']);
	const paths = raw.toString('utf8').split('\0').filter(Boolean);
	for (const path of paths) {
		const reason = forbiddenAssetPath(path);
		if (reason) problems.push('Git index: ' + path + ' (' + reason + ')');
	}
	console.log('Git index inspected:', paths.length, 'tracked paths');
}
if (!gitOnly) {
	const dist = join(root, 'dist');
	const result = inspectDistribution(dist);
	problems.push(...result.failures.map(s => 'Release dist: ' + s));
	for (const name of ['streamers.html', 'assets/extraLife.png', 'docs/instructions.html']) {
		if (!existsSync(join(dist, name))) problems.push('Missing approved public asset: ' + name);
	}
	for (const name of ['music-audition', 'music-audition-ace15',
		'music-transcription-audition', 'music-full-pope', 'music-full-one-more-run']) {
		if (existsSync(join(dist, name))) problems.push('Private music lab leaked into release: ' + name);
	}
	if (existsSync(join(root, 'public/music/catalog.json')) &&
		!existsSync(join(dist, 'music/catalog.json'))) problems.push('Production music catalog missing');
	console.log('Production output inspected:', result.count, 'release files');
}
if (problems.length) {
	console.error('RELEASE BLOCKED:\n' + problems.map(x => ' - ' + x).join('\n'));
	process.exitCode = 1;
} else console.log('Release asset safety gate: PASS (no tracked/bundled weights or private labs)');
