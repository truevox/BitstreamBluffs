#!/usr/bin/env python3
"""Conservative v2 candidate release detector experiments — NOT shipped audio.

Shared 48kHz performance-v1 output is the only eventual replacement contract.
Current game music/audio remains v1. These algorithms generate *candidate*
hypotheses for offline comparison and human review, never calibrated confidence.

Design: 10ms spectral novelty provides coarse attacks, 2ms RMS slopes
refine sample-frame positions. >=80ms cross-attack suppression prevents
reverb echoes from becoming extra notes while retaining 120ms re-attacks.
2048-sample windows + interpolated 8192-bin FFT give harmonic-supported pitch
hypotheses and remove release v1's impossible low-semitone bins.
"""
import math
import numpy as np
import librosa
from scipy.signal import find_peaks

RATE=16000
HOP=160
ROLE_MIN_GAP_SEC=.080
FFT_LEN=8192
PITCH_LOW=41
PITCH_HIGH=91
PITCHES=np.arange(PITCH_LOW,PITCH_HIGH+1)
FUNDAMENTALS=440.0*2.0**((PITCHES-69.0)/12.0)


def rms_envelope(y,step=32,width=64):
	"""Windowed RMS with ~2ms attack grid, centered windows."""
	if y.ndim!=1 or len(y)<width*2:
		raise ValueError('Detector needs mono audio longer than two windows')
	y=np.asarray(y,dtype='float64')
	sq=y*y
	prefix=np.r_[0.,np.cumsum(sq)]
	centers=np.arange(0,len(y),step)
	l=np.maximum(0,centers-width//2)
	r=np.minimum(len(y),centers+width//2)
	rms=np.sqrt(np.maximum(0,(prefix[r]-prefix[l])/(r-l)))
	return centers,rms

def source_onsets(y,min_gap_sec=ROLE_MIN_GAP_SEC):
	"""Source-aware onset proposals, not an accuracy label.

	FFT flux remains source-derived, while attack timestamp comes from
	measuring actual waveform RMS growth. Return 16kHz-sample onset indices,
	coarse candidate stats, and uncalibrated detector diagnostics.
	"""
	y=np.asarray(y,dtype='float32')
	if not len(y):return [],{'proposals':0,'retained':0,'status':'empty'}
	stft=np.abs(librosa.stft(y,n_fft=1024,hop_length=HOP,center=True))
	positive=np.maximum(0,np.diff(np.log1p(stft*25),axis=1))
	# Weight low and mid pitched energy; ignore upper hiss to avoid triggers
	# from stem leakage. Clipped frequency support starts above sub-bass.
	freq=np.fft.rfftfreq(1024,1/RATE)
	band=(freq>70)&(freq<5300)
	flux=np.mean(positive[band],axis=0)
	if len(flux)<4:return [],{'proposals':0,'retained':0,'status':'too-short'}
	threshold=max(.001,float(np.percentile(flux,68))*.23)
	gap=max(1,round(min_gap_sec*RATE/HOP))
	peaks,_=find_peaks(flux,prominence=threshold,distance=gap)
	centers,env=rms_envelope(y)
	# Local waveform-envelope gradients: sharp rises, not smooth decays.
	# diff(t) compares energy approximately 8ms before to 4ms after.
	l=np.maximum(0,np.arange(len(env))-4)
	r=np.minimum(len(env)-1,np.arange(len(env))+2)
	rise=np.maximum(0,env[r]-env[l])
	min_rise=max(float(np.percentile(rise,90))*.16,
		float(np.percentile(env,85))*.018,2e-5)
	onsets=[]
	for p in peaks:
		coarse=(int(p)+1)*HOP
		# Broadband flux is routinely up to 15ms early; search both sides.
		a=max(0,round((coarse-.025*RATE)/32))
		b=min(len(env),round((coarse+.04*RATE)/32)+1)
		if b<=a:continue
		chunk=rise[a:b]
		k=int(a+np.argmax(chunk))
		if rise[k]<min_rise:continue
		start=int(centers[k])
		# Discard any candidate with low attack contrast compared to the
		# immediately preceding local envelope. A genuine re-pluck
		# must exhibit a new attack, not just a bright sustain harmonic.
		before=float(np.median(env[max(0,k-8):max(1,k-3)]))
		after=float(np.median(env[min(len(env)-1,k+1):min(len(env),k+5)]))
		if after<before*1.14 and after-before<min_rise*.55:
			continue
		if onsets and start-onsets[-1] < min_gap_sec*RATE:
			# Prefer the candidate with stronger local amplitude slope.
			old=round(onsets[-1]/32)
			if rise[k]>rise[min(len(rise)-1,old)]*1.35:
				onsets[-1]=start
			continue
		onsets.append(start)
	return onsets,{'proposals':len(peaks),'retained':len(onsets),
		'resolutionMs':2.,'minimumGapMs':round(min_gap_sec*1000,1),
		'confidenceCalibrated':False}

def harmonic_candidates(y,onset,window_samples=2048,max_notes=2):
	"""Interpolate off-grid harmonics; subharmonic aliases are penalized.

	Return tuple (MIDI, raw heuristic salience). No salience is a confidence
	probability. Separate sustained/mixed-stem tests must qualify this model.
	"""
	y=np.asarray(y,dtype='float32')
	start=max(0,int(onset)+160)
	stop=min(len(y),start+window_samples)
	frame=y[start:stop]
	if len(frame)<384:return []
	frame=frame-np.mean(frame)
	window=np.hanning(len(frame))
	magnitude=np.abs(np.fft.rfft(frame*window,n=FFT_LEN))
	hz=np.fft.rfftfreq(FFT_LEN,d=1/RATE)
	# 8192-point padding is interpolation, NOT additional acoustic
	# resolution; 128ms actual window is the limiting low-note span.
	harmonics=[]
	base=[]
	for f in FUNDAMENTALS:
		energy=[]
		for harmonic in range(1,6):
			frequency=f*harmonic
			if frequency>4000:
				energy.append(0.);continue
			bin0=np.searchsorted(hz,frequency)
			halfwidth=max(2,round((4.0+frequency*.004)*FFT_LEN/RATE))
			seg=magnitude[max(0,bin0-halfwidth):min(len(magnitude),bin0+halfwidth+1)]
			energy.append(float(seg.max()) if seg.size else 0.)
		# Stronger harmonics are not independently interpreted as a
		# low pitch without support near f and 2f.
		score=sum(v/(i**1.1) for i,v in enumerate(energy,1))
		anchor=energy[0]+energy[1]*.6
		harmonics.append(score)
		base.append(anchor)
	harmonics=np.asarray(harmonics)
	base=np.asarray(base)
	global_max=float(np.max(harmonics)) if len(harmonics) else 0.
	if global_max<=1e-6:return []
	# Relative floor and local neighborhood competition stop spurious
	# scores 1 semitone from a real fundamental.
	local,_=find_peaks(harmonics,distance=2)
	candidates=[]
	for idx in local:
		if harmonics[idx]<global_max*.34 or base[idx]<max(base)*.27:
			continue
		pitch=int(PITCHES[idx])
		candidates.append((pitch,float(harmonics[idx]),float(base[idx])))
	candidates.sort(key=lambda x:x[1],reverse=True)
	selected=[]
	for pitch,salience,fundamental in candidates:
		if any(abs(pitch-m)<2 for m,_ in selected):
			continue
		# If a lower detected candidate also explains the harmonic, do
		# not count the overtone as an independent note.
		if any(pitch-m in (12,19,24) and strength>=salience*.6
			for m,strength in selected):
			continue
		selected.append((pitch,salience))
		if len(selected)>=max_notes:break
	return selected

def accompaniment(y):
	"""Generate standalone candidate score-v1 legacy note API, source-driven."""
	attacks,stats=source_onsets(y)
	events=[]
	for i,attack in enumerate(attacks):
		pitches=harmonic_candidates(y,attack)
		if not pitches:continue
		start=round(attack/RATE,4)
		if i+1<len(attacks):
			duration=min(.7,max(.095,(attacks[i+1]-attack)/RATE*.85))
		else:
			duration=.3
		for pitch,salience in pitches:
			events.append({'midi':pitch,'start':start,
				'end':round(start+duration,4),
				'confidence':None,'expression':{'estimatedVelocity':None}})
	return events,{**stats,'hypothesizedNotes':len(events),
		'algorithm':'experimental-v2-harmonic-rms-onsets',
		'quality':'unverified-candidate-not-publishable'}


def bass_replucks(y):
	"""Split same-pitch sustained YIN spans on validated re-attack cues.

	We preserve the legacy pitch track and do NOT invent octave guesses.
	This isolates Fable's missing repeated-bass-note defect from unrelated
	pitch model changes. Old + new share identical role/event JSON.
	"""
	from render_full_dynamic_orchestra_v1 import choose_bass_events
	old,meta=choose_bass_events(y)
	attacks,attack_meta=source_onsets(y,min_gap_sec=.09)
	out=[]
	for item in old:
		a=item['start']
		b=item['end']
		pitch=item['midi']
		# A 0.30-0.38s legitimate pluck with reverb tail often has one
		# phantom attack 140ms later. Short segments cannot establish
		# a repeated-note pattern, so do not modify them at all.
		if b-a<.42:
			out.append(item)
			continue
		within=sorted(t/RATE for t in attacks if a+.10<=t/RATE<=b-.07)
		regular=[t for t in within if t<=b-.09]
		gaps=np.diff(regular)
		# Multiple attacks at near-regular subbeat intervals are stronger
		# evidence of re-striking than a single source transient. This
		# conservative gate intentionally leaves ambiguous notes alone.
		if len(regular)<2 or len(gaps)<1 or np.min(gaps)<.085 or (
			np.max(gaps)>.27) or np.std(gaps)>max(.019,np.mean(gaps)*.24):
			out.append(item)
			continue
		earlier=[t/RATE for t in attacks if a-.03<=t/RATE<=a+.08]
		first=min(earlier,key=lambda t:abs(t-a-.045)) if earlier else a
		points=[first]
		for t in regular:
			if t-points[-1]>=.08 and b-t>=.07:
				points.append(t)
		if len(points)<3:
			out.append(item)
			continue
		for i,start in enumerate(points):
			end=points[i+1] if i+1<len(points) else b
			if end-start>=.065:
				out.append({'midi':pitch,'start':round(start,4),
					'end':round(end,4)})
	return out,{'algorithm':'release-v1-YIN-pitch-plus-v2-source-reattacks',
		'baselineBassEvents':len(old),'candidateBassEvents':len(out),
		'addedReattacks':len(out)-len(old),'attackProposals':attack_meta,
		'confidenceCalibrated':False}


def drum_simultaneous(y,echo_guard='ratio-only'):
	"""Independent per-family onset streams, including simultaneous co-hits.

	Unlike release v1 (one class per broadband onset), each family has its
	own spectral/onset evidence. Synthetic tests may still expose false
	co-hits; do not deploy until real drums manually reviewed.
	"""
	from scipy.signal import butter,sosfiltfilt
	y=np.asarray(y,dtype='float32')
	if len(y)<RATE//4:return [],{'reason':'too-short'}
	config={
		'kick':(45,180,.055),
		'snare':(350,3500,.055),
		'hat':(4400,7500,.044),
	}
	if echo_guard not in ('correlated-attack','ratio-only','none'):
		raise ValueError('invalid experimental echo guard')
	out=[]
	raw=[]
	filtered={}
	for kind,(low,high,gap) in config.items():
		sos=butter(4,[low,high],btype='bandpass',fs=RATE,output='sos')
		band=sosfiltfilt(sos,y).astype('float32')
		filtered[kind]=band
		centers,env=rms_envelope(band)
		idx=np.arange(len(env))
		past=np.maximum(0,idx-5)
		future=np.minimum(len(env)-1,idx+2)
		gain=np.maximum(0,env[future]-env[past])
		# Refractory windows affect ONLY this drum family.
		threshold=max(
			float(np.percentile(gain,87))*.3,
			float(np.max(gain))*.023,
			1e-5)
		peaks,_=find_peaks(gain,
			distance=max(1,round(gap*RATE/32)),
			prominence=threshold)
		for peak in peaks:
			frame=int(centers[peak])
			before=float(np.median(env[max(0,peak-8):max(1,peak-3)]))
			after=float(np.median(env[min(len(env)-1,peak+1):
				min(len(env),peak+5)]))
			if after-before<max(threshold*.4,2e-5):
				continue
			if after < before*1.2 and after-before<threshold:
				continue
			raw.append((frame,kind,float(gain[peak]),after))
	# Co-hits across band families remain distinct source events.
	raw.sort(key=lambda x:(x[0],x[1]))
	# A strongly decaying repeat of the SAME family inside 170ms is
	# echo-suspect. Never compare across families: kick+snare co-hits
	# are intentional. This is a hypothesis, not real-hit truth, and
	# could reject legitimate quiet ghost notes: audit on human gold.
	accepted={}
	removed_echo_suspects=0
	for frame,kind,gain,energy in raw:
		last=accepted.get(kind)
		if last is not None:
			last_frame,last_gain,last_energy=last
			dt=(frame-last_frame)/RATE
			echo_window=.052<=dt<=.17 and gain<last_gain*.52 and (
				energy<last_energy*.83)
			reject=False
			if echo_guard=='ratio-only':
				reject=echo_window
			elif echo_guard=='correlated-attack' and echo_window:
				# An echoed snare/hat is a delayed, scaled copy of the
				# earlier waveform, unlike an independently re-struck
				# noisy membrane or cymbal. One anchored window avoids
				# treating all quiet ghost notes as room echoes.
				# Tonal kick attacks can also be highly correlated when
				# truly struck again, so kick echo rejection waits for
				# separately calibrated time/frequency evidence.
				if kind!='kick':
					band=filtered[kind]
					size=round(.024*RATE)
					a=band[last_frame+32:last_frame+32+size]
					b=band[frame+32:frame+32+size]
					if len(a)==size and len(b)==size:
						den=float(np.linalg.norm(a)*np.linalg.norm(b))
						corr=abs(float(np.dot(a,b))/den) if den>1e-8 else 0.
						reject=corr>.68
			if reject:
				removed_echo_suspects+=1
				continue
		accepted[kind]=(frame,gain,energy)
		out.append({'t':round(frame/RATE,4),'type':kind})
	return out,{'algorithm':'v2-family-independent-band-envelope-attacks',
		'echoGuard':echo_guard,
		'removedEchoSuspects':removed_echo_suspects,
		'candidateHits':len(out),
		'families':{role:sum(x['type']==role for x in out)
			for role in config},'confidenceCalibrated':False}
