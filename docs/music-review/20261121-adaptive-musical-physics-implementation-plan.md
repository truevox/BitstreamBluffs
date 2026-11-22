# Adaptive Musical Physics: Implementation Plan (11 Biomes + Arcade)

Status: **Design for review, not shipping approval**. Authored by Gal Friday from Marvin's instructions and CC Friday's suggestions, November 21, 2026. Source branch: `origin/main` at `0c8c6c1`. This document contains design recommendations, not claims that features already exist.

## 0. Executive decision

Make the **original recorded instrumental stems** the durable musical performance; let biomes be physically reactive DSP instruments driven by real game events. Keep an optional separate biome-specific **vocal MIDI** track/renderer on its own roadmap, retain the original vocals for reference/choice, and NEVER remove the stereo masters, separated stems, or approved alternates. Optimize for music quality, recognizeable songs, phone speakers, consistent loudness, and playable musical transitions. Feature flags keep experiments reversible.

**Fundamental rule:** Game physics says *what happened*. The biome decides *what it means musically*. The audio engine never influences gameplay physics or rankings.

## 1. Verified repository baseline / integration points

- `src/systems/SimClock.js`: fixed **120 Hz** simulation; suitable for reproducible event timestamps, independent of render FPS.
- `src/scenes/RunScene.js`: emits `EVT.LANDING` with `quality`, `impactSpeedPxS`, `airtimeMs`, `hard`, `x/y`. Landing impact IS available already. Also publishes the authoritative BSOD snapshot and calls `audio.setSpeed` and `audio.setAirborne`.
- `src/systems/AudioSynth.js`: already listens to `EVT.LANDING`, `EVT.TRICK`, `EVT.BIOME_ENTER`, `EVT.BSOD_STATE_CHANGED` and other game events; owns current music/SFX master behavior. Extend with a read-only adapter; don't put audio logic into RunScene.
- `src/systems/music/StemMusicDirector.js`: retains the shared song clock and six original roles (vocals, drums, bass, guitar, piano, other). Already handles biome, speed, airborne, combo, menu, BSOD danger and effects. Preserve the same transport across transitions/crashes.
- `src/systems/music/MusicFXGraph.js`: per-stem native Web Audio effects, gain/sends, cleanup and chain crossfades. `BiomeSpaceBus.js` and `ImpulseBank.js` already provide bounded convolution-space choices. Reuse/refactor instead of replacing this architecture.
- `src/systems/music/AdaptiveBiomeRouter.js`: optional *recorded alternative stem* route gated by Dynamic Orchestra. Original-stem DSP MUST work with that switch OFF and ON; never silently require re-performed instrument MIDI.
- `src/systems/music/BeatGridTiming.js` validates independently verified source-beat positions. `BeatGridCatalog.js` currently marks the four release songs unverified; do not derive "true beat" from BPM or note onsets.
- The four release pack manifests each declare all six core stem roles. `performance.json` contains machine note events, but the `harmony` and `clock` sections remain unannotated. A full 300+ song library is NOT demonstrated by this release catalog.
- Debumont Snowpack ground/airborne behavior is a DRAFT in PR #194 (not merged). Current implementation uses static depth easing; impact-dependent rebound remains new work.
- Related efforts: issue #193 (original-stem DSP umbrella), PR #194 (Snowpack prototype), issue #180 (mono source + dynamic spatial stems), issue #50 (source downbeats), issues #65/#64 (biome progression and biome-layered BSOD). Coordinate before touching shared files.

## 2. Invariants and acceptance philosophy

1. **Performance intact:** no source retrigger, re-tempo, hidden playback-rate changes, unapproved pitch shift, music restart on biome change, dropped original stems or loss of pristine stereo masters. Parallel wet pitch effects are permitted only when clearly intentional.
2. **Distinct before clever:** each biome owns one recognizable signature axis. Avoid three "ringing bell" biomes or four indistinguishable long reverbs. A listener should identify a biome by audio alone.
3. **Reactive, not annoying:** actions are audible and immediate but do not dominate the song. Cap all resonance Q, feedback, modulation, transient energy, wet ratio and loudness changes; reduce fatigue during long runs.
4. **Transport-proof:** account for pause, resume, seek, song rollover, menu, crash, rapid biome reversals, slow motion/hit stop, missing assets and audio context suspension. DSP changes never damage the musical clock.
5. **Data honesty:** harmony confidence is not beat verification. Store source hashes and provenance. Unknown beat or harmony information must gracefully fall back, not pretend to be verified.
6. **Playback tiers:** support high-quality multistem, lightweight/mono-derived multistem or preprocessed mixes where required, and NO MUSIC; SFX remain independently configurable. Preserve original stereo recordings for future revisions.
7. **Musical provenance:** the original stem is a recording; synthesized event bells/foley are labeled derived layers. Never silently promote unreliable score events to musical truth.
8. **Deterministic control:** seeded events and tick-tagged scripted input yield the same processor decisions. Browser float DSP may differ between engines; do not promise byte-identical PCM.

## 3. Core architecture / responsibility split

`RunScene` / events + 120 Hz tick (authoritative physical state)
  -> `BiomeAudioSignalAdapter` (read-only normalized snapshots + discrete events)
  -> `BiomeMusicController` (pure policy: per-biome response, spring state, gestures)
  -> `StemFXMixer` (original-stem dry paths, bounded effect buses, room sends)
  -> existing post-mix/music bus, safety limiter/gain structure and master

`SourcePerformanceTimeline` (song frame offset from stable audio transport)
  -> optional verified `BeatGridTiming` / separate `HarmonyTimeline`
  -> `MusicEventScheduler` (sample-time scheduling, validated follow-on work)

**Do not introduce another jukebox, beat clock or global musical transport.** This is a controlled extension of the existing `StemMusicDirector` and `AudioSynth`.

### 3.1 Input signal contract

Use a small immutable, schema-validated `MusicPhysicsSnapshot` sampled from the simulation, plus typed event pulses. Proposed fields:

- `simTick` integer, `runId` stable ID, `biomeId` canonical slug, `songId` and `songFrame` if available.
- Continuous: `grounded`, `speedPxS`, `airtimeMs`, `heightAboveLocalGroundPx`, `verticalSpeedPxS`, `roughness01`, `heat01`, `bsodDanger01`, `comboIntensity01`.
- Discrete: `takeoff`, `landing{impactSpeedPxS,quality,hard,airtimeMs}`, `trick{type,count}`, `crash{cause,fatal}`, `biomeEnter{from,to}`.
- Add fields only when sourced from authoritative game facts, with unit/range contracts. Optional roughness/heat can initially be absent; biome controllers use safe defaults. Do not fabricate measurements from audio or visual-only animation.
- Derive `impact01` from tunable velocity calibration against actual landing samples (not arbitrary fixed assumptions), clamp to [0,1], preserve a separate quality/crash flag. No event means **no impulse**.
- Control plane coalesces high-rate continuous updates at a bounded frequency (e.g. 30–60 Hz), but **does not drop discrete landing events**. Use audio-param ramps at `AudioContext.currentTime`; when late, clamp schedule to now. Gameplay simulation stays authoritative.

### 3.2 Shared physical-envelope library

Create a pure `DampedSpring` primitive (bounded state + deterministic update at 120 Hz):

`x'' + 2ζω x' + ω²x = impactImpulse`

- Input: clipped signed/unsigned impulses, decay frequency/damping presets, optional repeat cooldown.
- Output: normalized displacement, energy and velocity; no audio device or Phaser dependency.
- Examples: snow burial depth envelope, jellyfish wobble modulation, candy bounce density, micro-box shudder, pressure/heat overshoot.
- Reset on song/run/scene boundary according to chosen policy; never accumulate unbounded energy over frequent landings.
- Test impulse responses against fixed tick traces, damping extremes, NaN/overflow, stacked impulses and frame-rate variation. Never use a display-frame variable delta for control physics.

### 3.3 Stem routing and effects API

- Preserve original six-role dry buses. Per-stem `gain`, `send`, `effectChain`, `spatialPosition` and existing BSOD corruption remain independently owned.
- Introduce typed `BiomeDSPPreset` and `BiomeDSPController`: `enter`, `update(snapshot)`, `onLanding`, `onTrick`, `exit`, `dispose`. Descriptors are data; trusted processor implementations are code.
- Combine shared reusable primitives: native gain, BiquadFilter, DynamicsCompressor, WaveShaper (oversampled), Delay, Convolver, stereo panner, oscillator, LFO and limited resonator banks. Use `AudioWorklet` only for sample-hold/bitcrush, granular beat repeats or genuinely necessary pitch shifting.
- Avoid graph rebuilding on every takeoff/landing or parameter update. Preallocate live routes, automate parameters, crossfade equivalent paths for incompatible states, reclaim old tails. Bound node count, DSP voices and simultaneous impulse responses.
- Ensure new DSP doesn't defeat user stem mix levels or the menu sound, alternative music routing, accessibility, master volume, or "no music" choice.
- Coordinate with #180: moving mono stems in virtual space is a **separate** concern from biome coloration. Preserve stereo original references and downmix safely for headphones, stereo, mono phone speakers and accessibility.
- Existing airborne drum ducking and BSOD guitar/piano/Other corruption already occur in the shared mixer: new biome controllers must COMPOSE with those routes, not double-duck/rebuild them or overwrite threat state.
- For the PWA/offline player, precache any shipped worklet modules and approved harmony sidecars per selected quality tier; failure to load one must fall back to native DSP or pristine stems rather than block playback.

### 3.4 Suggested implementation files and merge ownership

- `src/systems/music/BiomeAudioSignalAdapter.js`: bridge approved game event payloads into typed, immutable state; subscribed through `AudioSynth`, not gameplay logic.
- `src/systems/music/DampedSpring.js`: pure normalized, replay-testable envelope primitive. No AudioContext or Phaser dependencies.
- `src/systems/music/BiomeDSPController.js` and `BiomeDSPPresets.js`: shared controller interface plus per-biome policy objects. Keep implementation modules under `src/systems/music/biomes/` to parallelize authors safely.
- `src/systems/music/HarmonyTimeline.js` and `HarmonySidecar.js`: validation, hash-aware load and frame-indexed pitch-class lookup; optional `SourceFrameScheduler.js` uses existing beat-grid validators.
- `src/systems/music/worklets/BitrotProcessor.js`: gated by measured need with native fallback; avoid imposing a custom worklet on all biomes.
- `tools/music/analyze_harmony_v1.py`, `validate_harmony_v1.py`, and `render_biome_dsp_qa.mjs`: reproducible offline extraction, validation and real-browser output.
- `tests/src/music-physics-signal.test.js`, `tests/src/biome-dsp-controllers.test.js`, `tests/src/music-harmony-sidecar.test.js`, and browser smoke tests: schema, timing, fallback, leak and output assertions.
- One integration owner updates `StemMusicDirector.js`, `MusicFXGraph.js`, `AudioSynth.js` and the music pack schema after reviewing isolated per-biome modules. The concrete names above are proposals, not existing files.


## 4. Song intelligence: separate harmony from verified rhythm

### 4.1 `harmony-v1` sidecar (usable immediately after validation, independent of beat phase)

- Offline analyze **harmonic stems** (bass, guitar, piano and Other, with vocal/drum leakage suppression or weighting). Compute local chroma over source-frame-indexed windows (~250–500 ms as a starting comparison), optionally with harmonic/percussive source separation. Estimate whole-song or section tuning offset in cents.
- Store twelve **weighted pitch-class energies**, confidence and stability, plus optional low-register bass evidence and voiced/unvoiced flag. Do **not** rely on named chord labels or flatten each moment to only three notes.
- Sidecar provenance: schema/version, song ID, original source SHA-256, stem/input hashes, sample rate, frame count, interval start/end frame, analysis algorithm/version, parameters and explicit unverified/reviewed status.
- Smooth isolated passing notes without wiping out harmonic changes. Ambiguous segments: lower wet send, retain previous stable tuning only briefly, or use unpitched texture. Never create loud wrong-key bells merely because a detector guessed.
- Runtime `HarmonyTimeline.atSourceFrame(frame)` returns immutable confidence-ranked pitch classes and frequency candidates. Retune with parameter ramps or crossfade old/new banks, not instantaneous hard frequency jumps.
- Compare STFT/CQT chroma against existing unverified note events *as evidence*, not as ground truth. Human-listen to modulation, chromatic passages, sustained vocals, sparse sections and source-separation leakage.
- Reject stale/mismatched sidecars, missing assets, malformed arrays, non-finite values, and source revisions. Small compressed JSON/binary derived sidecars shipped only when verified to the agreed tier.

### 4.2 `verified-beat-grid` remains a different contract

- Consume `validateBeatGrid`/`nextVerifiedPulse` only when a source-matched, independently validated pulse grid actually exists; retain original source-time frame coordinates and support variable tempo / half-time transitions.
- Beat repeat, ratchet, packet-loss and Candy echoes may **not** snap to false beats. Without verified data, use perceptually safe free-running short delays, transient-driven gestures, or disable quantized gestures explicitly.
- Beat positions, note onsets, harmony windows and source audio segments are **four different data types**. Do not conflate them.
- Handle the lack of a verified fifth reference track by starting QA on the four currently cataloged sources, then acquiring/approving a fifth with contrasting style before calling the five-song matrix complete.

## 5. Full biome identity contract

For every biome, implement **grounded + airborne + impact** (and optional danger) as state transitions over the SAME original song. Each biome receives a strong **primary signature axis** and optional restrained secondary effects. Additional noise/foley is derived, quiet and independent of master music volume.

| Location / processor | Primary axis | Grounded | Airborne | Landing and danger |
| --- | --- | --- | --- | --- |
| **Debumont / Snowpack** | **Absorption** | Powdery muffled highs/attacks, bass less buried | Fast relief into dry original stems | Impact excites bounded additional burial spring; gradual resettling, proportional to impact |
| **Garbage Dump Glacier / Scrapheap** | **Inharmonic metal transient response** | Roughness- and drum-driven restrained rattles, distorted machinery | Physical contact rattles stop; tails decay | Impact excites bounded metallic modes; reject fake "chords" when confidence is poor |
| **Pyramid Peak / Echochamber** | **Reflection geometry** | Dense early stone reflections and midrange depth; bass stays clean | Predelay and architectural echo change with height | Impact low thump injects reflection pattern; BSOD modifies apparent chamber/collapse |
| **Underwater Mountain / Hydrostatic** | **Depth memory with airborne relief** | Pressure baseline climbs at each new deepest descent and never decreases inside the biome | Ascent temporarily lifts audible pressure without clearing its remembered baseline; pressure returns as rider starts falling | Full pressure is restored by touchdown with a brief impact wave; confirmed biome exit releases and resets the baseline |
| **Crystal Cavern / Harmonic Lattice** | **Stable consonant resonance** | Sympathetic bank excited by harmonic originals | Percussion retreats, bank bloom rises | Impact excites modal crystal tones chosen from confident current chroma; decays carry memory |
| **Space Mountain / Vacuum** | **Contact vs isolation** | Conducted rhythm + narrow radio-style harmonics | Contact path fades; spacious, filtered suspended wet image | Contact reconnect pulse and lower-mid harmonics; never rely only on sub-bass/stereo width |
| **Candy Cane Canyon / Sugar Rush** | **Elastic beat subdivision** | Short percussive slap echoes and springy attacks | Rhythmic bounces spread, not continuous stutter | Spring-driven shrinking-delay bounce on drums/Other only; avoid stuttering vocals |
| **Sky Jellyfish Mountain / Buoyancy** | **Slow damped-spring motion** | Soft floating modulation | Weightless slow chorus and sustained ambience | Landing wobble controls *wet-only* rate/depth; never pitch-modulate dry full mix |
| **Steampunk Slopes / Clockwork** | **Mechanical synchronization** | Ratchets/ticks lock to *verified* source rhythm | Ticking flywheel decays off-grid physically, but musical backing remains | Gear clunk + chatter then controlled re-lock; if grid unverified use non-metrical tick texture |
| **Micro Mountain / Tinyverse** | **Acoustic scale + synchronized visible bees** | Tiny box comb reflections; existing huge background bees provide positional audio cues | Apparent room opens; pan a quiet buzzing layer to the **actual visible** bee positions, rather than inventing independent flybys | Wooden 'tock' + short box shudder; bee audibility/fade follows real rendered bee locations, with mono-safe fallback |
| **Vertigo Vents / Thermal Engine** | **Nonlinear heat** | Harmonic saturation and heated mid-bass response | Hot air introduces subtle moving delay/filter haze on a send | Impact increases drive then a short steam release; continuous loudness compensation |
| **Arcade / Bitrot** | **Digital quantization/packet loss** | Bit depth/sample hold mainly on percussion, always dry anchor | Opens into cleaner digital tones or glitch echo | Seeded rhythmic dropouts and corruption correlated with **BSOD danger**, safe grid fallback |

### Signature separation / anti-sameness rules

- **Garbage ≠ Crystal ≠ Micro:** Garbage = short noisy, deliberately **inharmonic** metal transients. Crystal = sustained consonant harmonic resonance. Micro = tiny dry plucked wooden impacts and short room reflections. Garbage may use a few in-key resonances for cohesion but must not become a Crystal clone.
- **Pyramid ≠ Space ≠ Jellyfish ≠ Micro:** Pyramid changes **reflection geometry**; Space swaps conducted contact vs isolated sound; Jellyfish changes **elastic modulation**; Micro changes **scale, dryness and short reflections**. Shared reverb is secondary, not the whole identity.
- **Vents ≠ Arcade:** Vents = continuously driven *analog-like nonlinear saturation* with heat. Arcade = deliberate digital quantization and loss, explicitly rhythm-linked when verified.
- **Snow ≠ Water:** Debumont is contact-linked absorption relieved by leaving snow; Water has a **persistent, monotonic depth-pressure memory** driven by the deepest descent plus a temporary *audible-pressure relief envelope* during airborne ascent. Stored pressure never decreases until biome exit, even while the audible filter opens up.
- Only Crystal *requires* local harmonic analysis for its defining behavior. Garbage's pitched resonances, Underwater bubbles and Micro's optional motif may **reuse** the sidecar but have unpitched fallbacks.

### 5.1 Biome special behaviors / musical guardrails

- Debumont: existing Powdery .72 on instruments / .56 on bass are **prototype defaults**, not approved mix targets. Impact layer adds a temporary bounded deeper burial; avoid permanent sub-1.5-kHz dullness and make big jumps feel cathartic. Crash handling must not trap the music under a stale snow state.
- Garbage: use a small inharmonic modal bank and very short damping; avoid endless metallic ringing, high-Q feedback and abrasive treble. On phones, pitched resonances need audible midrange body; fallback to appropriately pitched/filtered metal hit samples if real-time modal CPU is expensive.
- Pyramid: existing `BiomeSpaceBus` IRs can be entry point, but dedicated early-reflection taps give clearer architectural identity; prefer high-pass on wet returns, and bound feedback. Dotted-eighth echoes require a genuinely verified grid, otherwise use a moderate non-quantized delay.
- Underwater (owner refinements, Nov 21): **Accrued pressure must build as the player reaches each new deepest descent and never decay/reset until confirmed biome exit.** Initialize a world-terrain elevation reference at entry; maintain `deepestTerrainDescentPx = max(previous, currentTerrainElevationMinusEntry, 0)` (positive-down coordinate). This is a high-water mark of depth attained, NOT total distance traveled, current rider Y, jump height, or repeated bounces. Even uphill travel never lowers it. Map to a bounded `storedPressure01` using a soft-knee curve, preserving musical intelligibility through warm lower-mid harmonics and fluid resonances. **New airborne contrast:** independently compute `jumpRelief01` (bounded, smoothed) from genuine takeoff, positive upward velocity/height above local terrain, and airborne phase; quick relief while rising, smoothly diminishing through apex and falling, reaching zero at touchdown. The *audible* control is `audiblePressure01 = storedPressure01 * (1 - reliefDepth * jumpRelief01)` with tunable `reliefDepth` < 1 so the underwater character remains. An airborne hop may open the filter temporarily but **never changes `storedPressure01`**. As descent resumes, rebuild the full pressure perceptually before/on landing; landing adds a bounded extra pressure-wave impulse and optional bubbles over the baseline. If the player dives deeper afterward, the stored baseline rises further. At confirmed biome exit, crossfade/release and only then reset the reference/high-water mark; rapid overlapping borders must not silently reset state. Missing terrain/velocity data falls back to stable pressure without inventing motion. Small bubbles may be harmonic on high-confidence chroma; otherwise use unpitched variants.
- Crystal: build 8–16 initial sympathetic modes (tune after profiling), plus capped polyphonic impact bells. Preserve decaying modes across chord changes using double-bank fades; retune from source-frame timeline, not from scene-clock guesses. Avoid strongly inharmonic bell spectra on consonant chords. Musical "conversation" is a later opt-in, NOT a hidden V1 requirement.
- Space: never intentionally imply physical sound propagation in vacuum; it is game-fiction sound design. Retain a midrange harmonic proxy for phone output and use mono-safe spatial cues.
- Candy: limit beat-repeat to drums/Other and very short windows; crossfade splice boundaries to avoid hard clicks. If beat unverified, only use free elastic transient repeats, no fake 1/16 grid.
- Sky Jellyfish: use modest pitch modulation on wet paths and long filtered room tails; deliberately avoid heavy dry chorus/sea-sick tuning. Check against pre-existing `landingRebound` game physics to avoid competing contradictory bounce cues.
- Steampunk: source beat phase cannot be approximated from 160 BPM prompts. Tick events must reference verified frames; if unavailable a subtle mechanical roughness layer can still ship.
- Micro (owner refinements, Nov 21): **the huge bees ALREADY EXIST as background decor**; do NOT add simulated independent insect paths or new visual bees. Existing `src/systems/MicroBees.js` exports pure `beesAt(scrollX,timeMs,seed)`, which the `Background` uses with its `decorSeed` for the `dew-drops` motif. Each visible bee has a stable ID, screen-space `x/y`, direction, wing phase and visibility `alpha`; at most two appear. Source the **same** camera scroll, time, seed and visual-bees-enabled flag as the actual backdrop through a read-only visual-audio adapter; map bee screen `x` relative to rider screen `x` to gentle pan, apparent proximity and screen-edge fade to a restrained, warm synthesized buzz **only on its own audio bus**, never pan the original music. Preserve bee IDs across snapshots to smoothly interpolate position, avoid popping and avoid spurious retrigger. The bees are visually in a background parallax layer, not world-positioned hazards: avoid claiming exact real-world distance/velocity or exaggerating flyby Doppler; any slight pitch modulation is aesthetic, bounded and follows observed movement. Airborne may increase bee audibility and perceived scale; grounded bee sound is quiet or fades. If the biome/motif is inactive, background bee display is off, or a bee is outside the screen, it must not have an audible ghost. Keep a mono-safe center/full-band fallback and cap loudness; never mask vocals or create a constant mosquito whine. Optional rare bee pitch cues may reuse confident chroma, with ordinary neutral buzzing otherwise. Preserve the toy-box and wood-tock as Micro's primary signature; no changes to physics, collisions or bee visuals.
- Vents: use oversampled soft-clipping with equal-power/dry gain compensation, or multiband lower-mid saturation. Clamp drive spikes; high hiss is a restrained tail, not a second permanent noise floor.
- Arcade: basic bitcrush and sample-hold may be tested before source beat verification; *quantized* glitches must wait for verified timing. Tie increased corruption to the authoritative BSOD danger signal; avoid randomized 20–80 ms mutes unless they obey repeatable seed / validated window envelopes.

## 6. DSP technology decision tree

- **Native Web Audio first:** GainNode/BiquadFilterNode/DynamicsCompressorNode/WaveShaperNode/DelayNode/ConvolverNode/StereoPannerNode/OscillatorNode support most V1 features, can be automated and offline rendered.
- **AudioWorklet only with demonstrated need:** sample-rate hold/bit quantizer, granular packet loss, custom comb/modal resonance if node budget dictates, or wet-only pitch shifter. AudioWorklet runs on the audio rendering thread; prohibit allocations, DOM/network access and heavy JS work in sample loop. Render quantum length should be inspected rather than assumed fixed. Have native/fallback paths for failure.
- **No real-time ML, mandatory LLM inference, or full-time live chroma analysis** for V1. Offline sidecar extraction is reproducible and cheaper.
- **DSP node budgets:** initial candidate maximum 16 resonators per cave and 6–8 simultaneous impact voices; profile before locking caps. Limit active convolution spaces and buffers; dispose or fade old nodes safely on fast terrain transitions.
- **Musical time vs simulation time:** AudioContext currentTime anchors the continuously playing song; incoming fixed-tick events only set envelopes and parameter schedules. For delayed quantized gestures, schedule against source-frame-aligned verified beats. Log run tick and song frame for deterministic diagnostics.


## 7. Phased execution / dependency graph

No invented calendar estimates: completion is governed by the verification gates below. All branches use distinct worktrees, a claimed GitHub issue and draft PR at start, and an independent review before merging. One shared engine owner integrates at the end; do not let agents edit the same music graph simultaneously.

| Stage | Deliverables | Dependencies and acceptance gate |
| --- | --- | --- |
| **0. Baseline + audition framework** | Freeze original assets/pack hashes; verify 4 packaged songs; reference song/traces matrix; feature flags; reusable A/B page; offline rendering/measurements; baseline regression triage | Current main / draft #194. No source mutation; a clean bypass renders the original bit-exact where possible |
| **1. Control plane** | MusicPhysicsSnapshot adapter; typed landing/takeoff/trick events; normalized impact and deterministic spring; testable per-biome controller interface; measured defaults | Native game `EVT.LANDING` and fixed tick. Must not change scores/physics or interrupt shared transport |
| **2. Debumont finish + rudimentary Arcade bridge** | Snowpack impact spring and landing overshoot, ground/airborne behavior; optional low-cost BITROT prototype **without fake beat locking**; smooth scene crossfades | #194 as foundation. Listening approval on soft, hard, rapid hop and crash |
| **3. Chroma tooling + Crystal V1** | Source-hash-bound harmony-v1 analyzer, stable 12-class timeline, confidence fallback, capped sympathetic resonance, modal impact bells, airborne bloom | 4 playable stems to start. Harmonic confidence QA and source-frame synchronization; must sound consonant |
| **4. Garbage from reused infrastructure** | Inharmonic metal bank/filtered hit alternatives, roughness-driven percussion contact, landing avalanche | Reuse #3 resonance and #1 impact/spring; distinctiveness blind A/B against Crystal and Micro reference |
| **5. Vents + Pyramid** | Native oversampled nonlinear heat chain, gain compensation; native/IR stone reflection design; gameplay gesture envelopes | No melody sidecar required; phone/mono and loudness gate |
| **6. Underwater + Space** | Pressure/filter motion and bubbles; contact/isolation sends, mono-safe midrange bass proxy and spatial mode | Chroma optional; avoid unintentional dry pitch change and phone-invisible bass |
| **7. Jellyfish + Micro** | Wet-only slow damped modulation, 2-room acoustics; tiny-box acoustic scale and staccato optional chroma motif | Damped spring and room transitions; no lookalike long-reverb/Crystal results |
| **8. Verified rhythmic DSP** | Verified beat-grid pipeline/human approval, Candy elastic bounce repeats, Steampunk ticks/ratchet, Arcade quantized packet-loss variants | Never ship rhythmic quantization until source-grid status passes; unverified source fallback is nonmetrical |
| **9. Continuous-world integration** | Biome morph routing; rapid back-and-forth crossfades, memory/tail preservation; biome-aware BSOD escalation based on BSOD position as separate world-art concern | #65/#64, #180 coordination. No duplicate clock, no graph leak, no audible jump at boundary |
| **10. Release hardening** | Five-song cross-style test matrix; mobile phones, mono/headphone/speaker listening; quality tiers; accessibility and dry bypass; documentation and staged rollout | Human listening signoff by biome and explicit owner acceptance; negative regressions resolved |

**Why Crystal before Garbage:** CC is right: harmony sidecar and resonator infrastructure should exist before designing metal instruments. Garbage then reuses infrastructure with deliberately **inharmonic** and transient-driven behavior. Vents/Pyramid are cheap parallel experiments after the common harness. Arcade can be a visually useful simple bridge early, while metrical glitches wait for verified beats.

### 7.1 Suggested issue/worktree splitting

- **Epic #193** becomes an index of subtasks, not one massive PR.
- Separate issues/PRs: *DSP test harness*; *typed gameplay audio adapter*; *spring and event scheduler*; *harmony-v1 extractor/validator*; *Crystal V1*; *Garbage V1*; *Vents*; *Pyramid*; *Underwater*; *Space*; *Jellyfish*; *Micro*; *beat-grid dependent Candy/Steampunk/Arcade*; *biome morph/BSOD*; *mobile and release QA*.
- Each code PR touches its own modules as far as possible. Integrator owns `StemMusicDirector.js` and `MusicFXGraph.js` merges to avoid agents overwriting each other. Define and approve interface contract FIRST; agents build bounded providers against it.
- Keep #194 as a separate prototype: do not add eleven implementations to that draft PR. Doc-only planning has its own branch/review. Do not merge on tests alone.

## 8. Offline and in-game acceptance harness

### 8.1 Reference inputs

- Begin with the **four** actually cataloged source packs (Pope Leo, One More Run, Every Hacker Part 2, Varmont Is Saved); obtain a fifth legitimately packaged contrasting source to complete the recommended five-track reference suite.
- Select excerpt windows with: dense percussion; sustained harmony; sparse breakdown; half-time or tempo change; dissonance/modulation; silence/transition. Keep SHA-256 of source stems and scripted event traces.
- Gameplay traces: (1) no action/ground cruise, (2) short hop and soft landing, (3) huge impact/collision, (4) long flight with trick chain, (5) rapid biome boundary oscillation with approaching BSOD, (6) pause/resume/restart and song rollover, (7) Underwater dive → jump/ascent → apex → fall/land → shallow climb → deeper dive → biome exit: `storedPressure01` never decreases before exit, `audiblePressure01` drops temporarily during ascent, returns during falling, full impact pulse on landing, baseline resets only at confirmed exit; (8) Micro: drive visible `beesAt` positions from known scroll/time/seed, assert sound source pans consistently with bee `x`, fades with bee `alpha`, never exists for hidden/off-screen bees or other biomes, and remains mono-legible/nonfatiguing with airplane/ground transitions. Vary simulation frame rates to verify event decisions.
- Render original-vs-processed with `OfflineAudioContext` in actual browser engines. Measure distinct stems, final music bus and combined music+SFX master. Automate smoke across quality settings and mono downmix.
- Any AudioWorklet processors require their own offline-compatibility checks and browser fallback tests.

### 8.2 Hard technical gates (proposed targets, adjust from measured baseline)

- **No non-finite samples, runaway feedback, unbounded growing envelopes, buffer churn or transport drift.** Stale sidecar inputs fail closed. Rapid biome and loop changes free old graphs.
- **True peak** target ≤ **−1 dBTP** on the monitored output after any necessary limiter/headroom; don't confuse raw sample peak with intersample true peak. Test full combined mix including existing SFX; confirm pre/post limiter safety.
- **Loudness** aim ~±3 LU of appropriate dry-reference passages, with human-approved exceptions for intentionally muffled/silent/danger sequences. Measure EBU/ITU-weighted gated LUFS in sufficiently long relevant windows; do not fail a one-second silence on a misleading LUFS number.
- **Clicks:** detect unexpected discontinuities across takeoff/landing/boundary and note retunes, while permitting intentional drum attacks; click detector must inspect local context rather than flag every transient.
- **Rhythmic accuracy:** verified beat-triggered gestures align to approved `sourceFrame` positions within a declared sample tolerance; no made-up quarter notes. Harmony retunes follow timestamped sidecar intervals without frame drift.
- **Audio CPU/memory:** profile on real low-end Android/Chromebook, midrange desktop and the targeted PWA path. Require zero under-runs in repeatable sessions, bounded per-block DSP costs and memory, and a documented downgrade path. Set quantitative CPU/voice caps after measurement, not guessed universal millisecond budgets.
- **Phone/mono:** low-end is supported by audible harmonics in 150–600 Hz; no important musical message encoded solely in stereo width or sub-bass. Spatial cues remain legible in mono.
- **Privacy/accessibility:** no automatic uploads from audition pages; volume/mute/low sensory-effects options honored; no global flashing/glitch audio from a disabled music setting.

### 8.3 Human listening gates

For each biome use blinded original/A/B comparisons with the SAME passage and loudness-matched reference. Ask: (1) Is it musically good for repeated runs? (2) Is the biome identifiable without visuals? (3) Can the listener hear takeoff and impact? (4) Does the song remain recognizable? (5) Does it get fatiguing? (6) Does it still work on phone? Record votes and exemplar timestamps with source hashes.

**Definition of done for one biome:** reproducible scripted offline render, supported target-browser live audition, no hard-gate failures, audible signature distinct from adjacent biomes, successful gameplay-state continuity, mobile fallback, listening approval. A prototype or plausible DSP graph alone is NOT done.

## 9. Rollback, provenance and unresolved choices

- Non-destructive feature toggle by processor/biome. Bypass outputs the original performance. Ensure songs play even if processors/worklets/sidecars fail or are unavailable.
- Source filenames and original stereo masters stay untouched. Derived filters/MIDI/synthetic bell layers get explicit provenance in manifests; preserve old arrangements for future experimentation.
- Keep a **configurable** physical-response intensity per biome, separate from overall music volume and user stem mixer. Provide an optional reduced-motion/reduced-intensity audio profile (minimal sweeps, wet effects, stutters, flutter).
- Open musical decisions requiring audition, not speculative locking: exact Snowpack ground depth/cutoff and impact response; Garbage metal sample-vs-modal blend; Crystal bank voice count and register; Pyramid impulse-vs-FDN; Space mono cue; Candy repeat intensity; Jellyfish pitch width; Micro toy arpeggio; Arcade corruption cadence and BSOD escalation curve.
- Track all changes under the existing GitHub issue and PR lifecycle. Do not mark unverified performance scores or beats as source-correct by code assertion. Existing release contracts and other agents' branches take precedence until integration review.

## 10. Immediate next execution slice

1. Review and agree on this interface plan in a **documentation-only PR**.
2. Land or independently review the Debumont Snowpack prototype (#194), then add impact `EVT.LANDING` to its **controller** instead of introducing another landing detector.
3. Build the offline testing/quality harness and deterministic spring primitive **before** multi-biome proliferation.
4. Generate one experimental harmony-v1 sidecar for One More Run; compare piano/guitar/bass/other chroma against a human audition; explicitly flag unknown sections.
5. Implement Crystal V1 sympathetic resonance + modal landing bells with a separate A/B audition. Only after approval implement Garbage on the shared bank.
6. Expand the playlist reference coverage and then the other biome processors, iterating in reviewable batches.

## 11. External technical references

- Web Audio worklet/render-quantum behavior: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet
- Offline browser rendering: https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext
- Chroma feature extraction and tuning: https://librosa.org/doc/main/api/generated/librosa.feature.chroma_stft.html
- True peak and integrated loudness standard: https://www.itu.int/rec/R-REC-BS.1770-5-202311-I
