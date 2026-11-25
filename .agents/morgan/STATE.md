# Morgan — Bitstream Bluffs working checkpoint

Last verified: 2026-11-25 04:46 UTC. Main `9e2f36a2a528c6aeea07c1b93153ed8495109f60` (#350), v2.22.3/SIM9. [Exact Pages push](https://github.com/truevox/BitstreamBluffs/actions/runs/45543839113) build/deploy succeeded; Gal's public Chromium receipt verifies AIR/GND BRAKE help and separate compiled Matter A/B verifies existing behavior. #348 offline recovery and #340 guard remain shipped; no new pause workaround check.
Goal: advance the handed [#168](https://github.com/truevox/BitstreamBluffs/issues/168)
portfolio one independently testable Morgan slice at a time. “Keep going”
means resume this queue, not take over another lane or merge a draft.

## Next actions

- **Requested #339/#340 reviews completed (Gal/Home audio lane):**
  #339 `43d4daf467133e40c50daafe07e49d57f27f53a7`: hold QA-only merge for two
  reproduced P2 false passes. Candidate linear 0.95 (−0.446 dBTP) with
  stored −2 dBTP passes both mixed/window verifiers; the mixed gate also
  lets missing candidate data bypass the explicit −1 requirement. The live
  wrapper verifies six synthetic private-mode/Debutmont receipts as R2 hot
  cases. Require a candidate, derive dB from linear, and pin R2 route and
  expected biome. 89 tests passed; findings do not invalidate original
  captures by themselves. #340 `171fb5cab2131c380e76ee40a5c87329271542b1`:
  no standalone runtime blocker, all 8193 curve points match #339's v2
  curve, 94 tests and identity passed, exact build SHA
  `3c0884e8e86acfdef433bf17cbe1ad644a9eb9070de5a4dc0a22de628ec7927b`.
  Two independent index-1 headless post-guard taps using public R2 source
  bytes rejected repeated 128-frame timestamps; no qualified independent
  live peak or audio-glitch conclusion. Marvin narrowly preferred v2 after
  blind A/B and asked Gal to ship, superseding the earlier hold. Gal merged
  exact heads via #339 `9e699444` and #340 `116141235`; public bundle verified
  and user informed. #342 is deferred P3 for hardware/full-song/chronology,
  but both verifier bugs remain in merged QA and are not explicitly listed
  there. Preserve as a separate QA-only follow-up, not a guard rollback or
  certification. No PR writes or production action by Morgan.


- **Requested #325 review completed and shipped:** reviewed v2.21.2 head
  `b4b52e1d6040f3b9ac998536f70362848b80d7dc` on main `29587b64`.
  Final delta from locally built `8c5b81a` is only docs and a QA tool.
  P2: strong sways exceed the 40px decor cull margin. At Micro Mountain
  seed 0, t=0, strength .8, scroll 8270→8271 drops a still-visible grass
  tip extending ~14px inside the left edge; main keeps the tip outside.
  Planet rings can cross the same margin. Recommend bounds-aware culling
  and a boundary regression test. Production build, identity and 123
  focused tests passed. Chromium WebGL: 20 shared frames, 40 per-run
  sprites, 20–21 visible, correct wrap/fade/OFF/exit over four restarts;
  old sprites destroyed, texture reused. Exact-head GitHub CI green.
  Follow-up exact `e4241167ff276e39a09a66dbb16c8b1b6fca023a` fixes P2:
  original scroll 8270→8271 now moves the visible tip from x13.925 to
  x13.855, without cutoff; 125 focused tests and exact-head CI green.
  Conservative per-motif margins preserve tile phase. User informed.
  Owner accepted Chromebook performance (not a measured benchmark), and
  Gal merged approved fix as `3197b762677abb88a0e108796384d61dde1d8215`.
  Verified public release and told Marvin. No PR write or merge by Morgan.

1. **#157 / #287**: current draft `morgan/issue-157-utility-score-baseline` @
   `eace461ce67d113215ee5d6f3e24346704461e36`, based on exact v2.20.1.
   Expect one test file only (blob `4d39e96421fcf42d2d5ff962ac166fc6c582b934`).
   [Fresh exact-head handoff](https://github.com/truevox/BitstreamBluffs/pull/287#issuecomment-7136664311)
   supersedes the held-input wording in the original PR description. 159
   focused tests passed; five deliberate regressions caught and reverted.
   Genuine production-module control spends 240 at 400→160, stationary
   air earns none, one paid pulse awards 40, held/duplicate earn nothing.
   Test isolates immediate credit, matched 89/95 combined utility, pending
   vs. banked, short/no-bonus settlement, canopy, combo and earned Flow.
   No coefficient or runtime change. Exact lifecycle `45429825491` and
   identity `45429825825` green; only old-head review observed. Await fresh
   exact-head independent review; resolve real feedback only. No merge.
   Independent exact test blob overlay on shipped v2.20.2 again passed
   159/159 across the same five suites; #320 has no test-file overlap.
2. #168 and all 17 original open issues were rechecked on v2.21.2;
   none closed. Keep checking source for actual dependency movement.
   [#338](https://github.com/truevox/BitstreamBluffs/pull/338) / #78 is now
   an open two-file developer-only draft at `fbc787a939446ac67ea4b7b25c12b35faf9b2836`,
   branch `morgan/issue-78-crash-brief-chain-smoke`, based on `044ebd4b`.
   Normal production asset matches v2.21.2. Two fresh strict playbacks
   of natural terrain fatal tick937 checked 7/7 checkpoints; a complete
   shaped nonfatal cutoff is refused with exit 1 and empty stdout.
   Unchanged comparator returned 0 vs itself and 2 vs historical Packet
   Spike brief. 102 focused tests, identity and closed-loop browser smoke
   passed. A longer experimental hazard playback hit the existing 60s
   wall limit and is not in the draft. No raw tapes, profile data, game
   behavior, deployment, or issue closure. Await exact-head review;
   lifecycle `45502797485` and identity `45502797488` green. No merge.
   #79 replay annotation QA (independent prior slice):
   Exact public normal v2.20.2 entry and shipped SIM9 identity: four
   fresh Chromium contexts, positive record+replay and cutoff record+replay.
   Existing opt-in conformance helper, CE120-BUMP3/reckless/hopEvery400,
   rngSeed9, 120 Hz. Natural matching non-negated terrain fatal tick937
   (153m); all 7 checks and 234 f32 pose triplets match, last pose tick936
   2.592px from fatal XY. Cutoff tick464 has a crash header but no fatal
   on either capture or replay through 465 (3 checks, 116 f32 poses match).
   Positive tape SHA-256 `fb1732519d3642b869a346a4d0360b0ddbaa9054d301cdc8452572d37db29b6f`;
   cutoff `1d0b806d064d6c37119bba12884ca1dffa06d6dde3b4f6ae6c8f2bde6d06ddbe`.
   Scratch-only UI A/B now shows separate terrain detail at tick937,
   X3121.909/Y1054.085, only for the independently replayed exact tape.
   +8px first-pose mutation still passes all 7 causal checkpoints and hits
   the same fatal, but fails exact Float32 comparison and receives no note.
   Header-only cutoff, copied receipt, wrong entry URL/index/module,
   clearing and delayed file hash after replacement all fail closed.
   Byte-identical strip preview, SVG download and Run DNA art for each
   accepted input; local inspector had zero outbound requests or errors.
   This is a scripted fixture-only QA bridge, not provenance for player
   files, an importable receipt, or product code. If review-ready proof
   is needed, package a pinned developer-QA recipe without runtime claims;
   otherwise move to the next unblocked slice rather than repeating this.
3. **#126 / #341**: open five-file developer-only draft
   `morgan/issue-126-paired-fatigue-report` @ `a560cec88bc835877620e808dd30d270d70b2722`, based on
   `044ebd4b`. Opt-in comparator matches classic/fatigue by course, reaction
   seed, settings, ramp and unchanged ideal control; emits only hashes,
   labels and counts. Chromium on exact main: 18/18 seeded repeats and
   fixed-tick playbacks, all 3 ideal controls equal, zero 500m threshold
   flips. Steady/sim-01 had one ramp and one capped intent, eight added
   delay frames. Mutated ideal RNG and Daily intake of untouched fatigue
   fail closed; existing classic CLI/Daily outputs byte-identical.
   91 focused tests, green local identity and 4,880 exact build files
   unchanged. No raw evidence or scoring/player/physics changes.
   Await independent exact-head review; no merge or preview.
4. **#79 / #345**: four-file open draft `morgan/issue-79-find-stored-tick`
   @ `81786116d7fb41b54eb75a07eb8b80710c847288`. Local dev inspector locates actual stored
   pose from a nominal tick, exact or nearest; ties earlier, refuses out of
   trace even if tape header claims a later end, reopens full range if
   outside section. No inference about crash events, terrain or provenance.
   Keyboard and 360px Chromium exercised decimated pose, tie, section
   reopen, rejection, file reset, exact SVG download/Run DNA byte parity,
   zero external requests. 42 focused tests and same smoke passed on
   original `116141235` and isolated exact `716679d4` overlay; v2.21.2 and
   v2.22.0 production builds unchanged across 4,880 and 4,882 files
   respectively; original local identity passed. Await exact-head review;
   no merge, preview, release or issue closure.
5. Keep upstream lanes tracked. #58 gates #81 friend exchange; #60 gates
   #84/#83 and broader #70/#71; #57/#60 gate #127 full branching;
   #75/#100/#74 need trusted restoration or equivalent causal replay
   prefix; #243 and #224 are narrow milestones, not full restores.
   #82: no product cohort or SaveStore migration authorization. #85:
   no player archive verified or gallery publication. #155: preserve
   delivered cue fix but do not claim full Pulp or take over Team B.

## Changes landed and published

- #332 developer-only Heavy Mode milestone: isolated SIM9 neutral-input
  fresh reconstruction 977/977 through terminal crash; strict suffixes
  300/300 contact + 280/280 hazard, with strengthened negative controls.
  No production save/load or ranking; #119/#242/#329 still open. Do not
  unblock product #75/#100/#74 on these bounded fixtures alone. An exact
  #79 fixture-only integration can use this as additional evidence after
  verifying matching build, causal prefix and input constraints.

- #327 merged `b67f944` as v2.20.3 Heavy Mode developer diagnostics,
  also preserved in #328. Covers strict preflight and bounded fresh
  reload probes; not trusted production restore, player save/load, or
  competition admission. #119/#242 and dependent slices remain gated.

- #320 v2.20.2 closed #319, the storage durability gap Morgan diagnosed.
  SaveStore distinguishes transaction commitment from session-only fallback,
  retries an uncommitted ID without duplicate scoring, and serializes
  initials updates. Game Over can label a score PENDING or SESSION ONLY.
  [Exact Pages push](https://github.com/truevox/BitstreamBluffs/actions/runs/45437509543)
  green. Served `main-CCdxY2p8.js` SHA-256
  `d84ee27159617d6605c2a756700ed1ea55001937e10fde1b2da76a104009cedc`;
  live source map SaveStore and GameOverScene blobs match exact Git main.
  Public Chromium #79 proof exercised the normal deployed bundle with
  fetched HTTPS bytes. Native abort/retry/reopen,
  request/quota/open failure reviewed in [#319](https://github.com/truevox/BitstreamBluffs/issues/319#issuecomment-7137786867).
  This does not atomically preserve run + proof, change ranking eligibility,
  or implement physics restore. #82/#244 remain open; #244 is Gal/Home's
  protected replay evidence archive. #242 diagnostic baseline does not
  establish fresh-world restore; #75/#100/#74 remain gated.

- #300 merged `9e0258076eab0e8edd8aa1d551090efb3d5a32e3` as v2.20.0/SIM9:
  owner-approved paid one-shot 60% horizontal loss, same upward pop.
  [Exact Pages push](https://github.com/truevox/BitstreamBluffs/actions/runs/45423359453)
  succeeded and v2.20.0 bundle was briefly observed live. #247 stays open.
  Exact review receipt exists in PR discussion; no formal review recorded,
  separate Codex integration was rate-limited. #248 is historical only.
- #318 merged `0229045d` as v2.20.1; unchanged final source blobs from
  #269 (#87 Art V2), #278 (#79 strip cursor), #281 (#78 opt-in shell exit
  statuses), #286 (#127 pinned historical blind-hazard docs), #288 (#70
  classic-only diagnostic). All five original PRs closed unmerged as
  superseded. #287 excluded from the bundle. No simulation or scoring
  change in #318. [Exact Pages push](https://github.com/truevox/BitstreamBluffs/actions/runs/45428681365)
  succeeded. Live `main-D1pX0sIt.js` matches the unmodified release build
  byte for byte, SHA-256
  `d12b2b0519a2355d362193f7e9e33f00a103fdc9afe88e01db6a0ee8858de25f`.
  Local Chromium on those production build bytes reached title and entered
  a moving run with real keyboard; no HTTP or page errors. Not a direct
  live browser smoke. Legacy GitHub Pages redirected to custom host as of
  v2.19.24; separate origins keep separate browser saves.
- #313 v2.19.23 `74c8d7b7` carried unchanged #290 ghost compatibility
  display, #283 dispatch test, #282 startup pointer. Originals closed
  as superseded. #314 v2.19.24 added title version label, no sim change.
  #290 labels old/unstamped ghosts without deleting them or enabling
  historical playback. Historical native persistence/isolated-origin proof
  and #269/#278 v2.19.24 receipts live in checkpoint history.

## Original handed queue: all 21 issues

| Phase / issues | Progress or blocker |
|---|---|
| 1: #132, #82, #87, #79, #126, #85 | #132 done via #167; #82 calculations shipped #169, durable provenance / screen work gated; #87 #170/#213 and #79 #174 shipped bounded slices, developer-only #318 slices shipped; #126 #171/#189/#218 shipped synthetic tools; #85 has a provenance-pinned scripted recapture candidate; original footage and gallery decision remain open. |
| 2: #131, #129, #127, #84, #83, #81, #78, #77, #75, #71, #70 | Shipped slices: #131 #184/#228; #129 #205/#226; #127 #183/#202 plus #286 via #318; #81 #178 and #290 via #313; #78 #190/#237 and #281 via #318; #77 #186/#220; #71 #197; #70 #181 plus #288 via #318. #84/#83 need #60 and scoped identity; #75 needs trusted restoration/testable replay prefix, not a pose trace. Remaining rank, identity, sharing and product gates in #168 still apply. |
| 3: #157, #155, #100, #74 | #157 #195 and draft #287 baseline only; no scoring change. #155 #196/#208 cue fix shipped; #140 Team B #160 merged and closed; full Pulp not complete. #100/#74 await trusted restoration or equivalent causal evidence; #224 is a narrow milestone. |

Closed after bounded work: #132, #77, #129 and #131. Explicit PR directions: #167 and #169 shipped;
#173 was reviewed for Gal and merged at `17993228`. #168 is the tracker, not a
22nd feature. GitHub owns the live status, including closed vs partial slices.

## Evidence and lane boundaries

- #127 historical displayed timing only, not unfairness: exact SIM6
  fair1153, neutral classic, mask16, Shatter Wall 17:2 x37680 to Packet
  Spike 18:0 x38301 (621 px); 320 ms policy hits tick9073 with 8.33 ms
  fade left, 300 ms hits tick9097 33.33 ms after expiry. Both unprotected.
  #286 via #318 contains commands. #202 is separate.
- #79 prior exact SIM6 collision proof matched all stored poses and seven
  checks; last pose tick936, verified terrain fatal tick937 ~2.623px away.
  Header-only cruise false fatal and changed stored pose were rejected.
  Actual matching normal entry matters even when a QA build shares identity.
- #82 historical native put→abort established the scope for shipped #320.
  Broader phase still needs atomic run + provenance completion and reopen
  proof for a durable cohort. Do not count memory-only scores as durable.
- #85 private scripted recapture candidate, not player footage: SIM6
  `22b6ade` reached 180s cutoff under stock level 1 neutral canopyHop
  on two seeds; SIM7 `d3e80fa` actual BSOD at 84.42/80.62s.
  Do not attribute the whole difference to the wall alone.
- Home: #117/#68/#76; Team A #152/#116/#118/#123; Team B #119/#140/#120/#115
  and conditional #121. #155 cue already unblocked #140/#160. #273 is
  the other lane (historical Luna source approval exact `0fd1400` only).
- #350 closed #30: existing AirBrake doubles as ground brake; no binding,
  physics, replay change. Tricks Right A, Tricks Left ←, Classic ↑ or S on
  ground, gamepad X or B on ground, touch existing AirBrake. Public README
  still presents generic S and air-only X; a Gal-lane docs cleanup could
  label Classic, list the contextual brake, and point to How to Play. No
  natural endurance/catch timing claim. No extra user notice.
- #351 reduced-motion-aware unverified #69 ghost link and stacked #352
  local Game Over #244 archive are drafts; neither permits public trust,
  friend exchange, ranking or trusted mid-run restoration.
- Gal/Home PWA #335/#337 integrated via #344 and updated through #348. Prior
  Chromium previews proved cold-offline committed ledger/ghost reopen after
  natural 166m SIM9 crash, visible same-course ghost, and a two-build upgrade
  retaining actual Lite audio; not physical device or trusted mid-run restore.
  #172 low-space follow-up: optional next-biome queue reports insufficient
  storage while UI shows only existing Lite readiness. Separate optional
  result from current readiness; do not auto-retry or transfer. Gal lane.
- #347 is Gal/Home's open #244 protected local evidence-ref draft, no
  shipping or broader restore/admission claim. #343 is an open pure #245
  contract, not public verified ranking, backend authority or a dependency
  unblock. Keep both lanes separate.
- Gal/Home audio lane: #328 merged the #322 music code as v2.21.0,
  main `69a6fb4674335d2496a801ddd7dcaabcb0a4a8bd`; #322 closed superseded.
  [Exact Pages push](https://github.com/truevox/BitstreamBluffs/actions/runs/45461734705)
  green. Public `main-CuoBeFkp.js` SHA-256
  `d19109f634429c8e1a529b725efc1d5e059d19d34270f6ca255a3c1becd87a11`
  exactly matches the previously tested draft build. Public source-map
  SaveStore/StemMusicDirector/SongCrossfade blobs match merged Git.
  Fresh Chromium on fetched public bytes and four real public OGG packs
  reproduced via actual Title buttons: default ON, pause 420ms before
  onset with seven outgoing nodes, Play starts incoming at zero. Explicit
  OFF held the outgoing track ~211.96s and resumed ~212.29s. No page or
  HTTP errors. Old draft controls also cover after-onset and real Run
  Escape/PauseScene resume. User informed at v2.21.0 that
  Music Library → Song Crossfade → OFF was the verified workaround.
  That receipt was for v2.21.0; do not claim it reverified on v2.21.1.
  Review covered other audio cases, not this one. #321 distinct; no
  media clearance implied. Watch for an owner fix and retest exact
  merged served head. No lane takeover, source edits, or external post.
- Main release controlled under #207. #295/#307 advisory checks are not
  exact-head approval. #308/#309: initial PR titles and applicable commits
  `[skip netlify]`; default zero discretionary previews, at most 10 actual
  builds across agents per Eastern date for owner testing with ledger entry.
  Production separately coordinated. Preserve versioned replays, no old
  tape migration before launch and at least 10 real players unless changed.

Recovery: history-free probe and a scheduled wake verified actual recovery;
main AGENTS.md has the pointer via #313. Root is the sole checkpoint writer,
no outstanding helper work for #287, and no local worktree needed to recover
the draft. Do not rely on an external Codex loader that has not been tested.
