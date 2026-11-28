#!/usr/bin/env python3
"""Small invariant tests for the private score-sparsification audition."""
import unittest
from render_sparse_audition import RATE, select_events, grid_for_mode

def note(frame, ordinal, role="piano"):
	return {"startFrame":frame,"endFrame":frame+RATE//4,
	        "pitch":60+ordinal,"class":"note","renderOrdinal":ordinal,"id":f"note-{ordinal}"}

class SparseAuditionTests(unittest.TestCase):
	def setUp(self):
		self.beats=[RATE*i//2 for i in range(12)]
		self.events=[note(i*RATE//8,i) for i in range(40)]

	def test_dense_exactly_preserved(self):
		result=select_events(self.events,self.beats,"dense","piano")
		self.assertEqual(result,self.events)

	def test_sparse_invariants(self):
		ids={e["id"] for e in self.events}
		for mode in ("beats","eighths","selective"):
			out=select_events(self.events,self.beats,mode,"piano")
			self.assertTrue(out)
			self.assertLess(len(out),len(self.events))
			self.assertEqual(len(out),len(set(e["id"] for e in out)))
			self.assertTrue(all(e["id"] in ids for e in out))
			self.assertEqual(out,sorted(out,key=lambda e:e["startFrame"]))

	def test_note_grids_are_nested(self):
		quarters=grid_for_mode(self.beats,"beats")
		eighths=grid_for_mode(self.beats,"eighths")
		self.assertEqual(len(quarters),12)
		self.assertEqual(len(eighths),23)
		self.assertTrue(set(quarters).issubset(set(eighths)))

	def test_chord_retained_together(self):
		chord=[note(RATE,0),note(RATE,1),note(RATE,2)]
		out=select_events(chord,self.beats,"beats","piano")
		self.assertEqual(len(out),3)

if __name__=="__main__":
	unittest.main()
