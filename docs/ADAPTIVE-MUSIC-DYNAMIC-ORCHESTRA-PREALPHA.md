# Bitstream Bluffs — Four Songs and Dynamic Orchestra Pre-Alpha (2026-11-17)

**Owner-approved deployment scope:** Marvin requested all four full songs on GitHub `main`, despite provisional note timing; he explicitly expects later re-renders and is currently the primary player. No source FLAC masters or independent private audition results are overwritten.

## User-facing behavior

Game Settings includes **DYNAMIC ORCHESTRA**, a persistent ON/OFF choice with a small magenta **PRE-ALPHA** badge **beside the toggle**. OFF is the default, including existing save records without the setting. Only an explicit Boolean `true` enables experimental mode.

- **OFF:** All five original instrumental sources (`drums, bass, guitar, piano, other`) remain the original six-stem recordings, with all normal biome-specific DSP processing still permitted on their source-instrument buses (EQ, filters, space/reverb, tremolo, distortion, etc.). The separately synthesized melodic lead continues to have a biome-specific sound. The original vocal can still be explicitly enabled as before. The toggle prohibits ONLY new instrumental replacement recordings, not processing the source. Gameplay volume automation remains active: bass gets quieter when speed falls; the original recorded drums duck during airborne phases; combo/biome progression and audio volume settings continue.
- **ON:** The three named accompaniment stems `guitar, piano, other`, the bass, and airborne percussion are all crossfaded to **actual newly generated, full-length, biome-specific replacement recordings**; NOT merely filters on the originals. Ground drums remain original until airborne. Melody gets the corresponding newly synthesized biome voice in both settings. The five original instrumental stems continue to be decoded underneath for smooth fallback, but are faded down when their new counterparts are active. Missing or late alternative clip → original source retained rather than music being silenced.
- **Mid-run switching:** The active song and source-clock position are maintained; every original-to-alternative change is a crossfade, not a song restart.
- **All four songs switched OFF:** Absolutely no music, regardless of Dynamic Orchestra setting. SFX continues. The saved all-off rule remains effective after reload.

### Four original complete songs on main

1. Pope Leo Wants the AI Root Password
2. One More Run (The Ballad of Bitstream Bluffs)
3. Every Hacker (Runs Out of Code) — Part 2
4. Varmont Is Saved

Each pack has 6 original sample-aligned full-length Ogg/Opus stem families and 12 biome melodic voices (eleven real mountain voices plus home), all segmented into the same 12-second sample-counted chunks. *One More Run's* original eleven stems were previously grouped into a non-destructive six-stem game derivative. No original source masters or WAV/FLAC music were committed—only the user-requested compressed game derivatives. The existing four-song selector and song-name toast remain in place.

## Reversible full-song renderer

This **pre-alpha** is intentionally an engineering integration, not a polished transcription. User explicitly authorized provisional timing and future replacements.

- Standalone model-free pitch and transient extraction from user-supplied original separated stems, not research-only SheetSage licensing.
- Seven audio domains: original voice melody source, featured accompaniment re-performance, two additional independently detected/source-conditioned accompaniment parts, bass, airborne drums, preserved original 6 stems.
- Guitar/Piano/Other are each **separately detected and independently re-synthesized** for every mountain; each part has its own original/new crossfade bus. V1 featured family and V2 two additional family assets are intentionally distinct.
- Dynamic replacements include **11 biomes × 4 songs × five instrumental role sets** (3 accompaniment, bass, drums). New biome melodic voices exist for all eleven; 1 home melody voice per song is provided separately.
- All scores are **automatic hypotheses**, not verified notes. Attacks and repeated strikes may be wrong. Do not claim this renderer fixes the original Pope rolls or accompaniment event placement. We expect to re-render the same versioned segments after improving source score timing.

### Code and rebuild paths

- `src/systems/music/DynamicOrchestraPresets.js`: lab-independent, reversible biome sound colors and source FX policy.
- `src/systems/music/AdaptiveBiomeRouter.js`: six reusable role buses (`featured,bass,drums,guitar,piano,other`), enabling replacement of all three accompaniment groups without double-routing the featured role, original-source fail-safe and 200ms crossfades.
- `src/systems/music/StemMusicDirector.js`: user toggle, preserved original stems, source DSP active in both modes, replacement stems gated by the toggle, tempo-dependent bass and airborne drum attenuation independent of source/replacement choice.
- `src/systems/music/MusicPack.js`: validates six role maps, source path safety, 42 stable source budget + 6 adaptive mixer buses.
- `src/ui/MenuList.js` and `src/ui/Views.js`: warning-badge support and Pre-Alpha label adjacent to switch.
- `src/systems/SaveStore.js` / `src/systems/AudioSynth.js`: strict default OFF and persistence.
- `tools/music/build_provisional_melody_v1.py`: model-free YIN isolated-vocal melodic notes and lead synthesis.
- `tools/music/render_full_dynamic_orchestra_v1.py`: main full length four-part source-conditioned biome replacement set (featured, bass, drums, melodic voice).
- `tools/music/render_additional_instruments_v1.py`: independent full-length guitar/piano/other parts not selected as main featured per song.
- `tools/music/install_full_dynamic_orchestra_v1.py`: clean staging full install of six newly performed roles, two independent render roots.
- `tools/music/upgrade_full_dynamic_orchestra_v2.py`: idempotence-safe, V1-only metadata conversion after adding the independently rendered other two parts.
- `tools/music/validate_full_dynamic_orchestra_v1.py`: source hash preservation, all audio paths and sample durations, full four-song/eleven-biome manifest QA.
- `tools/music/smoke-real-dynamic-orchestra.mjs`: actual Chromium/WebGL game smoke, PRE-ALPHA badge + default OFF, source preservation, actual new streaming buffers ON, air/bass ducking independent, ON→OFF no rewind, and all-four-off silence.

**Release constraints:** User has explicitly requested publishing compressed derivatives on main in a publicly hosted game's asset directory. Source masters, private note/transient reports, original audition excerpts, model files and unapproved individual lab reference recordings stay OUT of Git. The source-only music lab feature branch remains separate from game integration.

## Approvals and limitations

The owner did **not** claim sound quality was approved. He explicitly accepted future re-rendering after timing refinements. Treat this as **PRE-ALPHA**, OFF by default, with a clear reversible toggle. Future upgrades may swap score data and regenerate the same per-song/per-biome/per-stem segment paths without modifying the sound engine, while keeping original stem audio available.

### Verified build and playback QA (2026-11-17)

- **Four full-length songs; 4,745 committed-candidate 48kHz stereo Ogg/Opus audio chunks**: original six stem recordings plus one home melody stream per segment = **455 intact source/home chunks**; **4,290 independent biome replacement clips** across all eleven mountains and five instrumental roles plus eleven separate melodic voices.
- **Every one of the 390 six-stem original Opus files SHA-256 identical** to the earlier user-approved private source pack. All release media paths and 12-second sample frame alignment verified; ffprobe checks for representative beginning/middle/end of each instrumental family passed.
- **54/54 focused Jest tests passed across six suites** (pack validation, router, source mixer, user choices, pre-alpha behavior, full fallback).
- **Real Chromium/WebGL integration passed** on private QA build: the 4-song catalog, accurate Now Playing HUD and all 12 melodic voices loaded; magenta PRE-ALPHA badge rendered beside toggle without overlapping; OFF is default, all five original instrumental stems retain their non-empty biome effects chains and standard room sends, but no replacement session plays; turning ON starts all five actual independently generated Crystal Cavern instrumental replacement recordings; turning OFF restores source originals without changing the song clock or rebuilding/bypassing their FX; all four songs disabled stops all music with SFX still working. No HTTP failures or browser exceptions.
- **Production Vite build passed.** The legacy broad-repository test suite has unrelated preexisting failures; do not claim full-suite green.
- **The original FLAC/WAV master sessions, private transcription evidence, alternative audition clips and model/research weights remain outside the release.** These are user-authorized *provisional* public game-derivative Ogg assets, not finished musical mastering.

### Owner clarification — November 17, 2026

Marvin clarified that **anything dynamically processing the original stem is permitted when Dynamic Orchestra is OFF**. This overrides the earlier too-strict dry-stem interpretation. The **only prohibited operation** is substituting separately re-rendered Guitar/Piano/Other, bass or drum instrument parts. The synthesized biome-specific melody remains active in either mode by prior explicit design. Filters, EQ, distortion, tremolo, echo/reverb, room sends, ducking and gameplay effects belong to the original stem DSP path and remain active regardless of the toggle.

Production source/music commit was independently verified on GitHub main before this clarification; this is a correction in the subsequent source-only patch. The PRE-ALPHA status remains visible.
