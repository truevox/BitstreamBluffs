# Micro Mountain — miniature enclosure and actual visual-bee stereo sound

**Status:** draft sound-design experiment; human audition and integration review required. Implemented on a distinct stacked worktree/PR following Hydrostatic draft #252 / Scrapheap #221 / Snowpack #194. Issue [#254](https://github.com/truevox/BitstreamBluffs/issues/254); underlying design PR #200. No changes to existing owner-liked Scrapheap or Underwater DSP defaults.

## Source-grounded identity

Marvin's established Micro Mountain design has an RC-sized sled in Pete's pollinator space, with normal bees rendered *enormous* beside the miniature rider. `src/systems/MicroBees.js` **already** exposes the deterministic on-screen bee positions `beesAt(cameraScrollX, runTimeMs, Background.decorSeed)`; `Background` draws those very bees. The owner suggested miniature-enclosure music that expands in flight, impacts shaking the box, and panning the bees already present in the background. This implementation does not create a second random bee population or assert that bee animation has any effect on physics.

## Sound pipeline

- Native `microbox` Web Audio processor runs on **all five original recorded instrumental source stems**, with shared owner-liked boxiness. A highpass/lowpass miniature resonator and two **11 ms / 26 ms** tight reflection taps make grounded audio constrained and close; a little compensated gain prevents the bandpass from collapsing volume. The processor is parameterized with `openness` 0–1, `boxiness` 0–1.8, `impactWeight` 0–2. Each rise to airborne sets openness to 1 once; touchdown returns to 0. It does not retrigger, rescore, transpose or change a single source sample or transport timestamp. The separate MIDI-derived vocal melody remains on its existing pathway.
- Real physical noncrash landing produces a deterministic **320 ms plastic rattle/clack** on the original drum processor. No source transient needed, maximum three concurrent voices, complete disposal on graph teardown. Its actual trigger uses the same authoritative `impactFromLanding` as Garbage and Underwater. **It isn't a song beat.**
- Independent `MicroBeeAudio` creates at most **two bounded, low-volume filtered sawtooth wing buzz voices**, panned by the **actual existing visual bees' screen X relative to the rider's screen X**; `alpha` also fades the gain near offscreen edges. This is deliberately an environmental Foley layer, not a replacement for one of the original music stems. RunScene samples `beesAt` after `Background.update`, using the *same* camera scroll X, scene time, visual seed and Micro-only motif/visibility; it never invents a second bee layout. The AudioSynth/StemMusicDirector path is read-only and runs outside the game physics and scoring systems.
- Bee voices are allocated **lazily only when the first actual visual bee is visible in Micro**, muted when no bee is on-screen or the song stops, and stopped/disconnected on confirmed biome exit, menu transition and final destruction. Pausing proactively mutes them even if RunScene stops sending position updates before the next rendered frame. Frequency/pan/volume automation is thresholded and cancels prior target events, with a WeakMap cache so native AudioParam objects are never monkeypatched. Max two voices, and screen-relative pan bounded [-1,1]. Not 3D HRTF or an authorized claim that bees are attacking the rider.
- All source master recordings, original separated instrument preview files, pristine stereo masters, separate MIDI vocal melody, music clock and game physics stay intact.

## Demo and measurements (Nov 22, 2026)

`tools/music/microbox-audition.html` is a source-backed browser lab. It plays the **same five original preview stems** and exposes boxiness, room openness, physical box shake, dry compare, and a bee-position visual strip driven from the original pure `beesAt` function. Camera and rider position sliders are **simulated** coordinates for audition; the actual game receives its real camera + scene time + real rider X. Bee intensity is independently adjustable. Screen graphics display only bees actually returned by `beesAt`; if none are in the screen window the audio disappears.

Chromium `OfflineAudioContext` with the **real five original instrumental recordings**, three-second excerpt, game mix gains and 48kHz decode:

- Full original dry mix: **RMS 0.02566**, sampled peak **0.17309**.
- Grounded tiny-box mix: **RMS 0.01451**, sampled peak **0.23614**, difference vs dry **RMS 0.02536** (deliberately substantially different, not a same-volume claim).
- Open-air flight mix: **RMS 0.02183**, sampled peak **0.16741**, difference vs grounded **RMS 0.02133**.
- Landing rattle difference vs same grounded music: **RMS 0.00603**; original drums stay untouched.
- Existing deterministic on-screen bee with rider at left: left channel bee RMS **0.00014**, right **0.00118**. Same bee but rider at right: left **0.00104**, right **0.00004**. This verifies actual panner direction. It does **not** establish human-audible bees at every phone speaker volume.
- No nonfinite samples or sampled clipping in these test renders. These sampled peaks are **not true peaks**, not long-run game loudness certification, and not a substitute for listener evaluation.

**QA:** related Jest tests cover true visual bee positions, stereo panning, zero sound outside Micro, maximum two voices, cleanup after destruction, no unbounded automation events, real takeoff→landing edge and physical landing, native box filters and bounded one-shots. Built Vite player and Chromium browser smoke gate the preview. **Nothing merges until a human hears it and the stacked dependencies are reviewed.**

## Owner's listening questions

1. Does the grounded mix feel like music playing inside a tiny physical enclosure, *without* losing too much of the song?
2. Does a jump feel like the enclosure opens rapidly enough and closes decisively on landing?
3. Is the rattle a believable little plastic box shake?
4. Are the bees audible enough to notice moving left/right without masking the music? They should follow visible bees, not an endless synthesized swarm.

## Positive owner listening feedback — provisional Micro defaults (2026-11-23)

**Direct owner statement:** “This sounded pretty good with a bee buzz intensity of 150%. I think the stereo sounded OK.” His screenshot displays **Miniature enclosure intensity 135%**, **Room openness 0% (closed)** and **Box impact strength 100%**. The screenshot also has disabled playback/impact controls, so it cannot establish that music was playing at the captured instant; the accompanying statement attests to an earlier listening test. The phrase “I think” is a qualified positive reaction to stereo positioning, **not** final signoff on spatial mix.

**Gal Friday provisional interpretation, not a Marvin directive to merge:** use **135% enclosure** and **150% bee buzz** as game and audition starting levels while retaining all sliders and existing 100% landing-box-shake setting. Unlike the original initial `orchestraPreset` (bass .65, other stems 1), the old demo applied its enclosure slider **equally to all five original instrument stems** during playback, including bass. Consequently, to reproduce the **heard** 135% demo in the actual game, each original instrument gets `boxiness:1.35`; this avoids quietly giving the bass different audio from the reviewed browser comparison. The original bee Web Audio gain is unchanged; only its default intensity rises from 1 to 1.5. The independent bee stereo panner/visual positions remain exactly the same. No source recordings, vocal MIDI-derived melodies, earlier liked biomes, game physics or clock are modified.

**Acceptance and provenance:** retain draft PR #255, issue #254, and audition PR #201 until independent code review, owner decision on final stereo feel, mobile speaker/headphone and real-game validation. Snapshot values and positive feedback are owner-sourced; defaults are Friday's recommendations.

**Updated original-five-stem Chromium regression at those defaults (2026-11-23):** dry RMS 0.025662; grounded closed 135%-box RMS **0.013923** (sampled peak 0.221413); airborne open RMS **0.021523** (peak 0.167414); closed/dry difference RMS **0.025608**; closed/open difference **0.022204**; box shake difference **0.006026**. Bee left-of-rider dominant right channel RMS **0.001771** vs left 0.000211; rider moved to right of bee dominant left 0.001554 vs right 0.000063, at **150%** ambient intensity. All finite, no clipped sampled values in these short passages. 166 tests in 18 suites and built Chromium UI smoke passed. No claims of whole-song true peak, actual phone speaker audibility or final production approval.
