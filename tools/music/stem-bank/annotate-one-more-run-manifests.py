#!/usr/bin/env python3
"""Add optional grouped_6s track 33 bank without replacing original_11s."""
import json,os
from datetime import datetime,timezone
from pathlib import Path
import soundfile as sf
R=Path('/root/bitstream-maxi/launch33')
G=R/'stems/grouped_6s/33_one_more_run'
m=json.loads((G/'grouping.json').read_text())
N=['vocals','drums','bass','guitar','piano','other']
assert set(m['groups'])==set(N)
for k in N:
	d=m['groups'][k];p=R/d['output'];i=sf.info(p)
	assert (i.frames,i.samplerate,i.channels,i.subtype)==(7699860,44100,2,'PCM_24')
	assert d['bytes']==p.stat().st_size
rec={
 'layout':'grouped_6s','stemCount':6,'stemNames':N,
 'stemFiles':{k:m['groups'][k]['output'] for k in N},
 'stemInputs':{k:m['groups'][k]['sourceNames'] for k in N},
 'stemGainApplied':{k:m['groups'][k]['sourceGainApplied'] for k in N},
 'groupingReport':'stems/grouped_6s/33_one_more_run/grouping.json',
 'storageFormat':'FLAC PCM_24 stereo 44100Hz','frames':7699860,
 'source11StemsPreserved':True,
 'neutralMixUsesOriginalMaster':True,
 'notes':'Original 11 stems do not reconstruct master; use original WAV for neutral playback',
}
date=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
def update(name):
 path=R/name;d=json.loads(path.read_text());v=d['tracks'];t=v[32] if isinstance(v,list) else v['local-one-more-run-bitstream-bluffs']
 assert t['stem_layout']=='original_11s'
 if t.get('grouped_6s'):
  assert t['grouped_6s']==rec
  print('ALREADY_ANNOTATED',name)
  return
 t['grouped_6s']=rec
 d.setdefault('stem_layouts',{})['grouped_6s']=N
 if name=='stem_status.json':
  assert len(t['stems'])==11
  d['grouped_6s_completed']=1
 elif name=='roster.json':
  assert t['stem_count']==11
  d['stem_workflow']='32 tracks: htdemucs_6s; 33: 11 original WAV stems preserved plus six compatible grouped 44.1kHz FLAC stems'
 else:
  assert len(t['stem_files'])==11 and d['track_count']==33
  d['compatibility_policy']='All songs use 6-stem names. One More Run retains original_11s and adds grouped_6s option; neutral playback uses original WAV.'
 backup=path.with_name(path.name+'.before-6group-'+date)
 backup.write_bytes(path.read_bytes())
 out=path.with_name(path.name+'.grouped6.tmp')
 out.write_text(json.dumps(d,indent=2,ensure_ascii=False)+'\n')
 assert len(json.loads(out.read_text())['tracks'])==33
 os.replace(out,path)
 print('UPDATED',name,'BACKUP',backup.name)
for name in ('game-stems-manifest.json','stem_status.json','roster.json'):update(name)
readme=R/'README.md';s=readme.read_text()
if '## Six-stem compatibility for One More Run' not in s:
 s+='''

## Six-stem compatibility for One More Run

The originals remain untouched: 11 supplied 48kHz stereo WAV stems,
full WAV/MP3 master, and supplied stem ZIP. New 44.1kHz 24-bit FLAC
stems are in stems/grouped_6s/33_one_more_run, with 7,699,860
samples each:

- vocals = vocals + backing_vocals (muted by default)
- drums = drums + percussion (0.9936 gain to prevent a tiny peak clip)
- bass = original bass
- guitar = original guitar
- piano = original keyboard
- other = synth + strings + woodwinds + fx

This is a second, optional grouping, NOT a replacement for
original_11s. All three track-33 JSON records now offer the grouped_6s
path, with explicit original provenance and sample/format metadata.

QUALITY WARNING: The supplied original 11 stems do not precisely
reconstruct the master WAV when summed. That predates this grouping.
For neutral all-stems-unity audio, play the untouched original WAV;
use the grouped stems when applying gameplay-controlled ducking and
validate the audible result. See grouping.json for SHA256 per file.
'''
 readme.write_text(s)
 print('README_UPDATED')
print('COMPLETE')
