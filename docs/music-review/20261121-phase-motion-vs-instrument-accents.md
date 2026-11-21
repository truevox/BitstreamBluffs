# One More Run — original-source phase motion vs changing instrument accents

**Music Friday, 2026-11-21 · [DRAFT PR #53](https://github.com/truevox/BitstreamBluffs/pull/53) · NO verified musical tempo, beat one, drift, meter, or half-time bridge.**

## Question

A repeated rhythmic frequency close to 163–164 BPM was independently supported by low-band and high-band spectral onset extraction in a prior research pass. But a *repeating frequency* is not a **beat-time alignment** and does not prove the source can follow a single clock. In particular, bass/guitar/piano accents may anticipate a drum pulse or switch to backbeats without the song actually accelerating. Marvin raised the possibility that the original Suno/Kie song wasn't generated/downloaded as a BPM-locked track. This concern is a **hypothesis**, not an owner-observed measurement.

We therefore checked original spectral onset **phase motion** at a *hypothetical 163.8 BPM rhythm*, rather than hunting another 'best BPM' per segment.

## Method and provenance

- Exact original 174.6s source OGG pack: 8,380,800 frames at 48 kHz, 15 contiguous source segments. Original manifest SHA256 `e7d5b95ecb258c86551fd242ceb9696427c1655dc91d11b95b60dd6ef0647d6a`.
- Source stems are original `drums`, `bass`, `guitar`, `piano`, `other` OGGs, **each checked against the independently archived per-stem SHA256** before decoding. The test binds the original source candidate, harmonic, and global rhythmic phase reports together by their own SHA-256 values. No source OGG copied, resampled into new files, edited or re-rendered.
- For each stem, compute original-source **18-second** spectral-flux phased-onset windows every **6 seconds**, using the previously derived global *drum rhythmic-modulation* 163.8 BPM **hypothesis only**. Phasor angle is modulo one candidate rhythm cycle, *not* actual musical quarter-note position. Phasor magnitude is an **uncalibrated** relative coherence measure (0–1), not certainty.
- Compare **phase changes** between adjacent overlapping windows *within each role*. Require magnitude ≥0.10 for **both** endpoints before using a step. Compare relative steps, *not absolute phase*, across five roles with up to 0.10 candidate-beat difference. At least three agreeing stems can support a common change hypothesis; ≥0.05 candidate beats per 6-second step is required before a **common-motion candidate** can be flagged. These are exploratory, uncalibrated thresholds, not a scientific music-annotation confidence model.
- Enforce proper **no-evidence** / source-noise failure: a weak or missing phasor never gets silently unwrapped into an apparently continuous source beat sequence. A phase wrap at ±0.5 beats is resolved only between coherent adjacent windows, and not across gaps in musical source evidence.
- All OGGs were read in-place from a protected source worktree. No production audio or game files were written; only derived experiment source, JSON evidence, and optional listening-lab review metadata changed.

## Measured source results (not musical ground truth)

Of **27 adjacent window transitions**:

| Cross-stem outcome | Transitions | Interpretation |
|---|---:|---|
| Insufficient independently coherent/agreeing *separated-role* step evidence | **22** | Do not classify tempo drift or stability |
| At least three coherent roles with matching *small / locally stable* phase steps | **5** | Possible stable rhythmic phase in these windows, not verified meter |
| At least three coherent roles with a shared ≥0.05-cycle phase movement | **0** | **No multi-stem evidence of a common-motion event at this threshold**; NOT proof there is no drift |

Only the original separated **drums** were above the experimental 0.10 per-window phase-coherence threshold in all **28** windows. Bass passed in **12**, guitar **7**, piano **9**, and other **4**. These shared-mix Demucs-separated stems are **statistically correlated** and not truly independent recordings, making three-role agreement only a *provisional heuristic*. The majority of transitions fail its evidence gate, so **any claim of measured drift or measured no-drift is unjustified**.

These findings are consistent with the prior whole-song drum rhythmic-frequency candidate of ~163.8 BPM and modest global drum onset phasor magnitude ~0.241. It is entirely possible that a near-fixed underlying rhythm coexists with changing drum fills, syncopation, instrument entrances or arrangement. It is also possible the actual source pulse drifts subtly, and these methods simply lack power to isolate it. **No user/music professional has approved a beat index, start-of-bar, meter, bridge entrance/exit, or half-time interpretation.**

## Controls to avoid fooling ourselves

New **7 Python tests** deliberately create known synthetic examples:

1. A perfectly steady pulse with multiple **fixed instrument offsets** must show stable multi-role phase, **not false common drift**.
2. One bass part deliberately shifting its accents by approximately half a candidate beat must **not** register as a shared five-stem tempo movement.
3. A known source-tempo ramp affecting all five synthetic rhythm streams must yield **some coherent shared-motion candidates**. These synthetic fixtures are **not** original music validation.
4. Silence and weak phasor evidence cannot be silently treated as a valid phase path.
5. Circular phase values crossing −π/π must use the short periodic displacement, not a fictitious two-beat jump.
6. Nonfinite input, negative sources, missing roles or impossible reference BPM fail explicitly.
7. The source-bound JSON must assert its **UNVERIFIED** status, exact source frame total, all original fingerprints and absence of approved source downbeats.

The existing accompanying **50 automated tests** (six source-research Python groups + Node source/click browser packet tests) remain passing. An additional **6th Node test** checks that the optional browser lab contains the new source-bound phase-review evidence. Real Chromium still verifies the manifest and all original OGG SHA256 fingerprints, plays actual multi-stem OGGs, switches hypothetical clicks, shows warning text, and intentionally rejects tampered original OGG bytes. That's **58 automated tests in total** (51 prior/revised + seven new), plus the Chromium end-to-end smoke. No acoustic human listening has been performed.

## Safer listening lab

The [optional original-source listening lab](https://github.com/truevox/BitstreamBluffs/tree/research/music-source-downbeat-candidates-20261119/public/music-review/downbeat-review) now displays a phase-continuity uncertainty line for every original 12s source excerpt: nearby transitions with insufficient multi-stem evidence, apparent local stability, and only hypothetical shared-motion counts. Source report hashes are all checked when its tiny `candidates.json` is rebuilt, so stale research cannot be silently paired with different original music. **This review context is not a new click track, real tempo map, verified source bar grid or music rewrite.**

Machine source-bound evidence:

`docs/music-review/one-more-run-source-phase-motion-UNVERIFIED-20261121.json`, SHA256 `6f98cc4dd8dfc4b2833b779a3b7348e0e49886bd0fb65ae7f2ea903d3b5fa9dc`.

## Decision gate / next independent step

We can now narrow the task: find an **independent phase anchor tied to real musical structure**, likely via harmonically meaningful phrase/bass fundamental changes and a separate true mixed-recording (not just five correlated separated roles), then ask a human to audit only a few boundary passages. In particular the low-band source anomaly **78–102 seconds** and the disputed **120–132-second passage** remain *review priorities*, not proven changes. Until these agree, **do not** merge evidence-derived beat timing into `RELEASE_BEAT_GRIDS`, original music, Gym, World Dance, scorekeeping or physics. Maintain draft PR #53, original source integrity and generated clock isolation.

**Owner/agent separation:** Marvin requested ongoing research and raised uncertainty about steady-BPM Suno/Kie exports. Every numerical inference, heuristic, rejected source map and recommended engineering gate above is Music Friday's work, not Marvin's measured fact, approval or decision to change the music.
