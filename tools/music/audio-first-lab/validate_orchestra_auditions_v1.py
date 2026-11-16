#!/usr/bin/env python3
"""Read-only content, provenance and decoded-audio audit of private gallery.
Do not publish or mutate the user's original music, private samples,
SoundFont/model weights, or the original 231 audition variants.
"""
import argparse
import concurrent.futures
import hashlib
import json
import math
import subprocess
from pathlib import Path
import numpy as np

BIOMES=('debumont','garbage-dump-glacier','pyramid-peak',
	'underwater-mountain','crystal-cavern','space-mountain',
	'candy-cane-canyon','sky-jellyfish-mountain','steampunk-slopes',
	'micro-mountain','vertigo-vents')

def checksum(file):
	h=hashlib.sha256()
	with file.open('rb') as stream:
		for chunk in iter(lambda:stream.read(2**20),b''):
			h.update(chunk)
	return h.hexdigest()

def inspect(file):
	probe=subprocess.run(['ffprobe','-v','error','-show_entries',
		'stream=codec_name,sample_rate,channels:format=duration',
		'-of','json',str(file)],capture_output=True,text=True,check=True,
		timeout=20)
	p=json.loads(probe.stdout)
	stream=p['streams'][0]
	duration=float(p['format']['duration'])
	s=subprocess.run(['ffmpeg','-v','error','-nostdin','-ss','9.2','-i',
		str(file),'-t','2.0','-ac','1','-ar','11025','-f','f32le','pipe:1'],
		capture_output=True,check=True,timeout=40)
	audio=np.frombuffer(s.stdout,dtype='<f4')
	rms=float(np.sqrt(np.mean(audio.astype('float64')**2)))
	peak=float(np.max(abs(audio)))
	flags=[]
	if stream['codec_name']!='opus':flags.append('not_opus')
	if int(stream['sample_rate'])!=48000:flags.append('wrong_sample_rate')
	if int(stream['channels'])!=2:flags.append('not_stereo')
	if not 31.85<duration<32.2:flags.append('wrong_length')
	if not np.all(np.isfinite(audio)):flags.append('nonfinite')
	if rms<.001:flags.append('very_low_sample_rms')
	if peak>1.03:flags.append('decoded_sample_above_1_03')
	return {'file':str(file),'sha256':checksum(file),
		'bytes':file.stat().st_size,'durationSeconds':round(duration,4),
		'decodedSampleRms':round(rms,5),
		'decodedSamplePeak':round(peak,5),'flags':flags}

def validate(root,inputroot):
	doc=json.loads((root/'catalog.json').read_text())
	assert doc['format']=='bitstream-orchestra-auditions-v1'
	assert doc['seconds']==32 and doc['sampleRate']==48000
	assert len(doc['biomes'])==11
	assert [row['id'] for row in doc['biomes']]==list(BIOMES)
	assert len(doc['songs'])==2
	expected=set()
	for song in doc['songs']:
		assert song['featured'] in ('other','piano','guitar')
		assert set(song['unselectedPreserved']) == (
			{'guitar','piano','other'}-{song['featured']})
		assert len(song['variants'])==11
		base=root/song['id']
		expected.add(base/song['originalReference'])
		expected.add(base/song['vocals'])
		assert checksum(base/'vocals.ogg')==checksum(
			inputroot/song['id']/'original/vocals.ogg')
		for biome in BIOMES:
			var= song['variants'][biome]
			assert var['originalAccompanimentPreserved']==song['unselectedPreserved']
			assert var['featureNotes']>0 and var['foleyEvents']>0
			for mode in ('ground','air'):
				expected.add(base/var[mode])
				stats=var[mode+'Stats']
				assert 0.008<stats['rms']<.27
				assert 0.001<stats['peak']<=.891
	files=set(root.rglob('*.ogg'))
	assert files==expected, f'Missing/unexpected files: {len(files^expected)}'
	with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
		rows=list(pool.map(inspect,sorted(files)))
	flags=[row for row in rows if row['flags']]
	hashes=[row['sha256'] for row in rows]
	assert len(set(hashes))==len(hashes), 'Duplicate audio assets detected'
	size=sum(row['bytes'] for row in rows)
	output={
		'status':'pass' if not flags else 'warning',
		'format':doc['format'],'songs':len(doc['songs']),
		'biomes':len(BIOMES),'privateOggCount':len(files),
		'sha256Unique':len(set(hashes)),
		'fullContentHashed':True,'decodedWindowSeconds':2,
		'sourceVocalsBytePreserved':True,
		'totalOggBytes':size,
		'flags':flags,'files':rows,
		'limitations':['32-second excerpts only, not full songs',
			'Brief PCM decode does not certify musical note accuracy',
			'Human listening, source timbral approval, licensing and game integration pending',
			'Source original vocal bytes hashed exactly against private original']}
	return output

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--site',type=Path,required=True)
	p.add_argument('--input',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	a=p.parse_args()
	if a.out.exists():raise SystemExit('Do not overwrite prior QA result')
	result=validate(a.site,a.input)
	a.out.write_text(json.dumps(result,indent=2)+'\n')
	print('ORCHESTRA_QA',result['status'],
		'songs',result['songs'],'biomes',result['biomes'],
		'ogg',result['privateOggCount'],'unique_sha',result['sha256Unique'],
		'bytes',result['totalOggBytes'],
		'flag_count',len(result['flags']),flush=True)
	for row in result['flags']:
		print('QA_FLAG',row['file'],row['flags'])
	if result['flags']:raise SystemExit(2)

if __name__=='__main__':
	main()
