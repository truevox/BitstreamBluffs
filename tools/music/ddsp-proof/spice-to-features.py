#!/usr/bin/env python3
"""Convert 32ms Magenta SPICE neural F0 + confidence to 250Hz DDSP controls.

Uses vocal waveform as input to SPICE upstream. Does not use V3 F0 at any stage.
No MIDI note events. Confidence gaps >=128ms are unvoiced; shorter losses held.
Retains a separate unmodified source loudness array.
"""
import bisect
import json
import math
import statistics
from pathlib import Path

ROOT=Path("/home/hermes/experiments/bitstream-ddsp-20261115/audio")
old=json.loads((ROOT/"ddsp-25s-v3.json").read_text())
source=json.loads((ROOT/"spice-raw-pitches.json").read_text())
input_=source["pitches"]
assert len(input_)>=780
time=[v["time"] for v in input_]
pitch=[v["frequency"] for v in input_]
confidence=[v["confidence"] for v in input_]
def loginterp(t,values):
	i=bisect.bisect_right(time,t)-1
	i=max(0,min(len(time)-2,i))
	mix=min(1,max(0,(t-time[i])/(time[i+1]-time[i])))
	a=max(20.,values[i])
	b=max(20.,values[i+1])
	return math.exp(math.log(a)+(math.log(b)-math.log(a))*mix)
def lininterp(t,values):
	i=bisect.bisect_right(time,t)-1
	i=max(0,min(len(time)-2,i))
	mix=min(1,max(0,(t-time[i])/(time[i+1]-time[i])))
	return values[i]*(1-mix)+values[i+1]*mix
# Median filter over 3 SPICE 32ms frames to remove brief octave tracking slips;
# only adjust a suspicious point when BOTH its confident neighbors agree.
clean=pitch.copy()
corrected=0
for i in range(1,len(pitch)-1):
	a,b,c=pitch[i-1],pitch[i],pitch[i+1]
	if min(confidence[i-1],confidence[i+1])<.65:
		continue
	neighbor_cents=1200*math.log2(a/c)
	deviation=abs(1200*math.log2(max(1,b)/math.sqrt(a*c)))
	if abs(neighbor_cents)<80 and deviation>500 and confidence[i]<.85:
		clean[i]=math.sqrt(a*c)
		corrected+=1
# Low-confidence hold (not random pitch jitter), then mute uncertain >= 128ms regions.
gaps=[]
idx=0
while idx<len(input_):
	if confidence[idx]>=.56:
		idx+=1
		continue
	j=idx
	while j<len(input_) and confidence[j]<.56:
		j+=1
	gaps.append((idx,j))
	idx=j
neutral=clean.copy()
gates=[1.]*len(neutral)
for i,j in gaps:
	if j-i<=3 and i>0 and j<len(neutral) and confidence[i-1]>=.65 and confidence[j]>=.65:
		start=math.log(max(20.,neutral[i-1]))
		end=math.log(max(20.,neutral[j]))
		for k in range(i,j):
			a=(k-i+1)/(j-i+1)
			neutral[k]=math.exp(start*(1-a)+end*a)
	else:
		for k in range(i,j):
			gates[k]=0.
# Build the full 4ms condition arrays; suppress weakly detected pitched tone
# through uncertain consonant/silent sections. DO NOT add SPICE's random jitter.
f0=[]
power=[]
conf=[]
for frame in range(6250):
	t=frame/250.
	freq=loginterp(t,neutral)
	reliability=max(0,min(1,lininterp(t,confidence)))
	i=min(len(gates)-1,int(t/.032))
	envelope=old["loudness_db"][frame]
	if gates[i]==0.:
		f0.append(0.)
		power.append(max(-120.,envelope-25.))
	else:
		f0.append(round(freq,4))
		power.append(envelope)
	conf.append(round(reliability,4))
out={**old,
	"schema":"bitstream-ddsp-offline-conditions-v1",
	"pitchSource":"Official Magenta SPICE neural model F0 extracted directly from Maxi's 16k vocal waveform; 32ms raw hop, 4ms interpolation; confidence gate, no random pitch jitter",
	"loudnessSource":"Original Maxi isolated vocal waveform, same 4ms loudness as original DDSP trial",
	"f0_hz":f0,
	"loudness_db":power,
	"confidence_spice":conf,
	"stability":"3-frame isolated-octave correction with high-confidence neighboring frames; weak-frame hold <=96ms, otherwise mute",
}
path=ROOT/"ddsp-25s-spice.json"
path.write_text(json.dumps(out,separators=(",",":"))+"\n")
print(json.dumps(dict(
	sourceFrames=len(input_),targetFrames=len(f0),
	confidentRaw=sum(v>=.7 for v in confidence),
	conservativeCorrections=corrected,
	unvoicedFrames=sum(v==0 for v in f0),
	gaps=len(gaps),
	shortGaps=sum(j-i<=3 for i,j in gaps),
	mediumAndLongGaps=sum(j-i>3 for i,j in gaps),
	medianVoicedPitchHz=statistics.median(x for x in f0 if x>0),
	output=str(path)
),indent=2))
