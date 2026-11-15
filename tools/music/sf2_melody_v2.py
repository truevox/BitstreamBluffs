#!/usr/bin/env python3
"""Offline real instrument sample attack renderer using system FluidR3 SoundFont (MIT).

Read-only voice analysis from beat grid. Writes sample-aligned mono WAV.
No MIDI file and no note-grid quantization. Trigger note-on at original phonetic
attacks; apply pitch wheel per 10ms to retain pitch slides and vibrato.
"""
import argparse
import ctypes as ct
import json
import math
import wave
from pathlib import Path

import numpy as np

SOUNDFONT=Path("/usr/share/sounds/sf2/FluidR3_GM.sf2")
RATE=48000
HOP=480

class Synth:
	def __init__(self, program):
		self.lib=ct.CDLL("libfluidsynth.so.3")
		def bind(name, args, returns=ct.c_int):
			fn=getattr(self.lib,name)
			fn.restype=returns;fn.argtypes=args
			return fn
		p=ct.c_void_p;i=ct.c_int;s=ct.c_char_p
		self.settings=bind("new_fluid_settings",[],p)()
		bind("fluid_settings_setnum",[p,s,ct.c_double])(self.settings,b"synth.sample-rate",float(RATE))
		bind("fluid_settings_setnum",[p,s,ct.c_double])(self.settings,b"synth.gain",0.35)
		bind("fluid_settings_setint",[p,s,i])(self.settings,b"synth.reverb.active",0)
		bind("fluid_settings_setint",[p,s,i])(self.settings,b"synth.chorus.active",0)
		self.ptr=bind("new_fluid_synth",[p],p)(self.settings)
		bind("fluid_synth_sfload",[p,s,i])(self.ptr,str(SOUNDFONT).encode(),1)
		bind("fluid_synth_program_change",[p,i,i])(self.ptr,0,program)
		self.note_on=bind("fluid_synth_noteon",[p,i,i,i])
		self.note_off=bind("fluid_synth_noteoff",[p,i,i])
		self.pitch_bend=bind("fluid_synth_pitch_bend",[p,i,i])
		self.write=bind("fluid_synth_write_float",[p,i,p,i,i,p,i,i])
		self.stop_all=bind("fluid_synth_all_sounds_off",[p,i])
		self.del_synth=bind("delete_fluid_synth",[p],None)
		self.del_settings=bind("delete_fluid_settings",[p],None)
	def render(self,length):
		left=np.empty(length,dtype=np.float32);right=np.empty(length,dtype=np.float32)
		self.write(self.ptr,length,ct.c_void_p(left.ctypes.data),0,1,
			ct.c_void_p(right.ctypes.data),0,1)
		return ((left+right)*.5).astype(np.float32)
	def close(self):
		self.stop_all(self.ptr,0)
		self.del_synth(self.ptr)
		self.del_settings(self.settings)

def render(analysis_path,notes_path,out,program,frame_count,start_seconds=0,seconds=None):
	with np.load(analysis_path) as x:
		f0=x["f0"].astype(np.float32)
		env=x["env"].astype(np.float32)
		active=x["active"].astype(bool)
		time=x["time"].astype(np.float32)
	notes=json.loads(notes_path.read_text())["notes"]
	begin=round(start_seconds*RATE)
	total=frame_count if seconds is None else min(frame_count,round((start_seconds+seconds)*RATE))
	count=total-begin
	assert count>0
	out.parent.mkdir(parents=True,exist_ok=True)
	synth=Synth(program)
	s=0
	current=None
	current_note=-1
	peak=0
	total_power=0.
	# Process note events in 10ms chunks with time-aligned pitch bends.
	while s<len(notes) and notes[s]["start"]<start_seconds:
		s+=1
	start_block=begin//HOP
	with wave.open(str(out),"wb") as w:
		w.setnchannels(1);w.setsampwidth(2);w.setframerate(RATE)
		for block_start in range(begin,total,HOP):
			t=block_start/RATE
			while s<len(notes) and notes[s]["start"] <= t+0.005:
				if current_note>=0:synth.note_off(synth.ptr,0,current_note)
				n=notes[s]
				current_note=int(np.clip(n["midi"],40,96))
				current=n
				synth.pitch_bend(synth.ptr,0,8192)
				synth.note_on(synth.ptr,0,current_note,int(np.clip(n["velocity"],55,115)))
				s+=1
			if current_note>=0 and current is not None:
				index=min(len(f0)-1,int(round(t*100)))
				pitch=float(f0[index])
				if active[index] and pitch>70:
					# Fluid default +-2 semitones pitch wheel; exact unquantized f0.
					cents=12*math.log2(max(1,pitch)/(440*2**((current_note-69)/12)))
					wheel=int(np.clip(8192+4096*cents,0,16383))
					synth.pitch_bend(synth.ptr,0,wheel)
				if current["end"] <= t:
					synth.note_off(synth.ptr,0,current_note)
					current_note=-1
			n=min(HOP,total-block_start)
			pcm=synth.render(n)
			power=float(np.mean(pcm*pcm))
			total_power+=power*n
			peak=max(peak,float(np.max(np.abs(pcm))))
			w.writeframes((np.clip(pcm*.7,-.98,.98)*32767).astype("<i2").tobytes())
	synth.close()
	rms=10*math.log10(max(1e-12,total_power/count))
	return {"program":program,"output":str(out),"frames":count,"rmsDb":round(rms,2),
		"peakDb":round(20*math.log10(max(1e-9,peak)),2),
		"noteEvents":len(notes)}

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument("--analysis",type=Path,required=True)
	p.add_argument("--notes",type=Path,required=True)
	p.add_argument("--out",type=Path,required=True)
	p.add_argument("--program",type=int,required=True)
	p.add_argument("--frame-count",type=int,required=True)
	p.add_argument("--start",type=float,default=0)
	p.add_argument("--seconds",type=float,default=None)
	a=p.parse_args()
	print(json.dumps(render(a.analysis,a.notes,a.out,a.program,a.frame_count,a.start,a.seconds),indent=2))

if __name__=="__main__":
	main()
