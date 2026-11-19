#!/usr/bin/env python3
"""Offline, source-bound optional piano-friendly reinterpretation of One More Run.

Never edits original OGGs, release scores, beat grids, music packs, or gameplay.
Supports reproducible A/B/C listening extracts, a source-indexed contour
analysis JSON, and full-length additive MIDI/audio lead for a separate review.
"""
from __future__ import annotations
import argparse, hashlib, json, math, struct, subprocess
from pathlib import Path
import numpy as np
import librosa
from scipy.ndimage import median_filter

RATE=48000
PITCH_RATE=16000
HOP=160  # 10 ms source-contour frames
BPM_PROMPT=160
STEMS=('vocals','drums','bass','guitar','piano','other')
REVIEW_WINDOWS=((24.,48.),(60.,84.),(108.,132.),(144.,168.))


def read_ogg(path:Path,rate:int,channels:int=1)->np.ndarray:
	p=subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(path),
		'-ar',str(rate),'-ac',str(channels),'-f','f32le','pipe:1'],
		capture_output=True,timeout=35,check=True)
	data=np.frombuffer(p.stdout,'<f4').copy()
	return data.reshape(-1,channels) if channels>1 else data


def smooth_pitch(f0,rms,flatness):
	"""Use voice energy + spectral structure: never call all YIN f0 'voiced'."""
	f0=np.asarray(f0,dtype=np.float64)
	rms=np.asarray(rms,dtype=np.float64)
	flatness=np.asarray(flatness,dtype=np.float64)
	n=min(len(f0),len(rms),len(flatness))
	f0=f0[:n];rms=rms[:n];flatness=flatness[:n]
	floor=max(.0015,float(np.percentile(rms,76))*.22)
	mask=(rms>floor)&np.isfinite(f0)&(f0>=105)&(f0<=1050)&(flatness<.34)
	midi=69+12*np.log2(np.maximum(1e-9,f0)/440)
	# Ignore isolated octave errors and vibrato: medians performed only inside
	# continuously voiced islands so silence never becomes invented notes.
	midi=np.where(mask,midi,np.nan)
	return midi,mask,{'energyFloor':floor,'voicedFraction':float(mask.mean())}


def classify_contour(values:np.ndarray, times:np.ndarray):
	"""Classify one vocal phrase: long coherent rise vs tiny end-of-note scoop.

	Returns separate note-center and meaningful segment transitions; avoids
	inventing bend curves in the shipping integer-note performance schema.
	"""
	assert len(values)==len(times) and len(values)>0
	valid=np.isfinite(values)
	if valid.sum()<5:return {'kind':'unvoiced','stable':None,'transitions':[]}
	v=values[valid];t=times[valid]
	L=len(v)
	middle=v[int(.25*L):max(int(.75*L),int(.25*L)+1)]
	center=float(np.median(middle))
	stable=int(np.rint(center))
	duration=float(t[-1]-t[0]+.01)
	initial=float(np.median(v[:max(2,int(.17*L))]))
	final=float(np.median(v[-max(2,int(.13*L)):]))
	terminal=final-center
	start=initial-center
	# A dramatic start glide must be coherent and land on a sustainable note;
	# a tiny or short terminal scoop is not a structural new piano note.
	# The *stable destination* must occupy at least ~80 ms.
	end_section=v[max(0,int(.65*L)):]
	steady_end=bool(len(end_section)>=8 and np.median(np.abs(end_section-np.median(end_section)))<.8)
	transitions=[]
	kind='steady'
	if duration>=.19 and abs(start)>=1.55 and steady_end:
		limit=min(len(v)-1,max(5,int(.43*L)))
		line=v[:limit]
		trend=np.sign(center-initial)
		if trend and float((np.diff(line)*trend>.025).mean())>=.52:
			# Prefer the audible start anchor of a deliberate rise/fall,
			# not the median halfway through the singer's fast initial bend.
			lead=v[:max(3,int(.07*L))]
			# The early stable starting pitch of a genuine glide matters.
			# Median of a few beginning samples is less noisy than a minimum.
			start_anchor=np.median(lead)
			from_pitch=int(np.rint(start_anchor));to_pitch=stable
			if from_pitch!=to_pitch:
				kind='structural-onset-glide'
				transitions=[{'fromPitch':from_pitch,'toPitch':to_pitch,
					'slideSeconds':min(.3,max(.07,duration*.36))}]
	if kind=='steady' and abs(terminal)>=.55 and duration>=.17:
		kind='terminal-ornament-removed'
	return {'kind':kind,'stable':stable,'transitions':transitions,
		'initialCents':round(start*100), 'terminalCents':round(terminal*100),
		'durationSeconds':round(duration,3)}


def segment_notes(midi:np.ndarray,mask:np.ndarray,hop_seconds=.01):
	"""Segment robust note centers, retaining source reattacks and rests.

	Disjoint voiced islands are NOT merged across a genuine >=70ms rest.
	Consecutive rapid pitch excursions are held as candidate phrases rather
	than emitted as dozens of detuned notes.
	"""
	midi=np.asarray(midi,dtype=np.float64)
	mask=np.asarray(mask,dtype=bool)
	assert len(mask)==len(midi)
	# A 7-frame median suppresses transitory pitch/voicedness flutters.
	voiced=median_filter(mask.astype('uint8'),size=7,mode='nearest')>0
	runs=[];start=None
	for i,active in enumerate(np.r_[voiced,False]):
		if active and start is None:start=i
		elif not active and start is not None:
			if (i-start)*hop_seconds>=.075:runs.append((start,i))
			start=None
	result=[]
	for start,end in runs:
		vals=midi[start:end];frames=np.arange(start,end)*hop_seconds
		# Remove detectors' missed frames without smoothing across silence.
		good=np.isfinite(vals)
		if good.sum()<8:continue
		centered=vals.copy()
		for x in np.where(~good)[0]:
			near=np.where(good)[0];centered[x]=vals[near[np.argmin(np.abs(near-x))]]
		centered=median_filter(centered,size=9,mode='nearest')
		# Split on a center step only when it is sustained: unlike turning
		# every vibrato cycle into a new note, this requires >=100ms.
		labels=np.rint(centered).astype(int)
		starts=[0]
		minlen=max(9,int(.095/hop_seconds))
		for j in range(minlen,len(labels)-minlen):
			before=int(np.rint(np.median(centered[max(0,j-minlen):j])))
			after=int(np.rint(np.median(centered[j:j+minlen])))
			if abs(after-before)>=1 and after!=before and j-starts[-1]>=minlen and np.median(np.abs(centered[j:j+minlen]-after))<.45:
				starts.append(j)
		starts.append(len(labels))
		for a,b in zip(starts[:-1],starts[1:]):
			if (b-a)*hop_seconds<.075:continue
			segvals=centered[a:b]
			info=classify_contour(segvals,np.arange(start+a,start+b)*hop_seconds)
			if info['stable'] is None:continue
			result.append({'start':round((start+a)*hop_seconds,5),
				'end':round((start+b)*hop_seconds,5),
				'pitch':info['stable'],'kind':info['kind'],
				'transitions':info['transitions'],
				'initialCents':info['initialCents'],
				'terminalCents':info['terminalCents']})
	return result


def extract_source(pack:Path,segments:list,stem:str,rate:int):
	parts=[];hashes=[]
	for i,seg in enumerate(segments):
		f=pack/seg['sources'][stem]
		assert f.is_file(),f
		hashes.append(hashlib.sha256(f.read_bytes()).hexdigest())
		part=read_ogg(f,rate)
		# Convert exact 48 kHz pack-length source durations at target sample rate,
		# because decoded Opus final padding must not drift segment boundaries.
		length=round(seg['frames']*rate/RATE)
		if len(part)<length-4:raise ValueError(f'Short original OGG: {f} {len(part)} < {length}')
		parts.append(np.pad(part[:length],(0,max(0,length-len(part)))))
	return np.concatenate(parts),hashes


def notes_from_original(pack:Path,meta:dict):
	vocals,hashes=extract_source(pack,meta['segments'],'vocals',PITCH_RATE)
	print('VOCAL_SOURCE_READ',len(vocals),len(hashes),flush=True)
	# Full track one reference source clock; use deterministic librosa YIN.
	f0=librosa.yin(vocals.astype(np.float64),fmin=105,fmax=1050,
		sr=PITCH_RATE,frame_length=2048,hop_length=HOP,center=True,trough_threshold=.15)
	rms=librosa.feature.rms(y=vocals,frame_length=2048,hop_length=HOP,center=True)[0]
	# Flatness is only a weak voicing indicator; never claim gold transcription.
	flat=librosa.feature.spectral_flatness(y=vocals,n_fft=2048,
		hop_length=HOP,center=True)[0]
	midi,mask,stats=smooth_pitch(f0,rms,flat)
	notes=segment_notes(midi,mask)
	stats.update({'rawVoicedFrames':int(np.isfinite(midi).sum()),
		'rawPitchFrames':int(len(f0)),'noteCount':len(notes),
		'candidateStructuralGlides':sum(x['kind']=='structural-onset-glide' for x in notes),
		'candidateTerminalScoopsRemoved':sum(x['kind']=='terminal-ornament-removed' for x in notes)})
	return notes,stats,hashes


def piano_wave(freq,n):
	"""Simple original soft hammer-like harmonic piano approximation."""
	t=np.arange(n,dtype=np.float64)/RATE
	phase=2*np.pi*freq*t
	# This is an intentionally original synthetic instrument, not a sampled
	# acoustic grand. Fast attack + percussive exponential decay/release.
	partial=(.78*np.sin(phase)+.33*np.sin(2*phase)*np.exp(-2.5*t)+
		.16*np.sin(3*phase)*np.exp(-4*t)+.05*np.sin(4*phase)*np.exp(-5*t))
	decay=np.exp(-1.25*t)
	gate=np.minimum(1,t/.009)
	return partial*decay*gate


def performance_events(notes,mode):
	"""Pure score-to-piano event transform with optional staircase glides."""
	out=[]
	for i,n in enumerate(notes):
		start=float(n['start']);end=float(n['end']);pitch=int(n['pitch'])
		if not (0<=pitch<=127 and end>start):continue
		trans=n['transitions'] if mode=='expressive' else []
		if trans and (end-start)>.20:
			tr=trans[0];begin=int(tr['fromPitch']);target=int(tr['toPitch'])
			steps=min(4,abs(target-begin))
			step_len=min(.065,(end-start)*.35/max(1,steps))
			for k in range(steps):
				f=(k+0.5)/steps
				p=int(np.rint(begin+(target-begin)*f))
				out.append((start+k*step_len,start+(k+1)*step_len,p))
			start+=steps*step_len
		out.append((start,end,pitch))
	return out


def render_events(events,duration,volume=.17):
	N=round(duration*RATE)
	y=np.zeros(N,dtype=np.float32)
	for start,end,pitch in events:
		a=max(0,int(round(start*RATE)));b=min(N,int(round(end*RATE)))
		if b-a<120:continue
		freq=440*2**((pitch-69)/12)
		z=piano_wave(freq,b-a)
		# Short, bounded release to avoid discontinuities between reattacks.
		fade=min(int(.035*RATE),len(z)//2)
		z[-fade:]*=np.linspace(1,0,fade)
		y[a:b]+=np.asarray(z*volume,dtype=np.float32)
	return np.clip(y,-.90,.90)


def write_midi(events,path):
	"""Editable SMF0 percussion-independent piano take at 160 BPM.

	MIDI generation tempo is informational; precise source event seconds are
	mapped through that MIDI tempo without claiming a verified beat grid.
	"""
	def vlq(v):
		v=int(v);b=[v&127];v>>=7
		while v:b.insert(0,(v&127)|128);v>>=7
		return bytes(b)
	def tick(sec):return int(round(sec*(160/60)*480))
	ev=[(0,0,b'\xff\x51\x03'+int(60e6/BPM_PROMPT).to_bytes(3,'big')),
		(0,1,bytes([0xc0,0]))]
	for a,b,p in events:
		if b<=a:continue
		ev.extend([(tick(a),3,bytes((0x90,p,92))),
			(tick(b),2,bytes((0x80,p,0)))])
	ev.sort(key=lambda x:(x[0],x[1]))
	blob=bytearray();pos=0
	for t,_,data in ev:
		blob+=vlq(t-pos)+data;pos=t
	blob+=b'\x00\xff\x2f\x00'
	path.write_bytes(b'MThd'+struct.pack('>IHHH',6,0,1,480)+b'MTrk'+struct.pack('>I',len(blob))+blob)


def write_mp3(path,signal,channels=2):
	data=np.clip(signal,-.985,.985)
	if data.ndim==1 and channels==2:data=np.stack((data,data),axis=1)
	proc=subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-f','f32le',
		'-ar',str(RATE),'-ac',str(channels),'-i','pipe:0','-codec:a','libmp3lame',
		'-q:a','4',str(path)],input=data.astype('<f4').tobytes(),
		capture_output=True,timeout=75)
	if proc.returncode:raise RuntimeError(proc.stderr.decode()[:500])


def main():
	a=argparse.ArgumentParser()
	a.add_argument('--source-pack',type=Path,required=True)
	a.add_argument('--out',type=Path,required=True)
	args=a.parse_args()
	pack=args.source_pack
	meta=json.loads((pack/'pack.json').read_text())
	if meta.get('id')!='local-one-more-run-bitstream-bluffs':raise ValueError('Wrong source pack')
	assert meta['sampleRate']==RATE
	duration=meta['frameCount']/RATE
	if abs(duration-174.6)>1e-4:raise ValueError('Unexpected source duration')
	out=args.out;out.mkdir(parents=True,exist_ok=True)
	if list(out.iterdir()):raise FileExistsError('Refuse to overwrite nonempty output: '+str(out))
	notes,stats,hashes=notes_from_original(pack,meta)
	print('NOTES',stats,flush=True)
	if len(notes)<80:raise RuntimeError('Sparse source analysis, refusing fake melody')
	preview={'format':'bitstream-piano-friendly-source-contour-research-v1',
		'kind':'UNVERIFIED_PROVISIONAL_LISTENING_EXPERIMENT_NOT_RELEASE_SCORE',
		'songId':meta['id'],'sourceManifestSha256':hashlib.sha256((pack/'pack.json').read_bytes()).hexdigest(),
		'vocalOggSegmentHashes':hashes,'samplingHz':PITCH_RATE,
		'pitchHopSeconds':HOP/PITCH_RATE,'generator':'librosa.YIN+flatness+RMS+median+note-center',
		'intendedSunoPromptBpm':BPM_PROMPT,
		'timingQuantization':'No beat-grid snapping: exact source phrase starts retained because released beat phase unverified',
		'pitchQuantization':'nearest equal-temperament semitone; separate expressive glides rendered as piano-note staircase',
		'notes':notes,'analysis':stats}
	(out/'unverified-source-contour.json').write_text(json.dumps(preview,indent=2)+'\n')
	flat_events=performance_events(notes,'piano')
	expressive_events=performance_events(notes,'expressive')
	write_midi(flat_events,out/'B_piano_friendly_160bpm.mid')
	write_midi(expressive_events,out/'C_selective_glides_160bpm.mid')
	print('MIDI_WRITTEN',len(flat_events),len(expressive_events),flush=True)
	# Render one coherent melody clock, never a per-section restarted voice.
	flat=render_events(flat_events,duration)
	exp=render_events(expressive_events,duration)
	# Snapshot original source *accompaniment* only for the selected windows.
	# No original-song or original-vocal OGG is ever overwritten or re-encoded
	# into the game. User-owned review copies are kept on isolated feature branch.
	results=[]
	for k,(start,end) in enumerate(REVIEW_WINDOWS,1):
		start_frame=round(start*RATE);end_frame=round(end*RATE)
		accomp=np.zeros((end_frame-start_frame,2),dtype=np.float32)
		orig_vocals=np.zeros_like(accomp)
		for stem in STEMS:
			for i,seg in enumerate(meta['segments']):
				seg_start=seg['startFrame'];seg_end=seg_start+seg['frames']
				lo=max(start_frame,seg_start);hi=min(end_frame,seg_end)
				if hi<=lo:continue
				path=pack/seg['sources'][stem]
				original=read_ogg(path,RATE,2)
				part=original[lo-seg_start:hi-seg_start]
				if len(part)!=hi-lo:raise ValueError('OGG sample clock mismatch')
				if stem=='vocals':orig_vocals[lo-start_frame:hi-start_frame]+=part
				else:accomp[lo-start_frame:hi-start_frame]+=part
		# one gain across ALL variations, not each independently mastered
		base=.55*accomp
		variants={'A_original_song_vocals':base+.55*orig_vocals,
			'B_piano_friendly':base+flat[start_frame:end_frame,None],
			'C_selective_glides':base+exp[start_frame:end_frame,None]}
		common_gain=min(1.,.92/max(float(np.max(np.abs(v))) for v in variants.values()))
		files=[]
		for label,source in variants.items():
			path=out/f'window{k}_{int(start):03d}-{int(end):03d}_{label}.mp3'
			write_mp3(path,source*common_gain)
			files.append({'name':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
				'peak':round(float(np.max(np.abs(source*common_gain))),3)})
		print('WINDOW_READY',k,start,end,'files',len(files),flush=True)
		results.append({'index':k,'originalStartSeconds':start,'originalEndSeconds':end,
			'commonGain':round(common_gain,4),'files':files})
	(out/'README.md').write_text('# One More Run — optional piano-friendly melody audition\n\n'
		'**Research only**. Source-original vocals vs piano-friendly and selectively expressive piano interpretations.\n'
		'Preserves the actual source-note timing (the 160 BPM Suno prompt is not a beat-grid phase).\n'
		'All audio derives from the same user-owned OGG pack; synthetic piano sound, not an acoustic grand.\n'
		'No game/runtime changes, original files or released scores altered. Human note accuracy not verified.\n\n'
		+''.join(f'## Window {x["index"]}: {x["originalStartSeconds"]:.0f}–{x["originalEndSeconds"]:.0f}s\n'+
		''.join(f'- [{y["name"]}]({y["name"]})\n' for y in x['files'])+'\n' for x in results)
		+'Editable research-only MIDI: [piano-friendly](B_piano_friendly_160bpm.mid), '
		'[selective glides](C_selective_glides_160bpm.mid).\n'
		'Pitch contour and source stem SHA evidence: [source notes](unverified-source-contour.json).\n')
	(out/'manifest.json').write_text(json.dumps({'research':preview['kind'],
		'sourceManifestSha256':preview['sourceManifestSha256'],
		'notes':stats,'windows':results},indent=2)+'\n')
	print('ALL_COMPLETE',len(results),'WINDOWS',flush=True)

if __name__=='__main__':main()
