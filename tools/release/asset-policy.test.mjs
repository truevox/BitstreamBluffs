import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { forbiddenAssetPath, inspectDistribution, stageApprovedPublic } from './asset-policy.mjs';

function fixture(fn) {
	const root = mkdtempSync(join(tmpdir(), 'bb-release-safety-'));
	try { return fn(root); }
	finally { rmSync(root, { recursive: true, force: true }); }
}

test('model weight/checkpoint paths are refused, including in the Git index', () => {
	for (const path of [
		'model.safetensors', 'public/music/adapter_model.safetensors',
		'public/assets/weights.onnx', 'opt/model.ckpt',
		'public/music/local-tower.pt', 'tools/something/model.pth',
		'models--m-a-p--SheetSage2/model.json', 'public/music/checkpoints/config.json',
		'weights.bin', 'research/f0.npz', 'hf-cache/config.json',
		'public/music-audition-v3/some.ogg',
		'public/music-full-one-more-run/candidate.ogg',
	]) assert.ok(forbiddenAssetPath(path), path);
});

test('intended runtime music packs and public UI assets remain valid', () => {
	for (const path of [
		'public/music/catalog.json', 'public/music/packs/abc/0000-vocals.ogg',
		'public/docs/instructions.html', 'public/assets/extraLife.png',
		'public/streamers.html', 'src/systems/music/MusicPack.js',
	]) assert.equal(forbiddenAssetPath(path), null, path);
});

test('only approved public trees are staged; private auditions are omitted', () => fixture(root => {
	const source = join(root, 'public');
	const dist = join(root, 'dist');
	for (const name of ['assets', 'docs', 'music', 'music-audition-ace15',
		'music-full-pope', 'music-transcription-audition']) mkdirSync(join(source, name), { recursive: true });
	writeFileSync(join(source, 'favicon.ico'), 'ico');
	writeFileSync(join(source, 'streamers.html'), 'streamer permission');
	writeFileSync(join(source, 'assets', 'extraLife.png'), 'png');
	writeFileSync(join(source, 'docs', 'instructions.html'), 'docs');
	writeFileSync(join(source, 'music', 'catalog.json'), '{"format":"bitstream-music-catalog-v1","tracks":[]}');
	writeFileSync(join(source, 'music-audition-ace15', 'cover.ogg'), 'private');
	writeFileSync(join(source, 'music-full-pope', 'organ.ogg'), 'private');
	writeFileSync(join(source, 'music-transcription-audition', 'score.json'), '{}');
	mkdirSync(dist);
	assert.equal(stageApprovedPublic(source, dist), 5);
	assert.ok(existsSync(join(dist, 'streamers.html')));
	assert.ok(existsSync(join(dist, 'music', 'catalog.json')));
	assert.ok(!existsSync(join(dist, 'music-full-pope')));
	assert.ok(!existsSync(join(dist, 'music-audition-ace15')));
	assert.ok(!existsSync(join(dist, 'music-transcription-audition')));
	assert.deepEqual(inspectDistribution(dist).failures, []);
}));

test('release staging fails closed if a model checkpoint hides inside production music', () => fixture(root => {
	const source = join(root, 'public');
	const dist = join(root, 'dist');
	mkdirSync(join(source, 'music'), { recursive: true });
	mkdirSync(dist);
	writeFileSync(join(source, 'music', 'mert.safetensors'), 'MERT');
	assert.throws(() => stageApprovedPublic(source, dist), /Blocked pretrained model\/checkpoint extension/);
}));

test('release staging rejects unapproved content instead of silently publishing it', () => fixture(root => {
	const source = join(root, 'public');
	const dist = join(root, 'dist');
	mkdirSync(join(source, 'music'), { recursive: true });
	mkdirSync(dist);
	writeFileSync(join(source, 'music', 'new-tracks.zip'), 'private zip');
	assert.throws(() => stageApprovedPublic(source, dist), /Unapproved release asset type/);
}));

test('release staging rejects symlink escapes', () => fixture(root => {
	const source = join(root, 'public');
	const dist = join(root, 'dist');
	mkdirSync(join(source, 'music'), { recursive: true });
	mkdirSync(dist);
	const outside = join(root, 'outside.json');
	writeFileSync(outside, '{}');
	symlinkSync(outside, join(source, 'music', 'catalog.json'));
	assert.throws(() => stageApprovedPublic(source, dist), /Symlink in release assets/);
}));

test('distribution gate detects model weights and private lab directories', () => fixture(root => {
	const dist = join(root, 'dist');
	mkdirSync(join(dist, 'assets'), { recursive: true });
	mkdirSync(join(dist, 'music-full-one-more-run'), { recursive: true });
	writeFileSync(join(dist, 'assets', 'adapter_model.safetensors'), 'checkpoint');
	writeFileSync(join(dist, 'music-full-one-more-run', 'render.ogg'), 'private');
	const reasons = inspectDistribution(dist).failures.join('\n');
	assert.match(reasons, /adapter_model.safetensors/);
	assert.match(reasons, /music-full-one-more-run/);
}));
