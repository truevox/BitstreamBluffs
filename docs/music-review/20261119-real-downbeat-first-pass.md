# Real recording measure/downbeat search — *One More Run*, first pass (UNVERIFIED)

**2026-11-19 · Music Friday research only · GitHub issue [#50](https://github.com/truevox/BitstreamBluffs/issues/50).**

Owner requested a **real measure-start map** in addition to individual beats, immediately after approving the smaller **synthetic 4/4 clock** merged through [PR #49](https://github.com/truevox/BitstreamBluffs/pull/49). Unlike the shipped fake 0.5-second beat, none of these source-derived candidates is established as a real musical beat or bar boundary. This experiment does NOT change playback, World Dance, Gym, the shipped beat catalog, or any original audio.

## Evidence and scope

- Original user-owned **15-segment One More Run** OGG pack, 174.6s, read-only from existing CT223 music worktree; analyzed just **8 × 11.5s source windows** at segment indices 0, 1, 2, 5, 6, 9, 12 and 13. No new OGG copies.
- Each segment supplies **independent original drum low-frequency attack salience** and **original bass attack/change salience**, with SHA-256 of every source OGG and the original pack manifest; no full-mix vocal-dependent beat detection.
- Evaluates **160.00 BPM** (Marvin’s verbatim Suno generation instruction), **161.50 BPM** (previous audio-analysis hypothesis), and **163.84 BPM** (previous onset-comb candidate). These are *independent hypotheses*, not three verified tempo regions.
- For each local quarter-pulse phase, the result retains **all four possible 4/4 beat-one offsets**; an attack that happens regularly is not automatically a downbeat. Candidate scores are arbitrary source-envelope ranking values, **never confidence or validation**.
- The deliberately half-time bridge, possible pickups, source separation artifacts, percussive fills, different time signatures, true sample tempo drift, and phrase boundaries remain unresolved. **A half-time feeling does not itself change the bar lines.**

## First source-derived candidate observations (160 BPM hypothesis only)

| Source window | First local beat phase (s) | Best-scoring tentative bar-start in song (s) | Beat-one offset (0–3) | Other three candidates retained? |
|---|---:|---:|---:|---|
| 0–12s | 0.0499 | 0.0499 | 0 | Yes (all 4) |
| 12–24s | 0.2868 | 13.4118 | 3 | Yes (all 4) |
| 24–36s | 0.0748 | 24.0748 | 0 | Yes (all 4) |
| 60–72s | 0.2619 | 61.3869 | 3 | Yes (all 4) |
| 72–84s | 0.3118 | 73.4368 | 3 | Yes (all 4) |
| 108–120s | 0.1247 | 108.4997 | 1 | Yes (all 4) |
| 144–156s | 0.1746 | 145.2996 | 3 | Yes (all 4) |
| 156–168s | 0.0499 | 156.7999 | 2 | Yes (all 4) |

**Interpretation:** The locally preferred 4/4 beat-one offsets vary considerably among windows. That is **not evidence of one coherent, verified measure grid**. It could reflect genuine tempo drift, meter/phrase changes, independent local phase estimation, a source attack that is not the quarter pulse, or rhythmic bias such as a kick on a different beat. We should not splice these top-ranked timestamps into one artificial “source-approved” global beat map.

## Machine-readable report and how to reproduce

- [Eight-window source-bound JSON candidate report](one-more-run-source-downbeat-candidates-UNVERIFIED-20261119.json)
- `tools/music/research_original_downbeat_candidates.py --source-pack /path/to/real/33_local-one-more-run-bitstream-bluffs --out /path/to/new-output.json` (read-only input, refuses output overwrite).
- `tools/music/test_original_downbeat_candidates.py` uses synthesized test signals only and checks that ordinary pulses without strong bar accents remain undecided, genuine extra attacks are merely *ranked*, the four rival offsets remain visible, no missing source or invalid window is silently promoted, and source-relative timestamps remain absolute.
- Source pack manifest SHA-256: `e7d5b95ecb258c86551fd242ceb9696427c1655dc91d11b95b60dd6ef0647d6a`; report SHA-256: `ce5e10dcf47899a5525419e8659c948114bda18c98ac187ba124d1996b676742`.

## Next research gates before any source map is trusted

1. **Quarter-note phase:** Validate real pulse locations throughout the song, independently from kick/snare subdivision and the 160 BPM generation prompt. Keep source timestamps and original frame/sample-rate identity; current earlier beat grids are explicitly not verified.
2. **Downbeat and meter:** Human listeners should compare all four candidate bar starts *over the original audio*, ideally alongside bass/chord/harmony change timing, to determine actual **beat 1** and possible pickups. Include 2/4 and compound-meter alternatives rather than forcing every song to 4/4.
3. **Section/phrase:** The half-time bridge, chorus entrances, rests and vocal pickups need their own annotations; distinguish perceived half-time from meter or quarter-rate changes.
4. **Evidence and versioned release:** Both independent source and reviewer checks are required before marking any section `verified`. Store `pulseFrames`, verified `measureStartFrames`, time-signature span, source hashes and explicit uncertain intervals as distinct fields; do not overwrite the current `bitstream-beat-grid-v1` catalog without intentional schema/version migration.
5. **Consumer coordination:** Control Friday may use the shipped cosmetic synthetic meter, gated by Reduce Motion/World Dance. It must not interpret this issue #50 candidate report as real timing and should not implement a separate beat timer.

**Status:** This is a **started research deliverable**, not finished musical transcription. No song-specific genuine downbeat has been human-verified, no player/audio change was made, and no source beat measure grid is approved for release.
