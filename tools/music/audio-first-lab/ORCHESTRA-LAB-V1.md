# Bitstream Bluffs — First eleven biome orchestra auditions

**2026-11-16. Private first-pass audio, NOT yet approved by Marvin.**

Private gallery: http://100.115.120.66:8186/
Previous untouched 231-clip library: http://100.115.120.66:8185/

## Owner direction versus Friday authorship

Marvin approved developing eleven recognizable biome orchestras with
whichever instrument/synthesis backend is most appropriate, including
non-General-MIDI methods. The nominal source bucket Guitar, Piano or Other
does NOT constrain the replacement instrument. The two unselected
source streams MUST remain audible. Pyramid Peak's previously
owner-approved lead melody must not be altered.

Actual instrument choices, mix gains and the 48 generated first-pass
audio clips are Gal Friday's unapproved creative proposals, NOT
Marvin's musical selections or approval.

## Delivered playable first pass

Two 32-second songs with eleven ground arrangements and eleven airborne
arrangements per song, plus original instrumental and optional original
Maxi vocal reference per song: **48 new, private 48kHz stereo Opus files**.

- Pope Leo Wants the AI Root Password: featured source **Other**;
  original Guitar and Piano both remain playing.
- One More Run (The Ballad of Bitstream Bluffs): featured source
  **Piano**; original Guitar and Other both remain playing.
- Eleven biomes per song, separate ground and airborne percussion.
- Original Maxi vocals independently toggleable in the WebAudio player.
- A/B original instrumental versus newly arranged biome orchestra at
  the same 32-second song-clock position.
- Every Hacker is not included until its new Maxi lead is ready.

The featured source uses detected pitched notes to drive completely
new additive/modal/FM and sampled instruments; unique source-driven
foley augments airborne drums. Existing sampled bass/kits and the
approved unchanged melody-source files are combined with original
unfeatured accompaniment stems. This is an integrated orchestral
arrangement, not one filtered stem or GM patch swap.

**Source note accuracy is still experimental.** Marvin has not
approved the novel timbres, dynamics, transcriptions or level balance.

## Eleven orchestra identities (first creative candidates)

| Biome | New featured sound and distinctive percussion |
| --- | --- |
| Debumont | Hammered warm dulcimer harmonics, wooden cabin taps |
| Garbage Dump Glacier | Tuned scrap resonators, broken metallic circuitry |
| Pyramid Peak | Plucked qanun wire strings, sistrum dust rhythm |
| Underwater Mountain | Warbling hydroglass, liquid bubble accents |
| Crystal Cavern | Sustained HoloPad harmony, subtle glass taps |
| Space Mountain | FM telemetry pings, nav-system ticks |
| Candy Cane Canyon | Miniature toy accordion, candy wrapper snaps |
| Sky Jellyfish Mountain | Aeolian wind harp, rain/breath accents |
| Steampunk Slopes | Clockwork banjo plucks, metallic gear hits |
| Micro Mountain | Wind-up kalimba, miniature thimble rattles |
| Vertigo Vents | Dark bowed-steel modal chords, volcanic steam |

These are NOT finalized, user-approved physical instrument recordings.
Creative development and future replacement remains additive.

## Exact source and private outputs

Reproducible source-only scripts under tools/music/audio-first-lab:
- render_biome_orchestras_v1.py (Python, tabs)
- validate_orchestra_auditions_v1.py (read-only checksum/decoded QA)
- orchestra-audition/index.html
- orchestra-audition/app.js
- orchestra-audition/smoke.mjs

Source branch: feature/music-four-family-prototype.
All musical assets and model weights remain outside Git.

Private CT211 workspace:
/root/bitstream-maxi/orchestra-v1-20261116/

- input: read-only copied original 32s samples from prior private gallery.
- site: current decoded-headroom-corrected, privately served 48-clip set.
- site-v1-peak89-archived: immutable initial exploratory mix version.
- render_biome_orchestras_v1_initial_peak89.py: original first renderer,
  preserved separately from the corrected current renderer.
- qa.json: initial render had two short-sample decoded peak warnings.
- qa-v2.json: final corrected 48-asset PASS report.
- render-v2.log: deterministic current render logs.

Original 231 private audition recordings were SHA-256 rechecked
against the prior QA manifest: **231/231 byte-identical**.
The approved Pyramid Peak source melody Oggs are read-only inputs.

After finding two Opus decode peaks >1.03 in the initial version,
Friday did not overwrite or delete that version; instead rendered the
new 48-clip set with pre-codec output headroom of 0.76 and archived
the earlier one. QA-v2 confirms **48/48 unique SHA-256 files, zero
decoded sample flags, consistent ~32-second duration and stereo
48kHz Opus**, plus byte-exact original Maxi vocal references.

Real Chromium private gallery smoke: PASS, with zero JS/media errors,
song and biome switching, A/B, vocals, seek and ground/air controls.
Independent HEAD checks passed for all **52** site resources.

This is NOT completed full-song LUFS/true-peak mastering; the test
decodes 2-second windows for fast screening and requires human
musical judgment. These private clips are not placed in the public game.

## Persistent private hosting

CT211 hosts audio in systemd bitstream-orchestra-lab.service bound
to loopback 127.0.0.1:8186 only. CT223 forwards its Tailnet IP
100.115.120.66:8186 to CT211 using user systemd
bitstream-orchestra-tunnel.service. Both services are enabled
and supervised for restarts.

The library lives on CT211 rather than CT223 because CT223 had
less than 1 GB free. Older port 8185 library stays exactly unchanged.

Next gates: Marvin's listening feedback and individual sound design
revisions; ear-verified notes, third-song melody, full-length 33-song
arrangements, independent commercial clearance, then gameplay integration.
