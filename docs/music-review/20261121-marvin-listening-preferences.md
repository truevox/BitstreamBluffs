# One More Run — actual owner listening preferences (corrected screenshot)

**2026-11-21 EST / 2026-11-22 UTC · DRAFT PR #53 · source-music review, NOT music verification.**

Marvin supplied four screenshots of the unverified original-stem audition lab and described them as “this sounds pretty good.” When asked whether the displayed options were intentionally selected, he explicitly answered **“those selections were my preferences”**. That makes these *actual listener choices*, **not inferred default interface settings**. Marvin then supplied a replacement screenshot for the initially misleading 16.4-second passage: **“whoops ur right try this”**. The connected browser's open listening-lab tab confirmed the newly loaded source segment 1, the selected controls, and active original-source playback.

| Owner-preferred passage | Actual source window | Selected tempo hypothesis | Selected phase | Preferred 4/4 beat-one offset | Local algorithm rank |
|---|---|---:|---|---:|---:|
| 90.0 s | segment 7, 84–96 s | **163.84 BPM** | phase 3, **+0.1995 s** | **+0 beats** | **3/4** |
| 126.0 s | segment 10, 120–132 s | **161.50 BPM** | phase 2, **+0.3617 s** | **+0 beats** | **1/4** |
| 167.1 s | segment 13, 156–168 s | **163.84 BPM** | phase 3, **+0.3118 s** | **+2 beats** | **1/4** |
| **16.4 s (CORRECTED)** | **segment 1, 12–24 s** | **163.84 BPM** | **phase 4, +0.3617 s** | **+3 beats** | **1/4** |

At the corrected 16.4s selection, the source-audio tab reported actual original full-stem playback spanning **11.94–20.94 s**, which crosses the source segment 0→1 seam. The prior screenshot showed 16.4s in the **suggested passage** dropdown but still had source segment 13, 156–168s, loaded with the 167.1s setting. That old screenshot's source association was wrong and is **superseded**; it is not an independent 16.4s preference and not a fifth vote. The corrected 16.4s selection is **phase 4 / offset +3**, **not** the earlier phase 3 / offset +2 accidentally associated with that passage.

**Explicit subsequent clarification from Marvin:** “I was just clicking what sounded right - I may have gotten the wrong first beat.” This is an explicit owner statement that all four selections were made for **subjective musical fit**, *not* with an intention or claim to identify the actual first beat of each measure. This qualifier takes priority over any automated rank label, previous assistant interpretation, or inferred confidence; the human-selected bar-one field is the **selected accent-offset control**, not a confirmed bar-one position. Zero formal musical beat-one labels have been supplied.

**Research value:** The preferred 90s option was **ranked 3rd** by the algorithm; a real listener can prefer an option that the source onset and harmonic rankers underrate. The chosen settings also vary by musical passage. This is positive owner subjective feedback about the auditioned hypotheses, **not** formal confirmation of actual 4/4 meter, the right musical downbeat, local source BPM, half-time bridge, song-wide pulse phase, or an exact sample-frame tempo map. A passage preference should not silently become an authoritative release beat grid or override future listening/structural analysis.

**Fixed misleading UI:** the suggested-passage selector now **auto-loads** the selected passage on change, stops old playback, updates the source-window selector, and visibly displays the *actual* original-source excerpt range. The old separate **Reload source passage** button remains as a redundant accessible action. Directly changing the source window now also labels that the dropdown's suggestion is no longer what is loaded. This prevents the screenshot mismatch from quietly recurring. The Chromium integration smoke test exercises selecting the corrected 16.4s passage and its actual original audio, switching away while playing, source-segment crossing, intentional original OGG corruption rejection, and browser JS errors. Original WAV master and six original OGG stems remain protected by their source SHA-256 checks; original audio files and gameplay are untouched.

**Machine-readable user/agent provenance** (including every original source packet coordinate, owner's direct preferences, SHA fingerprints and explicitly rejected stale screenshot association): `docs/music-review/one-more-run-owner-preferences-UNVERIFIED-20261121.json`.

**No human has certified the source downbeats.** User feedback justifies a more focused follow-up listening comparison with explicit per-passage notes, not the release of a synthetic or unverified source beat grid. Maintain DRAFT PR #53 and do not modify `RELEASE_BEAT_GRIDS`, original music, World Dance, Gym, physics, saves or released soundtrack timing on the basis of these preferences alone.
