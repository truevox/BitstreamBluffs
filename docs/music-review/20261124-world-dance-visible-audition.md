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
