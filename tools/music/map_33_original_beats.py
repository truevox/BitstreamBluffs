#!/usr/bin/env python3
"""Map UNVERIFIED rhythmic beat candidates for all 33 immutable source songs.

Use original drums + bass FLACs, not generated MIDI or melody. Two tempo
priors; whole-song beat paths; 18s overlapping source-window rhythmic
periodicity; independent bass-onset corroboration; no claim of musical bar 1.
No `RELEASE_BEAT_GRIDS`, Gym, World Dance, or production music changes.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import time
import numpy as np
import librosa
from scipy.ndimage import uniform_filter1d
from scipy.signal import butter,sosfilt

SR=11025
HOP=220
TICK=HOP/SR
RATE=48000


def digest(p):
	h=hashlib.sha256()
	with p.open('rb') as f:
		for x in iter(lambda:f.read(4<<20),b''):
			h.update(x)
	return h.hexdigest()


def mono(path):
	p=subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(path),
		'-ac','1','-ar',str(SR),'-f','f32le','pipe:1'],capture_output=True,check=True,timeout=300)
	a=np.frombuffer(p.stdout,dtype='<f4').copy()
	if len(a)<10*SR or not np.isfinite(a).all():raise ValueError('Invalid source decoded drum/bass audio')
	return a


def low_onsets(signal,cutoff):
	filtered=sosfilt(butter(3,cutoff,fs=SR,output='sos'),signal.astype('float64'))
	energy=filtered*filtered
	short=np.sqrt(np.maximum(0,uniform_filter1d(energy,size=250)[::HOP]))
	long=np.sqrt(np.maximum(0,uniform_filter1d(energy,size=950)[::HOP]))
	flux=np.maximum(0,np.diff(np.log1p(short*100),prepend=np.log1p(short[0]*100)))
	change=np.maximum(0,short/(long+1e-5)-1)
	e=np.maximum(0,.75*flux+.25*change)
	peak=float(np.percentile(e,99.5))
	return np.clip(e/max(peak,1e-6),0,1)


def support(envelope,t):
	at=int(round(t/TICK))
	a=max(0,at-3);b=min(len(envelope),at+4)
	return float(max(envelope[a:b])) if a<b else 0.


def local_periods(envelope,seconds,hop=6,window=18):
	out=[]
	for st in np.arange(0,max(.1,seconds-window+.1),hop):
		a=envelope[round(st/TICK):round((st+window)/TICK)]
		if len(a)<window*.85/TICK or float(np.std(a))<.012:continue
		z=a-np.mean(a)
		cor=np.correlate(z,z,mode='full')[len(z)-1:]
		# Isolate the 70-210 BPM region; half-/double-time still ambiguous.
		lo=round((60/210)/TICK);hi=min(len(cor)-1,round((60/70)/TICK))
		if hi<=lo:continue
		strength=cor[lo:hi+1]/np.maximum(1,np.arange(len(z)-lo,len(z)-hi-1,-1))
		idx=int(np.argmax(strength))+lo
		if 1<=idx<len(cor)-1:
			l,c,r=cor[idx-1:idx+2];delta=.5*(l-r)/max(1e-8,l-2*c+r)
			if not np.isfinite(delta) or abs(delta)>.5:delta=0.
		else:delta=0.
		bpm=60/((idx+delta)*TICK)
		out.append({'sourceStartSeconds':round(float(st),2),'bpmPeriodicityHypothesis':round(float(bpm),3),
			'normalizedOnsetPeriodicity':round(float(max(0,cor[idx])/max(1e-6,cor[0])),4)})
	return out


def attempt_beat_track(drums,onset,prior):
	# librosa beat_track provides one source-absolute beat *hypothesis*;
	# start_bpm is merely a search prior, not evidence of the original song BPM.
	tempo,frames=librosa.beat.beat_track(onset_envelope=onset,sr=SR,
		hop_length=HOP,start_bpm=prior,trim=False,units='frames')
	bpm=float(np.asarray(tempo).reshape(-1)[0])
	times=librosa.frames_to_time(frames,sr=SR,hop_length=HOP)
	times=np.asarray(times,dtype='float64')
	if len(times)<12 or not 48<bpm<250:raise ValueError('Unreliable sparse beat sequence')
	return bpm,times


def measure_candidate_alternatives(beats,drum,bass):
	# There is NO known meter or downbeat. Retain all four possible 4/4
	# positions as equally provisional, with raw accent contrast.
	if len(beats)<12:return []
	d=np.array([support(drum,float(t)) for t in beats]);b=np.array([support(bass,float(t)) for t in beats])
	out=[]
	for offset in range(4):
		mask=np.arange(len(beats))%4==offset
		contrast=(float(np.mean(d[mask])-np.mean(d[~mask]))+
			float(np.mean(b[mask])-np.mean(b[~mask])))/2
		out.append({'hypotheticalFirstBeatIndexMod4':offset,
			'drumAccentDifference':round(float(np.mean(d[mask])-np.mean(d[~mask])),4),
			'bassAccentDifference':round(float(np.mean(b[mask])-np.mean(b[~mask])),4),
			'combinedAccentDifferenceNotConfidence':round(contrast,4)})
	return sorted(out,key=lambda row:row['combinedAccentDifferenceNotConfidence'],reverse=True)


def run_song(track,master,dest):
	id=str(track['id']);slot=int(track['slot']);name=f'{slot:02d}_{id}'
	target=dest/(name+'.json')
	if target.exists():
		r= json.loads(target.read_text())
		if r.get('trackId')==id and r.get('status')=='UNVERIFIED_SOURCE_BEAT_CANDIDATES':
			print('BEAT_MAP_EXISTING',slot,id,flush=True);return
		raise FileExistsError('Existing source beat map mismatch '+str(target))
	t0=time.monotonic()
	stems=track.get('stem_files')
	if slot==33:stems=track['grouped_6s']['stemFiles']
	assert all(k in stems for k in ('drums','bass'))
	paths={k:master/stems[k] for k in ('drums','bass')}
	assert all(p.is_file() for p in paths.values())
	sha={k:digest(p) for k,p in paths.items()}
	mono_d=mono(paths['drums']);mono_b=mono(paths['bass'])
	length=min(len(mono_d),len(mono_b))
	seconds=length/SR
	# trim mismatched leading/resampling tails but never time-stretch.
	mono_d=mono_d[:length];mono_b=mono_b[:length]
	drum=low_onsets(mono_d,160);bass=low_onsets(mono_b,260)
	# Two source-driven hypotheses with deliberately different priors.
	answers=[]
	for prior in (105.,165.):
		try:
			beat_bpm,times=attempt_beat_track(mono_d,drum,prior)
			times=times[(times>=0)&(times<seconds)]
			if len(times)<12:continue
			gaps=np.diff(times)
			valid=np.mean((gaps>0.18)&(gaps<1.3))
			if valid<.82:continue
			corrob=np.mean([min(support(drum,float(t)),support(bass,float(t))) for t in times])
			phase_d=np.mean([support(drum,float(t)) for t in times]);phase_b=np.mean([support(bass,float(t)) for t in times])
			answers.append({'priorBpm':prior,'algorithmEstimatedBpm':round(beat_bpm,3),
				'beatsSourceFrames48k':[int(round(t*RATE)) for t in times],
				'firstBeatCandidateSeconds':round(float(times[0]),4),
				'lastBeatCandidateSeconds':round(float(times[-1]),4),
				'localIntervalMedianBpm':round(float(60/np.median(gaps)),3),
				'irregularIntervalFraction':round(float(1-valid),4),
				'drumOnsetSupportNotConfidence':round(float(phase_d),4),
				'bassOnsetSupportNotConfidence':round(float(phase_b),4),
				'jointDrumBassSupportNotConfidence':round(float(corrob),4),
				'hypothetical4BeatMeterOffsets':measure_candidate_alternatives(times,drum,bass)})
		except (ValueError,RuntimeError,librosa.util.exceptions.ParameterError) as e:
			print('BEAT_PRIOR_UNRESOLVED',slot,prior,str(e)[:120],flush=True)
	local_d=local_periods(drum,seconds);local_b=local_periods(bass,seconds)
	median_d=float(np.median([w['bpmPeriodicityHypothesis'] for w in local_d])) if local_d else None
	median_b=float(np.median([w['bpmPeriodicityHypothesis'] for w in local_b])) if local_b else None
	status='UNVERIFIED_SOURCE_BEAT_CANDIDATES'
	r={'format':'bitstream-33-original-beat-candidates-v1','status':status,
		'provenance':'Original source drum and bass FLACs; no generated melodies, MIDI or downmix',
		'trackId':id,'slot':slot,'title':track['title'],'sourceSampleRate':SR,
		'outputFrameRate':RATE,'sourceSeconds':round(seconds,6),
		'sourceStemSha256':sha,'sourceStemPaths':{k:str(v.relative_to(master)) for k,v in paths.items()},
		'rhythmEstimator':'librosa onset beat tracking with two independent tempo priors; low-band source drums + bass cross-onset, overlapping source-time periodicity',
		'candidateBeatPaths':answers,'localDrumPeriodicityWindows':local_d,
		'localBassPeriodicityWindows':local_b,
		'crossStemWindowTempoMedianHypotheses':{'drums':median_d,'bass':median_b},
		'beatOne':'UNVERIFIED','meter':'UNVERIFIED','tempoDrift':'UNVERIFIED',
		'notes':'Source onset periodicity is not musical quarter-note BPM, nor a downbeat. Stem bleed and syncopation confound. Frame marks are candidates; no production gameplay authority.',
		'elapsedSeconds':round(time.monotonic()-t0,2)}
	dest.mkdir(parents=True,exist_ok=True)
	with target.open('x') as f:json.dump(r,f,indent=2);f.write('\n')
	print('SOURCE_BEAT_CANDIDATES_DONE',slot,id,round(seconds,1),len(answers),
		[len(a['beatsSourceFrames48k']) for a in answers],round(time.monotonic()-t0,1),flush=True)

if __name__=='__main__':
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--master',type=Path,default=Path('/root/bitstream-maxi/launch33'))
	p.add_argument('--out',required=True,type=Path)
	p.add_argument('--slot',type=int,choices=range(1,34),default=None)
	a=p.parse_args()
	master=a.master.resolve();dest=a.out.resolve()
	if master==dest or master in dest.parents or dest in master.parents:
		raise ValueError('Output must not overlap source archive')
	roster=json.loads((master/'game-stems-manifest.json').read_text())
	tracks=[x for x in roster['tracks'] if a.slot is None or int(x['slot'])==a.slot]
	for track in tracks:run_song(track,master,dest)
