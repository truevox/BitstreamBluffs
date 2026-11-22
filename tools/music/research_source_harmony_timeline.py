#!/usr/bin/env python3
"""Offline ORIGINAL OGG harmony timeline for DSP experiments, not beat labels.

Exact original guitar/piano/other SHA-bound PCM is decoded read-only, stitched
on the original absolute 48-kHz manifest timeline, then analyzed using whole-
song STFT. Source time in integer sample-frame bins; no tempo, bar or beat grid.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from scipy.ndimage import maximum_filter1d
from scipy.signal import stft, find_peaks

from research_variable_tempo import validate_source_manifest
from research_spectral_rhythm import expected_original_hashes

FORMAT='bsb-original-song-harmony-pitch-classes-UNVERIFIED-v1'
STATUS='SOURCE_TIME_HARMONY_DSP_RESEARCH_NOT_MUSICAL_TRANSCRIPTION'
ROLES=('guitar','piano','other')
SOURCE_RATE=48000
RATE=11025
FFT=4096
HOP=256
BIN_FRAMES=12000  # exact source 250 milliseconds at 48k, independent of tempo
PITCH_NAMES=('C','C#','D','D#','E','F','F#','G','G#','A','A#','B')


def decode_segment(path:Path,expected_count:int)->tuple[np.ndarray,int]:
	cmd=['ffmpeg','-nostdin','-v','error','-i',str(path),'-ac','1','-ar',str(RATE),'-f','f32le','pipe:1']
	result=subprocess.run(cmd,capture_output=True,check=True,timeout=45)
	data=np.frombuffer(result.stdout,dtype='<f4')
	if not np.isfinite(data).all() or not len(data):raise ValueError('Invalid or silent-length source segment')
	# Opus trimming can affect the very last decoded frames of a segment.
	# Missing samples are UNKNOWN, not artificial musical silence or beats.
	missing=expected_count-len(data)
	if abs(missing)>round(.040*RATE):
		raise ValueError(f'Source decode misaligned by {missing} frames for {path}')
	return data[:expected_count],max(0,missing)


def read_stitched_harmonics(pack:Path,manifest:dict,expected:dict)->tuple[dict,dict,dict]:
	length=round(manifest['frameCount']*RATE/SOURCE_RATE)
	waves={r:np.zeros(length,dtype=np.float32) for r in ROLES}
	coverage={r:np.zeros(length,dtype=bool) for r in ROLES}
	hashes={}
	diagnostics=[]
	for i,seg in enumerate(manifest['segments']):
		start=round(seg['startFrame']*RATE/SOURCE_RATE)
		end=round((seg['startFrame']+seg['frames'])*RATE/SOURCE_RATE)
		wanted=end-start
		hashes[str(i)]={}
		for role in ROLES:
			path=pack/seg['sources'][role]
			if not path.is_file():raise FileNotFoundError(path)
			actual=hashlib.sha256(path.read_bytes()).hexdigest()
			if actual!=expected[str(i)][role]:
				raise ValueError(f'Original OGG {role} segment {i} hash mismatch: stop')
			hashes[str(i)][role]=actual
			decoded,missing=decode_segment(path,wanted)
			n=len(decoded)
			waves[role][start:start+n]=decoded
			coverage[role][start:start+n]=True
			diagnostics.append({'segmentIndex':i,'role':role,
				'decodedFramesAtAnalysisRate':n,'expectedFramesAtAnalysisRate':wanted,
				'unknownTrailingAnalysisFrames':missing,
				'startFrameAtOriginalSourceRate':seg['startFrame']})
	return waves,coverage,{'sourceStemSha256':hashes,'decodeCoverage':diagnostics}


def chroma_features(wave:np.ndarray,coverage:np.ndarray)->tuple[np.ndarray,np.ndarray,np.ndarray,dict]:
	"""Fractional semitone energy, not chord names, from full-timeline PCM."""
	wave=np.asarray(wave,dtype=np.float64)
	if wave.ndim!=1 or len(wave)<RATE or not np.isfinite(wave).all():
		raise ValueError('Finite full-song source PCM required')
	if coverage.shape!=wave.shape:raise ValueError('Source analysis frame coverage mismatch')
	freq,t,fft=stft(wave,fs=RATE,nperseg=FFT,noverlap=FFT-HOP,boundary='zeros',padded=False)
	valid=(freq>=100)&(freq<=2300)
	frequencies=freq[valid]
	midi=69+12*np.log2(frequencies/440.0)
	classes=np.rint(midi).astype(int)%12
	mag=np.abs(fft[valid])
	# Only narrow spectral peaks above the local instantaneous floor count.
	# Do NOT whiten each frequency by its long-term median: that can boost
	# broadband separator noise and invent near-uniform pitch classes.
	peaks=mag>=maximum_filter1d(mag,size=5,axis=0,mode='nearest')
	foreground=mag>=np.maximum(mag.max(axis=0,keepdims=True)*.04,1e-7)
	mag=np.where(peaks & foreground,mag**.8,0.)
	bins=np.zeros((12,mag.shape[1]),dtype=np.float64)
	for pc in range(12):bins[pc]=mag[classes==pc].sum(axis=0)
	energy=bins.sum(axis=0)
	prob=bins/np.maximum(energy,1e-12)
	return t,prob,energy,{'fftBins':FFT,'hopFrames':HOP,'pitchMapping':'A440 equal-temperament foreground spectral peaks; tuning offset unverified'}


def summarize_bins(chroma:dict[str,tuple[np.ndarray,np.ndarray,np.ndarray]],
	coverage:dict[str,np.ndarray],source_frames:int)->list[dict]:
	"""All 12 pitch classes per quarter-second ORIGINAL SOURCE frame bin."""
	length=int((source_frames+BIN_FRAMES-1)//BIN_FRAMES)
	output=[]
	for bin_index in range(length):
		start=bin_index*BIN_FRAMES
		end=min(source_frames,start+BIN_FRAMES)
		seconds_a=start/SOURCE_RATE;seconds_b=end/SOURCE_RATE
		role_vectors=[];role_energies=[]
		for role in ROLES:
			t,probs,energies=chroma[role]
			mask=(t>=seconds_a)&(t<seconds_b)
			if not mask.any():continue
			source_a=round(start*RATE/SOURCE_RATE);source_b=round(end*RATE/SOURCE_RATE)
			present=float(np.mean(coverage[role][source_a:source_b]))
			if present<.93:continue
			e=np.maximum(energies[mask],0)
			if float(e.sum())<=1e-5:continue
			vec=np.average(probs[:,mask],axis=1,weights=e)
			vec=np.maximum(0,vec);vec/=max(float(vec.sum()),1e-9)
			role_vectors.append(vec)
			role_energies.append(float(np.median(e)))
		if len(role_vectors)<2:
			output.append({'startFrame':start,'endFrame':end,'startSeconds':round(seconds_a,6),
				'endSeconds':round(seconds_b,6),'pitchClassWeights':[0.]*12,
				'topPitchClasses':[],'relativeEvidence':0.,'agreement':0.,
				'confidence':0.,'status':'INSUFFICIENT_SOURCE_HARMONY',
				'candidateOnly':True})
			continue
		row=np.average(np.array(role_vectors),axis=0)
		row=np.maximum(row,0);row/=row.sum()
		# Confidence is a strictly HEURISTIC reliability, not chord probability:
		# distribution peak prominence times between-stem agreement.
		diff=np.mean([np.sum(np.abs(v-row))/2 for v in role_vectors])
		agreement=float(np.clip(1-diff,0,1))
		contrast=float(np.clip((float(row.max())-1/12)*4.5,0,1))
		relative_evidence=float(np.median(role_energies))
		confidence=float(agreement*contrast)
		top=np.argsort(-row)[:3]
		output.append({'startFrame':start,'endFrame':end,'startSeconds':round(seconds_a,6),
			'endSeconds':round(seconds_b,6),
			'pitchClassWeights':[round(float(v),6) for v in row],
			'topPitchClasses':[PITCH_NAMES[i] for i in top],
			'relativeEvidence':round(relative_evidence,4),
			'agreement':round(agreement,4),'confidence':round(confidence,4),
			'status':'UNVERIFIED_WEIGHTED_PITCH_CLASSES' if confidence>=.1 else 'WEAK_HARMONY_NO_RETUNE',
			'candidateOnly':True})
	return output


def estimate_tuning(wave:np.ndarray)->dict:
	"""Global approximate cents-from-A440 from local spectral peaks, not master truth."""
	# Compact 12 second middle excerpt only; mixture of polyphonic harmonics
	# limits reliability of global tuning estimation.
	start=round(60*RATE);slice_=wave[start:start+round(12*RATE)]
	freq,_,z=stft(slice_,fs=RATE,nperseg=8192,noverlap=6144,boundary=None,padded=False)
	mag=np.mean(np.abs(z),axis=1)
	mask=(freq>180)&(freq<1400)
	bins=np.where(mask)[0]
	peaks,_=find_peaks(mag[mask],prominence=max(float(np.max(mag[mask]))*.012,1e-9))
	indices=bins[peaks];idx=indices[np.argsort(mag[indices])[-30:]]
	if len(idx)<5:return {'offsetCents':0,'status':'INSUFFICIENT_TUNING_PEAKS_UNVERIFIED'}
	midi=69+12*np.log2(freq[idx]/440)
	cents=(midi-np.rint(midi))*100
	# A few harmonics of inharmonic instruments have strong cent deviations;
	# weak-median tuning proxy MUST NOT blindly retune the resonator system.
	median=float(np.median(cents))
	mad=float(np.median(np.abs(cents-median)))
	if mad>18 or abs(median)>40:
		return {'offsetCents':0,'status':'UNSTABLE_TUNING_EVIDENCE_USE_A440','observedMedianCents':round(median,2),'medianAbsoluteDeviationCents':round(mad,2)}
	return {'offsetCents':round(median,2),'status':'TENTATIVE_GLOBAL_TUNING_PROXY','medianAbsoluteDeviationCents':round(mad,2)}


def analyze(pack:Path,prior:Path,harmonic:Path)->dict:
	manifest,manifest_hash=validate_source_manifest(pack,prior)
	expected,chain=expected_original_hashes(prior,harmonic,manifest_hash)
	waves,coverage,media=read_stitched_harmonics(pack,manifest,expected)
	features={role:chroma_features(waves[role],coverage[role]) for role in ROLES}
	timeline=summarize_bins({role:features[role][:3] for role in ROLES},coverage,manifest['frameCount'])
	# Tuning diagnostics intentionally do not change pitch class weights or DSP.
	tuning=estimate_tuning(waves['piano'])
	return {'format':FORMAT,'status':STATUS,'trackId':manifest['id'],
		'originalManifestSha256':manifest_hash,**chain,**media,
		'originalSourceSampleRate':SOURCE_RATE,'originalFrameCount':manifest['frameCount'],
		'durationSeconds':manifest['frameCount']/SOURCE_RATE,
		'binFrames':BIN_FRAMES,'binDurationSeconds':BIN_FRAMES/SOURCE_RATE,
		'analysisSampleRate':RATE,'originalRoles':list(ROLES),
		'pitchClassNames':list(PITCH_NAMES),'tuning':tuning,'timeline':timeline,
		'limitations':['All 12 weighted pitch-class values are unreviewed relative spectral energy, not probabilities/chords/melody notes or correct instrument tuning',
			'Fixed source-frame 250ms bins deliberately do NOT use BPM, note-on, beat-one, bar starts, or guessed meter',
			'All three roles derive from correlated stem separation, not independent live instruments',
			'Equal-tempered A440 nearest semitone bins and rough spectral overtones can weight non-chord tones; tuning offset is exploratory only',
			'Timbre, distortion, octave errors, strong passing notes and Demucs bleed can cause dissonance; output is a sound-design audition input only',
			'Only matched original OGG stem SHA256 bytes can produce this report; decoded missing frames remain explicitly unknown',
			'No source tempo/beat/meter, harmony chord names, phrase/downbeat or release timing verified',
			'Never promote these harmonic research estimates as gold source labels or mutate original OGGs/RELEASE_BEAT_GRIDS/gameplay automatically']}


def main():
	p=argparse.ArgumentParser()
	p.add_argument('--source-pack',required=True,type=Path)
	p.add_argument('--prior-report',required=True,type=Path)
	p.add_argument('--harmonic-report',required=True,type=Path)
	p.add_argument('--out',required=True,type=Path)
	a=p.parse_args()
	if a.out.exists():raise SystemExit('Refusing overwrite of original research evidence')
	report=analyze(a.source_pack,a.prior_report,a.harmonic_report)
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(report,indent=2)+'\n')
	print('SHA256',hashlib.sha256(a.out.read_bytes()).hexdigest(),flush=True)
	print('BINS',len(report['timeline']),'VALID',sum(r['status']=='UNVERIFIED_WEIGHTED_PITCH_CLASSES' for r in report['timeline']),flush=True)
	print('TUNING',report['tuning'],flush=True)
	print('SAMPLE_BINS',[(r['startSeconds'],r['topPitchClasses'],r['confidence']) for r in report['timeline'][::100]],flush=True)
if __name__=='__main__':main()
