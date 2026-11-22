#!/usr/bin/env python3
"""Verified CT211 original WAV master: rhythmic & structural cue research ONLY.

Reads lossless PCM over SSH into RAM without duplicating source media on disk.
No source musical beat one, actual meter, drift or section boundaries approved.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks

from research_original_mix_phase import (
	EXPECTED_MP3_SHA256, decode_original_mp3, zero_lag_reconstruction_match,
)
from research_global_pulse_phase import scan,phase_vector
from research_harmonic_bar_cues import harmonic_novelty, STEP as CHROMA_STEP
from research_spectral_rhythm import RATE,TICK,spectral_onset,acf_periodicity

FORMAT='bitstream-lossless-original-master-structural-cues-UNVERIFIED-v1'
STATUS='MASTER_VERIFIED_RHYTHM_AND_PHRASE_CANDIDATES_ONLY'
MASTER_SHA256='636bbd42f7ece1c085b4768f25fb0e65d7f29963a22a948e0b6e697ef0284721'
MASTER_REMOTE='/root/bitstream-maxi/launch33/audio/33_one_more_run.wav'
MASTER_HOST='root@192.168.86.211'
SOURCE_FRAMES=8_380_800
SOURCE_RATE=48_000
DURATION=SOURCE_FRAMES/SOURCE_RATE


def validated_probe(probe:dict)->None:
	"""Original WAV sample format and exact source clock, not only filename."""
	stream=probe['streams'][0];fmt=probe['format']
	if (fmt.get('format_name')!='wav' or stream.get('codec_name')!='pcm_s16le'
		or stream.get('sample_rate')!='48000' or stream.get('channels')!=2
		or abs(float(fmt['duration'])-DURATION)>.0001):
		raise ValueError('CT211 original master has wrong PCM format, channels or clock')


def verified_remote_master(host=MASTER_HOST, path=MASTER_REMOTE)->tuple[np.ndarray,dict]:
	"""Remote read only. No cp/scp/local master audio file ever created."""
	ssh=['ssh','-F','/dev/null','-o','BatchMode=yes','-o','ConnectTimeout=10',host]
	sha=subprocess.run(ssh+['sha256sum '+path],capture_output=True,text=True,
		check=True,timeout=45).stdout.split()[0]
	if sha!=MASTER_SHA256:raise ValueError('Lossless original WAV master SHA-256 mismatch')
	probe_response=subprocess.run(ssh+['ffprobe -v error -show_entries '
		'stream=sample_rate,channels,codec_name:format=duration,format_name -of json '+path],
		capture_output=True,text=True,check=True,timeout=25)
	probe=json.loads(probe_response.stdout)
	validated_probe(probe)
	# The remote FFmpeg decodes the original WAV in memory and sends a stream
	# directly through SSH. 44.1/48 kHz source samples remain unmodified on disk.
	result=subprocess.run(ssh+['ffmpeg -nostdin -v error -i '+path+
		' -ac 1 -ar 11025 -f f32le pipe:1'],capture_output=True,check=True,timeout=90)
	pcm=np.frombuffer(result.stdout,dtype='<f4').astype(np.float64)
	if len(pcm)!=round(DURATION*RATE) or not np.isfinite(pcm).all():
		raise ValueError('Decoded remote WAV does not match expected source duration')
	return pcm,{'remoteSourceHost':host,'remotePath':path,
		'masterSha256':sha,'formatName':'wav','codecName':'pcm_s16le',
		'channelCount':2,'sourceRate':SOURCE_RATE,'sourceFrameCount':SOURCE_FRAMES,
		'durationSeconds':DURATION,'decodedTransientRate':RATE,
		'decodedFrameCount':len(pcm),'remoteReadOnly':True,'noPersistentAudioCopy':True}


def neighborhood_energy_change(samples:np.ndarray, at_seconds:float,rate=RATE,
	half_window_seconds=1.25)->float:
	"""Source dynamic-arrangement change heuristic, not a bar boundary."""
	n=round(half_window_seconds*rate);center=round(at_seconds*rate)
	if center<n or center+n>=len(samples):return 0.
	before=np.sqrt(np.mean(samples[center-n:center]**2))
	after=np.sqrt(np.mean(samples[center:center+n]**2))
	return float(abs(np.log((after+1e-8)/(before+1e-8))))


def harmonic_section_cues(samples:np.ndarray,rate=RATE,max_peaks=22)->list[dict]:
	"""Chroma-shift candidates across full original mix, not chord annotations."""
	if len(samples)<rate*20:raise ValueError('Need long original source audio')
	harm=harmonic_novelty(samples)
	if not len(harm):raise ValueError('No original master harmonic evidence')
	# Peak extraction uses musically broad 3s exclusion, and a longer loudness
	# contrast. No source phase or 4/4 bar grid is assumed.
	distance=max(1,round(3.0/CHROMA_STEP))
	indices,props=find_peaks(harm,distance=distance,prominence=.13,height=.28)
	rows=[]
	for i,p in enumerate(indices):
		secs=float(p*CHROMA_STEP)
		if secs<2.0 or secs>DURATION-1.0:continue
		change=neighborhood_energy_change(samples,secs,rate=rate)
		strength=float(harm[p]);prom=float(props['prominences'][i])
		rows.append({'originalSourceSeconds':round(secs,4),
			'normalizedChromaNovelty':round(strength,5),
			'prominenceWithinSong':round(prom,5),
			'logRmsChangeAcross2p5Seconds':round(change,5),
			'heuristicReviewPriority':round(.65*strength+.2*prom+.15*min(change,1),5),
			'candidateOnly':True,'sectionStartVerified':False})
	rows.sort(key=lambda x:(-x['heuristicReviewPriority'],x['originalSourceSeconds']))
	return rows[:max_peaks]


def candidate_review_sections(peaks:list[dict], mix_phase:dict, source_seconds=DURATION,
	max_sections=12)->list[dict]:
	"""Sort low-cost human listening candidates with coverage and uncertainty.

	Do not infer bridge or chorus from a sparse novelty peak. Include explicit
	old contentious regions 78–102s and 120–132s without pretending they're
	machine-discovered tempo jumps.
	"""
	manual=[{'centerSeconds':90.0,'reviewReason':'prior low-band bass outlier 78–102s; high-band detector did NOT replicate'},
		{'centerSeconds':126.0,'reviewReason':'previously weak/harmonically ambiguous 120–132s region'}]
	for p in peaks:
		manual.append({'centerSeconds':p['originalSourceSeconds'],
			'reviewReason':'original WAV full-mix chroma/energy shift, NOT verified phrase entrance',
			'noveltyScore':p['heuristicReviewPriority']})
	# Seed two historical concerns; prioritize source-wide coverage after them.
	selected=[]
	for item in manual:
		at=float(item['centerSeconds'])
		if not 0<at<source_seconds:continue
		if any(abs(at-prior['centerSeconds'])<5 for prior in selected):continue
		selected.append({'centerSeconds':round(at,3),
			'suggestedListenRangeSeconds':[round(max(0,at-4.5),3),
				round(min(source_seconds,at+4.5),3)],
			'reviewReason':item['reviewReason'],
			'noveltyScore':item.get('noveltyScore'),
			'candidateOnly':True,'humanVerified':False})
		if len(selected)>=max_sections:break
	return selected


def assess(wav:np.ndarray,mp3:np.ndarray,provenance:dict,mp3_prior:dict)->dict:
	if len(wav)!=len(mp3) or len(wav)!=round(DURATION*RATE):
		raise ValueError('Master and source MP3 timelines not identical')
	if (mp3_prior.get('status')!='ORIGINAL_MIX_MATCHED_NO_VERIFIED_SOURCE_BEAT_OR_DRIFT'
		or mp3_prior.get('originalMp3Sha256')!=EXPECTED_MP3_SHA256
		or mp3_prior.get('sourceFrameCount')!=SOURCE_FRAMES):
		raise ValueError('Archived original MP3/stems report source mismatch')
	matches=[]
	for start,length in ((0.,12.),(84.,12.),(168.,6.6)):
		a=round(start*RATE);n=round(length*RATE)
		result=zero_lag_reconstruction_match(wav[a:a+n],mp3[a:a+n])
		if abs(result['sourceLagSamplesAtAnalysisRate'])>1 or result['peakNormalizedPcmCorrelation']<.98:
			raise ValueError('Lossless master versus MP3 does not align')
		matches.append({'sourceStartSeconds':start,'durationSeconds':length,**result})
	flux=spectral_onset(wav)
	flux=np.pad(flux,(0,max(0,round(DURATION/TICK)+3-len(flux))))
	windows=[]
	previous=mp3_prior['localRhythmicPeriodComparisons']
	for w in previous:
		start=w['startSeconds'];end=w['endSeconds'];a=round(start/TICK);b=round(end/TICK)
		master=acf_periodicity(flux[a:b]);last=w['originalMixSpectralRhythm']
		delta=(master['preferredBpm']-last['preferredBpm'] if
			master['preferredBpm'] is not None and last['preferredBpm'] is not None else None)
		windows.append({'sourceStartSeconds':start,'sourceEndSeconds':end,
			'wavMasterSpectralRhythm':master,
			'originalMp3SpectralRhythmBpm':last['preferredBpm'],
			'candidateDifferenceBpm':round(delta,5) if delta is not None else None,
			'candidateOnly':True})
	global_candidates=scan(flux)
	peaks=harmonic_section_cues(wav)
	review=candidate_review_sections(peaks,global_candidates)
	return {'format':FORMAT,'status':STATUS,'master':provenance,
		'originalMp3Sha256':EXPECTED_MP3_SHA256,
		'originalMp3PriorReportSha256':mp3_prior['_sha256'],
		'originalMasterVsMp3SourceAlignment':matches,
		'fullOriginalWavRhythmicFrequencyCandidate':global_candidates,
		'originalWavVsMp3SourcePeriodComparisons':windows,
		'originalWavChromaAndLoudnessChangeCandidates':peaks,
		'suggestedShortHumanListeningReview':review,
		'limitations':['Original lossless WAV was SHA-checked on CT211 and its PCM read-only decoded through SSH; no master or resampled-audio file persisted locally',
			'Quarter-like spectral periodicity scanned only 140–180 BPM, and separate whole-song phase scan 155–173 BPM; these priors do NOT rule out true half-time meter',
			'The original source WAV and MP3 are encodings of the SAME musical recording, not independent performances',
			'Windowed ACF/phasor frequency agreement is NOT a verified musical downbeat, quarter note or bar-start grid',
			'Original full-mix chroma/loudness peak is NOT an actual musical phrase, section, chorus or bridge boundary',
			'Explicitly user-identified prior anomaly regions are research review priorities, not discovered tempo shifts',
			'The 28 overlapping 18s windows at 6s hops are statistically dependent, and correlated with prior MP3 analysis',
			'Original WAV PCM was resampled to 11025Hz mono for temporary *analysis in memory* only; no media files altered',
			'No artist/owner listening judgment, released source beat grid, RELEASE_BEAT_GRIDS or gameplay changes follow from these candidates']}


def main():
	p=argparse.ArgumentParser()
	p.add_argument('--original-mp3',required=True,type=Path)
	p.add_argument('--prior-mp3-report',required=True,type=Path)
	p.add_argument('--out',required=True,type=Path)
	a=p.parse_args()
	if a.out.exists():raise SystemExit('Refusing overwrite of original source evidence')
	wav,provenance=verified_remote_master()
	mp3,metadata=decode_original_mp3(a.original_mp3,DURATION)
	prior_bytes=a.prior_mp3_report.read_bytes();prior=json.loads(prior_bytes)
	prior['_sha256']=hashlib.sha256(prior_bytes).hexdigest()
	r=assess(wav,mp3,provenance,prior)
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(r,indent=2)+'\n')
	print('REPORT_SHA256',hashlib.sha256(a.out.read_bytes()).hexdigest(),flush=True)
	print('ORIGINAL_MASTER',r['master']['masterSha256'],'source byte integrity OK',flush=True)
	print('SOURCE_ALIGNMENT',r['originalMasterVsMp3SourceAlignment'],flush=True)
	print('WHOLE_RHYTHM',r['fullOriginalWavRhythmicFrequencyCandidate']['best'],flush=True)
	print('PHRASE_CANDIDATES',r['originalWavChromaAndLoudnessChangeCandidates'][:12],flush=True)
	print('LISTENING_REVIEW',r['suggestedShortHumanListeningReview'][:12],flush=True)
if __name__=='__main__':main()
