#!/usr/bin/env node
/**
 * QA-only LOOPBACK Vite server with READ-ONLY overlay for the owner's
 * private source OGGs. No media copied to publicDir, committed, or uploaded.
 */
import {createServer} from 'vite';
import {createReadStream,existsSync,statSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {assertPrivateAudioQaLoopbackHost,isPrivateQaRequestHost} from './private-qa-loopback.js';
const root=process.env.BSB291_PRIVATE_AUDIO_ROOT;
if(!root||!existsSync(join(root,'catalog.json'))||!existsSync(join(root,'packs')))
	throw Error('Set BSB291_PRIVATE_AUDIO_ROOT to verified private media');
const host=assertPrivateAudioQaLoopbackHost(process.env.BSB291_HOST||'127.0.0.1');
const port=Number(process.env.BSB291_PORT||8220);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid private QA port');
const media=resolve(root);
const gridFile=process.env.BSB312_GRID_FILE ? resolve(process.env.BSB312_GRID_FILE) :
	new URL('../../public/music/transition-grids.json',import.meta.url).pathname;
const plugin={
	name:'qa-private-original-media-overlay',enforce:'pre',
	configureServer(vite){
		vite.middlewares.use((req,res,next)=>{
			let url;
			try{url=decodeURIComponent((req.url||'').split('?')[0]);}
			catch{res.writeHead(400);res.end();return}
			if(!url.startsWith('/music/packs/')&&url!=='/music/catalog.json'&&url!=='/music/transition-grids.json')return next();
			if(!isPrivateQaRequestHost(req.headers.host,host,port)){
				res.writeHead(403);res.end();return;
			}
			if(req.method!=='GET'&&req.method!=='HEAD'){
				res.writeHead(405);res.end();return;
			}
			const pieces=url.split('/').filter(Boolean);
			if(pieces.some(x=>!/^[-_A-Za-z0-9.]+$/.test(x)||x==='.'||x==='..')){
				res.writeHead(400);res.end();return;
			}
			const file=url==='/music/transition-grids.json'?gridFile:resolve(media,...pieces.slice(1));
			if(!file){res.writeHead(404);res.end();return;}
			if(file!==gridFile&&!file.startsWith(media+sep)){res.writeHead(403);res.end();return}
			if(!/\.(ogg|json)$/.test(file)||!existsSync(file)||!statSync(file).isFile()){
				res.writeHead(404);res.end();return;
			}
			res.setHeader('Content-Type',file.endsWith('.ogg')?'audio/ogg':'application/json; charset=utf-8');
			res.setHeader('Cache-Control','private, no-store');
			res.setHeader('X-Content-Type-Options','nosniff');
			res.setHeader('Content-Length',statSync(file).size);
			res.writeHead(200);
			if(req.method==='HEAD'){res.end();return}
			createReadStream(file).pipe(res);
		});
	}
};
const server=await createServer({
	configFile:'vite.config.js',plugins:[plugin],
	server:{host,port,strictPort:true,open:false}
});
await server.listen();
console.log('OWNER_PRIVATE_MIX_QA',host,port,
	'private media supplied outside Git; no private masters in publicDir');
