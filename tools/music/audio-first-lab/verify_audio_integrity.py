#!/usr/bin/env python3
"""Read-only SHA256 fingerprint & decoded-sample QA for 33-song source bank
or 231-clip private audition. Reports exceptions; NEVER changes inputs.
Full decoded-content alignment requires a separate audio comparison.
"""
import argparse
import concurrent.futures
import datetime
import hashlib
import json
import math
import struct
import subprocess
from pathlib import Path

ROLES=('vocals','drums','bass','guitar','piano','other')

def files_for_source(root):
	roster=json.loads((root/'roster.json').read_text())
	found=[];expected={}
	for song in roster['tracks']:
		slot=int(song['slot'])
		dir=(root/'stems/grouped_6s/33_one_more_run') if slot==33 else (
			root/'stems/htdemucs_6s'/f"{slot:02}_{song['id']}")
		for role in ROLES:
			file=dir/(role+'.flac')
			if not file.is_file():raise FileNotFoundError(file)
			found.append(file)
		if slot==33:
			doc=json.loads((dir/'grouping.json').read_text())
			for role,group in doc['groups'].items():
				expected[str(dir/(role+'.flac'))]=group['sha256']
			raw=list((root/'stems/original_11s/33_one_more_run').glob('*.wav'))
			if len(raw)!=11:raise ValueError('Expected 11 original WAV stems')
			found.extend(raw)
	if len(found)!=209:raise ValueError(f'Expected 209 source files, got {len(found)}')
	return found,expected

def get_files(root,kind):
	if kind=='source':
		return files_for_source(root)
	index=root/'catalog.json'
	if not index.is_file():raise FileNotFoundError(index)
	doc=json.loads(index.read_text())
	if len(doc['songs'])!=3:raise ValueError('Expected three preview songs')
	files=sorted(root.rglob('*.ogg'))
	if len(files)!=231:raise ValueError(f'Expected 231 preview clips, got {len(files)}')
	return files,{}

def inspect(file,expected,mode):
	h=hashlib.sha256()
	bytes_count=0
	with file.open('rb') as stream:
		for chunk in iter(lambda:stream.read(4<<20),b''):
			h.update(chunk);bytes_count+=len(chunk)
	digest=h.hexdigest()
	probe=json.loads(subprocess.run(['ffprobe','-v','error',
		'-show_entries','format=duration:stream=sample_rate,channels,codec_name',
		'-select_streams','a:0','-of','json',str(file)],
		capture_output=True,check=True,text=True,timeout=30).stdout)
	audio=probe['streams'][0]
	duration=float(probe['format']['duration'])
	# Short-sample decode catches localized obvious failures, not full song
	start=max(0,duration*.38)
	p=subprocess.run(['ffmpeg','-v','error','-nostdin','-ss',str(start),
		'-i',str(file),'-t','1.5','-ac','1','-ar','8000',
		'-f','f32le','pipe:1'],capture_output=True,check=True,timeout=40)
	n=len(p.stdout)//4
	peak=0.;sum_sq=0.;finite=True
	for (sample,) in struct.iter_unpack('<f',p.stdout[:4*n]):
		finite=finite and math.isfinite(sample)
		if math.isfinite(sample):
			peak=max(peak,abs(sample))
			sum_sq+=sample*sample
	rms=math.sqrt(sum_sq/max(n,1))
	flags=[]
	if not finite:flags.append('nonfinite_sample_values')
	if not n:flags.append('no_samples_decoded')
	if duration<=0:flags.append('nonpositive_duration')
	if mode=='preview' and not 31.7<=duration<=32.5:
		flags.append('wrong_preview_duration')
	if mode=='preview' and peak>1.001:
		flags.append('short_sample_peak_over_fullscale')
	if digest!=expected.get(str(file),digest):
		flags.append('grouped_11_to_6_checksum_mismatch')
	return {'file':str(file),'sha256':digest,'bytes':bytes_count,
		'seconds':round(duration,4),'codec':audio['codec_name'],
		'rate':int(audio['sample_rate']),'channels':int(audio['channels']),
		'sampleRmsDb':round(20*math.log10(max(rms,1e-10)),2),
		'samplePeak':round(peak,5),'flags':flags}

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--root',type=Path,required=True)
	p.add_argument('--mode',choices=['source','preview'],required=True)
	p.add_argument('--out',type=Path,required=True)
	p.add_argument('--workers',type=int,default=4)
	a=p.parse_args()
	if a.out.exists():raise SystemExit('Refuse overwrite integrity manifest')
	if not a.root.is_dir():raise FileNotFoundError(a.root)
	files,expected=get_files(a.root,a.mode)
	with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(8,a.workers))) as pool:
		futures=[pool.submit(inspect,f,expected,a.mode) for f in files]
		rows=[f.result() for f in futures]
	flags=[{'file':row['file'],'flags':row['flags']} for row in rows
		if row['flags']]
	doc={'schemaVersion':1,'generatedUtc':datetime.datetime.now(
		datetime.timezone.utc).isoformat(),'root':str(a.root),
		'mode':a.mode,'totalFiles':len(rows),
		'verifiedSha256FullBytes':True,'decodedWindowSeconds':1.5,
		'flagged':flags,
		'notes':['SHA256 covers full bytes; audio signal sampled over a short window.',
			'Codec and duration via ffprobe, 1.5s PCM decode via ffmpeg.',
			'Checksums do NOT establish pitch transcription accuracy or mix quality.',
			'This tool does not modify, publish or rename private originals.'],
		'files':rows}
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(doc,indent=2)+'\n')
	print('INTEGRITY_COMPLETE',a.mode,len(rows),
		'sha256_full_bytes',True,'flags',len(flags),
		'out',a.out,flush=True)
	for row in flags[:15]:
		print('FLAG',row,flush=True)

if __name__=='__main__':
	main()
