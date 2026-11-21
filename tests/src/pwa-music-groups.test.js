import { currentlyNeededBiomes, upcomingBiomePrefetch, songOfflineGroups, selectedMusicGroupPlan } from '../../tools/pwa/music-groups.mjs';

const catalog = { format:'bitstream-music-catalog-v1',tracks:[
  {id:'a',title:'A',manifest:'packs/aa/pack.json'},
  {id:'b',title:'B',manifest:'packs/bb/pack.json'},
]};
const pack = (id) => ({format:'bitstream-music-pack-v1',id,frameCount:48000,sampleRate:48000,
  segments:[{startFrame:0,frames:48000,sources:{
    bass:'0-bass.ogg',drums:'0-drums.ogg',guitar:'0-guitar.ogg',other:'0-other.ogg',piano:'0-piano.ogg',vocals:'0-vocals.ogg',
    'voice:bitstream-bluffs':'0-home.ogg','voice:debumont':'0-debumont.ogg',
    'voice:garbage-dump-glacier':'0-garbage.ogg','voice:pyramid-peak':'0-pyramid.ogg',
  }}], adaptive:{featuredStem:'guitar',variants:{
    featured:{debumont:['adaptive/debumont/featured-0.ogg'], 'garbage-dump-glacier':['adaptive/garbage/featured-0.ogg']},
    bass:{},drums:{},guitar:{},piano:{},other:{},
  }}, captions:'captions.json'});
const packs={a:pack('a'),b:pack('b')};
const defs=[
  {id:'debumont',unlockLevel:4},{id:'garbage-dump-glacier',unlockLevel:7},{id:'pyramid-peak',unlockLevel:10},
];

test('menu lead available pre-unlock, and only owned AND switched-on run biomes are mandatory',()=>{
  expect(currentlyNeededBiomes()).toEqual(['debumont']);
  expect(currentlyNeededBiomes({unlockedBiomeIds:['garbage-dump-glacier','pyramid-peak'],enabledBiomeIds:['garbage-dump-glacier']})).toEqual(['debumont','garbage-dump-glacier']);
});

test('prefetch upcoming BONUS before the unlock: unlocked does not block priority for next locked biome',()=>{
  // Debumont lead is mandatory for the menu already, so prefetch the next *new* biome.
  expect(upcomingBiomePrefetch({currentLevel:1,biomeDefs:defs,unlockedBiomeIds:[]})).toEqual(['garbage-dump-glacier']);
  expect(upcomingBiomePrefetch({currentLevel:5,biomeDefs:defs,unlockedBiomeIds:['debumont']})).toEqual(['garbage-dump-glacier']);
  expect(upcomingBiomePrefetch({currentLevel:7,biomeDefs:defs,unlockedBiomeIds:['debumont','garbage-dump-glacier']})).toEqual(['pyramid-peak']);
  expect(upcomingBiomePrefetch({currentLevel:11,biomeDefs:defs,unlockedBiomeIds:['debumont','garbage-dump-glacier','pyramid-peak']})).toEqual([]);
});

test('normal mode requires real base and relevant biome leads, no unused dynamic arrangements',()=>{
  const x=songOfflineGroups(catalog.tracks[0],packs.a,{unlockedBiomeIds:['garbage-dump-glacier'],enabledBiomeIds:['garbage-dump-glacier']});
  expect(x.required.map(z=>z.id)).toEqual(['a:base','a:lead:debumont','a:lead:garbage-dump-glacier']);
  expect(x.required[0].files).toContain('/music/packs/aa/0-bass.ogg');
  expect(x.required[0].files).toContain('/music/packs/aa/0-home.ogg');
  expect(x.required[0].files).not.toContain('/music/packs/aa/0-pyramid.ogg');
  expect(x.required.flatMap(z=>z.files)).not.toContain('/music/packs/aa/adaptive/debumont/featured-0.ogg');
});

test('dynamic orchestra ON requires its real variant recordings for currently used biomes',()=>{
  const x=songOfflineGroups(catalog.tracks[0],packs.a,{dynamicOrchestra:true});
  expect(x.required.map(z=>z.id)).toContain('a:orchestra:debumont');
  expect(x.required.flatMap(z=>z.files)).toContain('/music/packs/aa/adaptive/debumont/featured-0.ogg');
  expect(x.required.flatMap(z=>z.files)).not.toContain('/music/packs/aa/adaptive/garbage/featured-0.ogg');
});

test('opportunistic pre-unlock bonus not counted for offline readiness; disabled songs never prefetched',()=>{
  const x=selectedMusicGroupPlan(catalog,packs,{
    selection:{b:false}, unlockedBiomeIds:['debumont'],enabledBiomeIds:['debumont'],
    currentLevel:5, biomeDefs:defs,prefetchNextBiome:true,dynamicOrchestra:true,
  });
  expect(x.offlineReadyRequiresBonus).toBe(false);
  expect(x.songs.map(s=>s.songId)).toEqual(['a']);
  expect(x.nextBiomes).toEqual(['garbage-dump-glacier']);
  expect(x.songs[0].bonus.map(y=>y.id)).toEqual(['a:lead:garbage-dump-glacier','a:orchestra:garbage-dump-glacier']);
  expect(x.songs[0].required.some(y=>y.id.includes('garbage-dump-glacier'))).toBe(false);
});

test('prefetched bonus becomes required when biome actually unlocks and is enabled',()=>{
  const ahead=selectedMusicGroupPlan(catalog,packs,{selection:{b:false},currentLevel:5,biomeDefs:defs,unlockedBiomeIds:['debumont'],enabledBiomeIds:['debumont'],prefetchNextBiome:true});
  const after=selectedMusicGroupPlan(catalog,packs,{selection:{b:false},currentLevel:7,biomeDefs:defs,unlockedBiomeIds:['debumont','garbage-dump-glacier'],enabledBiomeIds:['debumont','garbage-dump-glacier'],prefetchNextBiome:true});
  const prefetched=new Set(ahead.songs[0].bonus.flatMap(z=>z.files));
  const mandatory=new Set(after.songs[0].required.flatMap(z=>z.files));
  for(const file of prefetched) expect(mandatory.has(file)).toBe(true);
});
