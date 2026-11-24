/** Renders source AUDIO waveform from the SAME decoded OGG AudioBuffer
 * cache already used by the sandbox transport. No network, copied audio,
 * invented waveform, or pitch detector. Output is display-only normalized
 * sampled absolute PCM peaks per bin (up to 64 sample positions per bin),
 * NOT exact true-peaks, loudness, or post-DSP sound pressure.
 */
export const LAB_WAVEFORM_BINS=200;

export function originalStemWaveform(pack,cache,role,startFrame,endFrame,bins=LAB_WAVEFORM_BINS){
  if(!pack||!cache?.get||!Number.isInteger(startFrame)||
    !Number.isInteger(endFrame)||endFrame<=startFrame||
    !Number.isInteger(bins)||bins<8||bins>1024||
    !Number.isInteger(pack.sampleRate)||pack.sampleRate<=0||
    !Array.isArray(pack.segments))return null;
  const result=new Float32Array(bins);
  let populated=0;
  const range=endFrame-startFrame;
  const source=String(role||'');
  for(let i=0;i<bins;i++){
    const a=startFrame+Math.floor(i*range/bins);
    const b=startFrame+Math.floor((i+1)*range/bins);
    const segIndex=pack.segments.findIndex(seg=>
      a>=seg.startFrame&&a<seg.startFrame+seg.frames);
    if(segIndex<0)continue;
    const seg=pack.segments[segIndex];
    const buffer=cache.get(`${segIndex}/${source}`);
    if(!buffer?.getChannelData||!Number.isFinite(buffer.sampleRate)||
      buffer.sampleRate<=0||buffer.length<=0)continue;
    const start=Math.max(0,Math.floor((a-seg.startFrame)*buffer.sampleRate/pack.sampleRate));
    const until=Math.min(buffer.length,
      Math.ceil((Math.min(b,seg.startFrame+seg.frames)-seg.startFrame)*
        buffer.sampleRate/pack.sampleRate));
    if(until<=start)continue;
    const samples=[];
    for(let c=0;c<Math.min(buffer.numberOfChannels,2);c++)
      samples.push(buffer.getChannelData(c));
    if(!samples.length)continue;
    let peak=0;
    // Inspect a stable maximum ~64 positions per bin per channel;
    // avoid 192k samples per draw on low-end Chromebooks.
    const stride=Math.max(1,Math.floor((until-start)/64));
    for(let j=start;j<until;j+=stride){
      for(const samplesOfChannel of samples){
        const v=Math.abs(samplesOfChannel[j]??0);
        if(Number.isFinite(v))peak=Math.max(peak,v);
      }
    }
    result[i]=Math.min(1,peak);
    populated++;
  }
  return Object.freeze({role:source,bins:result,available:populated,
    total:bins,coverage:populated/bins});
}
