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
