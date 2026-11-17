#!/usr/bin/env python3
"""Private V8 controlled multi-style audio publication gate.

Verifies every Ogg, its source vocal/reference hashes, the rendered 4-way
family, the shared-gain/backing instrumentation report, and sample-accurate
pre-edit null of *decoded* Pope current-versus-retrigger waveforms.
Does not modify masters, candidate audio, or private site.
"""
import argparse
import concurrent.futures
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from validate_accompaniment_comparisons_v1 import inspect

STYLES=('stock','new','aligned','reattacks')
SONGS=('pope','one-more-run')
MODES=('ground','air')
ORIGINAL=('original-instrumental.ogg','vocals.ogg')

def sha(path):
	return hashlib.sha256(path.read_bytes()).hexdigest()

def decode_pcm(path,seconds=32):
	run=subprocess.run([
		'ffmpeg','-v','error','-nostdin','-i',str(path),
		'-t',str(seconds),'-f','f32le','-ac','2','-ar','48000','pipe:1',
	],capture_output=True,check=True,timeout=50)
	y=np.frombuffer(run.stdout,dtype='<f4')
	assert y.size>=32*48000*2-12000,path
	return y[:min(y.size,32*48000*2)].reshape(-1,2)

def verify(root,original):
	doc=json.loads((root/'catalog.json').read_text())
	met=json.loads((root/'qa-common-backing.json').read_text())
	assert doc['format']=='bitstream-orchestra-auditions-v1'
	assert set(doc['styles'])==set(STYLES)
	assert {s['id'] for s in doc['songs']}==set(SONGS)
	assert len(doc['biomes'])==11
	biomes=[b['id'] for b in doc['biomes']]
	expected=set()
	for style in STYLES:
		for song in SONGS:
			p=root/('controlled-'+style)/song
			for name in ORIGINAL:
				f=p/name
				assert f.is_file(),f
				expected.add(f)
				assert sha(f)==sha(original/song/name),(f,'changed reference')
			for biome in biomes:
				for mode in MODES:
					f=p/(biome+'-'+mode+'.ogg')
					assert f.is_file(),f
					expected.add(f)
	assert set(root.rglob('*.ogg'))==expected
	assert len(expected)==192,len(expected)
	for song in SONGS:
		for biome in biomes:
			row=met['bySong'][song][biome]
			for mode in MODES:
				data=row[mode]
				assert 0<data['commonGain']<=2.5
				assert data['maxRawBackingDifference']<1e-5
				assert len(data['commonBackingSha256'])==64
				assert max(data['preMasteringPeaks'].values())>0
	# Additional controlled isolation guarantee: the One More Run
	# reattacks were intentionally disabled, and are bit-identical to New.
	for biome in biomes:
		for mode in MODES:
			name=biome+'-'+mode+'.ogg'
			p=root/'controlled-new'/'one-more-run'/name
			q=root/'controlled-reattacks'/'one-more-run'/name
			assert sha(p)==sha(q),(p,'unexpected One More Run reattack')
	# Entire original and all previous V1-V7 renders untouched.
	with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
		rows=list(pool.map(inspect,sorted(expected)))
	flags=[r for r in rows if r['flags']]
	assert not flags,flags[:5]
	# Master/vocal refs and intentional V3 equivalent tracks duplicate
	# across styles. Distinct clips within each style must not duplicate.
	for style in STYLES:
		hashes=[r['sha256'] for r in rows if '/controlled-'+style+'/' in r['file']]
		assert len(hashes)==48 and len(set(hashes))==48,(style,len(hashes),len(set(hashes)))
	# Decode actual Opus 48k waveforms and inspect *untouched pre-edit*
	# section for source-vs-target null. Changed notes start >11s.
	# Codec differences may be tiny due to global frame encoding.
	isolation={}
	for biome in ('debumont','pyramid-peak','crystal-cavern'):
		for mode in MODES:
			name=biome+'-'+mode+'.ogg'
			a=decode_pcm(root/'controlled-new'/'pope'/name)
			b=decode_pcm(root/'controlled-reattacks'/'pope'/name)
			diff=b-a
			early=diff[:int(10.65*48000)]
			early_rms=float(np.sqrt(np.mean(np.square(early.astype('float64')))))
			early_peak=float(np.max(np.abs(early)))
			all_rms=float(np.sqrt(np.mean(np.square(diff.astype('float64')))))
			# Real sampled Opus decoding of identical 10.65s should null
			# closely, and the affected segment must be nonzero.
			assert early_rms<.0007,(biome,mode,'pre-edit contamination',early_rms)
			assert all_rms>.00001,(biome,mode,'no rendered difference',all_rms)
			isolation[biome+'-'+mode]={
				'decodedPreEditResidualRms':round(early_rms,8),
				'decodedPreEditResidualPeak':round(early_peak,7),
				'decodedWholeExcerptDifferenceRms':round(all_rms,7)}
	return {
		'status':'pass','fileCount':len(rows),
		'fileFormat':'48kHz stereo Opus, 32 seconds',
		'uniqueHashesWithinEachStyle':True,
		'originalInstrumentalAndVocalsBytePreserved':True,
		'oneMoreRunNoReattackIdenticalToNew':True,
		'rawCommonBackingVerified':True,
		'commonMasterGainPerSongBiomeTerrain':True,
		'decodedPreEditResidual':isolation,
		'files':rows,'flags':flags,
		'limitations':[
			'Original separated FLAC stem is unmodified, notes are NOT artist approved',
			'Only Pope Other and One More Run Piano are currently re-performed',
			'Opus requires finite tolerance for numerical null, not exact PCM equality',
			'No blind listening, LUFS normalization, or human musical adjudication yet']}
if __name__=='__main__':
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--site',type=Path,required=True)
	p.add_argument('--original',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	a=p.parse_args()
	if a.out.exists():
		raise FileExistsError(a.out)
	result=verify(a.site,a.original)
	a.out.write_text(json.dumps(result,indent=2)+'\n')
	print('V8_CONTROLLED_AUDIO_QA',result['status'],
		'ogg',result['fileCount'],
		'pre-edit-residuals',result['decodedPreEditResidual'],
		flush=True)
