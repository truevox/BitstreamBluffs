# Music Friday — 'Piano-friendly' melody simplification (fact finding, design ONLY)

**November 19, 2026. Marvin explicitly says a question is NOT a request to implement.** No new audio demo, MIDI render, source edit, score rewrite, game feature, deployment, or public release has been authorized by this discussion. This note documents whether it is possible and an experimental future plan **if separately approved**.

## What Marvin wants to be able to hear someday

One optional, **slightly quantized, more instrument-like rendering** of Maxi's melody. He is fine if it sounds a little more rigid and loses some of a singer's nuance. Preserve clearly *musically meaningful* movement, e.g., a note that rises from low to high across a sustained scream. Remove unrelated little end-of-note pitch scoops that an ordinary piano would not perform if playing the underlying written melody. Do **not** assume all pitch bends are undesirable, all notes need the same vibrato treatment, or that any replacement should overwrite Maxi's original sung performance.

**Three distinct dimensions** need independent controls:

1. **Pitch spelling / stable note centers:** estimate the robust stable pitch center (in semitones) for each note and snap ambiguous cents fluctuations to its musical note. Avoid octave flips and harmonics from raspy screams. A piano-like result is typically flat within each played note, with changes represented by deliberate new discrete notes rather than continuous portamento.
2. **Micro-timing:** optionally pull starts toward the actual song's verified beat/subdivision grid a **little**, not all the way. Respect pickup notes, intentional behind-the-beat lines such as *'three runs ago'*, syncopation and the deliberate half-time bridge. If the beat grid has not been independently verified, prefer the original onset timings and avoid false 'quantization to song time'. A fixed grid at exactly 160.000 BPM has no source-verified phase and is therefore just a prototype timing reference, NOT a production tempo truth.
3. **Expression / bends:** retain structural slides with an audible meaningful destination; suppress vibrato, wobble, tiny ornamental bends, unstable note-tail flicks, and detector artifacts when a pianist would simply hold/release the note. Large meaningful scream glides can become a controlled pitch slide for a flexible synth OR a stepped/legato series of nearby notes for piano. Instrument renders should not pretend a piano pitch-bends if the instrument does not support it.

## Source signal reality: the existing score cannot already do this

`tools/music/build_provisional_melody_v1.py` currently extracts f0 from the original **vocals stem** with `librosa.yin` at 16 kHz / 10 ms hop, rounds notes immediately to integer MIDI semitones, applies a nine-frame median filter, merges stable runs and renders a provisional **harmonic replacement voice**. The separate game `bitstream-performance-v1` `events.melody` schema contains `startFrame`, `endFrame`, integer `pitch`, ID, and source fingerprints. It **contains no time-varying note pitch-bend/portamento envelopes**. In-game Score Inspector is a *read-only diagnostic* score and OGG waveform view, not a verified human MIDI transcription. Its source note candidates are **provisional-unreviewed**. The V2 score validator explicitly requires unchanged melody events unless separately versioned. Simply toggling a nonexistent `pitchBend=false` field or rounding the current integer MIDI score again would produce no meaningful new interpretation.

**To hear the requested alternative later** we must work *offline* from the original **source-bound vocals audio**, preserve a 10–20 ms pitch/time contour and voicedness/confidence, then decide note boundaries and optional ornaments before converting to a new separate performance-score artifact and rendering through a chosen instrument. Do **not** change the released performance score, its hash, the actual source OGG, or any other game's consumers. Respect the existing song/stem SHA-256 identity, 48 kHz source frame clock, track segment boundaries and source duration. Store uncertainty as uncertainty (especially screaming/noise/harmonics), not as false note confidence.

## Concrete algorithm to prototype only with future approval

**A. Stable note estimation**

- Extract vocal pitch/voicedness with more than a single method or at least corroborated harmonic salience; source whispers/screams are not reliably monophonic voiced signals. Identify unvoiced consonants, harmonized/chopped hooks, multi-singer sections, and high distortion; never create fake pitch bends from silence/harmonic octave errors.
- Segment by **sustained pitch center, energy and re-attacks**, not by every 10 ms vibrato rise. Compute a robust median for central voiced frames (e.g. central 40–70% of each note); map to nearest stable semitone with optional key-aware constraints only when a key is independently established.
- Preserve real repeated notes at the same pitch and rests; don't merge them merely because pitch centers match. Explicitly retain source offsets and segment IDs.

**B. Classify each note's vocal contour by intent**

- `steady` → replace tiny drift/vibrato with one integer note held to the detected release.
- `onset-slide-to-held-target` → keep only when a sufficiently long, coherent movement arrives at a clear stable destination; allow strong scream climb and opening scoop when it is clearly integral to the melodic contour. On piano, represent deliberate multi-semitone movement as short *discrete* lead-in notes, not a literal piano bend.
- `terminal-scoop-without-next-target` → remove little final upward/downward flourish and sustain/release the stable musical pitch instead. A brief end lift that intentionally leads into the next pitched note is **not** automatically removable.
- `vibrato/unstable/unvoiced` → suppress ornamental fluctuations; retain stable note center and source onset/offset as far as detectable. If octave or pitch is truly ambiguous, flag for human review rather than inventing a confident note.

**C. Adjustable simplification, no magic single switch**

Initial *test-only* parameter hypotheses, not pre-approved values: quantization strength **0.20–0.40** for source-verified onset shifts, bound shift e.g. **≤25 ms**, favor note release preserving phrase lengths; pitch center integer semitone for a piano candidate; optional threshold ~**1–2 semitones** for retaining strong intentional target changes; distinguish tail flourishes with a tentative ~**80–150 ms** tail window and *whether a next stable pitch is reached*. These thresholds should be optimized against manually curated windows, not frozen because they sound mathematically tidy. Half-time bridge and behind-beat lyric phrasing require **different musical priors** from hard-attack chip riffs.

**D. Future controlled listening comparison**

- `A` **original vocal/song** or current source melody surrogate: reference, with no remapping.
- `B` **piano-friendly, lightly quantized**: piano/clean chiptune lead playing the *interpreted melody*, full-word ornaments omitted, big deliberate motion represented by meaningful neighboring notes. This is the option Marvin specifically asked whether he could eventually hear.
- `C` **moderately expressive**: same notes/onsets and instrument/loudness but retains only the clearly identified phrase-defining slides (or equivalent discrete piano notes). Compare to B with as few uncontrolled differences as possible.

All demos should use the **identical original accompaniment, 160 BPM style provenance, same time window, same player transport and source-tracked hashes**. The original Suno prompt requests 160 BPM and a half-time bridge, but recording timing and phase remain unverified; audition on an energetic chorus, a genuine scream/glide, a terminal scoop example and the half-time bridge before judging an algorithm. Allow listener to mark *keep glide / drop bend / wrong pitch / wrong note timing* per phrase; never promote speculative changes to a verified score without reviewed examples.

## Invariants and human approval gate

- Never alter or overwrite original vocals, original six stems, released performance score/OGG, player saved profile, or verified BeatGrid catalog.
- An optional future rendering is a separate versioned, source-hash-bound experimental score **with a distinctly named contour/simplification schema**. Do not silently insert bends into `bitstream-performance-v1` or violate the existing V2 melody-unchanged rule.
- Unit tests must cover short terminal scoop vs genuine pitch transition, stable screamed glide, vibrato suppression, unvoiced/noisy frames and octave errors, plus preserved re-attacks/pickups/half-time. Include human listening before any feature selection.
- **No audio was generated in response to this question.** Generating B/C, implementing a quantization control, or shipping it to Music Lab would require a later explicit go-ahead. This is capability/design exploration only.
