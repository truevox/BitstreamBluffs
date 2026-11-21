#!/usr/bin/env python3
"""Source-OGG spectral-flux periodicity: alternative to low-frequency attacks.

All BPM values are periodicity hypotheses, not musical tempo/downbeat labels.
Source PCM decoding is read-only. Segment-boundary onset transients are masked.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.signal import stft

from research_variable_tempo import validate_source_manifest

FORMAT = 'bitstream-source-spectral-onset-tempo-UNVERIFIED-v1'
STATUS = 'RESEARCH_ONLY_NO_TRUE_BEAT_OR_DOWNBEAT_APPROVAL'
SOURCE_RATE = 48000
RATE = 11025
HOP = 64
TICK = HOP / RATE
FFT = 1024
ROLES = ('drums', 'bass', 'guitar', 'piano', 'other')
WINDOW_SECONDS = 18
STRIDE_SECONDS = 6


def decode_original(path:Path, source_seconds:float) -> np.ndarray:
	p=subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(path),
		'-t',str(source_seconds+.1),'-ac','1','-ar',str(RATE),
		'-f','f32le','pipe:1'],timeout=40,capture_output=True,check=True)
	pcm=np.frombuffer(p.stdout,dtype='<f4').astype(np.float64)
	if len(pcm)<RATE*(source_seconds-.07):
		raise ValueError(f'Decoded original source shorter than manifest: {path}')
	return pcm[:round(source_seconds*RATE)]


def spectral_onset(pcm:np.ndarray) -> np.ndarray:
	"""Positive spectral change, independent of prior low-band RMS detector.

	Separate bands plus compression avoid equating loudness with rhythmic onset.
	No per-source time stretching/beat quantization is performed.
	"""
	if len(pcm)<RATE * 1.0:
		return np.zeros(0,dtype=np.float64)
	if not np.isfinite(pcm).all():raise ValueError('Nonfinite source PCM')
	f,_,spec=stft(pcm,fs=RATE,nperseg=FFT,noverlap=FFT-HOP,
		boundary='zeros',padded=False)
	# More than the prior 160Hz drum detector, by design.
	band=(f>=230)&(f<=4700)
	mag=np.log1p(np.abs(spec[band])*1600)
	# Per-bin adaptive whitening de-emphasizes persistent harmonics, before
	# positive spectral flux. No hard-coded chord, melody or meter labels.
	local=gaussian_filter1d(mag,sigma=25,axis=1,mode='nearest')
	whitened=np.maximum(0,mag-local*.80)
	flux=np.maximum(0,np.diff(whitened,axis=1,prepend=whitened[:,:1]))
	onset=np.mean(flux,axis=0)
	onset=gaussian_filter1d(onset,sigma=1.2)
	onset=np.maximum(0,onset-np.percentile(onset,35))
	peak=np.percentile(onset,99)
	return np.clip(onset/peak,0,1) if peak>1e-5 else np.zeros_like(onset)



def expected_original_hashes(prior_path:Path,harmonic_path:Path,manifest_hash:str):
	"""Bind every source stem to the *existing* independently saved SHA list."""
	prior_bytes=prior_path.read_bytes();harmonic_bytes=harmonic_path.read_bytes()
	prior=json.loads(prior_bytes);harmonic=json.loads(harmonic_bytes)
	if (prior['manifestSha256']!=manifest_hash or harmonic['manifestSha256']!=manifest_hash
		or prior['status']!='UNVERIFIED_NO_BEAT_OR_DOWNBEAT_APPROVAL'
		or harmonic['status']!='SOURCE_HARMONIC_CUES_NOT_APPROVED_DOWNBEATS'):
		raise ValueError('Existing source-fingerprint report/status mismatch')
	if hashlib.sha256(prior_bytes).hexdigest()!=harmonic['drumBassResearchReportSha256']:
		raise ValueError('Harmonic report does not bind this exact prior source report')
	if len(prior['windows'])!=15 or len(harmonic['windows'])!=15:
		raise ValueError('Missing original source windows in SHA source chain')
	result={}
	for a,b in zip(prior['windows'],harmonic['windows']):
		index=a['segmentIndex']
		if b['segmentIndex']!=index or a['sourceStartSeconds']!=b['sourceStartSeconds']:
			raise ValueError('Original source windows do not align')
		evidence={**a['stemEvidence'],**b['stemEvidence']}
		if not all(role in evidence and len(evidence[role]['sha256'])==64 for role in ROLES):
			raise ValueError('Missing original stem hash evidence')
		result[str(index)]={role:evidence[role]['sha256'] for role in ROLES}
	return result,{'priorReportSha256':hashlib.sha256(prior_bytes).hexdigest(),
		'harmonicReportSha256':hashlib.sha256(harmonic_bytes).hexdigest()}


def source_spectral_envelopes(pack:Path, manifest:dict,expected_hashes:dict):
	length=round(manifest['frameCount']/SOURCE_RATE/TICK)+3
	out={role:np.zeros(length,dtype=np.float32) for role in ROLES}
	hashes={}
	for index,seg in enumerate(manifest['segments']):
		start=round(seg['startFrame']/SOURCE_RATE/TICK)
		seconds=seg['frames']/SOURCE_RATE
		n=round(seconds/TICK)
		hashes[str(index)]={}
		for role in ROLES:
			f=pack/seg['sources'][role]
			if not f.is_file():raise FileNotFoundError(f)
			hashes[str(index)][role]=hashlib.sha256(f.read_bytes()).hexdigest()
			if hashes[str(index)][role]!=expected_hashes[str(index)][role]:
				raise ValueError(f'Original OGG SHA-256 source tampering/mismatch: {role} window {index}')
			v=spectral_onset(decode_original(f,seconds))[:n]
			if len(v)<max(1,n-8):raise ValueError('Missing spectral frames')
			if index>0:v[:min(35,len(v))]=0
			if index<len(manifest['segments'])-1:v[max(0,len(v)-35):]=0
			out[role][start:start+len(v)]=v
	return out,hashes


def acf_periodicity(x:np.ndarray, min_bpm=140,max_bpm=180)->dict:
	"""High-frequency spectral-flux onset autocorrelation (not beat tracking)."""
	x=np.asarray(x,dtype=np.float64)
	if not len(x) or not np.isfinite(x).all() or np.any(x<0):
		raise ValueError('Spectral onset input must be finite, non-negative, non-empty')
	mu=gaussian_filter1d(x,sigma=max(1,round(.15/TICK)))
	centered=x-mu
	if np.std(centered)<.006:
		return {'status':'INSUFFICIENT_EVIDENCE','candidateOnly':True,'preferredBpm':None,
			'preferredLagTicks':None,'rankedPeriods':[]}
	centered/=np.std(centered)
	min_lag=max(2,round(60/max_bpm/TICK))
	max_lag=min(len(centered)-2,round(60/min_bpm/TICK))
	if min_lag>=max_lag:raise ValueError('Analysis window too short for tempo alternatives')
	def strength(t):return float(np.dot(centered[:-t],centered[t:])/len(centered[:-t]))
	rows=[]
	for lag in range(min_lag,max_lag+1):
		left,at,right=strength(lag-1),strength(lag),strength(lag+1)
		denom=left-2*at+right
		interpolated=lag+(np.clip(.5*(left-right)/denom,-.5,.5) if denom< -1e-10 else 0.)
		rows.append({'lagTicks':lag,'interpolatedLagTicks':round(float(interpolated),5),
			'candidateBpm':round(float(60/(interpolated*TICK)),4),
			'autocorrelation':round(at,5)})
	rows.sort(key=lambda r:(-r['autocorrelation'],r['lagTicks']))
	return {'status':'CANDIDATES_UNVERIFIED','candidateOnly':True,
		'preferredBpm':rows[0]['candidateBpm'],
		'preferredLagTicks':rows[0]['lagTicks'],
		'peakContrast':round(rows[0]['autocorrelation']-rows[1]['autocorrelation'],5),
		'rankedPeriods':rows[:5]}


def assess(pack:Path,prior:Path,harmonic:Path):
	manifest,digest=validate_source_manifest(pack,prior)
	expected,provenance=expected_original_hashes(prior,harmonic,digest)
	envelopes,stem_hashes=source_spectral_envelopes(pack,manifest,expected)
	bound=manifest['frameCount']/SOURCE_RATE
	regions=[]
	for start in range(0,180,STRIDE_SECONDS):
		end=min(start+WINDOW_SECONDS,bound)
		if end-start<10:continue
		a,b=round(start/TICK),round(end/TICK)
		periods={role:acf_periodicity(envelopes[role][a:b]) for role in ROLES}
		core=[periods[role] for role in ('drums','bass','guitar','piano')]
		usable=[p['preferredBpm'] for p in core if p['preferredBpm'] is not None]
		# This range is a descriptive spread, not a calibrated error bar.
		spread=round(max(usable)-min(usable),3) if len(usable)>=2 else None
		regions.append({'sourceStartSeconds':start,'sourceEndSeconds':round(end,3),
			'periodicities':periods,'coreRoleBpmRange':spread,
			'rolesWithin3BpmOfDrum':sum(abs(periods[role]['preferredBpm']-periods['drums']['preferredBpm'])<=3
				for role in ('bass','guitar','piano') if periods[role]['preferredBpm'] is not None and periods['drums']['preferredBpm'] is not None),
			'status':'UNVERIFIED_CANDIDATE_ONLY'})
	return {'format':FORMAT,'status':STATUS,'trackId':manifest['id'],
		'sourceManifestSha256':digest,**provenance,'sourceFrameCount':manifest['frameCount'],
		'sourceSampleRate':SOURCE_RATE,'sourceStemSha256':stem_hashes,
		'method':'Original OGG 230-4700Hz log spectral flux from drums, bass, guitar, piano and other, 5.8ms frames; 18s/6s overlapping window local autocorrelation and 3-point lag interpolation',
		'analysisTickSeconds':TICK,'windowLengthSeconds':WINDOW_SECONDS,'windowStrideSeconds':STRIDE_SECONDS,
		'limitations':['Spectral onset periodicity is not verified musical quarter note, beat one, tempo stability, or tempo drift',
			'Five Demucs-derived stems are correlated by shared mixture and may contain bleed',
			'All frequency hypotheses restricted to 140–180 BPM; do not rule out half time or different meter',
			'Segment 12s seams masked, but residual codec and separation artifacts possible',
			'Overlapping 18s windows are correlated and cannot count as 28 independent experiments',
			'Fractional-bin interpolation on a 5.8ms grid is not 48k sample-accurate measurement',
			'No original mix source PCM was independently analyzed, so do not call this separate audio ground truth',
			'Never promote these frequency candidates into RELEASE_BEAT_GRIDS or gameplay without independent musician confirmation'],
		'regions':regions}


def main():
	p=argparse.ArgumentParser()
	p.add_argument('--source-pack',required=True,type=Path)
	p.add_argument('--prior-report',required=True,type=Path)
	p.add_argument('--harmonic-report',required=True,type=Path)
	p.add_argument('--out',required=True,type=Path)
	a=p.parse_args()
	if a.out.exists():raise SystemExit('Refusing overwrite of existing evidence')
	result=assess(a.source_pack,a.prior_report,a.harmonic_report)
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(result,indent=2)+'\n')
	print('REPORT_SHA256',hashlib.sha256(a.out.read_bytes()).hexdigest())
	for w in result['regions']:
		print('WINDOW',w['sourceStartSeconds'],'drums',w['periodicities']['drums']['preferredBpm'],
			'bass',w['periodicities']['bass']['preferredBpm'],
			'guitar',w['periodicities']['guitar']['preferredBpm'],
			'piano',w['periodicities']['piano']['preferredBpm'],
			'other',w['periodicities']['other']['preferredBpm'],
			'other_support',w['rolesWithin3BpmOfDrum'])
if __name__=='__main__':main()
