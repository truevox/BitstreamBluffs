# Arcade as BOTH musical bridge glue and a future standalone biome

Draft by Gal Friday, 2026-11-23. Issue #279. Owner explicitly requires both roles and deferred whether one or two effects. Design decision: ONE coherent, source-driven Arcade processor with two independently selectable modes. No owner listening approval yet. Game branch stacked on Pyramid #277, Space #275, Candy #271, Vertigo #268, Jellyfish #265, Steampunk #263, consolidated five-biome #261; main-based static listening PR #201 separate. Avoid double-merge of overlapping feature stacks.

## Source-grounded canonical gameplay

Issue #65 is merged. Actual terrain begins in canonical Debutmont. The legacy Debumont alias remains valid. Arcade is currently a real terrain bridge (NULL biome) inserted when consecutive sector biomes differ, NOT the starting terrain. The authoritative TerrainGenerator.bridgeSpanAt(x) yields startX/endX/fromId/toId; the pure BiomeTransition.bridgeProgress span drives the same physical 0–25% outgoing dissolve, 25–75% all-Arcade corridor and 75–100% incoming reconstruction used by the actual visual presentation. Each bridge consists of bounded, snapped whole terrain chunks. Unlike the visual reduced-motion setting, audio reads geometry independent of presentation. The true generator does not currently choose Arcade as a full destination sector: this patch ONLY makes the source audio ready for that future possibility.

The preexisting AudioSynth._enterRunMusic selected Arcade immediately at run start, despite real terrain starting in Debutmont. It now selects Debutmont music as soon as run starts, preserving the existing song clock and the subsequent actual BIOME_ENTER routing. The menu retains its original clean soundtrack.

## One engine, two sound roles

A native arcadeglue Web Audio source processor is registered for the bitstream-bluffs voice identity, retaining unity-dry pathways for all five synchronized ORIGINAL stereo recorded instrument stems. Optional parallel FX re-process the source waveform with deterministic stepped quantization (18 levels), highpass chip texture, source-fed amplitude pulse and two short left/right panned chip echoes. This does NOT invent new notes or beat events, replace the independent pre-existing voice:bitstream-bluffs melody lead, change a stem's recorded pitches/attacks, rescore MIDI, shift the original six-stem clock or change actual physics.

Standalone Arcade: the same source processor holds full, adjustable neon glitch-chip ambience when selected as an independent biome identity, for a future full Arcade sector without rewriting audio.

Arcade bridge: the optional read-only RunScene post-position observation reports true generated Arcade span geometry to AudioSynth and StemMusicDirector. On actual Arcade identity only, in active/unpaused run music, an exact finite progress value from 0 to 1 scales the existing Arcade source-wet signal. It is delicate at physical entrance and exit, building toward the full-chip sound in the 25–75% middle, fading as the target biome reconstructs. The actual next BIOME_ENTER installs that biome's own source-stem processor through existing fade, retaining the song clock and voice-source synchronization. No invented bridge duration or beats, and no gameplay writes. Menu, paused transport, wrong biome, stopped playback, NaN/nonfinite or out-of-range progress reject updates. Repeated same progress does not trigger repeated Web Audio control updates.

## Proposals to listen to (NOT owner approved)

- Arcade chip intensity 125% initially; 0% restores source sound and 200% gives meaningful stronger coloration.
- Original-source chop 120% initially.
- Bridge demo progress 0%, 25%, 50%, 75%, 100%; standalone demo full persistent Arcade identity.
- Dry A/B and isolated original drums. Static audition reuses previously existing synchronized original Pope MP3 instrument preview clips unchanged by relative URL only.
- Original game and numeric audio QA instead use original One More Run OGG; do not assign the OGG measurements to the different hosted Pope excerpt.

## Actual QA and limits

- Real Chrome OfflineAudioContext 48kHz, first 3.5 seconds of authentic One More Run original OGG 5-stem source: original dry RMS .0447687 peak .4015 at the same test mix gain. Full Arcade at default 125% and full bridge center: delta 17.438% of dry RMS. Actual bridge ends at 0/100%: 1.613% of dry RMS. Cranked 200% standalone: 29.703% of dry RMS. Intensity 0%: 0.0000045% difference (numerical only). Tested sample peaks .442 default and .491 at max, no overflow in this short excerpt. Those figures measure source audio differences, NOT human audibility/loudness approval or full-song true peak.
- Real Chromium original One More Run OGG source audition passed desktop/mobile controls, dry, solo, both modes, scrubbed bridge progress and cleanup with zero browser errors.
- Actual compiled game with original One More Run release OGGs boots to RunScene and cycles all 12 original-source musical identities (11 mountain biomes plus Arcade), preserving clock and retiring all 25 existing crossfade FX chains to zero. Arcade exercised as true-bridge-shaped progress at seven positions and standalone. Programmatically injected values at actual audio boundary are NOT evidence of a human rider actually crossing a bridge.
- Existing terrain bridge-span and Debutmont-first unit tests independently prove the actual geometry and starting biome; new Arcade-focused tests validate both modes, original source persistence and invalid/paused/menu rejection.
- Original media, release OGGs, MP3 preview stems, vocal masters and separate MIDI leads were not altered or staged. Test-only OGG files are exposed via read-only symlinks in ignored disposable dist.

**Release gate:** independent code review, owner playback and feedback, and deliberate nonduplicated merge path. No new biome gameplay/content and no merger authorized by the user.
