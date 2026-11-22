import {mkdtempSync,writeFileSync,mkdirSync,linkSync,readFileSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
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
  expect(args).toContain('-n'); // Never overwrite a preexisting derivative/hardlink.
  expect(args).not.toContain('-y');
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


test('a hardlinked derivative never overwrites or truncates its source file',async()=>{
  const temp=mkdtempSync(join(tmpdir(),'bb-mono-no-overwrite-'));
  const sourceRoot=join(temp,'source'),outRoot=join(temp,'output');
  const original=join(sourceRoot,'music/packs/33_local-one-more-run-bitstream-bluffs/0000-bass.ogg');
  const derivative=join(outRoot,'music-variants/lite/packs/33_local-one-more-run-bitstream-bluffs/0000-bass.ogg');
  const probeScript=join(temp,'fake-ffprobe');
  const encodeScript=join(temp,'fake-ffmpeg');
  try{
    mkdirSync(dirname(original),{recursive:true});mkdirSync(dirname(derivative),{recursive:true});
    writeFileSync(original,'SENTINEL ORIGINAL STEREO MASTER DO NOT TOUCH');
    linkSync(original,derivative); // different directories, SAME inode, worst case.
    writeFileSync(probeScript,'#!/usr/bin/env node\nconsole.log(JSON.stringify({streams:[{codec_name:"opus",channels:2,sample_rate:"48000"}],format:{duration:"12"}}))\n');
    writeFileSync(encodeScript,'#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.argv.at(-1),"CORRUPTED")\n');
    chmodSync(probeScript,0o755);chmodSync(encodeScript,0o755);
    await expect(encodeMonoVariants({urls:[sample('0000-bass.ogg')],quality:'lite',
      sourceRoot,outputRoot:outRoot,ffmpeg:encodeScript,ffprobe:probeScript}))
      .rejects.toThrow('Refusing to overwrite existing derivative');
    expect(readFileSync(original,'utf8')).toBe('SENTINEL ORIGINAL STEREO MASTER DO NOT TOUCH');
    expect(readFileSync(derivative,'utf8')).toBe('SENTINEL ORIGINAL STEREO MASTER DO NOT TOUCH');
  } finally {rmSync(temp,{recursive:true,force:true});}
});
