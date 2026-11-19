#!/usr/bin/env python3
"""Audit source fingerprints, synthesized research MIDI/MP3 assets, and HTML.

Read-only and works without the 500MB+ original song OGG checkouts.
"""
from pathlib import Path
import hashlib,json,subprocess,re

REPO=Path(__file__).resolve().parents[2]
ROOT=REPO/'public/music-review/piano-friendly'
PACK=REPO/'public/music/packs/33_local-one-more-run-bitstream-bluffs/pack.json'
assert PACK.is_file()
pack=json.loads(PACK.read_text())
contour=json.loads((ROOT/'unverified-source-contour.json').read_text())
manifest=json.loads((ROOT/'manifest.json').read_text())
identity=hashlib.sha256(PACK.read_bytes()).hexdigest()
assert identity==contour['sourceManifestSha256']==manifest['sourceManifestSha256']
assert contour['songId']==pack['id']=='local-one-more-run-bitstream-bluffs'
assert 'UNVERIFIED' in contour['kind']
assert contour['timingQuantization'].startswith('No beat-grid snapping')
assert len(contour['vocalOggSegmentHashes'])==len(pack['segments'])==15
assert all(len(s)==64 for s in contour['vocalOggSegmentHashes'])
assert 100<len(contour['notes'])<10000
for note in contour['notes']:
 assert 0<=note['start']<note['end']<=pack['frameCount']/pack['sampleRate']
 assert 0<=note['pitch']<=127
 assert note['kind'] in ('steady','structural-onset-glide','terminal-ornament-removed')
for mid in ('B_piano_friendly_160bpm.mid','C_selective_glides_160bpm.mid'):
 b=(ROOT/mid).read_bytes()
 assert b.startswith(b'MThd') and b[14:18]==b'MTrk'
 assert b.endswith(b'\x00\xff\x2f\x00')
 print('VERIFIED_EDITABLE_MIDI',mid,len(b))
assert len(manifest['windows'])==4
assert sum(len(w['files']) for w in manifest['windows'])==12
html=(ROOT/'index.html').read_text()
assert html.count('<audio controls')==12
assert 'visibilitychange' in html and 'pagehide' in html
for w in manifest['windows']:
 assert w['originalEndSeconds']-w['originalStartSeconds']==24
 assert len(w['files'])==3
 for item in w['files']:
  name=item['name']
  assert re.fullmatch(r'window[1-4]_[0-9]{3}-[0-9]{3}_[ABC]_[a-zA-Z_]+\.mp3',name),name
  f=ROOT/name
  assert f.is_file() and f.stat().st_size>50000
  assert hashlib.sha256(f.read_bytes()).hexdigest()==item['sha256']
  assert name in html
  r=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration',
    '-of','default=noprint_wrappers=1:nokey=1',str(f)],capture_output=True,text=True,check=True)
  duration=float(r.stdout.strip())
  assert 23.95<duration<24.2,(name,duration)
 print('VERIFIED_ORIGINAL_TIME_WINDOW',w['index'],w['originalStartSeconds'],w['originalEndSeconds'],len(w['files']))
assert manifest['windows'][1]['files'][1]['sha256']==manifest['windows'][1]['files'][2]['sha256'],'2nd passage B/C intentional duplicate expected'
for k in (0,2,3):assert manifest['windows'][k]['files'][1]['sha256']!=manifest['windows'][k]['files'][2]['sha256']
assert (ROOT/'README.md').is_file()
assert (REPO/'tools/music/render_piano_friendly_melody.py').is_file()
print('ALL_SOURCE_BOUND_PIANO_FRIENDLY_MIDI_AND_12_AUDIO_PREVIEWS_VERIFIED')
