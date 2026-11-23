import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const command=path.join(repo,'tools/music/check-original-stem-archive.mjs');
function scenario({omitLegacy=false,invalidPath=false}={}){
	const temp=mkdtempSync(path.join(tmpdir(),'bsb-original-stem-audit-'));
	try {
		const manifest=path.join(temp,'manifests','sample');
		const media=path.join(temp,'media','sample');
		mkdirSync(manifest,{recursive:true});
		mkdirSync(path.join(media,'adaptive','debumont'),{recursive:true});
		const originals=['0000-bass.ogg',invalidPath?'../escape.ogg':'adaptive/debutmont/melody-0000.ogg'];
		writeFileSync(path.join(manifest,'pack.json'),JSON.stringify({segments:[{sources:{bass:originals[0],melody:originals[1]}}]}));
		writeFileSync(path.join(media,'0000-bass.ogg'),'original test fixture');
		if(!omitLegacy)writeFileSync(path.join(media,'adaptive','debumont','melody-0000.ogg'),'archived test fixture');
		return spawnSync(process.execPath,[command,'--manifest-packs',path.join(temp,'manifests'),
			'--media-packs',path.join(temp,'media')],{encoding:'utf8'});
	} finally {rmSync(temp,{recursive:true,force:true});}
}

describe('Original song-pack archive validator never copies or replaces media',()=>{
	test('reports only the exact old Debumont audio filename as a recoverable legacy path',()=>{
		const run=scenario();
		expect(run.status).toBe(0);
		expect(run.stdout).toContain('packs=1 refs=2 present=1 old-debumont=1 missing=0');
		expect(run.stderr).toBe('');
	});
	test('missing physically stored audio makes audit fail closed',()=>{
		const run=scenario({omitLegacy:true});
		expect(run.status).toBe(1);
		expect(run.stdout).toContain('missing=1');
		expect(run.stderr).toContain('MISSING sample adaptive/debutmont/melody-0000.ogg');
	});
	test('unsafe paths cannot leave the original-media archive root',()=>{
		const run=scenario({invalidPath:true});
		expect(run.status).toBe(1);
		expect(run.stderr).toContain('UNSAFE sample "../escape.ogg"');
	});
});
