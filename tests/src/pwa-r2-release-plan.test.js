import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {planPublishedMusic,RELEASE_CATALOG} from '../../tools/pwa/r2-release-plan.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const pack=id=>({format:'bitstream-music-pack-v1',id,frameCount:48000,sampleRate:48000,segments:[{startFrame:0,frames:48000,sources:Object.fromEntries(['bass','drums','guitar','other','piano','vocals','voice:debutmont'].map(k=>[k,k.replace(':','-')+'.ogg']))}]});
function fixture(){
 const tracks=['a','b'].map(id=>({id,title:id,manifest:`packs/${id}/pack.json`}));
 const catalog=Buffer.from(JSON.stringify({format:'bitstream-music-catalog-v1',tracks}));
 const packs=Object.fromEntries(tracks.map(t=>[t.id,Buffer.from(JSON.stringify(pack(t.id)))]));
 const files=[['catalog.json',catalog],...tracks.flatMap(t=>[[t.manifest,packs[t.id]],...Object.values(pack(t.id).segments[0].sources).map(f=>[`packs/${t.id}/${f}`,Buffer.from(f)])])];
 const objects=files.map(([key,b])=>({key,size:b.length,sha256:sha(b)}));
 return {catalog,packs,publication:{format:'bsb-runtime-music-publication-v1',publicBaseCommit:'69a6fb4674335d2496a801ddd7dcaabcb0a4a8bd',tracks:2,objects,totalBytes:objects.reduce((n,e)=>n+e.size,0)}};
}
test('maps only selected original groups to exact versioned R2 URLs and hash inventory',()=>{
 const {publication,catalog,packs}=fixture(); const p=planPublishedMusic(publication,catalog,{a:packs.a},{selection:{b:false}});
 expect(p.catalog.url).toBe(RELEASE_CATALOG);expect(p.groups.map(g=>g.id)).toEqual(['a:base','a:lead:debutmont']);
 expect(p.groups.flatMap(g=>g.entries).every(e=>e.url.startsWith(new URL('packs/a/',RELEASE_CATALOG).href))).toBe(true);
 expect(p.requiredBytes).toBe(p.groups.reduce((n,g)=>n+g.totalBytes,0));
});
test('rejects tampered catalogs, pack bytes, missing media, duplicate paths and wrong releases',()=>{
 const {publication,catalog,packs}=fixture();
 expect(()=>planPublishedMusic(publication,Buffer.from('{}'),packs)).toThrow(/JSON mismatch/);
 expect(()=>planPublishedMusic(publication,catalog,{...packs,a:Buffer.from('{}')})).toThrow(/JSON mismatch/);
 const objects=publication.objects.filter(e=>e.key!=='packs/a/bass.ogg');
 expect(()=>planPublishedMusic({...publication,objects,totalBytes:objects.reduce((n,e)=>n+e.size,0)},catalog,packs)).toThrow(/Unpublished required object/);
 expect(()=>planPublishedMusic({...publication,objects:[...publication.objects,publication.objects[0]]},catalog,packs)).toThrow(/Invalid publication object/);
 expect(()=>planPublishedMusic({...publication,publicBaseCommit:'other'},catalog,packs)).toThrow(/Wrong publication/);
});
