#!/usr/bin/env python3
"""Unverified original-mix MP3 vs exact OGG-stem rhythmic phase analysis.

Original mix is MP3, NOT the lossless master WAV. Zero-lag PCM correlation of
short source excerpts establishes matching source audio without copying files.
All output is research-only and cannot be a released source beat grid.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from scipy.signal import correlate,correlation_lags

from research_spectral_rhythm import (RATE,TICK,ROLES,spectral_onset,acf_periodicity,
	expected_original_hashes,source_spectral_envelopes,SOURCE_RATE)
from research_global_pulse_phase import scan,phase_vector
from research_phase_motion import phase_trace,circular_steps,wrapped_beats
from research_variable_tempo import validate_source_manifest

FORMAT='bitstream-original-mp3-mix-vs-separated-source-phase-UNVERIFIED-v1'
STATUS='ORIGINAL_MIX_MATCHED_NO_VERIFIED_SOURCE_BEAT_OR_DRIFT'
EXPECTED_MP3_SHA256='931402316385f7a1afd302d59132b812f0ae6a312b46b8cd85826c0a63906a8e'
EXPECTED_TITLE='One More Run (The Ballad of Bitstream Bluffs)'


def decode_original_mp3(path:Path, seconds:float) ->tuple[np.ndarray,dict]:
	if hashlib.sha256(path.read_bytes()).hexdigest()!=EXPECTED_MP3_SHA256:
		raise ValueError('MP3 original mix source SHA-256 mismatch; refusing source identity claim')
	probe=subprocess.run(['ffprobe','-v','error','-show_entries',
		'format=duration,format_name:format_tags=title,artist','-of','json',str(path)],
		capture_output=True,text=True,check=True,timeout=20)
	info=json.loads(probe.stdout)['format']
	if info['format_name']!='mp3' or abs(float(info['duration'])-seconds)>.10:
		raise ValueError('MP3 format or duration does not match original stem pack')
	if info.get('tags',{}).get('title')!=EXPECTED_TITLE:
		raise ValueError('MP3 title metadata does not match original recording')
	p=subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(path),
		'-ac','1','-ar',str(RATE),'-f','f32le','pipe:1'],
		capture_output=True,check=True,timeout=45)
	pcm=np.frombuffer(p.stdout,dtype='<f4').astype(np.float64)
	if len(pcm)<round(seconds*RATE)-2:
		raise ValueError('Original MP3 decoded shorter than source timeline')
	return pcm[:round(seconds*RATE)],info


def decode_stem(path:Path,seconds:float)->np.ndarray:
	p=subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(path),
		'-t',str(seconds+.1),'-ac','1','-ar',str(RATE),'-f','f32le','pipe:1'],
		capture_output=True,check=True,timeout=30)
	return np.frombuffer(p.stdout,dtype='<f4').astype(np.float64)[:round(seconds*RATE)]


def zero_lag_reconstruction_match(original:np.ndarray,stem_mix:np.ndarray,
	rate=RATE,max_lag_seconds=.10)->dict:
	"""Report cross-aligned normalized PCM correlation; NOT equality of lossy stems."""
	length=min(len(original),len(stem_mix))
	if length<rate:raise ValueError('Insufficient original/reconstructed source audio')
	a=original[:length];b=stem_mix[:length]
	if np.linalg.norm(a)<1e-8 or np.linalg.norm(b)<1e-8:
		raise ValueError('Source reconstruction silence cannot establish identity')
	correlation=correlate(a,b,mode='full',method='fft')
	lags=correlation_lags(len(a),len(b),mode='full')
	valid=np.abs(lags)<=round(rate*max_lag_seconds)
	winner=int(np.argmax(np.abs(correlation[valid])))
	lag=int(lags[valid][winner])
	score=float(correlation[valid][winner]/(np.linalg.norm(a)*np.linalg.norm(b)))
	return {'sourceReadOnly':True,'candidateOnly':True,'peakNormalizedPcmCorrelation':round(score,5),
		'sourceLagSamplesAtAnalysisRate':lag,'sourceLagMilliseconds':round(lag/rate*1000,3),
		'analysisSamplesCompared':length}


def source_match(pack:Path,manifest:dict,original:np.ndarray,prior:Path,harmonic:Path)->list[dict]:
	"""Gate actual mix identity against grouped OGG stems at start/mid/end."""
	prior_obj=json.loads(prior.read_bytes())
	harmony_obj=json.loads(harmonic.read_bytes())
	results=[]
	for index in (0,7,14):
		seg=manifest['segments'][index]
		seconds=seg['frames']/SOURCE_RATE
		start=round((seg['startFrame']/SOURCE_RATE)*RATE)
		end=start+round(seconds*RATE)
		window=original[start:end]
		stems=[]
		for role in (*ROLES,'vocals'):
			f=pack/seg['sources'][role]
			b=f.read_bytes()
			expected=(prior_obj['windows'][index]['stemEvidence'].get(role) or
				harmony_obj['windows'][index]['stemEvidence'].get(role))
			if not expected or hashlib.sha256(b).hexdigest()!=expected['sha256']:
				raise ValueError('Segment stem bytes do not match archived original evidence')
			stems.append(decode_stem(f,seconds))
		reconstructed=sum(x[:len(window)] for x in stems)
		comparison=zero_lag_reconstruction_match(window,reconstructed)
		if abs(comparison['sourceLagMilliseconds'])>12 or comparison['peakNormalizedPcmCorrelation']<.55:
			raise ValueError(f'MP3 and original stem reconstruction not aligned: window {index}')
		results.append({'segmentIndex':index,'sourceStartSeconds':seg['startFrame']/SOURCE_RATE,
			'durationSeconds':seconds,**comparison})
	return results


def phase_comparison(mix_trace:list[dict],drums_trace:list[dict])->dict:
	if len(mix_trace)!=len(drums_trace):raise ValueError('Different original source time windows')
	rows=[]
	for a,b in zip(mix_trace,drums_trace):
		if a['centerSeconds']!=b['centerSeconds']:raise ValueError('Original source timeline mismatch')
		good=a['passesCoherenceGate'] and b['passesCoherenceGate']
		rows.append({'sourceWindowCenterSeconds':a['centerSeconds'],
			'originalMixCoherence':a['coherence'],'drumStemCoherence':b['coherence'],
			'passesBothSourceGates':good,
			'originalMixMinusDrumPhaseCandidateBeats':round(wrapped_beats(b['relativePhaseRadians'],a['relativePhaseRadians']),5) if good else None,
			'candidateOnly':True})
	return {'candidateOnly':True,'comparisonWindows':rows,
		'coherentPairs':sum(r['passesBothSourceGates'] for r in rows),
		'phaseOffsetIsNotVerifiedDownbeat':True}


def analyze(pack:Path,prior:Path,harmonic:Path,mp3:Path,global_report:Path)->dict:
	manifest,digest=validate_source_manifest(pack,prior)
	prev=json.loads(global_report.read_bytes())
	if prev['originalSourceManifestSha256']!=digest or prev['status']!='NO_VERIFIED_MUSICAL_BEATS_OR_TEMPO_DRIFT':
		raise ValueError('Original prior global source report mismatch')
	known,reports=expected_original_hashes(prior,harmonic,digest)
	seconds=manifest['frameCount']/SOURCE_RATE
	original,metadata=decode_original_mp3(mp3,seconds)
	matches=source_match(pack,manifest,original,prior,harmonic)
	# Only the original MP3 derives the full-mix spectral evidence stream.
	# A non-padded STFT omits the last ~half FFT window; maintain the same
	# manifest-length source timeline as decoded original OGG stem envelopes,
	# filling only unavailable terminal STFT positions with *zero* evidence.
	env=spectral_onset(original)
	stem_envelopes,stem_hashes=source_spectral_envelopes(pack,manifest,known)
	length=round(seconds/TICK)+3
	if len(env)>length:raise ValueError('Original MP3 analysis exceeds source timeline')
	env=np.pad(env,(0,length-len(env)))
	if any(len(value)!=length for value in stem_envelopes.values()):
		raise ValueError('Separated stem source timeline length mismatch')
	windows=[]
	for start in range(0,180,6):
		end=min(start+18.,seconds)
		if end-start<10:continue
		a=round(start/TICK);b=round(end/TICK)
		p=acf_periodicity(env[a:b])
		d=acf_periodicity(stem_envelopes['drums'][a:b])
		windows.append({'startSeconds':start,'endSeconds':round(end,4),
			'originalMixSpectralRhythm':p,'originalDrumStemSpectralRhythm':d,
			'candidateDifferenceBpm':round(p['preferredBpm']-d['preferredBpm'],4)
				if p['preferredBpm'] is not None and d['preferredBpm'] is not None else None,
			'candidateOnly':True})
	full=scan(env)
	reference=prev['candidateSourcePulseReferenceBpm']
	mix_trace=phase_trace(env,reference)
	drums_trace=phase_trace(stem_envelopes['drums'],reference)
	return {'format':FORMAT,'status':STATUS,'sourceManifestSha256':digest,
		**reports,'priorGlobalSourcePhaseReportSha256':hashlib.sha256(global_report.read_bytes()).hexdigest(),
		'originalMp3Sha256':EXPECTED_MP3_SHA256,
		'originalMp3Format':metadata['format_name'],'originalMp3MetadataTitle':metadata.get('tags',{}).get('title'),
		'originalMp3DurationSeconds':float(metadata['duration']),
		'originalStemSha256':stem_hashes,'sourceFrameCount':manifest['frameCount'],
		'originalStemSampleRate':SOURCE_RATE,'mp3DecodeSampleRate':RATE,
		'originalSourceSegmentReconstructionCheck':matches,
		'rhythmicReferenceBpmHypothesis':reference,
		'originalMixWholeSourceRhythmicFrequency':full,
		'originalMixToDrumPhaseEvidence':phase_comparison(mix_trace,drums_trace),
		'originalMixLocalPhaseTrace':mix_trace,
		'originalMixAdjacentPhaseSteps':circular_steps(mix_trace),
		'localRhythmicPeriodComparisons':windows,
		'limitations':['Original full mix MP3 is lossy and not the separately archived original CT211 WAV master; retain exact MP3 SHA identity and do not assert lossless WAV bit identity',
			'Six separated original stems reconstruct the MP3 strongly but not bit-perfectly; sample gain changes, Demucs artifacts and OGG/MP3 encoders differ',
			'Mix and stems are different representations of the same musical recording, NOT independent performances or proof of meter',
			'Frequency hypotheses use short overlapping windows, and fixed 140-180 BPM quarter-like prior may reject true half-time meter',
			'An original spectral rhythmic frequency or fixed-reference phasor is NOT source-certified beat one or tempo drift',
			'Phase evidence magnitude is not a calibrated musical confidence interval',
			'No source original OGG or MP3 file was changed; no gameplay or RELEASE_BEAT_GRIDS update authorized']}


def main():
	p=argparse.ArgumentParser()
	p.add_argument('--source-pack',type=Path,required=True)
	p.add_argument('--prior-report',type=Path,required=True)
	p.add_argument('--harmonic-report',type=Path,required=True)
	p.add_argument('--global-report',type=Path,required=True)
	p.add_argument('--original-mix-mp3',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	a=p.parse_args()
	if a.out.exists():raise SystemExit('Refusing overwrite')
	r=analyze(a.source_pack,a.prior_report,a.harmonic_report,a.original_mix_mp3,a.global_report)
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(r,indent=2)+'\n')
	print('SHA256',hashlib.sha256(a.out.read_bytes()).hexdigest())
	print('MIX IDENTITY',r['originalSourceSegmentReconstructionCheck'])
	print('MIX FULL',r['originalMixWholeSourceRhythmicFrequency'])
	print('MIX vs STEM',r['originalMixToDrumPhaseEvidence']['coherentPairs'],'overlapping windows')
	for w in r['localRhythmicPeriodComparisons']:
		print('WINDOW',w['startSeconds'],'mix',w['originalMixSpectralRhythm']['preferredBpm'],
			'drum',w['originalDrumStemSpectralRhythm']['preferredBpm'],'diff',w['candidateDifferenceBpm'])
if __name__=='__main__':main()
