#!/usr/bin/env python3
"""Reversible SOURCE-EVIDENCE retrigger audit for a polyphonic stem.

Existing source notes are preserved as pitch-class hypotheses. Only a
candidate onset inside an existing same-MIDI sustained note may split it.
No octave guesses removed, no pitches inserted, and no global quantization.
This is an UNAPPROVED audition candidate, NOT a musically verified score.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import audit_featured_notes_v1 as evid
import align_featured_source_onsets_v1 as attacks

SECONDS=32.

def retriggers(original,sensitive,cqt,source_times,source_strength,source_peak_indices):
	events=original['events']
	detected_ranks=np.array(source_strength)[source_peak_indices]
	attack_floor=float(np.percentile(detected_ranks,35)) if len(detected_ranks) else float('inf')
	if len(source_times)!=len(source_peak_indices):
		raise ValueError('STFT source peak/timestamp shape mismatch')
	# Once a detected same-pitch candidate is assigned to one original note,
	# it cannot be inserted again by a different overlapping source parent.
	claimed_candidates=set()
	claimed_onsets_by_midi={}
	revised=[]
	per_note=[]
	splits=[]
	rejected=[]
	for index,base in enumerate(events):
		start=float(base['start']);end=float(base['end'])
		midi=int(base['midi'])
		proposed=[]
		needs_review=False
		for j,alt in enumerate(sensitive['events']):
			t=float(alt['start']);conf=float(alt['confidence'])
			if int(alt['midi'])!=midi or not start+.09<t<end-.095:
				continue
			needs_review=True
			if j in claimed_candidates:
				rejected.append({'baseIndex':index,'sensitiveIndex':j,
					't':round(t,3),'reason':'already_assigned_to_overlapping_original'})
				continue
			if conf<.53:
				rejected.append({'baseIndex':index,'sensitiveIndex':j,
					't':round(t,3),'reason':'weak_sensitive_confidence'})
				continue
			# An original onset for this same pitch already represents a
			# separate audible note; do not add a duplicate close to it.
			if any(int(n['midi'])==midi and
				abs(float(n['start'])-t)<.075 for n in events):
				continue
			if not len(source_times):
				rejected.append({'baseIndex':index,'sensitiveIndex':j,
					't':round(t,3),'reason':'no_detected_source_transients'})
				continue
			nearest=int(np.argmin(np.abs(source_times-t)))
			dist=abs(float(source_times[nearest])-t)
			peak_strength=float(source_strength[source_peak_indices[nearest]])
			if dist>.025 or peak_strength<attack_floor:
				rejected.append({'baseIndex':index,'sensitiveIndex':j,'t':round(t,3),
					'reason':'no_strong_separate_source_attack','distanceMs':round(dist*1000,1)})
				continue
			pitch=evid.pitch_support(cqt,alt)
			if pitch['supportedFrameFraction']<.65 or pitch['prominenceMedianDb']<2.5:
				rejected.append({'baseIndex':index,'sensitiveIndex':j,'t':round(t,3),
					'reason':'insufficient_source_pitch_support'})
				continue
			proposed.append({'start':t,'sensitiveIndex':j,'confidence':conf,
				'sourceAttack':float(source_times[nearest]),'sourceAttackDistanceMs':round(dist*1000,1),
				'pitchEvidence':pitch})
		proposed.sort(key=lambda x:(x['start'],-x['confidence']))
		selected=[]
		for candidate in proposed:
			t=candidate['start']
			if selected and t-selected[-1]['start']<.11:
				if candidate['confidence']>selected[-1]['confidence']:
					selected[-1]=candidate
				continue
			selected.append(candidate)
		# Split the original note (same MIDI, same velocity expression),
		# retaining each successive tail's time but introducing a new
		# attack at the source-supported timestamp.
		points=[start]
		for candidate in selected:
			if any(abs(candidate['start']-v)<.025 for v in claimed_onsets_by_midi.get(midi,())):
				rejected.append({'baseIndex':index,'sensitiveIndex':candidate['sensitiveIndex'],
					't':round(candidate['start'],3),'reason':'duplicate_in_overlapping_source_parent'})
				continue
			if candidate['start']-points[-1]<.115 or end-candidate['start']<.115:
				rejected.append({'baseIndex':index,'sensitiveIndex':candidate['sensitiveIndex'],
					't':round(candidate['start'],3),'reason':'segment_too_short'})
				continue
			points.append(candidate['start'])
			claimed_candidates.add(candidate['sensitiveIndex'])
			claimed_onsets_by_midi.setdefault(midi,[]).append(candidate['start'])
		points.append(end)
		contributed=[]
		for sub in range(len(points)-1):
			segment=json.loads(json.dumps(base))
			segment['sourceIndex']=index
			segment['start']=round(points[sub],4)
			# Small explicit separation for note-off/re-attack, but the
			# original envelope duration is otherwise conserved.
			segment['end']=round(points[sub+1]-(.012 if sub<len(points)-2 else 0),4)
			if sub>0:
				split=next(x for x in selected if abs(x['start']-points[sub])<.0002)
				segment['confidence']=round(max(float(segment['confidence']),split['confidence']),3)
				segment['expression']=dict(segment.get('expression',{}))
				segment['expression']['recoveredAttackSource']='source_transient+BasicPitch_sensitive_trial'
				splits.append({'originalIndex':index,'sourceMidi':midi,
					'originalStart':round(start,4),'originalEnd':round(end,4),
					'recoveredStart':round(points[sub],4),
					'lastOriginalNoteGapMs':12.,
					'sensitiveConfidence':round(split['confidence'],3),
					'sourceAttackMs':round(split['sourceAttackDistanceMs'],2)})
			assert segment['end']-segment['start']>=.09
			revised.append(segment)
			contributed.append({'start':segment['start'],'end':segment['end']})
		per_note.append({
			'index':index,'midi':midi,'sourceStart':start,'sourceEnd':end,
			'originalConfidence':base['confidence'],
			'segments':contributed,'splitCount':len(contributed)-1,
			'flag':'source_supported_reattacks' if len(contributed)>1 else
				('needs_human_check' if needs_review else 'unchanged'),
		})
	revised.sort(key=lambda e:(e['start'],e['midi']))
	return revised,per_note,splits,rejected

def run(a):
	if a.out.exists() or a.report.exists():
		raise FileExistsError('Cannot overwrite rearticulation scores or QA')
	original=json.loads(a.original.read_text())
	sensitive=json.loads(a.sensitive.read_text())
	assert original['sourceStem']==sensitive['sourceStem']
	assert original['excerptStartSeconds']==sensitive['excerptStartSeconds']
	y=attacks.read_stem(original['sourceStem'],original['excerptStartSeconds'])
	times,strength,peaks,_=attacks.source_transients(y)
	cqt=evid.accompaniment_cqt(original['sourceStem'],original['excerptStartSeconds'])
	notes,per_note,splits,rejected=retriggers(
		original,sensitive,cqt,times,strength,peaks)
	source=original['events']
	assert len(notes)>=len(source)
	assert len(notes)==len(source)+len(splits)
	assert {int(n['midi']) for n in notes}.issubset({int(n['midi']) for n in source})
	for e in notes:
		assert e['end']>e['start']+.088 and 0<=e['start']<SECONDS
		assert e['end']<=SECONDS
	score={
		'schemaVersion':8,'status':'experimental source-attack retrigger candidate; not music approved',
		'sourceStem':original['sourceStem'],
		'excerptStartSeconds':original['excerptStartSeconds'],
		'excerptSeconds':int(SECONDS),
		'count':len(notes),'events':notes,
		'provenance':{'original':str(a.original),'sensitive':str(a.sensitive),
			'sourceAttackMethod':'positive source-stem STFT spectral novelty',
			'pitchSupportMethod':'source stem CQT local pitch prominence'},
	}
	report={
		'schemaVersion':1,'status':'UNAPPROVED diagnostic audition',
		'song':a.song,'sourceNotes':len(source),
		'revisedNotes':len(notes),'sourcePeakCount':len(peaks),
		'recoveredAttacks':len(splits),'splits':splits,
		'globalDuplicateSuppression':True,'emptySourcePeakPolicy':'retain base notes and flag review',
		'perOriginalNote':per_note,'rejectedCandidates':rejected,
		'limitations':[
			'Does NOT verify whether octave notes are legitimate doubling or harmonics',
			'Multiple transcriptions are the same Basic Pitch model with different thresholds',
			'Does NOT correct false/missing pitches or instrument classification',
			'Source-stem attack may be another overlapping instrument or percussion bleed',
			'All inserted reattacks are source-note pitch repeats, not new pitches',
			'Original note durations are partitioned, with 12ms nominal note-off metadata; audible release may overlap',
			'Requires owner listening and source comparison before musical approval',
		]}
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(score,indent=2)+'\n')
	a.report.write_text(json.dumps(report,indent=2)+'\n')
	print('RETRIGGER_AUDIT',a.song,'sourceNotes',len(source),
		'correctedNotes',len(notes),'recoveredAttacks',len(splits),
		'rejectedCandidates',len(rejected),flush=True)
	for s in splits[:20]:
		print('RETRIGGER_EXAMPLE',s,flush=True)

if __name__=='__main__':
	p=argparse.ArgumentParser()
	p.add_argument('--song',required=True)
	p.add_argument('--original',type=Path,required=True)
	p.add_argument('--sensitive',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	p.add_argument('--report',type=Path,required=True)
	run(p.parse_args())
