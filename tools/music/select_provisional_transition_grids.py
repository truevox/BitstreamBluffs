#!/usr/bin/env python3
"""Select source-backed provisional 4/4 bar grids; private output, no media mutation."""
import argparse,hashlib,json,math
from pathlib import Path

def sha(p):
	return hashlib.sha256(p.read_bytes()).hexdigest()

def build(candidates,catalog,tail_report):
	summary=json.loads((candidates/'source-verified-summary.json').read_text())
	assert summary['status']=='ALL_33_SOURCE_BOUND_BUT_UNVERIFIED'
	verified={s['id']:s for s in summary['songs']}
	tracks=json.loads(catalog.read_text())['tracks']
	tail_data=json.loads(tail_report.read_text())
	assert tail_data['status']=='PASS_33_REAL_SONG_BOUNDARY_SOURCE_AND_SCHEDULER_AUDIT_NOT_MASTERED'
	tails={c['endingTrackId']:c for c in tail_data['cases']}
	assert len(tracks)==len(verified)==len(tails)==33
	result=[]
	for track in tracks:
		id=track['id'];s=verified[id]
		p=candidates/f"{s['slot']:02d}_{id}.json"
		assert sha(p)==s['sha256'],f'Candidate report changed: {id}'
		report=json.loads(p.read_text())
		assert report['trackId']==id and report['status']=='UNVERIFIED_SOURCE_BEAT_CANDIDATES'
		pack=json.loads((catalog.parent/track['manifest']).read_text())
		duration=pack['frameCount']/pack['sampleRate']
		assert abs(duration-report['sourceSeconds'])<.25,(id,duration,report['sourceSeconds'])
		paths=report['candidateBeatPaths']
		def score(q):
			return q['jointDrumBassSupportNotConfidence']+.2*max(x['combinedAccentDifferenceNotConfidence'] for x in q['hypothetical4BeatMeterOffsets'])-.25*q['irregularIntervalFraction']
		best=max(paths,key=score)
		offset=max(best['hypothetical4BeatMeterOffsets'],key=lambda x:x['combinedAccentDifferenceNotConfidence'])['hypotheticalFirstBeatIndexMod4']
		beats=[f/48000 for f in best['beatsSourceFrames48k'] if f/48000<duration]
		assert len(beats)>12 and all(math.isfinite(x) for x in beats) and all(b>a for a,b in zip(beats,beats[1:]))
		ratio=tails[id]['endingHalfSecondEnergyRatio']
		result.append({'id':id,'status':'estimated-4/4','duration':duration,'bpm':best['algorithmEstimatedBpm'],
			'selectedPrior':best['priorBpm'],'downbeatOffset':offset,'beats':beats,'downbeats':beats[offset::4],
			'quietTail':ratio is not None and ratio<.2,'tailEnergyRatio':ratio,
			'alternativeBpms':[q['algorithmEstimatedBpm'] for q in paths],
			'sourceCandidateSha256':sha(p),'sourceStemSha256':report['sourceStemSha256']})
	return {'format':'bsb-provisional-transition-grids-v1','status':'estimated-not-musician-verified','tracks':result}

if __name__=='__main__':
	p=argparse.ArgumentParser(description=__doc__)
	for arg in ('candidates','catalog','tail-report','out'):p.add_argument('--'+arg,type=Path,required=True)
	a=p.parse_args();data=build(a.candidates,a.catalog,a.tail_report)
	with a.out.open('x') as f:json.dump(data,f,separators=(',',':'));f.write('\n')
	print('PROVISIONAL_4_4_GRIDS',len(data['tracks']),'quiet tails',sum(t['quietTail'] for t in data['tracks']))
