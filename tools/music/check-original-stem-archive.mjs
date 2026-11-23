#!/usr/bin/env node
/**
 * Read-only audit of every source OGG referenced by the existing release
 * manifests against the archival original OGG bank. NEVER copies, rewrites,
 * hard-links or rescores any media. External media is intentionally NOT
 * expected to exist in CI; run this on an authorized music-storage host.
 *
 * node tools/music/check-original-stem-archive.mjs [--manifest-packs dir] [--media-packs dir]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const arg=(name,fallback)=>{
	const i=process.argv.indexOf(name);
	if(i<0)return fallback;
	if(!process.argv[i+1]||process.argv[i+1].startsWith('--'))throw Error('Missing '+name+' value');
	return path.resolve(process.argv[i+1]);
};
const manifests=arg('--manifest-packs',path.join(project,'public/music/packs'));
const archive=arg('--media-packs',path.join(
	process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local/share'),
	'bitstream-static-music-v1/packs'));
const pathSafe=value=>typeof value==='string'&&value.length<300&&
	!value.startsWith('/')&&!value.includes('\\')&&!value.split('/').includes('..')&&
	/^[A-Za-z0-9_.\/-]+$/.test(value);

let total=0,present=0,oldNames=0,broken=0,packs=0;
for(const folder of fs.readdirSync(manifests,{withFileTypes:true})){
	if(!folder.isDirectory()||!pathSafe(folder.name))continue;
	const file=path.join(manifests,folder.name,'pack.json');
	if(!fs.existsSync(file))continue;
	packs++;
	const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
	const all=new Set();
	for(const segment of manifest.segments||[])
		for(const value of Object.values(segment.sources||{}))all.add(value);
	for(const groups of Object.values(manifest.adaptive?.variants||{}))
		for(const paths of Object.values(groups))
			if(Array.isArray(paths))for(const value of paths)all.add(value);
	let available=0,legacy=0,missing=0;
	for(const originalPath of all){
		if(!pathSafe(originalPath)){
			console.error('UNSAFE',folder.name,JSON.stringify(originalPath));
			missing++;continue;
		}
		const current=path.join(archive,folder.name,originalPath);
		// This is the SAME fallback used by the runtime on a confirmed 404;
		// no other legacy or missing song files are silently substituted.
		const oldPath=originalPath.startsWith('adaptive/debutmont/')
			?originalPath.replace(/^adaptive\/debutmont\//,'adaptive/debumont/') : null;
		if(fs.existsSync(current)&&fs.statSync(current).isFile())available++;
		else if(oldPath&&fs.existsSync(path.join(archive,folder.name,oldPath))&&
			fs.statSync(path.join(archive,folder.name,oldPath)).isFile())legacy++;
		else{
			missing++;
			console.error('MISSING',folder.name,originalPath);
		}
	}
	total+=all.size;present+=available;oldNames+=legacy;broken+=missing;
	console.log(`${folder.name}\trefs=${all.size}\tpresent=${available}\told-debumont=${legacy}\tmissing=${missing}`);
}
console.log(`TOTAL packs=${packs} refs=${total} present=${present} old-debumont=${oldNames} missing=${broken}`);
if(!packs||broken)process.exitCode=1;
