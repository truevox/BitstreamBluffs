#!/usr/bin/env python3
"""Reproducible four-track full-length six-stem preview builder.

Original 11-stem One More Run files are NEVER modified: the verified grouped
six-stem derivative is mapped into a throwaway source-manifest mirror.
All output is separate segmented 48kHz stereo Ogg/Opus; never put source
stems or media in the public game repository without explicit approval.
"""
import argparse
import json
import tempfile
from pathlib import Path

from pack_song import build, STEMS

SLOTS=(1,33,3,31)

def create_mirror(master,folder):
	manifest=json.loads((master/'game-stems-manifest.json').read_text())
	status=json.loads((master/'stem_status.json').read_text())
	one=next(t for t in manifest['tracks'] if int(t['slot'])==33)
	group=one.get('grouped_6s',{})
	mapping=group.get('stemFiles',{})
	if set(mapping)!=set(STEMS):
		raise ValueError('One More Run must have validated grouped six-stem derivative')
	frames=group.get('frames')
	if not isinstance(frames,int) or frames<=0:
		raise ValueError('Missing grouping frame count')
	one['stem_files']=dict(mapping)
	one['stem_names']=list(STEMS)
	one['stem_layout']='grouped_6s'
	status['tracks'][one['id']]={
		'status':'complete',
		'stems':{stem:{
			'file':relative,'frames':frames,'sample_rate':44100,'channels':2,
		} for stem,relative in mapping.items()},
	}
	(folder/'stems').symlink_to(master/'stems',target_is_directory=True)
	(folder/'game-stems-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
	(folder/'stem_status.json').write_text(json.dumps(status,indent=2)+'\n')
	return {int(t['slot']):t for t in manifest['tracks']}

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--master',type=Path,default=Path('/root/bitstream-maxi/launch33'))
	p.add_argument('--out',type=Path,required=True)
	p.add_argument('--chunk-seconds',type=int,default=12)
	p.add_argument('--bitrate',default='64k')
	a=p.parse_args()
	master=a.master.resolve()
	out=a.out.resolve()
	if not master.is_dir() or not (master/'game-stems-manifest.json').is_file():
		raise FileNotFoundError('No six-stem master roster')
	if master==out or master.is_relative_to(out) or out.is_relative_to(master):
		raise ValueError('Refusing output inside (or enclosing) the immutable source master tree')
	if out.exists():
		raise FileExistsError('Refusing to overwrite an existing four-song preview')
	if not 2<=a.chunk_seconds<=30:
		raise ValueError('Chunk must be 2-30 seconds')
	out.mkdir(parents=True)
	with tempfile.TemporaryDirectory(prefix='bitstream-master-mirror-',
		dir=out.parent) as scratch:
		stage=Path(scratch)
		roster=create_mirror(master,stage)
		if any(slot not in roster for slot in SLOTS):
			raise ValueError('One or more of four songs absent from source roster')
		for slot in SLOTS:
			build(stage,out,slot,a.chunk_seconds,0,a.bitrate)
	catalog=json.loads((out/'catalog.json').read_text())
	if len(catalog['tracks'])!=4:
		raise ValueError('Expected four full songs, not a short preview')
	print('FOUR_FULL_SONG_PACKS_COMPLETE',out)

if __name__=='__main__':
	main()
