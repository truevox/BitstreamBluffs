#!/usr/bin/env python3
"""Release gate: decode every game music Opus clip and check exact source frames.

Fable's 6.5ms defect escaped the old 40ms tolerance. There is NO tolerance
here: all 4745 decoded clips must have exactly the segment's integer
sample-frame count. All six original source stems and original home voice
must remain SHA-256 unchanged; no model weights or raw source FLAC/WAV
are distributed. The track manifests, not guessed durations, are truth.
"""
import argparse
import hashlib
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROLES=('featured','bass','drums','guitar','piano','other')
ORIGINAL=('vocals','drums','bass','guitar','piano','other','voice:bitstream-bluffs')

def sha256(path):
	h=hashlib.sha256()
	with path.open('rb') as f:
		for block in iter(lambda:f.read(1024*1024),b''):
			h.update(block)
	return h.hexdigest()

def check_sample(job):
	path,frames,kind=job
	proc=subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(path),
		'-ac','2','-ar','48000','-f','s16le','pipe:1'],
		stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=90)
	if proc.returncode:
		raise ValueError('PCM decode failed: '+str(path)+' '+proc.stderr.decode(errors='replace')[-600:])
	n=len(proc.stdout)
	if n%4 or n//4!=frames:
		raise ValueError('SAMPLE COUNT MISMATCH '+str(path)+
			' decoded='+str(n//4)+' expected='+str(frames))
	return kind

def build_jobs(root,prior):
	cat=json.loads((root/'catalog.json').read_text())
	oldcat=json.loads((prior/'catalog.json').read_text())
	assert len(cat['tracks'])==len(oldcat['tracks'])==4
	assert [t['id'] for t in cat['tracks']]==[t['id'] for t in oldcat['tracks']]
	jobs=[]
	songReport=[]
	originalHashCount=0
	for item in cat['tracks']:
		relative=Path(item['manifest'])
		doc=json.loads((root/relative).read_text())
		previous=json.loads((prior/relative).read_text())
		assert doc['frameCount']==previous['frameCount']
		assert doc['sampleRate']==48000
		assert len(doc['segments'])==len(previous['segments'])
		assert doc['id']==item['id']
		roles=doc['adaptive']['variants']
		assert set(roles)==set(ROLES)
		stems=doc['segments'][0]['sources']
		allVoices=[n for n in stems if n.startswith('voice:') and n!='voice:bitstream-bluffs']
		assert len(allVoices)==11
		cursor=0
		touched=set()
		for i,(seg,old) in enumerate(zip(doc['segments'],previous['segments'])):
			assert seg['startFrame']==cursor==old['startFrame']
			assert seg['frames']==old['frames']>0
			cursor+=seg['frames']
			assert set(seg['sources'])==set(old['sources'])
			for name,path in seg['sources'].items():
				if name in ORIGINAL:
					assert path==old['sources'][name]
				full=(root/relative.parent/path).resolve()
				assert full.is_relative_to(root.resolve()) and full.is_file()
				if name in ORIGINAL:
					priorFile=(prior/relative.parent/old['sources'][name]).resolve()
					assert priorFile.is_file()
					if sha256(full)!=sha256(priorFile):
						raise ValueError('Original stem was changed: '+str(full))
					originalHashCount+=1
				assert full not in touched, ('duplicate clip',full)
				touched.add(full)
				jobs.append((full,seg['frames'],'original' if name in ORIGINAL else 'reperformed'))
			for role,variants in roles.items():
				if role==doc['adaptive']['featuredStem']:
					assert variants=={}
					continue
				assert set(variants)==set(n.split(':',1)[1] for n in allVoices)
				for biome,paths in variants.items():
					assert len(paths)==len(doc['segments'])
					path=paths[i]
					full=(root/relative.parent/path).resolve()
					assert full.is_relative_to(root.resolve()) and full.is_file()
					assert full not in touched, ('duplicate clip',full)
					touched.add(full)
					jobs.append((full,seg['frames'],'reperformed'))
		assert cursor==doc['frameCount']
		songReport.append({'id':item['id'],'durationSeconds':cursor/48000,
			'segments':len(doc['segments']),'decodedClips':len(touched)})
	assert len(jobs)==4745,len(jobs)
	assert len({row[0] for row in jobs})==len(jobs)
	assert originalHashCount==455,originalHashCount
	return jobs,songReport,originalHashCount

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--music',type=Path,required=True)
	p.add_argument('--baseline',type=Path,required=True)
	p.add_argument('--report',type=Path,required=True)
	p.add_argument('--workers',type=int,default=8)
	a=p.parse_args()
	assert not a.report.exists()
	assert 1<=a.workers<=32
	jobs,songs,untouched=build_jobs(a.music,a.baseline)
	print('MANIFEST_AND_SHA256_PASS',len(jobs),'audio clips',untouched,
		'original files unchanged',flush=True)
	counts={'original':0,'reperformed':0}
	failures=[]
	with ThreadPoolExecutor(max_workers=a.workers) as pool:
		pending={pool.submit(check_sample,job):job[0] for job in jobs}
		for i,future in enumerate(as_completed(pending),1):
			try:
				kind=future.result()
				counts[kind]+=1
			except Exception as exc:
				failures.append(str(exc))
				if len(failures)>6:
					for other in pending:other.cancel()
					break
			if i%250==0 or i==len(jobs):
				print('PCM_DECODE_VERIFIED',i,'/',len(jobs),
					'failures',len(failures),flush=True)
	if failures:
		for error in failures[:10]:print('FAIL',error,file=sys.stderr)
		raise ValueError('Sample exact decode validation failed '+str(len(failures)))
	assert counts=={'original':455,'reperformed':4290},counts
	report={'format':'bitstream-opus-frame-exact-gate-v1','passed':True,
		'rate':48000,'channels':2,'expectedOgg':4745,
		'originalSha256Unchanged':untouched,'decodedFramesExact':len(jobs),
		'counts':counts,'songs':songs,
		'fix':'independent Opus encoding per 12s integer-sample segment',
		'notes':'No content transcription improvements claimed. This is an audio packaging repair.'}
	a.report.write_text(json.dumps(report,indent=2)+'\n')
	print('SAMPLE_EXACT_RELEASE_GATE_PASS',report['decodedFramesExact'],flush=True)

if __name__=='__main__':
	main()
