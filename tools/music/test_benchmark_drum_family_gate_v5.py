#!/usr/bin/env python3
"""Research-only tests for deterministic drum-family hypothesis selection."""
import unittest

from benchmark_drum_family_gate_v5 import (RECIPES, FAMILIES,
	select_families, test_case, summarize, make_cases)


class DrumFamilyGateTests(unittest.TestCase):
	def test_selects_exactly_one_method_per_family(self):
		v2=[{'t':.1,'type':'kick'},{'t':.2,'type':'snare'},
			{'t':.3,'type':'hat'}]
		v4=[{'t':.4,'type':'kick'},{'t':.5,'type':'snare'},
			{'t':.6,'type':'hat'}]
		initial_v2=[x.copy() for x in v2]
		initial_v4=[x.copy() for x in v4]
		selected=select_families(v2,v4,('v2','v4','v2'))
		self.assertEqual(selected,[{'t':.1,'type':'kick'},
			{'t':.3,'type':'hat'},{'t':.5,'type':'snare'}])
		self.assertEqual(v2,initial_v2)
		self.assertEqual(v4,initial_v4)
		selected[0]['t']=99
		self.assertEqual(v2,initial_v2)

	def test_rejects_unexpected_roles_or_methods(self):
		with self.assertRaises(ValueError):
			select_families([],[],('v2',))
		with self.assertRaises(ValueError):
			select_families([],[],('v2','invalid','v4'))
		with self.assertRaises(ValueError):
			select_families([{'t':0,'type':'tom'}],[],('v2','v2','v2'))

	def test_all_recipes_include_known_three_families(self):
		for label,recipe in RECIPES.items():
			with self.subTest(label=label):
				self.assertEqual(len(recipe),len(FAMILIES))
				self.assertTrue(all(v in ('v2','v4') for v in recipe))

	def test_case_has_clear_synthetic_status_and_20_50ms(self):
		name,gold,wave,cohort=next(make_cases(559103))
		before=wave.copy()
		row=test_case(name,gold,wave,559103,cohort)
		self.assertEqual(row['goldCountSynthetic'],len(gold))
		for label in RECIPES:
			self.assertEqual(set(row['metrics'][label]),{'20ms','50ms'})
			self.assertGreaterEqual(row['metrics'][label]['20ms']['f1'],0)
		self.assertTrue((wave==before).all())
		assert 'v5SnareOnly' in summarize([row])[cohort]['20ms']


if __name__=='__main__':
	unittest.main()
