import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRealMusicGroupManifest } from '../../tools/pwa/music-integrity-groups.mjs';
import { selectedMusicGroupPlan } from '../../tools/pwa/music-groups.mjs';
import { renderMusicRouteWorker } from '../../tools/pwa/music-route-worker.mjs';

const catalog={format:'bitstream-music-catalog-v1',tracks:[
	{id:'song1',title:'First song',manifest:'packs/alpha/pack.json'},
	{id:'song2',title:'Second song',manifest:'packs/beta/pack.json'},
]};
const pack=(id)=>({format:'bitstream-music-pack-v1',id,frameCount:48000,sampleRate:48000,
	segments:[{startFrame:0,frames:48000,sources:{
		vocals:'a-vocals.ogg',drums:'a-drums.ogg',bass:'a-bass.ogg',
		guitar:'a-guitar.ogg',piano:'a-piano.ogg',other:'a-other.ogg',
		'voice:bitstream-bluffs':'a-home.ogg','voice:debutmont':'a-debutmont.ogg',
		'voice:garbage-dump-glacier':'a-garbage.ogg',
	}}],
	adaptive:{featuredStem:'guitar',variants:{featured:{debutmont:['adaptive/debutmont/featured-0.ogg'],
		'garbage-dump-glacier':['adaptive/garbage/featured-0.ogg']}}},
	captions:'captions.json'});
const packs={song1:pack('song1'),song2:pack('song2')};
const opts={selection:{song1:true,song2:false},unlockedBiomeIds:[],enabledBiomeIds:[],
	currentLevel:5,biomeDefs:[{id:'debutmont',unlockLevel:4},{id:'garbage-dump-glacier',unlockLevel:7}],
	prefetchNextBiome:true,dynamicOrchestra:false};
test('only required real audio groups plus next-unlock bonus; every hash pins actual bytes',async()=>{
	const publicRoot=mkdtempSync(join(tmpdir(),'bsb-pwa-real-groups-'));
	try{
		const plan=selectedMusicGroupPlan(catalog,packs,opts);
		expect(plan.songs.map(x=>x.songId)).toEqual(['song1']);
		expect(plan.nextBiomes).toEqual(['garbage-dump-glacier']);
		const all=plan.songs.flatMap(x=>[...x.required,...x.bonus]);
		for(const group of all)for(const url of group.files){
			const abs=join(publicRoot,url);
			mkdirSync(join(abs,'..'),{recursive:true});
			writeFileSync(abs,'original-recording:'+url);
		}
		const a=await buildRealMusicGroupManifest(publicRoot,catalog,packs,opts);
		const b=await buildRealMusicGroupManifest(publicRoot,catalog,packs,opts);
		expect(a).toEqual(b);
		expect(a.groups.map(x=>[x.id,x.priority])).toEqual([
			['song1:base','required'],
			['song1:lead:debutmont','required'],
			['song1:lead:garbage-dump-glacier','bonus'],
		]);
		expect(a.groups.flatMap(x=>x.entries).every(x=>/^[a-f0-9]{64}$/.test(x.sha256))).toBe(true);
		expect(a.requiredBytes).toBeGreaterThan(a.bonusBytes);
		expect(a.groups.some(x=>x.id.startsWith('song2:'))).toBe(false);
		writeFileSync(join(publicRoot,'/music/packs/alpha/a-drums.ogg'),'changed-stem-bytes');
		const changed=await buildRealMusicGroupManifest(publicRoot,catalog,packs,opts);
		expect(changed.groups[0].version).not.toBe(a.groups[0].version);
		expect(changed.groups[1].version).toBe(a.groups[1].version);
	} finally {rmSync(publicRoot,{recursive:true,force:true});}
});

test('developer worker routes original recordings only from complete checked caches',()=>{
	const text=renderMusicRouteWorker();
	expect(text).toContain('bb-real-music-v1-');
	expect(text).toContain('offline-music-complete');
	expect(text).toContain('offline-music-integrity');
	expect(text).toContain("crypto.subtle.digest('SHA-256'");
	expect(text).toContain('VERIFIED_MUSIC_GROUPS.clear()');
	expect(text).not.toContain('clients.claim(');
	expect(text).not.toContain('skipWaiting(');
});
