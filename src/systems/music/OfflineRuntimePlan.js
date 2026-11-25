/** Browser-only compact index expansion; no network or audio side effects. */
const BASE='https://bsb-audio.bearcave.win/releases/20261124-melody-only-748a0670/';
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const size=x=>Number.isSafeInteger(x)&&x>0;
const key=x=>typeof x==='string'&&/^packs\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.\/-]+$/.test(x)&&!x.split('/').some(p=>!p||p==='.'||p==='..');
const hex=x=>[...new Uint8Array(x)].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function expandOfflineRuntimePlan(index,{selection={},unlockedBiomeIds=[],enabledBiomeIds=[],nextBiome=null,subtle=globalThis.crypto?.subtle}={}){
 if(index?.format!=='bb-melody-runtime-index-v1'||index.release!==BASE||!Array.isArray(index.groups)||!Array.isArray(index.catalog)||!size(index.catalog[0])||!hash(index.catalog[1])||!subtle)throw Error('Invalid offline runtime index');
 const owned=new Set(unlockedBiomeIds),enabled=new Set(enabledBiomeIds),groups=[],seen=new Set();
 for(const tuple of index.groups){if(!Array.isArray(tuple)||tuple.length!==3)throw Error('Invalid runtime group');const [id,quality,rows]=tuple;const match=/^([A-Za-z0-9_-]+):(base|lead:([A-Za-z0-9_-]+))$/.exec(id);if(!match||!['lite','full'].includes(quality)||!Array.isArray(rows)||!rows.length||seen.has(id+':'+quality))throw Error('Invalid runtime group identity');seen.add(id+':'+quality);const [,song,,biome]=match;
  if(selection[song]===false)continue;
  const required=!biome||biome==='debutmont'||(owned.has(biome)&&enabled.has(biome));if(!required&&biome!==nextBiome)continue;
  const paths=new Set(),entries=rows.map(row=>{if(!Array.isArray(row)||!key(row[0])||!size(row[1])||!hash(row[2])||paths.has(row[0]))throw Error('Invalid runtime recording');const [path,bytes,sha256,sourceSha256,frames]=row;paths.add(path);const logicalUrl=BASE+path;if(path.endsWith('.ogg')){if(row.length!==5||!hash(sourceSha256)||!size(frames))throw Error('Invalid runtime derivative');return {url:BASE+'music-variants/'+quality+'/'+path,bytes,sha256,logicalUrl,sourceSha256,frames};}if(row.length!==3)throw Error('Invalid runtime metadata');return {url:logicalUrl,bytes,sha256,logicalUrl};});
  const version=hex(await subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(entries)))).slice(0,20);groups.push({id:id+':'+quality,originalId:id,songId:song,priority:required?'required':'bonus',quality,entries,version,bytes:entries.reduce((n,e)=>n+e.bytes,0)});
 }
 const downloads=[];for(const priority of ['required','bonus'])for(const quality of ['lite','full'])downloads.push(...groups.filter(g=>g.priority===priority&&g.quality===quality));
 return {format:'bb-melody-candidate-plan-v1',release:BASE,publicationReady:false,mode:'high',catalog:{url:BASE+'catalog.json',bytes:index.catalog[0],sha256:index.catalog[1]},groups,downloads,bytes:downloads.reduce((n,g)=>n+g.bytes,0)};
}
