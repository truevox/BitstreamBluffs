# V9 — Lab-only Sine Timing Reference pseudo-biome

**Added 2026-11-17.** Private Tailnet research player only: `http://100.115.120.66:8186/`. **Not a mountain in the game**; does not change the eleven biome instrument files, the real-game source engine, soundpacks, or private full-song four-track preview at :8187.

## Marvin's direct request

Marvin requested a **sine "biome" only in the orchestra laboratory**, in addition to the real mountain ensembles. His purpose is to hear **the physical location of detected notes** rather than instrument attack, decay, soft pads, or effects. Simple percussion should expose even rapid successive drum hits. He suggested sine or saw-like waveforms, not a new production instrument or artist-approved orchestra.

## What was actually built

`render_sine_timing_reference_v1.py` renders 5 private **32-second** Ogg/Opus diagnostic excerpts at 48 kHz stereo, from the exact, existing scored event positions:

- **Lead melody:** source SheetSage2 full-song `pure/notes.json`, shifted onto the original excerpt time axis (Pope starts at **150 s**, One More Run **92 s**). Intended melody notes are not meant to imply exact singer acoustics.
- **Featured accompaniment:** current Basic Pitch `Other` (Pope) or `Piano` (One More Run), untouched original scored event onset, duration and MIDI; aligned candidate moves only selected attacks; reattacks candidate adds 18 inferred strikes for Pope. No novel melody or pitch classes introduced.
- **Bass:** source-derived F0 bass note event list, not source audio; low notes raised an octave ONLY so the diagnostic pulse is audible. Onset times and intervals unchanged.
- **Drums:** event timestamps from the 2026-11-16 **high-speed V3 25ms-conscious drum-hit detector**, rendered as **3–10 ms electronic dry clicks**, with kick/snare/hat differentiated by click frequency. No quantization or artificial grid correction.

**Pure sine note tone** starts at each recorded event's exact sample index and remains at constant amplitude until its scored end; **1 ms anti-click safety ramps** are the only fade. No instrument AD/decay, musical sustain/legato handling, oscillator detuning, random timbres, room, reverb, FX, original Guitar/Piano/Other source stems, original recorded drum kits, sampled bass, or SoundFont glue. A brief (~2 ms), quiet high-frequency **right-channel tick** annotates the featured notes' starts to make adjacent same-pitch retriggers physically audible. The original Maxi vocal recording can still be explicitly overlaid by the lab's existing checkbox; disable it for a strictly synthesized-only test.

The same **melody, bass, and drum-click backing arrays** are present across all applicable featured-score variants, with a **single shared gain**; no independently normalized variants or accidental changes to unchanged notes. Note pitch and duration are not automatically corrected, and all source model uncertainties remain.

## UI

A twelfth **visible button, labelled 🧪 Sine / Timing Reference**, is displayed alongside the real eleven biome selections **without adding a twelfth biome to the canonical catalog**. Selecting it temporarily forces the existing *Controlled score A/B* score logic, with choices:

- **Detected note score** — base original note events (Pope 151; One More Run 299).
- **Timing candidate** — identical pitches with previously source-aligned candidate onsets (both songs).
- **Recovered attacks (Pope)** — 169 total event candidates including 18 inferred additional same-pitch note-on strikes. Disabled on One More Run because not yet audited.
- **Original instrumental** — can still be selected independently for a quick source reference. *Stock trio* is disabled **within the diagnostic biome** because original recorded source audio cannot magically be a synthetic note-event score.

Ground/Air controls are deliberately disabled in diagnostic mode since **the same dry high-resolution drum-click reference** is used for both. Real original/acoustic Drums Ground vs new Air drum-kit comparisons remain available in every normal biome. Upon leaving the diagnostic, historical selected revision and accompaniment are restored; all source biomes and real instrument selectors remain intact.

## Audio evidence and QA

Private output generation on CT211 (append-only, never overwrites):
`/root/bitstream-maxi/orchestra-v1-20261116/lab-only-sine-diagnostic-20261117`

Published NEW directory only:
`/root/bitstream-maxi/orchestra-v1-20261116/site/revisions/diagnostic/{pope,one-more-run}/{new,aligned,reattacks}.ogg` (reattacks only Pope).

- **Pope:** lead 86 excerpt-overlapping scored melody notes, 18 bass notes, **352 drum click events**, and 151 / 151 / 169 featured note candidates.
- **One More Run:** lead 39 excerpt-overlapping scored melody notes, 52 bass note events, **535 drum clicks**, 299 / 299 featured notes.
- **Five independent numerical Python tests pass:** exact scored-start placement with zero pre-onset energy; flat note gates without lingering tails; separated same-pitch retriggers; absolute-song excerpt shift; preserving 25ms rapid drum-hit separation.
- **Five Ogg Opus independently probed**: 48 kHz stereo, ~32.0065 seconds each, valid finite sample reports, all distinct note candidates.
- **All 528 previous Ogg clips checksum-preserved**, 533 total current private Oggs.
- **537 lab HTTP resources verified**. Real Chromium WebAudio exercise PASS (all real versions; both songs; chosen diagnostic note variants; source original A/B; terrain controls locked; Pope recovered attack enabled; One More Run disabled; seek and vocal synchronization). Initial test prematurely waited on a cache-start instead of actual new-song playback; corrected that test race and re-ran to PASS.
- The site `catalog.json` remains 11 real biomes / 2 songs and is **not modified**. Old :8185 gallery and main game :8187 unchanged.

## Scientific limits and musical status

This deliberately exposes **what the note detectors think the notes are**, not guaranteed real strikes. The instruments represented by real Guitar/Piano/Other source recordings cannot all be isolated or given sine pitches without separate note detection; the current diagnostic only plays the **featured** candidate accompaniment plus lead melody/bass and reconstructed drum timestamps. Hearing a bad note here suggests scoring or pitch error; hearing a bad note only in an artistic biome suggests a timbre/attack/release or mix problem. Hard-gating a note makes its scored end audible; a short safety ramp is necessary to avoid clipping clicks. The 18 extra Pope strikes are hypothesis-level and remain **artist-unapproved**.

Full-song SheetSage2 source score may be research/noncommercial-only; the resulting sine previews are hosted exclusively behind Marvin's **private Tailnet lab**, never on the public game site or in Git.

## Source paths

- `tools/music/audio-first-lab/render_sine_timing_reference_v1.py`
- `tools/music/audio-first-lab/test_sine_timing_reference_v1.py`
- `tools/music/audio-first-lab/orchestra-audition/app.js`
- `tools/music/audio-first-lab/orchestra-audition/index.html`
- `tools/music/audio-first-lab/orchestra-audition/smoke.mjs`

The owner will listen later; **this is a diagnostic tool, not musical approval**.
