#!/usr/bin/env python3
"""Source-bound, explicitly UNVERIFIED One More Run downbeat hypotheses.

Two distinct onset streams: low-frequency transients in the actual drums OGG,
and attack/change salience in the original bass OGG. This does NOT establish
meter, an absolute bar number, or source-verified downbeats. No original audio
or public-release metadata is modified. Intended as a reviewer packet.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter1d, uniform_filter1d
from scipy.signal import butter, sosfilt

RATE=11025
HOP=110
TICK=HOP/RATE
DEFAULT_BPM_HYPOTHESES=(160.0,161.5,163.84)
DEFAULT_WINDOWS=(0,1,2,5,6,9,12,13)
FORMAT='bitstream-source-downbeat-candidate-research-v0'
STATUS='UNVERIFIED_NO_BEAT_OR_DOWNBEAT_APPROVAL'


def decoded_mono(path:Path,seconds=11.5)->np.ndarray:
	p=subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(path),
		'-t',str(seconds),'-ac','1','-ar',str(RATE),'-f','f32le','pipe:1'],
		capture_output=True,timeout=35,check=True)
	return np.frombuffer(p.stdout,'<f4').astype(np.float64)


def onset_energy(samples,mode='drum'):
	"""Source-domain envelope in 10ms frames. No trained genre assumptions."""
	if len(samples)<RATE*3:return np.zeros(0,dtype=np.float64)
	if mode=='drum':
		signal=sosfilt(butter(3,160,fs=RATE,output='sos'),samples)
	else:
		signal=sosfilt(butter(3,260,fs=RATE,output='sos'),samples)
	energy=signal**2
	short=np.sqrt(np.maximum(0,uniform_filter1d(energy,size=240)[::HOP]))
	long=np.sqrt(np.maximum(0,uniform_filter1d(energy,size=920)[::HOP]))
	flux=np.maximum(0,np.diff(np.log1p(short*120),prepend=np.log1p(short[0]*120)))
	ratio=np.maximum(0,short/(long+1e-5)-1)
	strength=gaussian_filter1d(flux*.76+ratio*.24,sigma=1)
	strength=np.maximum(0,strength-np.percentile(strength,50))
	peak=float(np.percentile(strength,99))
	if peak<1e-5:return np.zeros(len(strength))
	return np.clip(strength/peak,0,1)


def salience_at(envelope,seconds,radius=.065):
	"""Maximum onset near candidate pulse (accounts for rough transient offset)."""
	if not np.isfinite(seconds):return 0.
	center=int(round(seconds/TICK))
	window=max(1,int(round(radius/TICK)))
	start=max(0,center-window)
	end=min(len(envelope),center+window+1)
	return float(np.max(envelope[start:end])) if end>start else 0.


def phase_candidates(drums,bass,bpm,sourceStartSeconds=0.,topN=4):
	"""Rank *all* beat phase and 4-way meter-position hypotheses, not just one.

	The first suggested 'bar start' is a mathematical label for the local
	4-pulse group. Competing offsets persist, so ambiguities stay explicit.
	"""
	assert len(drums)>0 and len(bass)>0
	span=min(len(drums),len(bass))*TICK
	period=60./bpm
	phases=np.arange(0,period,TICK*1.25)
	if span<period*9:raise ValueError('Insufficient source window for 4/4 hypotheses')
	rows=[]
	for phase in phases:
		pulse=np.arange(phase,span-.1,period)
		if len(pulse)<9:continue
		d=np.asarray([salience_at(drums,t) for t in pulse]);b=np.asarray([salience_at(bass,t) for t in pulse])
		# Beat-phase support must exist on both independent channels; the
		# arbitrary 4-way bar offset is scored primarily by recurring kicks/
		# bass changes, while contrasting other beats and preserving rivals.
		phaseDrums=float(d.mean());phaseBass=float(b.mean())
		phaseSupport=(phaseDrums+phaseBass)/2.
		for offset in range(4):
			bar=np.arange(offset,len(pulse),4)
			other=np.array([i for i in range(len(pulse)) if i%4!=offset])
			if len(bar)<2 or len(other)<4:continue
			barDrum=float(d[bar].mean());barBass=float(b[bar].mean())
			otherDrum=float(d[other].mean());otherBass=float(b[other].mean())
			# Modest bar-accent contrast, avoids large false precision from
			# constant quarter notes or snare backbeat; source independent.
			contrast=.5*(barDrum-otherDrum)+.5*(barBass-otherBass)
			score=.50*phaseSupport+.50*max(-.25,contrast)
			starts=[round(sourceStartSeconds+float(t),4) for t in pulse[bar]]
			rows.append({'bpmHypothesis':round(float(bpm),3),
				'beatPhaseWithinWindowSeconds':round(float(phase),4),
				'barOffsetBeats':offset,
				'localBarStartSourceSeconds':starts,
				'phaseSupport':round(phaseSupport,4),
				'drumDownbeatContrast':round(barDrum-otherDrum,4),
				'bassDownbeatContrast':round(barBass-otherBass,4),
				'combinedEvidenceScore':round(score,4),
				'candidateOnly':True})
	# Choose distinctive *beat phase* proposals, but carry ALL FOUR meter
	# identities for EACH one. A drum pulse is not a proof of which beat is 1.
	rows.sort(key=lambda x:(x['combinedEvidenceScore'],x['phaseSupport']),reverse=True)
	selected=[];seen=[]
	for row in rows:
		phase=row['beatPhaseWithinWindowSeconds']
		if any(abs(phase-old)<.035 for old in seen):continue
		seen.append(phase)
		alternatives=[r for r in rows if r['beatPhaseWithinWindowSeconds']==phase]
		assert len(alternatives)==4
		spread=round(alternatives[0]['combinedEvidenceScore']-alternatives[-1]['combinedEvidenceScore'],4)
		for rank,candidate in enumerate(alternatives,1):
			selected.append({**candidate,'meterOffsetRankWithinPhase':rank,
				'fourWayEvidenceSpread':spread,
				'meterOffsetAmbiguous':spread<.08})
		if len(seen)>=topN:break
	return selected


def build_report(pack_dir,segments=DEFAULT_WINDOWS):
	path=pack_dir/'pack.json'
	manifest=path.read_bytes()
	meta=json.loads(manifest)
	assert meta['id']=='local-one-more-run-bitstream-bluffs'
	assert meta['sampleRate']==48000
	out=[]
	for index in segments:
		seg=meta['segments'][index]
		start=seg['startFrame']/meta['sampleRate']
		stems={}
		envelopes={}
		for role in ('drums','bass'):
			f=pack_dir/seg['sources'][role]
			assert f.is_file(),f
			a=decoded_mono(f)
			# Last original segment is only 6.6s; preserve it as a short,
			# lower-evidence source window instead of silently dropping it.
			expected_seconds=seg['frames']/meta['sampleRate']
			if len(a)<RATE*min(10.,expected_seconds-.3):
				raise ValueError(f'Short source segment: {f}')
			envelopes[role]=onset_energy(a,mode='drum' if role=='drums' else 'bass')
			stems[role]={'relativePath':seg['sources'][role],
				'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),
				'analysisSeconds':round(len(a)/RATE,4),
				'rootMeanSquare':round(float(np.sqrt(np.mean(a*a))),5),
				'onsetDensity':round(float(envelopes[role].mean()),5)}
		perBpm=[]
		for bpm in DEFAULT_BPM_HYPOTHESES:
			c=phase_candidates(envelopes['drums'],envelopes['bass'],bpm,start)
			perBpm.append({'bpm':bpm,'rankedLocalCandidates':c})
		# Do NOT collapse to one winner across different BPM candidates;
		# intentional 160 BPM prompt differs from audio phase verification.
		out.append({'segmentIndex':index,'sourceStartSeconds':round(start,4),
			'sourceEndSeconds':round((seg['startFrame']+seg['frames'])/meta['sampleRate'],4),
			'status':'uncertain','reviewerStatus':'pending','meter':'unverified',
			'stemEvidence':stems,'hypotheses':perBpm})
		print('SOURCE_WINDOW',index,'t=',round(start,3),
			'bpm phase candidates',[(h['bpm'],h['rankedLocalCandidates'][0]['beatPhaseWithinWindowSeconds'],
				h['rankedLocalCandidates'][0]['barOffsetBeats']) for h in perBpm],flush=True)
	return {'format':FORMAT,'status':STATUS,
		'trackId':meta['id'],'sourceSampleRate':meta['sampleRate'],
		'sourceFrameCount':meta['frameCount'],
		'manifestSha256':hashlib.sha256(manifest).hexdigest(),
		'intendedGenerationBpm':160,
		'bpmHypotheses':list(DEFAULT_BPM_HYPOTHESES),
		'method':'Original OGG low-band drum attacks plus independently analyzed bass attacks; 4-way 4/4 meter offset ranking on local 11.5-second source segments' + (' (final original 6.6-second segment shorter)' if 14 in segments else ''),
		'confidence':'NOT_ESTABLISHED: candidate evidence score is not confidence or a trust gate',
		'limitations':['No genuine beat phase, tempo, meter or downbeat approval','Original song may have pickup or half-time feel','Source separation artifacts and inferred bass attacks','Local phase offsets can drift between source sections','4/4 is test hypothesis; 2/4, 6/8 and other meters not ruled out','The four ranked bar offsets may be musically equivalent under sparse/percussive arrangements','Human and independent musical spot checks absent','Never use to release Gym or affect gameplay/World Dance until verified'],
		'windows':out}


def main():
	p=argparse.ArgumentParser()
	p.add_argument('--source-pack',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	p.add_argument('--all-windows',action='store_true',
		help='Research all 15 original segments, including the shorter ending')
	a=p.parse_args()
	if a.out.exists():raise SystemExit('Refusing overwrite of existing candidate report')
	a.out.parent.mkdir(parents=True,exist_ok=True)
	report=build_report(a.source_pack,segments=tuple(range(15)) if a.all_windows else DEFAULT_WINDOWS)
	a.out.write_text(json.dumps(report,indent=2)+'\n')
	print('RESEARCH_OUTPUT',a.out,'sha256',hashlib.sha256(a.out.read_bytes()).hexdigest(),flush=True)

if __name__=='__main__':main()
