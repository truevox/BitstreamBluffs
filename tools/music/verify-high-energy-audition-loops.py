#!/usr/bin/env python3
"""Check that source-based audition loops retain synchronized strong signal."""
import array
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys

root=Path(sys.argv[1]) if len(sys.argv)>1 else Path('dist/audition-loops')
manifest=json.loads((root/'manifest.json').read_text())
roles=['drums','bass','guitar','piano','other']

def decode(*inputs):
 cmd=['ffmpeg','-nostdin','-hide_banner','-loglevel','error']
 for i in inputs:cmd+=['-i',str(i)]
 if len(inputs)>1:cmd+=['-filter_complex',f'amix=inputs={len(inputs)}:duration=shortest:normalize=1']
 cmd+=['-ar','8000','-ac','1','-f','f32le','pipe:1']
 p=subprocess.run(cmd,capture_output=True)
 if p.returncode:raise RuntimeError(p.stderr.decode(errors='replace'))
 a=array.array('f');a.frombytes(p.stdout)
 return a

for name,entry in manifest['selection'].items():
 files=[root/name/f'{role}.ogg' for role in roles]
 for role,file in zip(roles,files):
  assert file.is_file(),file
  assert hashlib.sha256(file.read_bytes()).hexdigest()==entry['stems'][role]['previewSha256'],file
 mix=decode(*files)
 sr=8000
 windows=[math.sqrt(sum(v*v for v in mix[i:i+sr])/sr) for i in range(0,len(mix)-sr+1,sr)]
 avg=sum(windows)/len(windows)
 minimum=min(windows)/avg
 tail=(sum(windows[-2:])/len(windows[-2:]))/avg
 assert len(windows)>=10,(name,len(windows))
 assert minimum>.48,(name,'weak 1s window',minimum)
 assert tail>.68,(name,'last 2s fade',tail)
 assert len(mix)/sr<12.2,(name,'duration',len(mix)/sr)
 typical_step=sum(abs(mix[i]-mix[i-1]) for i in range(1,len(mix)))/(len(mix)-1)
 seam_step=abs(mix[0]-mix[-1])
 assert seam_step < typical_step*3,(name,'audible loop seam risk',seam_step/typical_step)
 if name=='pope-leo':
  assert (root/name/'mix.ogg').is_file()
 print('ENERGETIC_LOOP_PASS',name,'duration',round(len(mix)/sr,3),
       'lowest-second/mean',round(minimum,3),'last-two-seconds/mean',round(tail,3),
       'RMS',round(avg,4),'seamStep/averageStep',round(seam_step/typical_step,2))
print('ENERGETIC_STEM_LOOP_SOURCE_CHECK_PASS',len(manifest['selection']),'packs',len(roles),'stems each')
