#!/usr/bin/env python3
"""Source-conditioned individual-note AUDIT and reversible limited edit trial.

Combines 3 differently-thresholded Basic Pitch note lists (same model),
actual source-stem chroma/CQT pitch evidence, octave-shadow suspicion, and
same-pitch retrigger overlap. NOT an authoritative transcription: a harmonic
can be a true sound, and threshold agreement isn't independent validation.
Outputs per-note provenance and changes; never overwrites original scores.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import librosa

RATE=22050
HOP=256
BASE_MIDI=24
N_BINS=84
SECONDS=32

def comparable(x,y,tolerance=.085):
	if int(x['midi'])!=int(y['midi']):
		return False
	if abs(float(x['start'])-float(y['start']))>tolerance:
		return False
	overlap=min(float(x['end']),float(y['end']))-max(float(x['start']),float(y['start']))
	return overlap>=.035

def matched_index(note,other):
	found=[i for i,e in enumerate(other) if comparable(note,e)]
	if not found:
		return None
	return min(found,key=lambda i:abs(float(other[i]['start'])-float(note['start'])))

def accompaniment_cqt(path,start):
	y,sr=librosa.load(str(path),sr=RATE,mono=True,offset=float(start),duration=SECONDS)
	if len(y)<RATE*SECONDS:
		y=np.pad(y,(0,RATE*SECONDS-len(y)))
	cqt=np.abs(librosa.cqt(y,sr=sr,hop_length=HOP,
		fmin=librosa.midi_to_hz(BASE_MIDI),n_bins=N_BINS,
		bins_per_octave=12))
	return cqt

def pitch_support(cqt,note):
	midi=int(note['midi'])
	bin_no=midi-BASE_MIDI
	if bin_no<2 or bin_no>=N_BINS-2:
		return {'supportedFrameFraction':0.,'prominenceMedianDb':0.,
			'pitchMeanDb':-99.,'valid':False}
	start=float(note['start']);end=float(note['end'])
	mid_start=min(end-.035,start+.030)
	mid_end=max(mid_start+.015,min(end-.012,start+.20))
	a=max(0,int(mid_start*RATE/HOP))
	b=min(cqt.shape[1],max(a+1,int(mid_end*RATE/HOP)))
	tone=cqt[bin_no,a:b].astype('float64')+1e-8
	neighbor=np.maximum(cqt[bin_no-2,a:b],cqt[bin_no+2,a:b])+1e-8
	db=20*np.log10(tone)
	prom=20*np.log10(tone/neighbor)
	globalmax=float(np.max(cqt))+1e-8
	relative=20*np.log10(tone/globalmax)
	support=(prom>=1.3)&(relative>=-48.)
	return {
		'supportedFrameFraction':round(float(np.mean(support)),3),
		'prominenceMedianDb':round(float(np.median(prom)),2),
		'pitchMeanDb':round(float(np.mean(db)),2),
		'relativePeakDb':round(float(np.max(relative)),2),
		'valid':True}

def audit(old,strict,sensitive,cqt):
	events=old['events']
	report=[]
	kept=[]
	suppressed=[]
	notes_out=[]
	for i,note in enumerate(events):
		j=matched_index(note,strict['events'])
		k=matched_index(note,sensitive['events'])
		support=pitch_support(cqt,note)
		octave_below=[
			(index,other) for index,other in enumerate(events)
			if (int(note['midi'])-int(other['midi'])) in (12,24,36) and
				abs(float(note['start'])-float(other['start']))<.055 and
				min(note['end'],other['end'])-max(note['start'],other['start'])>.065
				and other['confidence']>=note['confidence']+.09
		]
		octave_below.sort(key=lambda x:-x[1]['confidence'])
		conf=float(note['confidence'])
		# Very narrow automatic exclusion: the note is a weak harmonic-
		# shadow candidate, not present at strict threshold, AND has weak
		# local pitch support in the original stem. This is an audition only.
		shadow_risk=bool(octave_below and j is None and conf<.45 and
			support['supportedFrameFraction']<.30 and
			support['prominenceMedianDb']<1.3)
		reasons=[]
		if octave_below:reasons.append('octave_shadow_possible')
		if j is None:reasons.append('not_recovered_by_strict_model_threshold')
		if k is None:reasons.append('not_recovered_by_sensitive_model_threshold')
		if support['supportedFrameFraction']<.25:reasons.append('weak_source_pitch_prominence')
		if conf<.36:reasons.append('low_basic_pitch_confidence')
		if shadow_risk:
			suppressed.append(i)
			action='suppress_uncertain_octave_shadow'
		else:
			kept.append(i)
			notes_out.append(json.loads(json.dumps(note)))
			action='retain'
		report.append({
			'index':i,'t':round(float(note['start']),3),
			'durationMs':round(1000*(float(note['end'])-float(note['start'])),1),
			'midi':int(note['midi']),'confidence':conf,
			'strictThresholdMatch':j is not None,
			'sensitiveThresholdMatch':k is not None,
			'lowerOctaves':[int(o['midi']) for _,o in octave_below],
			**support,'action':action,'flags':reasons
		})
	# Evidence for missing notes: the strict model calls pitches absent
	# from original. New notes must have unusually strong original-stem
	# pitch evidence AND be non-overlapping with nearby events of same
	# pitch. Threshold cross-runs aren't independent, so err conservative.
	added=[]
	for j,note in enumerate(strict['events']):
		if matched_index(note,events) is not None:
			continue
		support=pitch_support(cqt,note)
		matches=matched_index(note,sensitive['events']) is not None
		conf=float(note['confidence'])
		if not (conf>=.61 and matches and
			support['supportedFrameFraction']>=.68 and
			support['prominenceMedianDb']>=2.6):
			continue
		if any(int(e['midi'])==int(note['midi']) and
			abs(float(e['start'])-float(note['start']))<.14 for e in notes_out):
			continue
		candidate=dict(note)
		candidate['confidence']=min(1.,conf)
		candidate['expression']={
			'estimatedVelocity':82,
			'derivedFrom':'strict Basic Pitch threshold agreement plus source CQT; UNVERIFIED'}
		notes_out.append(candidate)
		added.append({'strictIndex':j,'midi':int(candidate['midi']),
			't':round(float(candidate['start']),4),'confidence':conf,
			**support})
	# Only unambiguously retriggered notes should lose an OVERLAPPING tail.
	trimmed=[]
	order=sorted(range(len(notes_out)),key=lambda i:(notes_out[i]['midi'],notes_out[i]['start']))
	for at,i in enumerate(order[:-1]):
		e=notes_out[i]
		j=order[at+1]
		f=notes_out[j]
		if e['midi']!=f['midi']:continue
		duration=float(e['end'])-float(e['start'])
		overlap=float(e['end'])-float(f['start'])
		if overlap<=.055 or duration<=.17:continue
		# Only trim when a new same-pitch note onset is in both base and
		# stricter transcription, i.e. unusually robust evidence.
		if matched_index(f,strict['events']) is None:continue
		new_end=max(float(e['start'])+.11,float(f['start'])-.015)
		if new_end>=float(e['end'])-.03:continue
		old_end=float(e['end'])
		e['end']=round(new_end,4)
		trimmed.append({'midi':int(e['midi']),'t':round(float(e['start']),3),
			'oldEnd':round(old_end,4),'newEnd':round(new_end,4)})
	notes_out.sort(key=lambda x:(x['start'],x['midi']))
	# Report ONLY: sensitive-model candidate notes absent from base, not
	# enough to automatically hallucinate more sounds into this audition.
	unreviewed=[]
	for j,note in enumerate(sensitive['events']):
		if matched_index(note,events) is not None:continue
		if matched_index(note,strict['events']) is not None:continue
		support=pitch_support(cqt,note)
		if (note['confidence']>=.43 and
			support['supportedFrameFraction']>=.55):
			unreviewed.append({'midi':int(note['midi']),
				'start':round(float(note['start']),3),
				'end':round(float(note['end']),3),
				'confidence':note['confidence'],**support})
	return notes_out,report,suppressed,added,trimmed,unreviewed

def run(args):
	assert not args.out.exists()
	assert not args.report.exists()
	old=json.loads(args.original.read_text())
	strict=json.loads(args.strict.read_text())
	sensitive=json.loads(args.sensitive.read_text())
	assert float(old['excerptStartSeconds'])==float(strict['excerptStartSeconds'])==float(sensitive['excerptStartSeconds'])
	assert int(old['excerptSeconds'])==SECONDS
	original=Path(old['sourceStem'])
	assert original.is_file()
	cqt=accompaniment_cqt(original,old['excerptStartSeconds'])
	notes,rows,suppress,add,trim,maybe=audit(old,strict,sensitive,cqt)
	report={
		'schemaVersion':1,
		'status':'UNAPPROVED source-conditioned note-event AUDIT, not truth',
		'song':args.song,
		'source':str(original),
		'originalSourceEvents':len(old['events']),
		'revisedEvents':len(notes),
		'strictThresholdNotes':len(strict['events']),
		'sensitiveThresholdNotes':len(sensitive['events']),
		'sourcePitchHopMs':round(HOP/RATE*1000,3),
		'suppressedIndices':suppress,'suppressedCount':len(suppress),
		'addedNotes':add,'addedCount':len(add),
		'trimmedNotes':trim,'trimmedCount':len(trim),
		'additionalSensitiveUnverifiedCandidates':maybe[:70],
		'additionalSensitiveUnverifiedCandidateCount':len(maybe),
		'perOriginalNote':rows,
		'limitations':[
			'Three thresholds use SAME Basic Pitch model, not three independent models',
			'Pitch evidence from a mixed polyphonic Other stem includes true harmonics',
			'A missing CQT pitch peak does not prove a note is false',
			'Do not claim this is note-perfect or artist-approved',
			'Preserve all source notes and prior audition audio; verify by ear',
		]
	}
	score={
		'schemaVersion':5,'status':'candidate audited experimental private score only',
		'sourceStem':old['sourceStem'],
		'excerptStartSeconds':old['excerptStartSeconds'],
		'excerptSeconds':SECONDS,
		'count':len(notes),'events':notes,
		'provenance':{
			'base':str(args.original),'strict':str(args.strict),
			'sensitive':str(args.sensitive),'method':'audit_featured_notes_v1'},
		'auditSummary':{'suppressed':len(suppress),'added':len(add),
			'trimmed':len(trim)}
	}
	args.out.parent.mkdir(parents=True,exist_ok=True)
	args.out.write_text(json.dumps(score,indent=2)+'\n')
	args.report.write_text(json.dumps(report,indent=2)+'\n')
	print('FEATURED_NOTE_AUDIT',args.song,'source',len(old['events']),
		'strict',len(strict['events']),'sensitive',len(sensitive['events']),
		'suppressed',len(suppress),'added',len(add),'trimmed',len(trim),
		'revised',len(notes),'unverifiedExtraCandidates',len(maybe),flush=True)

if __name__=='__main__':
	p=argparse.ArgumentParser()
	p.add_argument('--song',required=True)
	p.add_argument('--original',type=Path,required=True)
	p.add_argument('--strict',type=Path,required=True)
	p.add_argument('--sensitive',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	p.add_argument('--report',type=Path,required=True)
	run(p.parse_args())
