# Bitstream Bluffs — High-Speed Air Drums V3 (2026-11-16)

**Status: private audition built, not musically approved or deployed into gameplay.**

Tailnet listening: http://100.115.120.66:8186/

## Marvin's actual direction

Marvin heard clear improvement in V2's instruments but reported persistent timing errors in drums and Guitar/Piano/Other. He specifically identified drum rolls in the Pope song exceeding ten hits per second and asked whether detection resolution was 25–50ms. He explicitly authorized a new fast-percussion revision. No completed arrangement or transcription has been artist-approved.

## Identified technical bottlenecks

Old audible Air sampled kits used a 11025Hz / 256-sample scan hop, about **23.22ms**, with **65ms minimum separation across different drum instruments**. Each peak was assigned only one drum type, losing co-hits. The old foley renderer used a 10ms analysis grid but discarded events closer than **160ms** and retained at most **125 over 32 seconds**.

Research V2 already sampled at 22050Hz / 128 sample hop, 5.805ms, with a 40ms peak separation, but that V2 analysis was **not fed into the audible sampled kits**.

## New, additive implementation

1. V3 multi-band onset analysis: source-separated original drums, 22050Hz, hop 128 = **5.805ms time grid**, minimum three STFT hops = **17.415ms** between distinct attacks, and simultaneous kick/snare/hat classifications allowed. Four-decimal-second onset data are kept; no musical grid quantization. **These are estimated, unverified events.**
2. Pope excerpt (150–182s): **280 distinct estimated attacks**, **352 classified kick/snare/hat events**, up to 28 estimated separate attacks in a rolling second. Previous V2 research: 215/272.
3. One More Run (92–124s): **389 distinct attacks**, **535 classified events**, up to 25 estimated attacks in one second. V2 research: 331/448. These increases could include errors, so counts alone do not prove musical accuracy.
4. V3 GM sampled kit re-performance uses the above event timestamps directly with sample-exact 48kHz scheduling, **not old 10ms render blocks**. Co-hits are retained, and arbitrary every-ninth-note accent substitution removed. Eleven biome kit characters remain.
5. New foley performance follows the exact same scored physical drum attacks; no 160ms gate or 125-attack cap, while overlapping kick/snare/hat co-hits yield only one physical foley trigger.
6. V2 distinct orchestral instrument timbres, existing source-derived pitched notes, original six-stem architecture and Crystal bell BOOOONG are otherwise retained. Guitar/Piano/Other rhythmic transcription is NOT fixed by this drum revision.
7. Added fourth A/B selector **High-speed drums 🥁** to the private listening page, alongside the First Pass, Timing / Envelopes and Distinct Orchestra choices.

## Isolation and QA

- New V3 version contains 48 Ogg files: 22 new Air mixes, 22 **SHA-exact copies of V2 Ground**, two original instrumentals and two optional original Maxi vocal clips that are also **SHA-exact copies of V2**. Prior gallery audio untouched; private gallery now 192 Ogg files total.
- **Ground is NOT merely the untouched original six-stem instrumental:** it preserves the original drums within the newly orchestrated pitched arrangement. Original instrumental A/B uses all original instrumental stems. Ground difference isolated exactly to zero between V2 and V3.
- High-speed detector synthetic test: separate 27ms-spaced hits, about 37/s, are not suppressed.
- Sample-exact 48k mocked FluidSynth test with 22.7ms co-hit and 49.1ms snare, no 10ms snap.
- Foley regression: three close original attacks including one co-hit preserve three distinct foley attacks.
- **3 high-speed tests passed.** Audio QA: 48 unique V3 Ogg, all pass duration/sample-rate/short-window peak integrity.
- Real Chromium A/B smoke passed with 196 HTTP resources, across all four versions, two songs, all biomes, Air and Ground, original A/B, seek and vocal toggle. No JS or media errors.
- All original masters, original sound samples, main game and original private gallery preserved; only private CT211 listening site gains new Ogg files. Source-only Git changes.

## Remaining gates

Marvin listens to High-speed drums versus Distinct orchestra with **Air** selected and reports whether fast rolls and co-hit timing are musically closer to source. Additional false positives, classification errors, and ~17ms-apart attacks remain possible. Guitar/Piano/Other timing requires separate human-guided score correction. LUFS matching and commercial licensing/approval remain pending.
