"""Synthetic source-manifest controls; never reads or rewrites real private music."""
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
def load_script(module_name,file):
	spec=importlib.util.spec_from_file_location(module_name,ROOT/'tools'/'music'/file)
	module=importlib.util.module_from_spec(spec)
	spec.loader.exec_module(module)
	return module
verify_module=load_script('verify_33_original_beats','verify_33_original_beats.py')
assemble_module=load_script('assemble_private_33_song_game_catalog','assemble_private_33_song_game_catalog.py')
def sha(data):
	return hashlib.sha256(data).hexdigest()

def mock_flac_streaminfo(seconds=120,rate=48000,unique=b''):
	'''Synthetic metadata-only FLAC header for unit tests (not audio output).'''
	samples=int(seconds*rate)
	packed=(rate<<44)|(1<<41)|(15<<36)|samples
	streaminfo=bytes([16,0,16,0])+bytes(6)+packed.to_bytes(8,'big')+bytes(16)
	assert len(streaminfo)==34
	return b'fLaC'+bytes([0x80,0,0,34])+streaminfo+unique

class SourceBindingTests(unittest.TestCase):
	def create_fixture(self,root):
		master=root/'master';results=root/'results'
		master.mkdir();results.mkdir()
		tracks=[]
		for slot in range(1,34):
			id=f'song{slot:02d}'
			files={}
			hashes={}
			for role in ('drums','bass'):
				name=f'sources/{slot:02d}/{role}.flac'
				target=master/name
				target.parent.mkdir(parents=True,exist_ok=True)
				data=mock_flac_streaminfo(unique=f'unique private mock {id} {role}'.encode())
				target.write_bytes(data)
				files[role]=name
				hashes[role]=sha(data)
			track={'slot':slot,'id':id,'title':f'Mock {slot}','stem_files':files}
			if slot==33:
				track.pop('stem_files')
				track['grouped_6s']={'stemFiles':files}
			tracks.append(track)
			candidate=lambda prior: {
				'priorBpm':prior,'algorithmEstimatedBpm':118.,
				'hypothetical4BeatMeterOffsets':[
					{'hypotheticalFirstBeatIndexMod4':i} for i in range(4)
				],
				'beatsSourceFrames48k':[i*48000 for i in range(13)],
				'drumOnsetSupportNotConfidence':.5,
				'bassOnsetSupportNotConfidence':.5,
				'jointDrumBassSupportNotConfidence':.5,
			}
			report={
				'trackId':id,'slot':slot,'status':'UNVERIFIED_SOURCE_BEAT_CANDIDATES',
				'beatOne':'UNVERIFIED','meter':'UNVERIFIED','tempoDrift':'UNVERIFIED',
				'sourceSampleRate':11025,'outputFrameRate':48000,
				'sourceSeconds':120,'sourceStemPaths':files,
				'sourceStemSha256':hashes,
				'candidateBeatPaths':[candidate(105.),candidate(165.)],
				'localDrumPeriodicityWindows':[{'bpmPeriodicityHypothesis':120.}],
				'localBassPeriodicityWindows':[{'bpmPeriodicityHypothesis':120.}],
			}
			(results/f'{slot:02d}_{id}.json').write_text(json.dumps(report))
		(master/'game-stems-manifest.json').write_text(json.dumps({'tracks':tracks}))
		return master,results

	def test_all_33_expected_stems_and_grouped_slot_33_pass(self):
		with tempfile.TemporaryDirectory() as tmp:
			master,results=self.create_fixture(Path(tmp))
			self.assertEqual(len(verify_module.verify(master,results)),33)

	def test_self_consistent_other_song_hashes_are_rejected(self):
		with tempfile.TemporaryDirectory() as tmp:
			master,results=self.create_fixture(Path(tmp))
			target=results/'01_song01.json'
			report=json.loads(target.read_text())
			report['sourceStemPaths']={
				role:f'sources/02/{role}.flac' for role in ('drums','bass')
			}
			report['sourceStemSha256']={
				role:sha((master/path).read_bytes()) for role,path
				in report['sourceStemPaths'].items()
			}
			target.write_text(json.dumps(report))
			with self.assertRaisesRegex(AssertionError,'Incorrect master source-path binding'):
				verify_module.verify(master,results)

	def test_beat_beyond_verified_duration_is_rejected_even_with_inflated_report_duration(self):
		with tempfile.TemporaryDirectory() as tmp:
			master,results=self.create_fixture(Path(tmp))
			target=results/'01_song01.json'
			report=json.loads(target.read_text())
			report['sourceSeconds']=121
			for q in report['candidateBeatPaths']:
				q['beatsSourceFrames48k'][-1]=120*48000+1
			target.write_text(json.dumps(report))
			with self.assertRaisesRegex(AssertionError,'(Claimed source duration|Beat frame)'):
				verify_module.verify(master,results)
			# Even a truthful reportSeconds cannot permit a beat beyond the
			# independently verified shortest original recording.
			report['sourceSeconds']=120
			target.write_text(json.dumps(report))
			with self.assertRaisesRegex(AssertionError,'Beat frame outside verified'):
				verify_module.verify(master,results)

	def test_shorter_bass_recording_caps_the_common_beat_grid(self):
		with tempfile.TemporaryDirectory() as tmp:
			master,results=self.create_fixture(Path(tmp))
			bass=master/'sources/01/bass.flac'
			data=mock_flac_streaminfo(110,unique=b'shorter bass')
			bass.write_bytes(data)
			target=results/'01_song01.json'
			report=json.loads(target.read_text())
			report['sourceStemSha256']['bass']=sha(data)
			report['sourceSeconds']=110
			for q in report['candidateBeatPaths']:
				q['beatsSourceFrames48k'][-1]=111*48000
			target.write_text(json.dumps(report))
			with self.assertRaisesRegex(AssertionError,'Beat frame outside verified'):
				verify_module.verify(master,results)

	def test_private_partial_preview_requires_four_old_and_one_new(self):
		old=assemble_module.OLD_IDS
		self.assertTrue(assemble_module.validate_partial_track_ids(old|{'new01'}))
		for ids in [
			{'new01','new02','new03','new04','new05'},
			old,
			(set(old)-{next(iter(old))})|{'new01','new02'},
		]:
			with self.subTest(ids=ids):
				with self.assertRaisesRegex(ValueError,'requires all four original packs'):
					assemble_module.validate_partial_track_ids(ids)

if __name__=='__main__':
	unittest.main()
