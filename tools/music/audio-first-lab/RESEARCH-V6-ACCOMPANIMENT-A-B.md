# Bitstream Bluffs — Independent Guitar/Piano/Other A/B and onset candidate (November 16–17, 2026)

**Status:** source-only Git implementation and private audible comparison; **not artist-approved** and not live game music.

Private Tailnet player: http://100.115.120.66:8186/

## Owner's direct feedback

Marvin heard the new high-speed drums and said **the drums were absolutely better but still not perfect**. He asked for a way to swap the orchestra between **stock and new** independently, and asked whether we could address the timing of Guitar/Piano/Other. This is feedback and an implementation request, **not musical approval**.

## Actual transformation boundary

In the current TWO 32-second excerpt arrangements, only ONE of the three accompaniment stems is re-performed. *Pope* re-performs Other; One More Run re-performs Piano. Guitar remains a stock recording in both excerpts, and the other unfeatured source (Piano in Pope / Other in One More Run) also remains stock. This is not a claim that all three accompaniment parts have new MIDI performances. Original stems are all preserved.

Existing Original Instrumental versus Biome Orchestra A/B changed the whole mix: source drums, source melody, and bass as well as accompaniment. It was not a controlled experiment in accompaniment timing.

## Implemented three-way switch (only under High-speed drums revision)

Under **Guitar / Piano / Other — hold all other buses steady**:

- **Stock trio:** all original Guitar + Piano + Other source recordings at their original event timing, in the same new melody, bass and selected V3 ground/air rhythm environment.
- **Current orchestra:** existing, unchanged High-speed Drums version, with one featured stem replaced by the biome-specific re-performance, preserving the other two original stems.
- **Timing candidate:** same V3 custom instrument identity, original lead and percussion/bass, but the selected featured stem is re-synthesized from an **experimental source-transient-aligned note score**.

This is not completely isolated after mastering: final output RMS matching and peak headroom may apply different overall gain, so it remains a *practical listening A/B*, not phase-null-identical backing. Selecting one control preserves the arrangement, song-clock position and active Ground/Air option. Switching to older revisions temporarily disables the accompaniment controls. The broad Original Instrumental A/B remains available and distinct.

## Timing correction design, not a claim of musical proof

Source: the original separated FLAC of the **featured** accompaniment stem, its 32-second excerpt, and the already derived Basic Pitch / expression JSON. Not the previous transformed audio.

Method: log-spectral positive transient novelty with 22,050 Hz / 128 frame hop (**5.805ms**), 1024 point window, and conservative local source attacks. Simultaneous note-onsets are clustered within 27ms. A cluster can move by at most 47ms when a strong candidate source attack occurs nearby, and only if the change exceeds 11ms. All pitches, note durations, event counts and expression estimates are retained. Strong safeguard: **one source peak per cluster** and preserve original chronological order with 12ms separation from neighbors, avoiding collapsing distinct note groups onto one transient. No automatic tempo-grid quantization or blanket shift.

Initial version had a collision risk; it was archived privately, not published. Safe revision used:

- Pope Other: 151 source notes, **63 notes** changed across 40 clusters, median shift **17.6ms**, maximum **46.3ms**.
- One More Run Piano: 299 notes, **118 notes** changed across 72 clusters, median shift **18.6ms**, maximum **46.3ms**.

**These are unverified suggestions**. A transient might belong to a different concurrent pitch, sample attack, echo or a nonpitched artifact. Neither hallucinated/wrong pitches nor missing/extra notes nor badly estimated note lengths are fixed by shifting events alone. Some edits may sound worse. The source FLAC note timing still needs listening/manual correction.

## QA and preservation

- Added two new independent gallery folders, each 48 private Oggs (22 Ground, 22 Air, 2 original instrumental refs and 2 byte-identical original vocal references), yielding **96 new gallery clips** and **288 total private Oggs**.
- Private audio auditor PASS on each 48-clip new set, correct Ogg format/48kHz stereo/32sec, 48 unique SHA-256, no short-window peak/finiteness flags.
- All four source Original Instrumental references and four Maxi vocal reference copies match those used by High-speed drums **byte-for-byte**.
- Existing High-speed drums, Distinct Orchestra, Timing / Envelopes, First Pass and the older 231-clip :8185 archive remain unchanged.
- Three alignment tests prove chord-level shift consistency, no collision of separate groups onto one attack, and no adjustment without source evidence.
- Real Chromium WebAudio smoke checked **292 resources**: 2 songs, 11 biomes, 4 orchestra revisions, all three accompaniment controls, both terrain modes, original full-mix A/B, voice toggle and seek: PASS.
- No private source FLAC, derived note JSON, soundfonts, audio previews or other model weights committed to Git.
- Private CT211 audio gallery only; no main branch, gameplay integration or original masters changed.
- Future: owner listening and manually adjudicated per-note timing edits; full stem re-orchestration for all Guitar/Piano/Other is a different and larger task; LUFS matching and rights clearance before release.

## Source

- tools/music/audio-first-lab/align_featured_source_onsets_v1.py
- tools/music/audio-first-lab/render_accompaniment_comparisons_v1.py
- tools/music/audio-first-lab/validate_accompaniment_comparisons_v1.py
- tools/music/audio-first-lab/test_accompaniment_comparisons_v1.py
- tools/music/audio-first-lab/orchestra-audition/{index.html,app.js,smoke.mjs}
