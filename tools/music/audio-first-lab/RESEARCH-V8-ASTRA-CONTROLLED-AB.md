# Bitstream Bluffs — V8 Controlled Accompaniment A/B (Astra remediation)

**Date:** 2026-11-17
**Status:** ADDITIVE PRIVATE RESEARCH, NOT owner-approved soundtrack or game release.
**Listener:** http://100.115.120.66:8186/
**Prior private versions:** 336 Ogg files remain in-place; V8 adds 192 → **528 Ogg previews** total. The older :8185 archive remains untouched.

## Trigger and independent source of criticism

Marvin requested that Gal Friday ask **Astra Friday** for an independent review of the V7 *Pope Other* 18-retrigger score trial. The actual local Astra profile, **gpt-6-astra** (OpenAI Codex), reviewed code, source JSON/FLAC and decoded previews read-only on 2026-11-17. Her review identified **three P1 defects** in the ability to compare note-level changes fairly, plus P2 robustness/sonic limitations. She recommended retaining V7 as historical but **not** relying on it as a controlled test.

Astra's full independent report is preserved, reviewer-attributed, in canonical GBrain under the V7 Pope note-audit project, child `astra-independent-review-20261117`. Astra was **not** asked to edit the code and did not author V8 implementation; V8 is Gal Friday's subsequent response to the reviewer findings. The owner did **not** approve new musical notes.

## Implemented repairs

### 1. Verified fixed backing and common mastering gain

`render_controlled_accompaniment_v1.py` constructs the two-song, eleven-biome, two-terrain combinations from one **shared backing array** comprising:

- Two original unfeatured Guitar/Piano/Other source stems;
- The same already-designed biome melody and bass layers;
- For Ground, the original source drum stem; for Air, the existing V3 high-resolution sampled kit and foley.

For each song, biome, and terrain, all four accompaniment choices use this identical backing:

- **Stock trio** — original featured stem as well as the other originals;
- **Current orchestra** — baseline original source-derived featured notes, redesigned instruments;
- **Timing candidate** — previously available source-transient-aligned featured note-onset trial;
- **Recovered attacks (Pope)** — the same pitch classes with V8 retrigger candidate, 18 extra source-conditioned reattacks. **Not available for One More Run**, whose corresponding files are literal copies of Current orchestra.

The featured synth gain is computed ONCE from baseline notes, and applies unchanged to the aligned/retrigger candidate. All four mixes share the **same single master scalar**, chosen from the baseline mix target RMS and maximum peak across all four to avoid clip. There is **no independent whole-mix RMS limiter or normalization per style**, so the backing cannot change volume when switching accompaniment. Some natural overall measured loudness difference from *added featured notes* is expected and is part of the experiment; it must not be confused with changed background gain.

Programmatic raw PCM check verifies `raw_variant - raw_current == featured_variant - featured_current` within float32 arithmetic tolerance, for every style/terrain/biome/song. Report `qa-common-backing.json` holds each common gain, backing SHA-256 and maximum isolation error. Original reference and Maxi vocal files are copied bit-for-bit from V3. All media and score candidates are **private on CT211**, not included in Git.

### 2. Stable note identity, random timbre and pan

`stable_render_featured()` seeds note synthesis using original **`sourceIndex`** instead of score-array index. Newly inferred reattacks have a distinct `('recovered', sourceIndex, start)` identity; other original notes keep `('source', sourceIndex)` regardless of score insertion/reordering. Panning uses a stable hash of the same identity. Additional notes cannot shift another note's RNG stream or left-right position.

Crystal Cavern's sparse `BOOOONG` layer is gated by original note identities; inserted source-inferred note attacks do not displace existing bongs. No changes to existing original-stem source MIDI, the original sound templates, or the game music engine.

### 3. Continuous A/B WebAudio clock, including vocals

`orchestra-audition/app.js` no longer rewrites `state.startClock` during a normal swap. New source is scheduled at future WebAudio time `begin`, with **offset = begin − original song startClock**, rather than at a stale offset followed by an artificial 28ms clock rewind. The old source fades from the exact same wall-clock transition point. Audio source slots expose their actual scheduled `begin` and `offset` for verification. Maxi's optional original vocal uses the same clock and is **not restarted** for a simple accompaniment swap.

The only time `startClock` is set is at a fresh start of playback (or after an explicit user seek/pause/song change), derived from the actual scheduled start time. Both versions remain aligned as the audio streams continuously.

The default now selects **Controlled score A/B ✨**. All four earlier revision families remain accessible, clearly labeled historical where necessary. The preexisting "Original instrumental" A/B continues as a broader comparison—not a same-backing test.

### 4. Retrigger robustness and provenance

`rearticulate_featured_v2.py` retains *all original pitch hypotheses*, but accepts each sensitive input candidate only once across overlapping original same-pitch parents; a per-MIDI close-onset register also suppresses duplicate insertions. An empty source transient list never calls `percentile(empty)` or `argmin(empty)`; it conservatively preserves the original note and marks candidates needing a human review. Rejected candidates retain reason codes, including already-assigned, duplicate original, no source transient, too-short segment and insufficient source pitch support.

This same-source *Pope* data still proposes **18 extra reattacks**, 151 candidate source events → 169 proposed segments, of which **141 baseline** and **159 reattack** notes pass the existing renderer gates. Original octaves/pitches are not deleted or invented. Each source event carries stable original index metadata in the private V8 score.

**Known limitation not hidden or forcibly "fixed":** the 12ms gap in note-on/off scores does NOT mean the synthesized waveform is silent between attacks. Release tails can intentionally overlap. The new controlled audition fixes pan/timbre/loudness confounds but does not establish note-perfect music, instrument isolation or legitimate octave harmonics. The 18 sensitive-model events share a single octave family and are source-conditioned estimates, not manually adjudicated strikes. Stronger pitch-specific acoustic evidence and artist listening remain necessary.

## Validation, actually run

- **18 Python tests passed** including 5 added V8 checks: fixed per-note identity under event insertion/reorder; unchanged note sounds under split duration; one shared gain/no backing drift; duplicate retriggers across overlapping source-note parents; graceful empty-source behavior. Existing independent 13 audio tests remain green.
- **39 game music unit tests**, production Vite build, no-private-asset release check, **7 asset-safety tests** passed.
- **192/192 new Ogg preview clips passed independent 48kHz stereo/32s/decoded peak/finiteness/file integrity QA**. Six Ground/Air *Pope* Current-vs-Recovered decoded Opus comparisons exhibited **exactly zero residual RMS/peak over the first 10.65 seconds**, preceding the first edited source note. Later portions differ as intended.
- Source references and Maxi vocal files byte-identical to earlier V3. All One More Run Recovered (disabled) Oggs byte-identical to Current after verifying decoded equivalence (the initial separate Opus encodes had different Ogg stream serials despite identical decoded samples).
- Real Chromium/WebAudio integration tested all **532 private HTTP resources**; all relevant choices, both songs, seeking, vocal enable, repeated switching, and **single uninterrupted song-clock continuity**. Audio scheduled offset is tested against absolute shared clock and old vocal remains on same clock.
- Old 336 preview files not touched. Only the newly created V8 style folders and updated private listening-page UI were published.
- Source is Python tab-indented; no Ogg/FLAC/private score JSON, model weights or Source SoundFont assets entered Git.

## What is not done

- Human verification of the 18 actual Pope reattacks or suspected octave ghosts.
- Full three-stem Guitar+Piano+Other re-orchestration: Pope still transforms Other; One More Run still transforms Piano. All remaining source stems are preserved unchanged.
- A blind LUFS-matched audition or note-by-note score adjudication against isolated source pitches/attacks.
- Commercial/game mastering, licensing clearance, full-song score extension or merging feature branch into main.

## Source paths

- `tools/music/audio-first-lab/rearticulate_featured_v2.py`
- `tools/music/audio-first-lab/render_controlled_accompaniment_v1.py`
- `tools/music/audio-first-lab/validate_controlled_accompaniment_v1.py`
- `tools/music/audio-first-lab/test_astra_fixes_v1.py`
- `tools/music/audio-first-lab/orchestra-audition/{index.html,app.js,smoke.mjs}`

## Original review and source score provenance

Prior feature commit `ba71bc22e49094e5dadd862dd7e7be5babec7655` is preserved. CT211 private experiment output: `/root/bitstream-maxi/orchestra-v1-20261116/astra-fixes-v1-20261117/`, including `events/pope-other-reattacks-v2-sourced.json`, `qa-controlled-audio.json` and the shared-backing gain report in the controlled-render root. None of these private research outputs is a release asset.
