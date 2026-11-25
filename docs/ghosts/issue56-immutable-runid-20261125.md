# P0 #56 — immutable recording identity for each stored ghost run ID

The v2.22.5 Course Archive safety milestone rejects reusing an existing tape
run ID on another course. It does **not** currently reject replacing the
payload behind a tape run ID on the SAME seed+biome-mask course: a second
`saveRun()` silently mutates an already Favorite-pinned recording, including
trace, checkpoint, score or outcome, while the favorite role still says the
same ID. This was reproduced on current main v2.22.7 in the memory backend.

Goal: `runId` is an immutable artifact identity. Once a recording exists on
this device, another `saveRun()` with the same ID must either be exactly the
same whole tape (an idempotent replay of the same save), or fail **before**
changing the course's Latest/Best/Favorite refs, tape bytes or garbage
collection. No new course slot/price policy, player data upload, ScoreManager
changes, ghost schema change or physics change.

Both memory fallback and IndexedDB must obey the same rule. IndexedDB checks
must execute in the same readwrite transaction as any accepted tape+course
write to prevent cross-tab races. Tests should create colliding runs with
same course and different trace/score, pinned Favorite, and simultaneous
different-tab saves; verify one authoritative original wins and the losing
mutation cannot replace it. Also test same-ID exact duplicate retry accepted
when it truly is identical, and cross-course collisions still refused. A
rejected save must never be reported as durable success. This does not by
itself finish #56 Course Archive slot pricing/explicit management or
long-run cross-browser replay acceptance.

This is an unversioned branch off v2.22.7. Release ordering remains behind
protected archive #371 v2.22.8, Heavy #372 v2.22.9, Team B #68 and #69 file
fallback #374. No Codex or Netlify.
