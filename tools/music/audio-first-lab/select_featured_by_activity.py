#!/usr/bin/env python3
"""Precompute featured backing source by ACTIVE DURATION, not source RMS loudness."""
import json, subprocess, sys, math
from pathlib import Path
import numpy as np
sets={
	'FEsxYVStla4':Path('/root/bitstream-maxi/launch32/stems/htdemucs_6s/01_FEsxYVStla4'),
	'one-more-run-bitstream-bluffs':Path('/root/bitstream-maxi/launch33/stems/grouped_6s/33_one_more_run'),
}
def read_pcm(path):
	p=subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-i',str(path),
			'-ac','1','-ar','8000','-f','f32le','pipe:1'],capture_output=True,check=True)
	return np.frombuffer(p.stdout,dtype='<f4')
for name,base in sets.items():
	stats={}
	for stem in ('guitar','piano','other'):
		path=base/(stem+'.flac')
		if not path.exists():
			print('MISSING',path);continue
		sig=read_pcm(path)
		window=4000;sig=sig[:len(sig)//window*window].reshape(-1,window)
		rms=np.sqrt(np.mean(sig**2,axis=1)+1e-12)
		upper=np.percentile(rms,95)
		floor=np.percentile(rms,20)
		# Relative activity measure so louder stems do not automatically win.
		# Blend significant per-stem activity and absolute floor to ignore bleed.
		threshold=max(10**(-46/20), upper*0.085, floor*3)
		active=(rms>threshold)
		# Discount isolated transients by requiring two or more adjacent active blocks.
		hits=active & (np.r_[False,active[:-1]] | np.r_[active[1:],False])
		stats[stem]={'activity':round(float(hits.mean()),4),
				'activeSeconds':round(float(hits.sum()*.5),1),
				'peakWindowDb':round(float(20*np.log10(max(upper,1e-9))),1),
				'thresholdDb':round(float(20*np.log10(threshold)),1),
				'medianRmsDb':round(float(20*np.log10(max(np.median(rms),1e-9))),1)}
	selected=max(stats,key=lambda x:(stats[x]['activity'],stats[x]['activeSeconds']))
	print(json.dumps({'id':name,'featured':selected,'stats':stats},sort_keys=True))
