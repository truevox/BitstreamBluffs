# SIM8 33-song private original-stem biome processing — actual game integration

**Owner request, 2026-11-23:** Get the new biome processing into the same real SIM8 game that already holds all 33 original six-stem recordings plus separate biome melody voices. This is owner-directed private listening/game integration, not final mastering, a public music release or permission to replace the original stems.

## What is actually installed

- All twelve biome identities now have the original-stem DSP chain from the previous thirteen-panel listening experiment. Debutmont Snowpack, Garbage Dump Glacier Scrapheap, Crystal Cavern resonances, Sky Jellyfish, Space Mountain, Steampunk Slopes, Pyramid Peak, Candy Cane Canyon, Vertigo Vents, Underwater Mountain, Micro Mountain, and Arcade all share the native StemMusicDirector.
- A new source-only Candy character processor (saturated bright sugar, bubbly stereo treble, audition 160%) precedes the existing speed-driven Sugar Fizz (sweetness/fizz 200%); physical wrapper 200% and Pop Rocks 200% triggers stay **after** these processors and do not enter their delay/drive circuits. The owner found the earlier source difference nearly imperceptible, despite having liked physical impacts. Extra original-stem bloom is 175%.
- A new source-only Vertigo heated-stereo-wah/overdrive (105%) precedes the existing physically driven Ventforge. Rumble 200%, haze 190%, real eruption 200%, stone landing 190%, and bloom 185% follow the original listening sample. An ordinary jump never triggers a geyser: the music observes a real increase in the authoritative geyser cooldown across the same physics tick.
- Arcade uses chip-color intensity 200%, source-pulse chop 200%, extra bloom 190%, with the same effect in a standalone destination or the real generated bridge position. A 750ms clean menu transition persists without song restart.
- Scrap Clangs uses native original bass-pitch detection: clang volume 170%, source note occurrence multiplier 180%, plus 200% inharmonic stereo cowbell. The extra cowbell is a **one-shot companion**, created only after the existing original-bass-measured pitched clang succeeds. There is no new note/beat generator, no synthetic pitch substitution for missing source evidence, max three overlapping cowbells and strict cleanup on stop/menu/exit. The previously approved SPLORP, suction and landing settings are unchanged.
- Source-only longer stereo spatial tails were added for Jellyfish (tentacle reach), Space (long orbital echoes) and Pyramid (warm sandstone chamber above old 125% baseline). These are owner-requested exploratory audio differences but **not** separately mastered/approved. All physical impact event outputs bypass these new long feedback loops.
- The other biome FX, 12 separately synthesized per-song melody voices, six original accompaniment stems, user song-selection rules, music shuffle, and source clock remain unchanged. The dynamic orchestra toggle still governs only replacement performance stems, not these original-stem effects.

## Game signal ownership

- RunScene sends only read-only snapshots from the already-joined Matter collision mesh (never TerrainGenerator.heightAt), existing sampled background-bee positions, WorldDance original-source envelopes, pre/post-same-step geyser cooldown and player motion. No new physics RNG, collider, score, replay pad, authoritative meter, or hazard motion comes from any audio callback.
- StemMusicDirector owns source effects and physical landing/takeoff triggers. Gameplay-facing stage ordering is **source-only character/echo/bloom first, then existing event-capable physical biome processor**.
- Menus preserve original untouched sources and the chosen song/clock, fading changes over 750ms. The final AudioSynth compressor feeds OutputPeakGuard (sampled soft ceiling 0.965). This is **not** certified oversampled true-peak mastering and must not be described as such.
- A normal playable 33-song private runtime mounts the original OGG packs from a separate owner-authorized private archive. None of the copyrighted OGG/FLAC/WAV/MP3 media or private note transcripts is included in this code PR.

## Verification evidence

- Full original-source 33-song real-game Chromium Web Audio scan: **33/33** songs start successfully, 18 sources per pack, 12 biome-melody voices, positive live decode nodes, no unexpected HTTP errors or JS exceptions. Four known older home-biome filename 404s were properly retried before playback.
- Additional REAL game Chromium DSP chain scan: **12/12** biome identities apply the expected actual five-source Web Audio effects. It inspected Candy, Heat, Space, Jelly, Pyramid, Scrap, Arcade, Snow, Hydro, Micro, Crystal and Steampunk. Only real music and source file media were used; this is a controlled presentation-state test, not a false claim that simulation physically traversed twelve biomes in one run.
- The clean-menu browser test returns every original stem to its unprocessed chain, drops gameplay room wet, and proves song ID and clockStart unchanged.
- Dedicated ScrapCowbell tests: malformed bass candidates and missing pitch fail closed, real candidate preserves hz/440 playback rate and bounds three overlapping voices, and Director only plays a cowbell **after** the original pitched clang succeeds.
- The owner sound values are documented from screenshots and source listening notes; human approval was specific to those audition samples. Other experimental reach/character effects remain subject to owner listening and output safety approval.
- SIM8 replay source tripwire updated through its supported official attestation command as a no-causal-behavior-change read-only audio observation; canonical ruleset and SIM revision remain SIM8. New-only audio modules were registered in the explicit presentation-only native Math allowlist, leaving causal scan rules intact.

## Repeat the private browser audits

Build a full Vite game using this branch. At deployment only, mount the externally owned complete private catalog and packs under dist/music. Run the following with an available owner-authorized private game URL and unique report paths; reports are created exclusively and never overwrite a previous audit:

    GAME_URL=http://127.0.0.1:8219/ REPORT_OUT=/tmp/unique-all33.json node tools/music/smoke-all-33-current-game.mjs
    GAME_URL=http://127.0.0.1:8219/ REPORT_OUT=/tmp/unique-biomes.json node tools/music/smoke-all-biome-33-game-dsp.mjs

## Remaining gates

The preliminary 29 YIN-generated melody transcriptions need human listening for incorrect pitches/octaves and rhythm. All original drum/bass beat maps remain explicitly **unverified**; none is authorized to change timing, Gym, World Dance or physics. Real full-length 33-song continuous/transition QA, musical A/B approval, low-power device CPU, final musical balance with gameplay wind/SFX, oversampled true peaks, public media rights, source licensing and independent code review are outstanding. Do not publish original or derived media publicly or merge a draft PR as a final mastered release.

## Independent integration-review hardening (November 23, 2026)

- The SIM8 causal isolation reviewer found `TerrainGenerator.heightAt(sled.x)` inside an audio-only branch. That method can change `_lastChunk` and queue terrain, so the branch now samples existing physically joined `TerrainMesh.chunks` with `joinedMarkerHeight()`. Audio input is skipped until a finite joined geometry sample exists. The authoritative gameplay void check later in the tick retains its generator read and is NOT altered by the audio correction.
- The installed-catalog selector governs ALL AudioSynth music and procedural fallback checks. A public four-song installation with all four visible tracks OFF stays silent even if the 29 not-installed private song booleans are ON in settings; an actual private 33-song installation retains those selections.
- On an original-track change during an active Arcade bridge, newly built `arcadeglue` effect chains immediately receive the cached bridge and progress parameters. If audio is paused, the cache is invalidated for the next authoritative transition update; no synthetic timing is fabricated.
- Regression tests prove these corrected contracts, including no mutable generator height reads in the audio observation block. All source OGGs remain private. Full-song pitch/beat certification, listening, rights and mastering remain separate owner gates.

## Second independent review: playback and provenance hardening (November 23, 2026)

A second static code review after the first three corrections found five additional integration risks; all have explicit source corrections and regressions:

- **Private-only menu autoplay:** an early Title screen no longer permanently loses selected 29-song tracks when the catalog has not finished loading. A single delayed autoplay request is redeemed only after authentic catalog readiness, only in menu mode, and canceled by intentional pause, manual transport commands, stopping or a new run. Public four-song all-off stays silent.
- **Continuous effect controls across song swaps:** new source effects inherit their next authentic physical Space/Hydro/Pyramid/Vertigo signals even when the rider remains in the same zone. Only continuous parameter-suppression caches are invalidated; existing impact, gust and other one-shot latches are retained. Arcade bridge state is restored as separately described above.
- **Audio failure isolation:** independently faulted Micro-bee and Arcade audio callbacks may throw without escaping the game frame or simulation loop. The actual built Phaser/Matter Chrome test injects both exceptions, witnesses both, and confirms the real fixed simulation ticks continue advancing with no page errors.
- **Canonical beat-map provenance:** the independent verifier binds each report's declared drums/bass files to the corresponding paths in the authoritative 33-track source manifest (including the grouped-six slot 33 exception) BEFORE comparing hashes. It cannot self-verify some other song's source files simply because those other hashes match.
- **Partial PRIVATE preview validity:** a private partial-catalog staging promotion requires ALL four original source packs and at least one additional new song, not merely five arbitrary songs. Synthetic standalone Python regression controls verify both provenance guards without ever reading or exporting actual audio.

**Status distinction:** source/physics isolation and four-song public fallback are production-code review gates; private pitch interpretation, all 33 original rhythm candidates, full-song quality, intersample mastering, and publication rights are NOT certified by these smoke tests and remain separate owner/listening gates. No private audio or provisional musical note/beat transcripts have been staged to GitHub.


## Final integration-review corrections and release preparation (November 24, 2026)

- A throwing `StemMusicDirector.onLanding` is now caught inside `AudioSynth._onLanding`, so `EVT.LANDING` does not abort subsequent scoring/boost/spring logic and the ordinary SFX listener still executes.
- A run with only private tracks selected initializes its seeded procedural fallback's RNG, chord order, step and intensity before a catalog read can return early. A later selected pack failure can start fallback safely; public four-song all-off still stays silent.
- The beat verifier independently parses the FLAC STREAMINFO sample rate and count for both manifest-bound originals and caps candidate timestamps to the shorter recording plus one 48 kHz output frame of rounding. It no longer trusts the report's own claimed duration. Five synthetic provenance tests cover healthy 33-song manifests, forged source hashes/paths, overstated durations, and mismatched stem lengths.
- The original vocal room-send remains unmodified in menus and is restored on re-entry to actual gameplay (no accidental replacement of vocal DSP chains).
- This user-facing music capability prepares semantic minor release v2.20.0 (package and lockfile), with a dated numbered changelog entry. It is **not merged** until all source, browser, independent-review and owner/publication gates are addressed. If main advances before merge, re-evaluate the version and restack against the actual release base. [skip netlify] remains mandatory.
