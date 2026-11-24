#!/usr/bin/env python3
"""Make strong, synchronized, seamless audition excerpts from PRIVATE original OGGs.

Only writes the destination; never modifies original recordings or source packs.
The short seam overlap applies identically to every instrumental stem.
Set BSB_STEM_PACK_ROOT to the central private packs location if needed.
"""
import array
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys

SOURCE=Path(os.environ.get('BSB_STEM_PACK_ROOT','/home/hermes/.local/share/bitstream-static-music-v1/packs')).resolve()
DEST=(Path(sys.argv[1]) if len(sys.argv)>1 else Path('dist/audition-loops')).resolve()
if DEST==SOURCE or SOURCE in DEST.parents:
    raise ValueError('Destination must not be in the original-source archive')
RATE=48000
CHANNELS=2
FADE_FRAMES=RATE*3//4
STEMS=['drums','bass','guitar','piano','other']
SELECTIONS={
    'one-more-run':('33_local-one-more-run-bitstream-bluffs','0011'),
    'pope-leo':('01_FEsxYVStla4','0014'),
}

def run(cmd,data=None):
    p=subprocess.run(cmd,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if p.returncode:
        raise RuntimeError('ffmpeg failed: '+p.stderr.decode(errors='replace')[-1400:])
    return p.stdout

def decoded(path):
    pcm=run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-i',str(path),
             '-vn','-ac',str(CHANNELS),'-ar',str(RATE),'-f','f32le','pipe:1'])
    a=array.array('f');a.frombytes(pcm)
    return a

def low_discontinuity_overlap(stems, frames):
    # Choose a join that remains continuous across ALL original stereo stems.
    # Small changes in the 750-ms overlap avoid cutting on a steep waveform slope.
    def score(fade):
        boundary=frames-fade
        return sum((samples[boundary*CHANNELS+ch]-
                    samples[(boundary-1)*CHANNELS+ch])**2
                   for samples in stems.values() for ch in range(CHANNELS))
    return min(range(round(RATE*.68),round(RATE*.82)+1),key=score)

def make_loop(data, common_frames, fade_frames):
    frames=common_frames-fade_frames
    result=array.array('f',data[:CHANNELS*frames])
    # Seam overlaps the physical end of this SAME source excerpt with its head.
    # At the far end of playback, it continues naturally into that blended head.
    for i in range(fade_frames):
        incoming=i/fade_frames
        outgoing=1-incoming
        for ch in range(CHANNELS):
            k=i*CHANNELS+ch
            result[k]=data[(frames+i)*CHANNELS+ch]*outgoing+data[k]*incoming
    return result

def second_rms(a):
    window=RATE*CHANNELS
    return [math.sqrt(sum(v*v for v in a[i:i+window])/window)
            for i in range(0,len(a)-window+1,window)]

manifest={'format':'bitstream-private-stem-preview-loops-v1','sampleRate':RATE,
          'nominalSeamCrossfadeSeconds':FADE_FRAMES/RATE,'sourceRoot':str(SOURCE),
          'selection':{}}
for label,(pack,segment) in SELECTIONS.items():
    directory=DEST/label
    directory.mkdir(parents=True,exist_ok=True)
    files={stem:SOURCE/pack/f'{segment}-{stem}.ogg' for stem in STEMS}
    if not all(p.is_file() for p in files.values()):
        missing=[str(p) for p in files.values() if not p.is_file()]
        raise FileNotFoundError('Missing original stem(s): '+', '.join(missing))
    decoded_stems={stem:decoded(path) for stem,path in files.items()}
    lengths={stem:len(v)//CHANNELS for stem,v in decoded_stems.items()}
    common_frames=min(lengths.values())
    if common_frames<8*RATE:raise ValueError('Selected chunk too short '+label)
    fade_frames=low_discontinuity_overlap(decoded_stems,common_frames)
    entry={'pack':pack,'segment':segment,'sourceFrames':lengths,
           'seamCrossfadeSeconds':fade_frames/RATE,
           'loopFrames':common_frames-fade_frames,'durationSeconds':(common_frames-fade_frames)/RATE,
           'stems':{}}
    for stem,data in decoded_stems.items():
        sound=make_loop(data,common_frames,fade_frames)
        output=directory/f'{stem}.ogg'
        run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
             '-f','f32le','-ar',str(RATE),'-ac',str(CHANNELS),'-i','pipe:0',
             '-c:a','libopus','-b:a','128k','-vbr','on',str(output)],sound.tobytes())
        entry['stems'][stem]={
            'sourceSha256':hashlib.sha256(files[stem].read_bytes()).hexdigest(),
            'previewSha256':hashlib.sha256(output.read_bytes()).hexdigest(),
        }
    # Snowpack's single-file player uses the same selected original five-stem mix.
    if label=='pope-leo':
        cmd=['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y']
        for stem in STEMS:cmd+=['-i',str(directory/f'{stem}.ogg')]
        cmd+=['-filter_complex','amix=inputs=5:duration=shortest:normalize=1',
              '-c:a','libopus','-b:a','192k',str(directory/'mix.ogg')]
        run(cmd)
        entry['mixSha256']=hashlib.sha256((directory/'mix.ogg').read_bytes()).hexdigest()
    manifest['selection'][label]=entry
    print(label,pack,segment,'frames',entry['loopFrames'],'duration',round(entry['durationSeconds'],3),'join',round(entry['seamCrossfadeSeconds'],4))
DEST.mkdir(parents=True,exist_ok=True)
(DEST/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Generated',len(SELECTIONS),'original-source loop packs under',DEST)
