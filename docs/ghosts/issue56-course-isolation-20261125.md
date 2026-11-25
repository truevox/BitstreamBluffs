# #56 course-isolation hardening — implementation and QA plan

The owner-established five simultaneous local roles (Best, Latest, Favorites A/B/C) are keyed to the **exact seed and selected biome mask**, not an arbitrary tape run ID. Current `GhostLibrary.setFavorite` accepts any existing run ID including one from another course; loaded/stale course metadata can also point to another course and currently pass through the visible ghost and Game Over row reader. A separate `saveRun` reusing a run ID can overwrite a tape belonging to another course.

This patch will enforce exact `courseKey(tape.seed,tape.biomeMask)` equality for explicit favorite selection, loaded display candidates and Game Over labels; refuse cross-course run-ID overwrite in `saveRun`; and prove honest same-course Latest/Best/Favorite behavior and no physics/ranking writes remain unchanged. No database schema change, user role migration, archive-slot cap, pricing, eviction, Bazaar upload, or replay verifier is added here. Incompatible/corrupted foreign favorites stay safely visible as **OTHER COURSE** in the read-only role panel for explicit user repair, not secretly drawn as a sixth or foreign ghost.

The full #56 economic/retention P0 stays OPEN pending owner decisions about initial included course-library count, slot price curve and explicit eviction policy. This patch only closes the concrete cross-course integrity hole.

## Implemented source/QA evidence

The library now validates the exact `courseKey(seed,biomeMask)` when pinning any Favorite, before accepting a duplicate global run ID, and again when selecting stored role tapes for the renderer. The Game Over role labels use the same course check and show a clearly repairable `OTHER COURSE` state for corrupted foreign references. Only five existing role identifiers are mutable. No foreign role pointer or rejected input changes the saved course. Recorded tape output and authoritative physics are untouched.

Adversarial regressions originally failed on unmodified main: cross-seed and cross-mask favorite injection; persisted foreign role display; duplicate global run ID replacing another course's tape; unauthorized sixth role; Game Over foreign label. After hardening, ghost-tape, ghost-course-row and live replay acceptance suites passed 51/51. The source still needs independent exact-head review and final CI/browser acceptance before merge. Course archive-slot counts, purchase pricing and eviction/user-replacement remain unapproved and are **not** implemented.
