# Issue #212 — World Dance visible audition candidate

Separate draft on #322 corrective head df11f055. Do not merge or set final amplitude without owner visual approval. The original audio analyzer, onset timestamps (including Steampunk sound accents), synthetic cosmetic meter, transport, gameplay code, and replay ruleset are unchanged.

Visual transfer: p -> 4p/(1+3p), bounded, monotonic and neutral at zero. Sun ellipse radius deltas are +8p/-6p at radius 40; decorative horizon sway is bounded at 8 px before motif scaling. Candy canes bend, lollipops bob, jellyfish compress/lift, gears rock, grasses bend, ringed planets expand and vents breathe. Debutmont pixel ridges and snow, Glacier debris and the Arcade art sun also receive frame-local visual energy. No flashing/color change, camera motion, or collider writes.

Unit diagnostic at settled original-mix fixture strength 0.042: 1.19 px sun radius change (previous 0.202 px). Strong transient fixture strength 0.259: +4.666/-3.500 px radius change (previous +1.244/-0.933). Actual decor geometry tests confirm >1 px response at 0.26 for all six decorated motifs. Existing horizon-only diagnostic still distinguishes decor anchored to horizon from independently moving objects.

Live Chromium, actual original One More Run: 115 sampled frames, 89 transient-pulse samples, peak raw strength 0.798. Pixel sun stripe width 80/88/96 px, height 65–76 px; near ridge y 94–100 px. Mute, OS auto reduce motion, explicit motion reduction, explicit override and World Dance OFF all passed. Initial run failed because the old probe expected an ellipse outline in the pixel skin; corrected probe measures actual stripe draws and ridge y, not synthetic values. 88/88 focused tests, source tripwire and build identity unchanged. This is draw-coordinate and functional browser evidence, not owner acceptance of the visual look.

Remaining: matched-time 1x real gameplay ON/OFF capture or A/B audition page, live coverage in other motifs, Chromebook performance and owner's visual intensity approval. No Netlify preview or public media changes; no version bump until a reviewed release.

## Matched public-source audition

New `tools/world-dance-matched-ab.mjs` captures two actual rendered frames from a single stepped game frame and one live original public song transport. Left redraws Background and BiomeFx at zero dance, right retains current scenery dance; the remaining game UI/billboard is the same on both sides. Restores the live presentation before the next actual game step. Same exact sled x/y, run clock, camera, source clock/token on each pair. No audio saved or private recordings used. 96/96 nonblank and pixel-distinct pairs, 480x270 per arm, peak raw strength .851, natural zoom 1→.8, 8.879s real source clock elapsed (4.025s game time; software-rendered capture is slower than real-time gameplay). Silent GIF duration 8.969s, median 8,842.5 changed pixels per pair, maximum 16,124. These counts describe screen differences, not an exclusive measure of perceptual motion. Owner audition remains pending; real normal-speed Chromebook performance and broad biome traversal are not established by this capture.

Reproduce with complete public music assets (see #323), loopback game URL and a new local output directory:
```sh
GAME_URL=http://127.0.0.1:8220/ REPORT_OUT=/tmp/world-dance-paired-new node tools/world-dance-matched-ab.mjs
```

## Second audition: owner rejected first amplitude

Owner feedback: "The gif is fine as long as the movement is enough to see. Right now it really isn't." Follow-up: "Do it. Every dance needs to be 'readable'." This authorizes a much stronger candidate, not final visual approval.

The separate scenery peak follower attacks with a 32ms exponential time constant (~74ms to 90%), holds 105ms, then releases with a 145ms time constant (~334ms to 10%). It resets immediately on the same unavailable/disabled/seek/revision conditions as the original detector. The detector's strength, onset timestamps, synthetic meter and billboard response are unchanged. Scenery transfer is 5p/(1+4p). Near/far Debutmont ridges rise at most 20/12 native pixels and stretch vertically around their original lower edge, not merely translate. Procedural horizons deform up to 30px before motif scaling; stronger individual planet, cane, lollipop, jellyfish, gear, grass, vent, snow, debris and Arcade-sun movement. All six decorated motifs and all eleven procedural horizon motifs exceed 6px displacement at fixture strength .26; zero restores their exact old geometry. This is a quantitative gate, not proof of owner-perceived readability.

Actual original public One More Run: 96 matched rendered pairs, near ridge 5–19px rise, median 13px (v1 median 3, max 6). All pairs nonblank and distinct; median 16,403.5 changed screen pixels (previous 8,842.5). New GIF ~14.1s, 6.8 unique frame pairs/sec under software rendering; encoded at 15fps without claiming interpolated frames as observations. Live independent browser smoke confirmed 19px maximum rise, 80–96px stripe width, 61–76px height, and neutral mute/OS reduced motion/explicit OFF. No audio or GIF committed. Temporary Tailnet-only static preview serves only silent imagery. 100/100 focused tests pass. One renderFrame call changes causal-source tripwire, attested presentation-only; SIM9 ruleset unchanged. Remaining: subjective approval, live biome-wide audition and Chromebook performance.

## Third audition: more motion

Owner reported V2 was visible, but requested even more movement. V3 expands anchored Debutmont near/far ridge lift to 36/22 native pixels with opposing 20/12px tile sway. Transfer 4p/(1+3p) preserves stronger contrast against troughs; visual hold and detector stay unchanged. Procedural horizons now have up to 45px bounded offset before motif scaling; all six decor and eleven procedural horizon fixtures require >8px displacement. Sun squash, planet, cane, jellyfish, gear, grass, vent, snow, debris and Arcade movement increased. No RunScene or audio clock changes relative to V2.

100/100 focused tests and unchanged SIM9 build identity pass. Real public One More Run paired capture: 96 matched nonblank pairs, 95 distinct (first neutral frame), near ridge min/median/max 0/22/34px, previous median/max 13/19. Median changed screen pixels 21,431; actual capture 15.86 unique pairs/sec, ~6.05s silent GIF encoded at 24fps. Removed redundant third render and artificial interframe wait while retaining same-state comparisons. Live original recording browser smoke: pixel sun width 80–112px, height 50–76px, ridge peak 34px, mute and motion gates pass. New owner-only Tailnet preview; no private music or visual media committed. Await visual taste approval, broader live motif and device performance testing.

## Fourth audition: independent Steampunk and Jellyfish readability

The first two motif-specific candidates add a permanent asymmetric reference spoke to each gear (otherwise periodic teeth obscure rotation), a bounded 1.4 radian rock, stronger jellyfish lift and squash, accent-linked tentacle contraction, and phase-varied accent gains. Phase variation is not a true delayed envelope. No physics, audio or meter change. Independent tests measure keyed spoke endpoints with fixed axles and individual bell lift/width without horizon movement; 106/106 focused background, World Dance and ruleset tests passed.

The matched capture runner accepts AUDITION_BIOME for controlled production-look selection on the real Debutmont run. This is not natural traversal of the named sectors. Actual public One More Run, 96 matched 480x270 frame pairs per motif, no page errors: Steampunk peak visual envelope .879 over 6.15s audio; Jellyfish peak .695 over 4.73s. Silent owner audition only; no audio or media publication. The rest of the motifs, normal gameplay traversal, fresh accessibility browser checks and Chromebook performance remain pending. Final amplitude and art changes remain subject to owner approval.

## Fifth audition: Candy Cane Canyon

Owner feedback on V4: "Hehehe, I love it! The jellyfish look so happy jumping around! On to CCC!" This is favorable V4 audition feedback and permission to continue, not blanket merge approval.

Candy canes bend with a rooted quadratic curve, reach up, and vary accent gain by item. Lollipops hop and sway while growing and spinning, with stems remaining attached. Same neutral geometry and no changes to physics, audio timing or other motifs. Independent motif tests require >19px hook displacement and >4px stretch, >15px lollipop lift, >13% growth, perceptible spiral rotation and planted roots at .26 input without horizon movement. 108/108 targeted background/dance/ruleset tests passed.

96 matched rendered pairs, original One More Run, 480x270 per arm, peak visual envelope .863 over 5.34s audio, no page errors; silent ~5.33s Tailnet audition at 18 fps. Controlled production-look selection on Debutmont terrain, not natural traversal; owner visual feedback, fresh live accessibility check and Chromebook performance still pending. No media committed.

## Sixth audition: Micro Mountain

Grass uses an envelope-gated travelling spatial wave with per-blade phase variation, larger height-scaled lateral sway and a quadratic bow. Roots stay anchored and attached dew moves with its parent blade; bee behavior and unrelated motifs are unchanged. This is phase variation, not a delayed audio envelope. Independent tests require opposing tip shifts beyond 15px in the typical accent fixture, vertical bow, >8px dew displacement, fixed roots, unchanged droplet radii, direction reversal over a half wave, and exact neutral geometry. 109/109 targeted background/dance/ruleset tests passed.

96 matched actual game render pairs using original One More Run, native 480x270 per arm, peak visual envelope .783 over 4.94s audio, no page errors; silent ~5s Tailnet audition. Controlled production look on Debutmont terrain rather than natural traversal. Owner feedback, fresh accessibility browser checks, Chromebook performance and remaining motifs pending. No media committed.

## Seventh audition: Candy Cane rebound

Owner feedback: Candy canes looked like they were stretching; requested more back-and-forth boing. Steampunk, Sky Jellyfish and Micro Mountain look good to owner. Leave these three unchanged.

Candy stem now bends along a constant-length circular arc, with a signed envelope-gated oscillation (165ms/radian, about 1.04s/cycle) and individual phase offsets. The hook follows the tangent at the tip as a rigid shape. No vertical stretch; the cane bows down as it bends. Lollipops unchanged. Tests sample 25 phases, require >15px tip displacement to both sides for each visible cane at .26 input, fixed roots, stable stem length and hook dimensions, no vertical elongation, neutral geometry with dance off. 109/109 targeted background/dance/ruleset tests passed.

96 matched actual game render pairs, original One More Run, peak visual envelope .804, 6.94s audio span, no page errors. Controlled CCC look on Debutmont terrain, silent Tailnet audition. No media committed; remaining live accessibility and Chromebook checks pending. This oscillation is amplitude-gated by music rather than phase-locked to beat timing.

## Eighth audition: Vertigo Vents

Owner feedback: "Candy cane looks NICE and boingier. Keep going." Record positive V7 audition feedback; leave the four accepted motifs unchanged.

Vertigo decorative steam now visibly breathes via height and radial expansion, with larger billowing older puffs and slight local phase variation. No lateral displacement, brightness change, actual hazard geometry or audio timing changes. Independent geometry test at .26 input requires >50% peak puff radius growth and >20px peak lift with fixed vent mouths, alpha and neutral OFF geometry. 110/110 targeted background/dance/ruleset tests passed.

96 matched actual game render pairs, original One More Run, peak visual envelope .832, 5.10s audio span, no page errors. Controlled Vertigo look on Debutmont terrain, silent Tailnet audition. No media committed; natural traversal, accessibility browser refresh and Chromebook performance remain pending.

## Ninth audition: Arcade bridge

Owner approved V8 Vertigo Vents. The five previously accepted motifs remain unchanged.

Arcade sun now has a bounded vertical hop (22px maximum centre lift) combined with broad horizontal squash and vertical compression. Its horizontal centre, palette and transition-controlled opacity remain independent of dance. The bridge grid and veil logic are untouched. Added actual sprite-transform tests at partial and full veil, including reduced motion and zero-envelope reset. 136/136 focused background, dance, transition and ruleset tests passed.

96 matched real game frame pairs over original One More Run, with the presentation-only Arcade veil forced to full coverage then swept through partial coverage (not natural sector traversal). Peak envelope .724, maximum measured sun centre lift 20.09px, identical opacity in both arms, no page errors. Fresh live original-OGG browser smoke passed music reactivity, mute, OS reduced motion, explicit reduced-motion overrides and World Dance OFF. Private silent audition only; no media committed. Natural traversal and Chromebook performance still pending.

## Owner acceptance and integration

Owner accepted Arcade V9 as good enough for now and raised possible dancing buildings as a future idea, not a requirement for this release. All six individual audition candidates are accepted for current visual tuning. Preserve existing building art for this release. Natural traversal and Chromebook performance remain separate evidence gaps.

## Arcade skyline EQ follow-up (#331)

Owner subsequently explicitly asked to try buildings as a graphic EQ and include it if the implementation is lightweight. Existing 480px skyline art is sliced into 20 tower groups sharing one texture, with two wrap copies but only the visible screen of sprites rendered. No extra audio nodes/assets; reuse existing real bass/mid/treble analyser readings with independent 65ms attack / 150ms release. Skyline remains rooted at horizon, tint/fade/parallax preserved, sun unchanged. Original tile used when OFF/neutral; explicit __BASE frame prevents Phaser's firstFrame change from corrupting later runs. No synthetic spectrum or physics change. 165/165 targeted tests passed including new band separation, reset, fade, wrap and geometry tests.

V10 and V11: 96 matched actual game frame pairs with original One More Run, controlled full/partial Arcade veil on Debutmont terrain; no page errors. V11 optimized visible copies and idle updates, measured audio span 9.60s (V10 13.52s, V9 3.69s; capture timing is confounded by host load and capture overhead and is NOT a validated frame-rate benchmark). Chromebook performance is still unverified; treat the EQ as an audition candidate, not a cleared performance gate. Independent exact-head review and owner visual feedback pending. Do not conflate three broad frequency bands with a high-resolution spectrum display. No media committed.

## V12 individual tower EQ tuning

Owner loved the skyline EQ and asked for stronger individual variation. Each of 20 tower slices now has its own bounded gain (0.46–1.25) and blend of adjacent actual bands, including extra treble sensitivity to compensate for the typically quieter upper band. No new sprites or audio nodes; wrap copies share the same response. Maximum scale remains 2.25x. This is a stylized three-band visualizer, not 20 independent FFT bands. Tests verify within-band variety, relative low/high response, wrap consistency, bounds and neutral restoration. 165/165 targeted tests passed; 96 matched real-render pairs with original One More Run, no page errors, at least ten distinct visible scales in a frame. Silent controlled audition; Chromebook frame rate remains unverified.

## Final V12 visual acceptance

2026-11-24: owner response to V12 audition: "LOVE IT! Looks great!" All current visual tuning accepted, including individual Arcade tower EQ responses. No further tuning requested. This is visual approval, not a waiver of independent review or Chromebook performance gate. Main has advanced to R2 soundtrack v2.21.1 plus billboard thumbnails; candidate version moved to v2.21.2 to avoid collision.

## v2.21.2 integration gate

Candidate 25254189 against main 29587b64: 173/173 focused tests (including the R2 catalog and cosmetic noninterference), production build and identity check passed. GitHub identity/build/lifecycle green, deploy skipped. Production Chromium real original-OGG reactivity and mute/reduced-motion/OFF passed. Settings smoke initially rejected 16 rows vs an obsolete 14-row expectation, identical settings UI to main; corrected the assertion to require one World Dance and one Reduce Motion control, retain panel bounds validation, and test actual persistence. Corrected test passed: panel y18/h244, 16 rows, choices survive reload. Independent OpenCode review attempt timed out at 75 seconds without findings or verdict; Codex review remains rate-limited. No independent approval claimed. Physical Chromebook performance and natural traversal are still outstanding.

## Generated Arcade bridge regression

Real production build, seed beegate0@512, bridge world x 20272–21728 from Debutmont to Micro Mountain. New loopback-only browser gate uses eight scripted sled placements around the actual generated bridge; the production game step owns look/veil, with no forced palette, veil, or fake audio samples. Observed veil 0 → .397 → .797 → 1 → 1 → .802 → .402 → 0, up to 21 visible tower slices during Arcade, then zero at Micro. Incoming dew-drops motif and neutral exit correct; no crash or page errors. This is generated-sector integration evidence, not an uninterrupted playthrough.

The same gate alternates four paired batches of 45 actual WebGL draws without image readback, using held real audio energy at bridge midpoint. Software-renderer timings were highly variable (OFF 1.80–30.39 ms/draw; ON 1.34–33.03 ms/draw); no defensible overhead or physical Chromebook FPS conclusion. Neutral skyline restoration passed. No performance gate waiver. Retain original owner-approved visual tuning and await real-device QA.
