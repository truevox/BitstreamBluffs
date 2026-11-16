#!/usr/bin/env python3
"""Benchmark/training for isolated SoundFont percussion classification.
Kits held out by bank patch; synthetic known hits ONLY, not separated songs.
Keep model weights outside public repository and prior audition assets intact.
"""
import argparse
import ctypes as ct
import json
from pathlib import Path
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import GroupKFold
from sklearn.metrics import confusion_matrix, accuracy_score, f1_score, classification_report
from sf2_melody_v2 import Synth,RATE

PATCHES=(0,8,16,25,32,48)
ROLE_NOTES={'kick':(35,36),'snare':(37,38,40),
	'hat':(42,44,46),'tom':(41,45,47,50),'cymbal':(49,51,55,57)}
VELOCITIES=(60,84,107)
BANDS=((40,150),(150,400),(400,1200),(1200,3500),(3500,8500),(8500,16000))

def features(y):
	# All features are isolated-attack diagnostics, not multi-hit separation.
	sr=RATE
	x=y.astype('float64')
	output=[]
	for seconds in (.045,.12,.28):
		part=x[:round(seconds*sr)]
		nfft=2**int(np.ceil(np.log2(max(len(part),1))))
		power=np.abs(np.fft.rfft(part*np.hanning(len(part)),nfft))**2
		freq=np.fft.rfftfreq(nfft,1/sr)
		energy=float(np.sum(power)+1e-12)
		for low,high in BANDS:
			output.append(float(np.sum(power[(freq>=low)&(freq<high)])/energy))
		output.append(float(np.sum(power*freq)/energy)/10000)
		output.append(float(np.exp(np.mean(np.log(np.maximum(power,1e-12))))/
			max(np.mean(power),1e-12)))
		output.append(float(np.sqrt(np.mean(part**2))))
	output.append(float(np.sqrt(np.mean(x[:round(.045*sr)]**2))/
		max(np.sqrt(np.mean(x[round(.12*sr):]**2)),1e-7)))
	return np.nan_to_num(output,nan=0,posinf=0,neginf=0).tolist()

def make_samples():
	X=[];labels=[];groups=[];meta=[]
	for patch in PATCHES:
		synth=Synth(0)
		try:
			p=ct.c_void_p;i=ct.c_int
			select=synth.lib.fluid_synth_program_select
			select.restype=i;select.argtypes=[p,i,i,i,i]
			res=select(synth.ptr,9,1,128,patch)
			if res!=0:
				raise RuntimeError(f'FluidR3 percussion patch {patch} unavailable')
			for label,notes in ROLE_NOTES.items():
				for note in notes:
					for velocity in VELOCITIES:
						synth.stop_all(synth.ptr,9)
						synth.note_on(synth.ptr,9,note,velocity)
						signal=synth.render(round(.35*RATE))
						if not np.any(np.abs(signal)>.00001):
							raise ValueError(f'silent patch {patch} note {note}')
						X.append(features(signal));labels.append(label)
						groups.append(patch)
						meta.append({'patch':patch,'note':note,
							'velocity':velocity,'label':label})
		finally:
			synth.close()
	return np.array(X,dtype=np.float32),np.array(labels),np.array(groups),meta

def model():
	return RandomForestClassifier(n_estimators=170,max_depth=12,
		min_samples_leaf=2,class_weight='balanced',n_jobs=2,random_state=17)

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--out',type=Path,required=True,help='New private dir for reports and model')
	a=p.parse_args()
	if a.out.exists():
		raise SystemExit('Refusing overwrite: '+str(a.out))
	a.out.mkdir(parents=True,exist_ok=False)
	X,y,groups,meta=make_samples()
	y_pred=np.empty_like(y)
	folds=[]
	for train,test in GroupKFold(n_splits=len(PATCHES)).split(X,y,groups):
		m=model();m.fit(X[train],y[train])
		pred=m.predict(X[test])
		y_pred[test]=pred
		folds.append({'holdoutPatch':int(groups[test][0]),'samples':len(test),
			'accuracy':round(float(accuracy_score(y[test],pred)),4),
			'macroF1':round(float(f1_score(y[test],pred,average='macro')),4)})
	labels=sorted(ROLE_NOTES)
	confusion=confusion_matrix(y,y_pred,labels=labels).tolist()
	final=model()
	final.fit(X,y)
	import joblib
	model_file=a.out/'isolated-drum-rf.joblib'
	joblib.dump(final,model_file,compress=3)
	report={'schemaVersion':1,'training':'six GM SoundFont percussion kit banks',
		'samples':len(X),'trainingPatchIds':PATCHES,'roles':labels,
		'validation':'leave-one-kit-patch-out GROUP cross validation',
		'patchFolds':folds,'overallAccuracy':round(float(accuracy_score(y,y_pred)),4),
		'macroF1':round(float(f1_score(y,y_pred,average='macro')),4),
		'confusionMatrixRowsTrueColsPredicted':confusion,
		'modelPrivatePath':str(model_file),
		'notes':['Independent instrument sample classifier, not an onset detector.',
			'No performance guarantee on noisy, overlapping or separated drums.',
			'Model trained on synthetic kit samples; human ears still needed.',
			'Check for cross-family confusions and kit shift before integration.']}
	(a.out/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
	print('CLASSIFIER_COMPLETE','samples',len(X),'macroF1',report['macroF1'],
		'accuracy',report['overallAccuracy'],'perPatch',folds,
		'confusion',confusion,flush=True)

if __name__=='__main__':
	main()
