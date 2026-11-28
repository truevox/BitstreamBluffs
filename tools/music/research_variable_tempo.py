#!/usr/bin/env python3
"""EXPERIMENTAL source-audio variable-tempo tracking (not human-verified beats).

Treats the original 15 segments as one continuous timeline.  DP scores possible
quarter notes with a changing period, without resetting phase at OGG segment
boundaries.  Reports rival stable-tempo and variable-tempo hypotheses, with
source SHA-256 provenance and held-out bass observations.  It DOES NOT infer
4/4 bar-one identity, chords, a section boundary, or gameplay timing.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.ndimage import maximum_filter1d, gaussian_filter1d

from research_original_downbeat_candidates import RATE, TICK, onset_energy, decoded_mono

FORMAT='bitstream-original-song-variable-tempo-research-v1'
STATUS='UNVERIFIED_SOURCE_BEAT_TRACK_RESEARCH_NO_PRODUCTION_APPROVAL'
SOURCE_RATE=48000
DRIFT_BOUNDARY_MASK_SECONDS=.18
PERIOD_FRAMES=tuple(range(33,45))  # 136.36–181.82 BPM, not evidence of actual range
CENTER_BPM=160.
CENTER_PERIOD=60./CENTER_BPM/TICK


def validate_source_manifest(pack_dir: Path, research_doc: Path) -> tuple[dict,str]:
	original=(pack_dir/'pack.json').read_bytes()
	manifest=json.loads(original)
	report=json.loads(research_doc.read_bytes())
	digest=hashlib.sha256(original).hexdigest()
	if digest != report['manifestSha256'] or digest != 'e7d5b95ecb258c86551fd242ceb9696427c1655dc91d11b95b60dd6ef0647d6a':
		raise ValueError('Original exact source manifest does not match prior experiment')
	if report['status']!='UNVERIFIED_NO_BEAT_OR_DOWNBEAT_APPROVAL' or len(report['windows'])!=15:
		raise ValueError('Source candidate status or original segment count not as expected')
	if manifest['sampleRate']!=SOURCE_RATE or manifest['frameCount']!=8380800:
		raise ValueError('Unexpected original song sample-frame timeline')
	if len(manifest['segments'])!=15:
		raise ValueError('Original song should contain exactly 15 segments')
	cursor=0
	for i,seg in enumerate(manifest['segments']):
		if seg['startFrame']!=cursor:raise ValueError(f'Gapped source timeline at {i}')
		cursor+=seg['frames']
	if cursor!=manifest['frameCount']:raise ValueError('Original segments do not cover the song')
	return manifest,digest


def source_onsets(pack_dir:Path,manifest:dict) -> tuple[dict[str,np.ndarray],dict]:
	length=int(np.ceil(manifest['frameCount']/SOURCE_RATE/TICK))+1
	channels={role:np.zeros(length,dtype=np.float64) for role in ('drums','bass')}
	fingerprints={}
	mask=int(round(DRIFT_BOUNDARY_MASK_SECONDS/TICK))
	for i,seg in enumerate(manifest['segments']):
		start=round(seg['startFrame']/SOURCE_RATE/TICK)
		span=round(seg['frames']/SOURCE_RATE/TICK)
		fingerprints[str(i)]={}
		for role in ('drums','bass'):
			src=pack_dir/seg['sources'][role]
			if not src.is_file():raise FileNotFoundError(src)
			fingerprints[str(i)][role]=hashlib.sha256(src.read_bytes()).hexdigest()
			samples=decoded_mono(src,seconds=seg['frames']/SOURCE_RATE+.1)
			if len(samples) < seg['frames']/SOURCE_RATE*RATE-.05*RATE:
				raise ValueError(f'Truncated original source stem {src}')
			envelope=onset_energy(samples,mode='drum' if role=='drums' else 'bass')[:span]
			# Per-OGG decode/filter starts artificially sharp and segmented; mask their
			# short edges instead of interpreting a split as a musical kick.
			if i:envelope[:mask]=0
			if i!=len(manifest['segments'])-1:envelope[max(0,len(envelope)-mask):]=0
			channels[role][start:start+len(envelope)]=envelope
	return channels,fingerprints


def observation(envelope:np.ndarray, radius=2) -> np.ndarray:
	"""Allow peak ±20ms for onset extraction jitter; preserve empty sections."""
	return gaussian_filter1d(maximum_filter1d(envelope,size=2*radius+1),.6)


def track_beats(onsets:np.ndarray, periods=PERIOD_FRAMES, onset_weight=1.,
	change_penalty=.14, target_penalty=.011, cost_per_beat=.36) -> dict:
	"""Single continuous, tempo-smooth best candidate; NO claim beat correctness.

	A sparse Viterbi graph has node (original-song tick, previous beat period).
	Edges connect successive candidate beats, forbid period changes >20ms per
	beat, and penalize acceleration and deviation from the loose 160 BPM prior.
	First beat is allowed anywhere in the first ~one nominal beat period.
	"""
	signal=np.asarray(onsets,dtype=np.float64)
	if not len(signal) or not np.isfinite(signal).all() or not (signal>=0).all():
		raise ValueError('Finite, non-negative onset evidence required')
	if (np.percentile(signal,98)<.06 or np.std(signal)<.015):
		raise ValueError('Insufficient distinct source rhythm evidence; do not invent a beat grid')
	periods=np.array(periods,dtype=int)
	if periods.ndim!=1 or not len(periods) or np.any(periods<=0) or np.any(np.diff(periods)<=0):
		raise ValueError('Strictly ascending positive period ticks required')
	n=len(signal);k=len(periods)
	best=np.full((n,k),-np.inf,dtype=np.float32)
	prev=np.full((n,k),-1,dtype=np.int16)
	penalty=change_penalty*np.square(periods[:,None]-periods[None,:])
	penalty[np.abs(periods[:,None]-periods[None,:])>2]=np.inf
	period_prior=target_penalty*np.square(periods-CENTER_PERIOD)
	seed_until=min(n,int(np.ceil(max(periods))))
	for t in range(n):
		emission=float(signal[t])*onset_weight-cost_per_beat
		for i,p in enumerate(periods):
			score=emission-period_prior[i]
			if t<seed_until: best[t,i]=score
			from_t=t-p
			if from_t<0:continue
			candidates=best[from_t]-penalty[i]
			idx=int(np.argmax(candidates));old=float(candidates[idx])
			if np.isfinite(old) and old+score>best[t,i]:
				best[t,i]=old+score
				prev[t,i]=idx
	# Last beat may precede track end by up to one beat; avoid rewarding
	# trajectories that end early instead of covering the whole song.
	last=max(0,n-int(max(periods)))
	end_idx=np.unravel_index(int(np.argmax(best[last:])), best[last:].shape)
	t=last+end_idx[0];i=end_idx[1]
	if not np.isfinite(best[t,i]):raise ValueError('No candidate continuity track')
	final_score=float(best[t,i]);times=[];period_indices=[]
	while t>=0:
		times.append(t);period_indices.append(int(periods[i]))
		idx=int(prev[t,i]);
		if idx<0:break
		t-=int(periods[i]);i=idx
	times.reverse();period_indices.reverse()
	if len(times)>1 and any((b-a) not in periods for a,b in zip(times,times[1:])):
		raise AssertionError('Nonlegal time step in candidate path')
	if not len(times) or times[0]>=seed_until or times[-1]<last:
		raise AssertionError('Candidate track does not cover full timeline')
	return {'ticks':times,'interBeatTicks':[b-a for a,b in zip(times,times[1:])],
		'rawObjective':round(final_score,4), 'candidateOnly':True}


def fixed_tempo_candidate(onsets:np.ndarray,bpm_values=np.arange(150.,171.,.25)) -> dict:
	"""Best static-period pulse-grid control measured on the same envelope."""
	best=None
	for bpm in bpm_values:
		period=(60./bpm)/TICK
		for phase in np.arange(0,period,2.):
			ticks=np.rint(np.arange(phase,len(onsets)-.5,period)).astype(int)
			ticks=ticks[(ticks>=0)&(ticks<len(onsets))]
			if not len(ticks):continue
			score=float(onsets[ticks].mean())
			if best is None or score>best['meanDrumEvidence']:
				best={'bpm':round(float(bpm),3),'phaseSeconds':round(float(phase*TICK),4),
				'meanDrumEvidence':round(score,5),'ticks':ticks.tolist(),
				'candidateOnly':True}
	return best


def evaluate(signal:np.ndarray,ticks:list[int]) -> float:
	return round(float(np.mean(signal[np.asarray(ticks,dtype=int)])),5)


def period_summary(track:dict,start:float,end:float) -> dict:
	p=[period for period, tick in zip(track['interBeatTicks'],track['ticks'][1:])
		if start <=tick*TICK<end]
	if not p:return {'meanCandidateBpm':None,'intervals':0}
	return {'meanCandidateBpm':round(float(60/(np.mean(p)*TICK)),2),
		'minCandidateBpm':round(float(60/(max(p)*TICK)),2),
		'maxCandidateBpm':round(float(60/(min(p)*TICK)),2),
		'intervals':len(p)}


def report(manifest:dict,manifest_digest:str,channels:dict,hashes:dict)->dict:
	drum=observation(channels['drums']); bass=observation(channels['bass'])
	candidate=track_beats(drum)
	baseline=fixed_tempo_candidate(drum)
	bass_candidate=track_beats(bass)
	bass_baseline=fixed_tempo_candidate(bass)
	matched=np.asarray(bass_candidate['ticks'])
	difference=np.asarray([np.min(np.abs(matched-t))*TICK for t in candidate['ticks']])
	settings=((.08,.007),(.14,.011),(.28,.020))
	sensitivity=[]
	for label,input_signal,independent in [('drum',drum,bass),('bass',bass,drum)]:
		control=fixed_tempo_candidate(input_signal)
		for change,prior in settings:
			track=track_beats(input_signal,change_penalty=change,target_penalty=prior)
			sensitivity.append({'trainingRole':label, 'transitionPenalty':change,
				'priorPenalty':prior,'beatCount':len(track['ticks']),
				'fitEvidence':evaluate(input_signal,track['ticks']),
				'heldOutEvidence':evaluate(independent,track['ticks']),
				'heldOutFixedControl':evaluate(independent,control['ticks']),
				'heldOutDifference':round(evaluate(independent,track['ticks'])-
					evaluate(independent,control['ticks']),5)})
	observed=[int(round(t*TICK*SOURCE_RATE)) for t in candidate['ticks']]
	if observed!=sorted(set(observed)):raise ValueError('Invalid candidate frame positions')
	regions=[{'startSeconds':start,'endSeconds':min(start+12,manifest['frameCount']/SOURCE_RATE),
		**period_summary(candidate,start,min(start+12,manifest['frameCount']/SOURCE_RATE))}
		for start in range(0,180,12) if start<manifest['frameCount']/SOURCE_RATE]
	constant_bass=evaluate(bass,baseline['ticks'])
	variable_bass=evaluate(bass,candidate['ticks'])
	return {'format':FORMAT,'status':STATUS,'sourceId':manifest['id'],
		'sourceSampleRate':SOURCE_RATE,'sourceFrameCount':manifest['frameCount'],
		'sourceManifestSha256':manifest_digest,
		'originalStemSha256':hashes,
		'analysisTickSeconds':TICK,
		'inputRoles':['original drums OGG (tracking input)','original bass OGG (held-out comparison only)'],
		'candidateGrid':{'timesSourceFrames':observed,
			'localInterBeatFrames':[(b-a) for a,b in zip(observed,observed[1:])],
			'objective':candidate['rawObjective'], 'candidateOnly':True,
			'beatOneOffsets':'UNKNOWN_NOT_APPROVED',
			'actualMeter':'UNKNOWN_NOT_APPROVED',
			'halfTimeFeel':'UNREVIEWED'},
		'fixedGridControl':{'bpm':baseline['bpm'],'phaseSeconds':baseline['phaseSeconds'],
			'beatCount':len(baseline['ticks']),'drumOnsetMean':baseline['meanDrumEvidence'],
			'heldOutBassOnsetMean':constant_bass},
		'alternateBassDrivenAssessment':{'beatCount':len(bass_candidate['ticks']),
			'bassFitOnsetMean':evaluate(bass,bass_candidate['ticks']),
			'heldOutDrumMean':evaluate(drum,bass_candidate['ticks']),
			'heldOutDrumFixedControl':evaluate(drum,bass_baseline['ticks']),
			'heldOutDrumDifferenceVsBassFixed':round(evaluate(drum,bass_candidate['ticks'])-
				evaluate(drum,bass_baseline['ticks']),5),
			'first15CandidateSourceFrames':[int(round(t*TICK*SOURCE_RATE)) for t in bass_candidate['ticks'][:15]],
			'candidateOnly':True},
		'crossSourceBeatAgreement':{'candidateDrumBeatsCompared':len(candidate['ticks']),
			'nearestBassBeatWithin40msFraction':round(float(np.mean(difference<.04)),4),
			'medianNearestBassBeatDifferenceSeconds':round(float(np.median(difference)),4),
			'noAssumedPhaseOrMeterTruth':True},
		'modelSensitivity':sensitivity,
		'variableGridAssessment':{'beatCount':len(candidate['ticks']),
			'drumOnsetMean':evaluate(drum,candidate['ticks']),
			'heldOutBassOnsetMean':variable_bass,
			'heldOutBassDifferenceVsFixed':round(variable_bass-constant_bass,5)},
		'regions':regions,
		'limitations':[
			'Viterbi path is conditional on an approximately 160 BPM quarter-note prior and specified period bounds; cannot test 80 BPM half-time or arbitrary meter',
			'Original Demucs drums and bass stem separation are correlated and can contain artifacts',
			'No independent human source listening, actual beat labels, downbeat verification or section boundary identification',
			'Numeric frames quantized from 10ms source-time analysis to 48kHz source coordinates, not sample-accurate onset evidence',
			'Beat count, tempo variability, region bpm and scores are algorithmic candidates, not measured ground truth',
			'Original OGG segments may introduce spurious boundaries; masked local edges as a safeguard',
			'Variable paths have more degrees of freedom than a static grid; higher training evidence is not evidence of actual drift',
			'Bass-trained and drum-trained beat paths are independent algorithm fits but not independent source truth; differences may reflect syncopation and separation artifacts',
			'No source tempo map may enter gameplay, Gym, RELEASE_BEAT_GRIDS, or World Dance before independent review']}


def main():
	p=argparse.ArgumentParser()
	p.add_argument('--source-pack',type=Path,required=True)
	p.add_argument('--prior-report',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	a=p.parse_args()
	if a.out.exists():raise SystemExit('Refusing overwrite')
	manifest,digest=validate_source_manifest(a.source_pack,a.prior_report)
	channels, hashes=source_onsets(a.source_pack,manifest)
	result=report(manifest,digest,channels,hashes)
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(result,indent=2)+'\n')
	print('REPORT',str(a.out),'SHA256',hashlib.sha256(a.out.read_bytes()).hexdigest(),flush=True)
	print('FIXED',result['fixedGridControl'],flush=True)
	print('VARIABLE',result['variableGridAssessment'],flush=True)
	for region in result['regions']:
		print('REGION',region,flush=True)
if __name__=='__main__':main()
