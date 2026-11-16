/**
 * Explicit release allowlist. Private music labs and model runtimes
 * must NEVER be copied to a shippable Vite build.
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { join, relative, sep, extname, basename } from 'node:path';

export const MODEL_EXTENSIONS = new Set([
	'.safetensors', '.gguf', '.ggml', '.pt', '.pth', '.ckpt', '.onnx', '.tflite',
	'.h5', '.hdf5', '.mlmodel', '.pte', '.pkl', '.pickle', '.joblib',
]);
const MODEL_SEGMENTS = new Set([
	'checkpoints', 'model-checkpoints', 'model-weights', 'pretrained-weights',
	'weights', 'hf-cache', 'huggingface', 'hf-hub', 'models--m-a-p--sheetsage2',
]);
const EXPERIMENT_PREFIX = /^(?:music-(?:audition|full-|transcription-lab|transcription-audition)|(?:private|research|experiment|checkpoint|weights)(?:-|$))/i;

export function forbiddenAssetPath(input) {
	const path = String(input).replaceAll('\\', '/').replace(/^\.\//, '');
	const pieces = path.toLowerCase().split('/').filter(Boolean);
	const filename = pieces.at(-1) || '';
	const ext = extname(filename);
	if (MODEL_EXTENSIONS.has(ext)) return 'pretrained model/checkpoint extension';
	if (filename.endsWith('.bin') || filename.endsWith('.npz')) return 'binary model or analysis payload';
	if (pieces.some(x => MODEL_SEGMENTS.has(x))) return 'model weight/cache directory';
	if (pieces.some(x => x.startsWith('models--') || x.endsWith('.incomplete'))) return 'model download/cache';
	if (pieces[0] === 'public' && pieces.slice(1).some(x => EXPERIMENT_PREFIX.test(x))) {
		return 'private experimental media in public release tree';
	}
	return null;
}

const APPROVED_PUBLIC = Object.freeze({
	'assets': new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.ico', '.woff', '.woff2']),
	'docs': new Set(['.html', '.css', '.js', '.png', '.svg', '.webp']),
	'music': new Set(['.json', '.ogg', '.opus', '.mp3', '.wav', '.flac', '.vtt']),
});
const ROOT_FILES = new Set(['favicon.ico', 'streamers.html']);

/** No symlinks, weight/cache files, experimental dirs or unknown file types. */
export function stageApprovedPublic(publicPath, distPath) {
	let count = 0;
	function copyOne(from, to, display, allowed) {
		const source = lstatSync(from);
		if (source.isSymbolicLink()) throw new Error('Symlink in release assets: ' + display);
		if (source.isDirectory()) {
			if (!allowed) throw new Error('Unexpected release directory: ' + display);
			for (const entry of readdirSync(from)) {
				copyOne(join(from, entry), join(to, entry), display + '/' + entry, allowed);
			}
			return;
		}
		if (!source.isFile()) throw new Error('Unsupported release file: ' + display);
		const forbidden = forbiddenAssetPath(display);
		if (forbidden) throw new Error('Blocked ' + forbidden + ': ' + display);
		if (!allowed.has(extname(display).toLowerCase())) {
			throw new Error('Unapproved release asset type: ' + display);
		}
		mkdirSync(join(to, '..'), { recursive: true });
		copyFileSync(from, to);
		count++;
	}
	for (const name of ROOT_FILES) {
		const from = join(publicPath, name);
		if (existsSync(from)) {
			copyOne(from, join(distPath, name), 'public/' + name, new Set([extname(name)]));
		}
	}
	for (const [name, allowed] of Object.entries(APPROVED_PUBLIC)) {
		const from = join(publicPath, name);
		if (existsSync(from)) copyOne(from, join(distPath, name), 'public/' + name, allowed);
	}
	return count;
}

/** Refuse shipping runtime checkpoints even if a later build step adds one. */
export function inspectDistribution(distPath) {
	const failures = [];
	let count = 0;
	if (!existsSync(distPath)) throw new Error('Missing dist directory: ' + distPath);
	function visit(folder) {
		for (const entry of readdirSync(folder)) {
			const path = join(folder, entry);
			const rel = relative(distPath, path).split(sep).join('/');
			const info = lstatSync(path);
			const reason = forbiddenAssetPath(rel);
			if (reason) failures.push(rel + ': ' + reason);
			if (info.isSymbolicLink()) failures.push(rel + ': symlink forbidden in release');
			else if (info.isDirectory()) {
				if (EXPERIMENT_PREFIX.test(basename(path))) failures.push(rel + ': private lab directory');
				visit(path);
			} else if (info.isFile()) count++;
		}
	}
	visit(distPath);
	return { count, failures };
}
