/** Experimental source-preserving mono encodes for Bitstream Bluffs #172.
 * A versioned derivative is one *original* instrument/voice, never a remix.
 * This is build-time tooling only; it is not connected to shipped gameplay.
 */
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, stat, lstat, realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,dirname,sep,join} from 'node:path';

export const MONO_PRESETS=Object.freeze({
  lite:Object.freeze({vocals:24,drums:28,bass:12,guitar:20,piano:20,other:26,lead:18,adaptive:24}),
  full:Object.freeze({vocals:48,drums:56,bass:40,guitar:48,piano:48,other:52,lead:40,adaptive:52}),
});
const VARIANT_FORMAT='bsb-stem-variants-v1';
const PATH_RE=/^\/music\/packs\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]+\.ogg$/;

export function canonicalStemUrl(url) {
  if (typeof url!=='string'||!PATH_RE.test(url)||url.includes('..')||url.includes('\\')||url.includes('?')||url.includes('#'))
    throw new TypeError('Invalid original stem URL: '+String(url));
  return url;
}

export function stemCategory(url) {
  canonicalStemUrl(url);
  const base=url.split('/').at(-1).toLowerCase();
  if (/^[0-9]{4}-vocals\.ogg$/.test(base)) return 'vocals';
  if (/^[0-9]{4}-drums\.ogg$/.test(base)) return 'drums';
  if (/^[0-9]{4}-bass\.ogg$/.test(base)) return 'bass';
  if (/^[0-9]{4}-guitar\.ogg$/.test(base)) return 'guitar';
  if (/^[0-9]{4}-piano\.ogg$/.test(base)) return 'piano';
  if (/^[0-9]{4}-other\.ogg$/.test(base)) return 'other';
  if (/^([0-9]{4}-voice-home|melody-[0-9]{4})\.ogg$/.test(base)) return 'lead';
  return 'adaptive';
}

export function targetKbps(url,quality,overrides={}) {
  if (!Object.hasOwn(MONO_PRESETS,quality))throw new TypeError('Invalid mono quality');
  const preferred=Object.hasOwn(overrides,url)?overrides[url]:MONO_PRESETS[quality][stemCategory(url)];
  if (!Number.isSafeInteger(preferred)||preferred<6||preferred>128)throw new RangeError('Bitrate outside 6..128 kbps');
  return preferred;
}

export function variantSourceUrl(url,quality) {
  canonicalStemUrl(url);
  if(!Object.hasOwn(MONO_PRESETS,quality))throw new TypeError('Invalid mono quality');
  return `/music-variants/${quality}${url.slice('/music'.length)}`;
}

export function ffmpegMonoArgs(input,output,rate) {
  if(!Number.isSafeInteger(rate)||rate<6||rate>128)throw new RangeError('Invalid bitrate');
  // Never overwrite ANY existing file, even if an output path were a
  // malicious hardlink to an original master. Variants are immutable assets.
  return ['-hide_banner','-nostdin','-v','error','-n','-i',input,'-map','0:a:0',
    '-vn','-sn','-dn','-map_metadata','-1','-ar','48000','-ac','1',
    '-c:a','libopus','-application','audio','-b:a',rate+'k','-vbr','on',
    '-compression_level','10',output];
}

function insideRoot(root,url){
  const resolvedRoot=resolve(root);
  const f=resolve(resolvedRoot,url.slice(1));
  if(!f.startsWith(resolvedRoot+sep))throw new Error('Escaped root');
  return f;
}

async function digestFile(file){
  const hash=createHash('sha256');
  for await(const data of createReadStream(file))hash.update(data);
  return hash.digest('hex');
}

function runProgram(program,args){
  return new Promise((ok,fail)=>{
    const p=spawn(program,args,{stdio:['ignore','pipe','pipe']});
    const err=[];p.stderr.on('data',b=>{if(err.reduce((n,x)=>n+x.length,0)<65536)err.push(b)});
    p.on('error',fail);p.on('close',code=>code===0?ok():fail(new Error(`${program} failed ${code}: ${Buffer.concat(err).toString('utf8').slice(-1800)}`)));
  });
}

async function probe(file,binary='ffprobe'){
  return new Promise((ok,fail)=>{
    const args=['-v','error','-select_streams','a:0','-show_entries',
      'stream=codec_name,channels,sample_rate:format=duration','-of','json',file];
    const p=spawn(binary,args,{stdio:['ignore','pipe','pipe']});
    let out='',err='';p.stdout.on('data',b=>{out+=b});p.stderr.on('data',b=>{err+=b});
    p.on('error',fail);p.on('close',c=>{
      if(c!==0)return fail(new Error('ffprobe '+c+' '+err.slice(-1000)));
      try{
        const j=JSON.parse(out);const s=j.streams?.[0];const duration=Number(j.format?.duration);
        if(!s||s.codec_name!=='opus'||!Number.isFinite(duration)||duration<=0)throw Error('Invalid source audio');
        ok({channels:s.channels,sampleRate:Number(s.sample_rate),duration});
      }catch(e){fail(e)}
    });
  });
}

/** Build actual Ogg/Opus mono assets from a bounded, explicit recording list.
 * sourceRoot and outputRoot must differ. An existing output isn't trusted: its
 * SHA-256 is always read back into the emitted manifest. A source fingerprint
 * accompanies each derivative, allowing provenance checks on rebuild. */
export async function encodeMonoVariants({urls,quality,sourceRoot,outputRoot,overrides={},ffmpeg='ffmpeg',ffprobe='ffprobe',onProgress=()=>{}}){
  if(!Object.hasOwn(MONO_PRESETS,quality)||!Array.isArray(urls)||!urls.length||urls.length>5000)
    throw new TypeError('Invalid mono encoding request');
  const originalRoot=resolve(sourceRoot),derivRoot=resolve(outputRoot);
  if(originalRoot===derivRoot || derivRoot.startsWith(originalRoot+sep) || originalRoot.startsWith(derivRoot+sep))
    throw new Error('Output and original media roots must be disjoint');
  await mkdir(derivRoot,{recursive:true});
  const realSource=await realpath(originalRoot),realOutput=await realpath(derivRoot);
  if(realSource===realOutput||realOutput.startsWith(realSource+sep)||realSource.startsWith(realOutput+sep))
    throw new Error('Output and original media roots must be disjoint');
  const ordered=[...new Set(urls.map(canonicalStemUrl))].sort();
  const records=[];
  for(let index=0;index<ordered.length;index++){
    const url=ordered[index],from=insideRoot(originalRoot,url);
    const realInput=await realpath(from);
    if(!realInput.startsWith(realSource+sep))throw new Error('Original stem symlink escaped its source root');
    const source=await probe(from,ffprobe);
    if(source.sampleRate!==48000||![1,2].includes(source.channels))throw new Error('Unexpected source layout: '+url);
    const kbps=targetKbps(url,quality,overrides);
    const variantUrl=variantSourceUrl(url,quality);
    const dest=insideRoot(derivRoot,variantUrl);
    await mkdir(dirname(dest),{recursive:true});
    if(!(await realpath(dirname(dest))).startsWith(realOutput+sep))
      throw new Error('Derivative output folder escaped its root');
    // Never replace pre-existing outputs: even a regular-looking output may
    // be a hardlink pointing at an original elsewhere on this filesystem.
    // Any intentional new variant build must use a new, distinct output root.
    try{await lstat(dest);throw new Error('Refusing to overwrite any existing recording: '+dest);}
    catch(e){if(e.code!=='ENOENT')throw e;}
    await runProgram(ffmpeg,ffmpegMonoArgs(from,dest,kbps));
    const out=await probe(dest,ffprobe);
    if(out.channels!==1||out.sampleRate!==48000||Math.abs(out.duration-source.duration)>.030)
      throw new Error('Mono derivative fails layout/duration check: '+url);
    const bytes=(await stat(dest)).size;
    if(bytes<100)throw new Error('Suspiciously short audio derivative: '+url);
    records.push({url,variantUrl,category:stemCategory(url),quality,targetKbps:kbps,
      sourceSha256:await digestFile(from),sha256:await digestFile(dest),sourceChannels:source.channels,
      channels:out.channels,sampleRate:out.sampleRate,sourceDuration:source.duration,
      duration:out.duration,sourceBytes:(await stat(from)).size,bytes});
    onProgress({index:index+1,total:ordered.length,category:stemCategory(url),url});
  }
  const version=createHash('sha256').update(JSON.stringify(records)).digest('hex').slice(0,20);
  return {format:VARIANT_FORMAT,quality,version,entries:records,
    sourceBytes:records.reduce((n,x)=>n+x.sourceBytes,0),bytes:records.reduce((n,x)=>n+x.bytes,0)};
}
