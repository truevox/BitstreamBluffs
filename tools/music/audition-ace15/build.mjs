/** Build the voice audition and copy private audio test assets, outside Git. */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const source = resolve(root, 'public/music-audition-ace15');
const target = resolve(root, 'dist-music-audition-ace15/music-audition-ace15');
const manifestPath = join(source, 'gallery.json');
if (!existsSync(manifestPath)) {
	throw new Error('Missing private gallery audio: supply public/music-audition first');
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.format !== 'bitstream-voice-gallery-v1' || manifest.voices?.length !== 7) {
	throw new Error('Expected a 12-voice gallery');
}
for (const filename of [manifest.backing, manifest.originalVocal, ...manifest.voices.map(x => x.file)]) {
	if (!/^[a-z0-9-]+(?:-excerpt)?\.ogg$/.test(filename) || !existsSync(join(source, filename))) {
		throw new Error('Missing or invalid audition asset: ' + filename);
	}
}
const vite = resolve(root, 'node_modules/.bin/vite');
const build = spawnSync(vite, ['build', '--config', resolve(here, 'vite.config.js')], {
	cwd: root,
	stdio: 'inherit',
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
const count = readdirSync(target).filter(x => x.endsWith('.ogg')).length;
if (count < 13) throw new Error('Incomplete audition output');
console.log('ACE-Step 1.5 cover lab build complete:',target,'(' + count + ' audio previews)');
const live = resolve(root, 'dist-music-audition');
if (existsSync(live)) {
	cpSync(resolve(root,'dist-music-audition-ace15/assets'),resolve(live,'assets'),{recursive:true});
	cpSync(resolve(root,'dist-music-audition-ace15/tools/music/audition-ace15'),
		resolve(live,'tools/music/audition-ace15'),{recursive:true});
	cpSync(target,resolve(live,'music-audition-ace15'),{recursive:true});
	console.log('Published ACE-Step 1.5 local cover lab alongside previous labs:',live);
}
