#!/usr/bin/env python3
"""Catalog-only release gate cases, independent of the 4745-audio-file QA."""
import copy
import unittest
from validate_performance_release import assert_catalog_compatible


def baseline():
	return {'format':'bitstream-music-catalog-v1','tracks':[
		{'id':id,'title':id,'manifest':f'packs/{i:02d}_{id}/pack.json'}
		for i,id in enumerate(('FEsxYVStla4','local-one-more-run-bitstream-bluffs',
			'WRBGQUqD54U','FYImnz5-hXs'),1)]}


class TestReleaseCatalogMetadata(unittest.TestCase):
	def test_exact_prior_catalog_passes(self):
		cat=baseline()
		assert_catalog_compatible(cat,copy.deepcopy(cat))

	def test_three_new_billboard_ids_do_not_invalidate_source_release(self):
		old=baseline();new=copy.deepcopy(old)
		for row in new['tracks']:
			if len(row['id'])==11:row['youtubeId']=row['id']
		assert_catalog_compatible(new,old)

	def test_future_local_track_can_gain_confirmed_video(self):
		old=baseline();new=copy.deepcopy(old)
		new['tracks'][1]['youtubeId']='ABCDE12345_'
		assert_catalog_compatible(new,old)

	def test_published_video_reference_must_not_change_or_disappear(self):
		old=baseline();old['tracks'][0]['youtubeId']='FEsxYVStla4'
		for variant in ('WRBGQUqD54U',None):
			with self.subTest(variant=variant):
				new=copy.deepcopy(old)
				if variant is None: del new['tracks'][0]['youtubeId']
				else: new['tracks'][0]['youtubeId']=variant
				with self.assertRaisesRegex(AssertionError,'PUBLISHED_YOUTUBE_ID_CHANGED'):
					assert_catalog_compatible(new,old)

	def test_malformed_video_ids_fail(self):
		for malformed in (None,12,'bad','!ABCDE12345','valid-with-spaces'):
			with self.subTest(malformed=malformed):
				old=baseline();new=copy.deepcopy(old)
				new['tracks'][0]['youtubeId']=malformed
				with self.assertRaisesRegex(AssertionError,'INVALID_YOUTUBE_ID'):
					assert_catalog_compatible(new,old)

	def test_never_ignore_catalog_source_or_other_field_changes(self):
		old=baseline()
		for change in ('id','title','manifest','new_metadata','order','format','extra_top'):
			with self.subTest(change=change):
				new=copy.deepcopy(old)
				if change=='new_metadata':new['tracks'][0]['artworkOverride']='fake.png'
				elif change=='order':new['tracks'].reverse()
				elif change=='format':new['format']='v2'
				elif change=='extra_top':new['danger']=True
				else:new['tracks'][0][change]='changed'
				with self.assertRaises(AssertionError):
					assert_catalog_compatible(new,old)

	def test_track_count_drift_fails(self):
		old=baseline();new=copy.deepcopy(old);new['tracks'].pop()
		with self.assertRaisesRegex(AssertionError,'CATALOG_TRACK_COUNT_CHANGED'):
			assert_catalog_compatible(new,old)


if __name__=='__main__':unittest.main()
