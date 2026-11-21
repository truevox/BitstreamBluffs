import {stemCategory,variantSourceUrl,canonicalStemUrl,MONO_PRESETS,
  targetKbps,ffmpegMonoArgs,encodeMonoVariants} from '../../tools/pwa/mono-stem-variants.mjs';

const root='/music/packs/33_local-one-more-run-bitstream-bluffs/';
const sample=(suffix)=>root+suffix;
test('all six stem families retain independent source paths and instrumental rate choices',()=>{
  for(const [file,category] of Object.entries({
    '0000-vocals.ogg':'vocals','0000-drums.ogg':'drums','0000-bass.ogg':'bass',
    '0000-guitar.ogg':'guitar','0000-piano.ogg':'piano','0000-other.ogg':'other',
    '0000-voice-home.ogg':'lead','adaptive/debumont/melody-0000.ogg':'lead',
    'adaptive/debumont/featured-0000.ogg':'adaptive',
  })){
    expect(stemCategory(sample(file))).toBe(category);
    expect(targetKbps(sample(file),'lite')).toBe(MONO_PRESETS.lite[category]);
    expect(targetKbps(sample(file),'full')).toBe(MONO_PRESETS.full[category]);
    expect(variantSourceUrl(sample(file),'lite')).toBe('/music-variants/lite/packs/33_local-one-more-run-bitstream-bluffs/'+file);
  }
  expect(targetKbps(sample('0000-drums.ogg'),'lite',{
    [sample('0000-drums.ogg')]:36,
  })).toBe(36);
});

test('all derivative URLs are same-origin only, no path escapes or arbitrary qualities',()=>{
  for(const invalid of [null,'','/music/packs/abc/../../bad.ogg','/music/packs/x/../y.ogg',
    '/music/packs/foo/song.js','https://bad.example/music/packs/abc/0000-bass.ogg',
    '/music/packs/abc/0000-bass.ogg?version=2','/music/packs/abc/0000-bass.ogg#fragment',
    '/music/packs/abc/0000-bass.ogg\\secret']){
    expect(()=>canonicalStemUrl(invalid)).toThrow();
  }
  expect(()=>variantSourceUrl(sample('0000-bass.ogg'),'auto')).toThrow();
  expect(()=>targetKbps(sample('0000-bass.ogg'),'lite',{[sample('0000-bass.ogg')]:0})).toThrow();
  expect(()=>targetKbps(sample('0000-bass.ogg'),'lite',{[sample('0000-bass.ogg')]:129})).toThrow();
});

test('ffmpeg encodes real individual mono Opus and preserves 48k clock',()=>{
  const args=ffmpegMonoArgs('/private/original.ogg','/tmp/private-variant.ogg',16);
  expect(args).toContain('0:a:0');
  expect(args).toContain('libopus');
  expect(args.at(-1)).toBe('/tmp/private-variant.ogg');
  expect(args.slice(args.indexOf('-ac'),args.indexOf('-ac')+2)).toEqual(['-ac','1']);
  expect(args.slice(args.indexOf('-ar'),args.indexOf('-ar')+2)).toEqual(['-ar','48000']);
  expect(args.slice(args.indexOf('-b:a'),args.indexOf('-b:a')+2)).toEqual(['-b:a','16k']);
});

test('source masters can never share a tree with derivative outputs',async()=>{
  const u=sample('0000-bass.ogg');
  for(const outputRoot of ['/media/source','/media/source/variants','/media']){
    await expect(encodeMonoVariants({urls:[u],quality:'lite',sourceRoot:'/media/source',outputRoot}))
      .rejects.toThrow('must be disjoint');
  }
});
