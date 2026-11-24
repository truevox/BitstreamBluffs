# Issue #312 — source-derived provisional 4/4 crossfade preview

Owner direction: implement tail-aware crossfades; use best judgment for beat-one selection, with the owner's hypothesis that nearly all (possibly all) Maxi songs are in simple 4/4. This authorizes a provisional musical grid, not a claim of musician verification.

## Evidence and private data
- All 33 source-backed beat candidate reports were matched against their previously verified report hashes and the current private catalog durations.
- Selected one candidate pulse path per track using joint drum/bass onset support, bar-accent contrast, and interval regularity. Choose the strongest of four possible bar offsets, then count in fours.
- The generated, private `transition-grids.json` sidecar has 15,468 estimated beats, 3,868 estimated downbeats, 33 track identities, and 15 quiet-tail flags. Nine tracks have conflicting candidate tempos. This sidecar is not committed or uploaded; the original source recordings remain untouched.
- The candidate grid is explicitly labeled estimated, not musician-verified. It is only used for song-transition planning, not authoritative world physics, beat mechanics, or Gym timing.

## Preview implementation
Opt in with Sound Manager > SONG CROSSFADE (PREVIEW). Preload the incoming source stems and require outgoing coverage before committing. Target 2–4s overlap (longer for quiet tails); align the first incoming estimated downbeat when practical without skipping or stretching the incoming introduction. Otherwise use a non-aligned transition. If readiness is inadequate, use the existing boundary transition. Keep the original six stems and existing shared DSP/peak guard; separate vocals, transfer bass/drums near the center, equal-power blend melody. No crossfade for a single repeated song or dynamic orchestra gameplay in this preview. Without the private grid file, use a simple time-based transition.

## Verification
- 51 focused tests in 6 suites passed (crossfade, seek/pause, adaptive director, selection, five-biome integration, private loopback).
- Real game Chromium Web Audio smoke, private 33-song catalog:
  - index 0 to 1 (Pope → One More Run), clean menu: 3.756s, estimated downbeat aligned.
  - index 32 to 0 (The Factorio Meta → Pope), clean menu: 3.342s, wraparound.
  - index 1 to 2 (One More Run → Every Hacker Part 2), gameplay DSP, stopped simulation for controlled transition: 3.150s.
- Each case checks scheduled original six-stem overlap, clock anchor, and outgoing node cleanup. The browser run is scheduling verification, not a subjective listening test, comprehensive overlap PCM/peak analysis, or CPU/device certification. Full 33-transition matrix and owner listening remain open.

## Reproduction
Use `tools/music/select_provisional_transition_grids.py` with existing private candidate, catalog, and verified tail-report inputs; it creates a new output file exclusively. Supply its private path as `BSB312_GRID_FILE` to the existing loopback-only mixed QA server, then run `tools/music/smoke-song-crossfade.mjs` against that server. No public build or media publication is authorized.

## Dual-meter live overlap QA — first 17 transitions
The new `audit-song-crossfade-output.mjs` captures actual stereo output after the final peak guard, with a qualified v4 AudioWorklet arm, every render quantum checked, and an exact final-quantum stop receipt. Controlled gameplay DSP in Debutmont, all original vocals enabled, max user volume controls, normal six-stem playback, dynamic orchestra off; the simulation is paused for repeatable timing. The PCM is passed in memory to the existing finite-window 4x meter and separately to FFmpeg EBU R128 true-peak analysis. It is not retained or uploaded. 50ms RMS windows flag near-silence below -60 dBFS, not perceptual approval.

Independent report validation (`verify-song-crossfade-output.mjs`) accepted 17/33 exact ordered catalog transitions: 154.950 s contiguous PCM, 2.002–3.800 s overlaps, five estimated-downbeat-aligned, zero sample clips, nonfinite samples, estimated intersample overs, or near-silent overlap windows. Worst peak -3.9783 dBTP (FFmpeg -4.0). Two instrument-only render discontinuities were preserved and repeated; no measured audio-limit failure was retried. Full default aggregation fails closed on incomplete coverage. Twelve verifier tests passed, including wrong IDs, missing nodes/terminal samples, truncated meter, and reported clipping.

The initial PR identity CI failed on native sine/cosine in the fade helper. Switched to existing pinned portable math with unchanged fade law; 490/490 local determinism + crossfade tests and 17/17 conformance tests passed; no ruleset or replay change. The full 33-case audit remains incomplete at this checkpoint. Subjective listening, calibrated mastering compliance, live moving gameplay and low-end-device performance are still separate gates.
