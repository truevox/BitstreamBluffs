#!/usr/bin/env python3
"""Quantify SheetSage2/Basic Pitch agreement for Maxi's 25s vocal.
No note edits; report candidate corroboration, harmonics, and untrusted discrepancies.
"""
import json
from pathlib import Path
import numpy as np
import pretty_midi
from scipy.optimize import linear_sum_assignment

root=Path('/root/bitstream-maxi/transcription-lab-20261115')
sheet=pretty_midi.PrettyMIDI(str(root/'sheetsage2/maxi-vocal-25-cpufft/melody_vocal.mid'))
basic=pretty_midi.PrettyMIDI(str(next((root/'basic-pitch').glob('*.mid'))))
s=sorted([n for ins in sheet.instruments for n in ins.notes],key=lambda x:x.start)
b=sorted([n for ins in basic.instruments for n in ins.notes],key=lambda x:x.start)
spice=json.loads(Path('/root/bitstream-maxi/mountain-ddsp-probe/ddsp-25s-spice.json').read_text())
hz=np.asarray(spice['f0_hz'],dtype=np.float64)
confidence=np.asarray(spice['confidence_spice'],dtype=np.float64)
assert len(hz)==6250

def window_spice(n):
	t0=max(0,int((n.start+.04)*250))
	t1=min(len(hz),int(min(n.end,n.start+.20)*250))
	if t1<=t0:return None
	valid=hz[t0:t1][(hz[t0:t1]>70)&(confidence[t0:t1]>=.65)]
	if len(valid)<5:return None
	return float(69+12*np.log2(np.median(valid)/440))

def overlap(a,c):
	return max(0.,min(a.end,c.end)-max(a.start,c.start))

def pc_distance(a,b):
	return abs(((a-b+6)%12)-6)

def match_score(a,c):
	ov=overlap(a,c)
	onset=abs(a.start-c.start)
	if ov<.04 or onset>.18:return -100
	# source octave offset correction; Sheet nominally +12 relative to SPICE/Basic.
	diff=pc_distance(a.pitch,c.pitch)
	if diff>1:return -100
	norm=ov/min(max(.001,a.end-a.start),max(.001,c.end-c.start))
	return 3*norm-3*onset+(.75 if diff==0 else -.9)

cost=np.array([[-match_score(x,y) for y in b] for x in s])
rows,cols=linear_sum_assignment(cost)
match=[(i,j,match_score(s[i],b[j])) for i,j in zip(rows,cols) if cost[i,j]<100]
match.sort()
basic_used={j for _,j,_ in match}
sheet_used={i for i,_,_ in match}
spice_valid=[window_spice(x) for x in s]
spice_confirmed=[i for i,x in enumerate(s) if spice_valid[i] is not None and pc_distance(x.pitch,spice_valid[i])<.5]
both_all=[i for i in sheet_used if i in spice_confirmed]
unmatched=[(j,n) for j,n in enumerate(b) if j not in basic_used]
harmonic_like=[(j,n) for j,n in unmatched
	if any(overlap(n,ss)>.03 and pc_distance(n.pitch,ss.pitch)<.5 for ss in s)]
unmatched_spice=[(j,n) for j,n in unmatched if (v:=window_spice(n)) is not None and pc_distance(n.pitch,v)<.5]
sheet_nobasic=[s[i] for i in range(len(s)) if i not in sheet_used]
report={
	'rawSheetNotes':len(s),
	'rawBasicNotes':len(b),
	'matchedPairsOneToOne':len(match),
	'exactPitchClassMatches':sum(pc_distance(s[i].pitch,b[j].pitch)<.01 for i,j,_ in match),
	'sheetWithIndependentBasicSupport':len(sheet_used),
	'sheetWithoutBasicSupport':len(sheet_nobasic),
	'basicWithoutSheetPair':len(unmatched),
	'rawBasicOverlapsSamePitchClassSheet':len(harmonic_like),
	'basicWithoutSheetPairYetSpiceSupports':len(unmatched_spice),
	'sheetNotesSpiceSupported':len(spice_confirmed),
	'sheetNotesBothBasicAndSpiceSupported':len(both_all),
	'sheetNotesSpiceNoSupport':len(s)-len(spice_confirmed),
	'sheetSuggestedOctaveShift':-12,
	'matchExamples':[
		{'start':round(s[i].start,2),'sheet':pretty_midi.note_number_to_name(s[i].pitch),
		 'basic':pretty_midi.note_number_to_name(b[j].pitch),
		 'onsetDeltaMs':round((b[j].start-s[i].start)*1000),
		 'durationS':round(s[i].end-s[i].start,2),
		 'score':round(sc,2)}
		for i,j,sc in match[:22]
	],
	'sheetWithoutBasicStartExamples':[
		{'start':round(n.start,2),'note':pretty_midi.note_number_to_name(n.pitch)}
		for n in sheet_nobasic[:25]
	],
	'basicsWithoutSheetSpiceSupportedExamples':[
		{'start':round(n.start,2),'note':pretty_midi.note_number_to_name(n.pitch),
		 'duration':round(n.end-n.start,2)}
		for j,n in unmatched_spice[:15]
	],
	'method':'One-to-one Hungarian optimal matching with overlap >= 40ms, onset difference <=180ms, same pitch class up to 1 semitone. No claims of ground truth. SPICE F0 independently measures pitch. SheetSage2 pitch class down octave.',
}
(root/'corroboration.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
