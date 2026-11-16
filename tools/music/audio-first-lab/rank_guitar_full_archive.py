#!/usr/bin/env python3
import json,subprocess,concurrent.futures,numpy as np
from pathlib import Path
root=Path('/root/bitstream-maxi/launch33')
entries=json.loads((root/'roster.json').read_text())['tracks']
def measure(item):
	slot=int(item['slot']);tid=item['id']
	if slot>32:return None
	folder=root/'stems/htdemucs_6s'/f'{slot:02}_{tid}'
	report={'slot':slot,'title':item['title'],'id':tid}
	def density(stem):
		file=folder/(stem+'.flac')
		if not file.exists():return None
		proc=subprocess.run(['ffmpeg','-v','error','-nostdin','-i',str(file),'-ac','1','-ar','8000','-f','f32le','pipe:1'],
				stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
		signal=np.frombuffer(proc.stdout,dtype='<f4')
		window=4000;signal=signal[:len(signal)//window*window].reshape(-1,window)
		rms=np.sqrt(np.mean(signal**2,axis=1)+1e-12)
		top=np.percentile(rms,95);floor=np.percentile(rms,20)
		cutoff=max(10**(-46/20),top*.085,floor*3)
		active=rms>cutoff
		hits=active & (np.r_[False,active[:-1]]|np.r_[active[1:],False])
		coverage=round(float(hits.mean()),4)
		n=min(64,len(hits))
		best=max([(round(float(np.mean(hits[i:i+n])),3),i*.5) for i in range(max(1,len(hits)-n))],default=(0,0))
		return {'activity':coverage,'best32':best,'rmsDb':round(float(20*np.log10(max(np.sqrt(np.mean(signal**2)),1e-9))),1)}
	with concurrent.futures.ThreadPoolExecutor(max_workers=3) as work:
		futures={work.submit(density,k):k for k in ('guitar','piano','other')}
		for f in concurrent.futures.as_completed(futures):report[futures[f]]=f.result()
	candidates={k:report[k]['activity'] if report[k] else 0 for k in ('guitar','piano','other')}
	report['winner']=max(candidates,key=candidates.get)
	report['guitar_margin']=round(candidates['guitar']-max(candidates['piano'],candidates['other']),4)
	return report
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
	results=list(pool.map(measure,entries[:32]))
for r in sorted(results,key=lambda x:(x['winner']!='guitar',-x['guitar_margin'], -x['guitar']['activity'])):
	print(f"{r['slot']:02d} {r['winner']:<6s} guitar={r['guitar']['activity']:.3f} piano={r['piano']['activity']:.3f} other={r['other']['activity']:.3f} margin={r['guitar_margin']:+.3f} guitar_best32={r['guitar']['best32']} {r['title'][:70]}",flush=True)
out=Path('/root/bitstream-maxi/launch33/guitar-showcase-ranking-20261116.json')
out.write_text(json.dumps(results,indent=2)+'\n')
print('GUITAR_SCAN_READY',out,flush=True)
