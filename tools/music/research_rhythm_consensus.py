#!/usr/bin/env python3
"""Original-song independent ACF periodicity + cross-stem lag diagnostic.

No authentic beat/downbeat, section, bridge, meter, local BPM or drift status is
approved here. This second estimator is independent of the Viterbi tracker,
not independent of the same source onset-extraction pipeline.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.signal import correlate

from research_original_downbeat_candidates import TICK
from research_variable_tempo import (
	SOURCE_RATE, observation, source_onsets, validate_source_manifest,
	track_beats, fixed_tempo_candidate
)

FORMAT='bitstream-original-source-rhythm-consensus-UNVERIFIED-v1'
STATUS='RESEARCH_ONLY_NO_VERIFIED_BEATS_OR_DRIFT'
# All finite intervals are candidate quarter-note periodicities, not BPM truth.
QUARTER_MIN=32
QUARTER_MAX=46
HALF_MIN=64
HALF_MAX=92
DOUBLE_MIN=16
DOUBLE_MAX=23


def standardized(x:np.ndarray) -> np.ndarray:
	"""Subtract activity baseline and normalize; silence has zero evidence."""
	x=np.asarray(x,dtype=float)
	if not len(x) or not np.isfinite(x).all() or (x<0).any():
		raise ValueError('Onset envelopes must be finite nonnegative arrays')
	x=x-gaussian_filter1d(x, sigma=18, mode='nearest')
	mag=np.std(x)
	if mag<.002:return np.zeros_like(x)
	return x/mag


def acf_strength(signal:np.ndarray,lag:int) -> float:
	"""Variance-normalized autocorrelation, return zero for low-energy music."""
	if lag<=0 or lag>=len(signal):return 0.
	a=standardized(signal)
	if not np.any(a):return 0.
	return float(np.dot(a[:-lag],a[lag:])/len(a[:-lag]))


def periodicity_evidence(signal:np.ndarray) -> dict:
	"""Return unrestricted octave/half-time competitors and uncertainty cues."""
	a=standardized(signal)
	if not np.any(a):
		return {'status':'INSUFFICIENT_RHYTHM','candidateOnly':True,'quarterAlternatives':[],
			'preferredQuarterTick':None,'octaveFamily':[],'quarterContrast':0.}
	def strength(t):return float(np.dot(a[:-t],a[t:])/len(a[:-t]))
	def sub_tick_peak(t):
		# Fractional period inferred from a parabola around autocorrelation's
		# three discrete lags; still limited by the ~10ms input envelope.
		left, center, right = strength(t-1),strength(t),strength(t+1)
		denominator = left-2*center+right
		shift = .5*(left-right)/denominator if denominator < -1e-10 else 0.
		return float(t+np.clip(shift,-.5,.5))
	quarter=[{'lagTicks':t, 'interpolatedLagTicks':round(sub_tick_peak(t),4),
		'candidateBpm':round(60/(sub_tick_peak(t)*TICK),3),
		'autocorrelation':round(strength(t),4)} for t in range(QUARTER_MIN,QUARTER_MAX+1)]
	quarter.sort(key=lambda r:(-r['autocorrelation'],r['lagTicks']))
	family=[]
	for name,rr in [('double_time',range(DOUBLE_MIN,DOUBLE_MAX+1)),
		('half_time',range(HALF_MIN,HALF_MAX+1))]:
		peaks=[{'lagTicks':t,'periodicBpm':round(60/(t*TICK),3),
			'autocorrelation':round(strength(t),4)} for t in rr]
		peaks.sort(key=lambda r:(-r['autocorrelation'],r['lagTicks']))
		family.append({'hypothesis':name, 'best':peaks[0]})
	gap=quarter[0]['autocorrelation']-quarter[1]['autocorrelation']
	return {'status':'CANDIDATES_UNVERIFIED','candidateOnly':True,
		'frequencyEstimateResolution':'fractional-tick parabolic interpolant of 10ms-period ACF; no sub-10ms ground truth',
		'quarterAlternatives':quarter[:5],
		'preferredQuarterTick':quarter[0]['lagTicks'],
		'quarterContrast':round(gap,5),
		'octaveFamily':family}


def phase_lag_crosscheck(drum:np.ndarray,bass:np.ndarray,
	window_seconds=.45) -> dict:
	"""Compare rhythmic stream phase across all offsets, no beat-one inference."""
	if len(drum)!=len(bass):raise ValueError('Mismatched rhythm timelines')
	a=standardized(drum);b=standardized(bass)
	if not np.any(a) or not np.any(b):
		return {'status':'INSUFFICIENT_RHYTHM','candidateOnly':True,'bestLagTicks':None}
	maxlag=int(round(window_seconds/TICK))
	steps=[]
	for lag in range(-maxlag,maxlag+1):
		if lag>=0:x=a[lag:];y=b[:len(b)-lag]
		else:x=a[:len(a)+lag];y=b[-lag:]
		if len(x)<20:continue
		score=float(np.dot(x,y)/len(x))
		steps.append((lag,score))
	best=max(steps,key=lambda x:(x[1],-abs(x[0])))
	zero=next(v for lag,v in steps if lag==0)
	return {'status':'CANDIDATES_UNVERIFIED','candidateOnly':True,
		'bestLagTicks':best[0], 'bestLagSeconds':round(best[0]*TICK,4),
		'bestNormalizedCorrelation':round(best[1],4),
		'zeroLagNormalizedCorrelation':round(zero,4),
		'gainOverNoShift':round(best[1]-zero,4),
		'lagSignConvention':'positive = drums occur later than bass; negative = drums earlier than bass',
		'lagIsBeatOneEvidence':False}


def beat_path_agreement(primary: list[int],secondary:list[int],
	period_seconds=.375,window_seconds=.04) -> dict:
	"""Compare rival paths after potential *global* half-pulse displacement.

	A high half-shift agreement indicates consistent syncopation or competing
	beat phases, not a verified musical pulse. Constant shifts are diagnostic.
	"""
	if not primary or not secondary:raise ValueError('Beat candidate paths required')
	p=np.asarray(primary)*TICK
	s=np.asarray(secondary)*TICK
	shifts=(0.,period_seconds/4,period_seconds/2,-period_seconds/4,-period_seconds/2)
	result=[]
	for shift in shifts:
		ss=s+shift
		# Local nearest beat in O(nlogn), rather than O(n*m) memory growth.
		idx=np.searchsorted(ss,p)
		left=np.abs(p-ss[np.clip(idx-1,0,len(ss)-1)])
		right=np.abs(p-ss[np.clip(idx,0,len(ss)-1)])
		d=np.minimum(left,right)
		result.append({'shiftSeconds':round(float(shift),5),
			'within40msFraction':round(float(np.mean(d<=window_seconds)),5),
			'medianNearestSeconds':round(float(np.median(d)),5)})
	return {'candidateOnly':True,'assumedDiagnosticPeriodSeconds':period_seconds,
		'alignments':result,
		'bestShiftIsNotActualBeatOne':True}


def analyze(pack:Path,prior:Path) -> dict:
	manifest,manifest_hash=validate_source_manifest(pack,prior)
	channels,original_hashes=source_onsets(pack,manifest)
	all_drum=observation(channels['drums']);all_bass=observation(channels['bass'])
	drum_tracker=track_beats(all_drum)
	bass_tracker=track_beats(all_bass)
	regions=[]
	for start in range(0,180,6):
		span=18.0
		end=min(start+span,manifest['frameCount']/SOURCE_RATE)
		if end-start<10:continue
		begin_idx=round(start/TICK);end_idx=round(end/TICK)
		d=all_drum[begin_idx:end_idx];b=all_bass[begin_idx:end_idx]
		d_per=periodicity_evidence(d);b_per=periodicity_evidence(b)
		dt=d_per['preferredQuarterTick'];bt=b_per['preferredQuarterTick']
		regions.append({'startSeconds':start,'endSeconds':round(end,3),
			'drumPeriodicity':d_per,'bassPeriodicity':b_per,
			'quarterLagDisagreementTicks':None if dt is None or bt is None else abs(dt-bt),
			'crossStemOnsetLag':phase_lag_crosscheck(d,b),
			'candidateOnly':True})
	return {'format':FORMAT,'status':STATUS,
		'sourceSongId':manifest['id'],'sampleRate':SOURCE_RATE,
		'sourceFrameCount':manifest['frameCount'],
		'sourceManifestSha256':manifest_hash,
		'originalDrumBassStemSha256':original_hashes,
		'windowLengthSeconds':18,'windowHopSeconds':6,
		'method':'18s windowed autocorrelation of locally detrended original OGG drum/bass onsets; deliberately independent of Viterbi period tracking, but shares source stem separation and onset extraction',
		'phaseHypothesisComparison':beat_path_agreement(drum_tracker['ticks'],bass_tracker['ticks']),
		'regions':regions,
		'limitations':[
			'Autocorrelation candidate BPM assumes one quarter-note onset every 32–46 analysis ticks; does not identify musical quarter notes, beat one, phrase starts or meter',
			'Rhythmic periodicity of half/double notes and syncopation can masquerade as tempo changes; the strongest lag may be a subdivision',
			'Overlapping 18s analysis windows at 6s hop are correlated; do not treat agreement percentages as independent samples',
			'Both tracks use the same previous onset extraction and Demucs-separated recording, so they are not independent ground truth',
			'Per-segment original OGG codec/analysis boundaries are locally masked; timing resolution is about 10ms',
			'Cross-correlation peaks may reflect instrumentation lag, syncopation and periodic patterns, not real musical beat boundaries',
			'No actual source human musical review, source-trusted tempo map or confidence is established',
			'No original OGG changes, source tempo approval or gameplay release state may follow from this report']}


def main():
	p=argparse.ArgumentParser()
	p.add_argument('--source-pack',required=True,type=Path)
	p.add_argument('--prior-report',required=True,type=Path)
	p.add_argument('--out',required=True,type=Path)
	a=p.parse_args()
	if a.out.exists():raise SystemExit('Refusing to overwrite existing source research evidence')
	result=analyze(a.source_pack,a.prior_report)
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(result,indent=2)+'\n')
	print('REPORT',a.out,'SHA256',hashlib.sha256(a.out.read_bytes()).hexdigest())
	for window in result['regions']:
		d=window['drumPeriodicity'];b=window['bassPeriodicity'];lag=window['crossStemOnsetLag']
		print('WINDOW',window['startSeconds'],round(window['endSeconds'],1),
			'drum_bpm',d['quarterAlternatives'][0]['candidateBpm'] if d['quarterAlternatives'] else None,
			'bass_bpm',b['quarterAlternatives'][0]['candidateBpm'] if b['quarterAlternatives'] else None,
			'disagree_ticks',window['quarterLagDisagreementTicks'],
			'rhythmic_shift_s',lag.get('bestLagSeconds'),
			'corr',lag.get('bestNormalizedCorrelation'))
	print('PHASE_SHIFT_DIAGNOSTIC',result['phaseHypothesisComparison'])

if __name__=='__main__':main()
