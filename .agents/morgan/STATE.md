# Morgan — Bitstream Bluffs working checkpoint

Last verified: 2026-11-24 17:46 UTC. Main `05a1bf1e4ba710be691610b4947d1e4a60dd2413` (#320), v2.20.2 live at https://simulate.sledhead.ing/, SIM9 unchanged.
Goal: advance the handed [#168](https://github.com/truevox/BitstreamBluffs/issues/168)
portfolio one independently testable Morgan slice at a time. “Keep going”
means resume this queue, not take over another lane or merge a draft.

## Next actions

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
2. Reconcile #168 against current issue states and release notes. All 17
   original open issues were rechecked after #318; no parent issue closed.
   While #287 waits, continue bounded #79 replay annotation QA.
   Exact public normal v2.20.2 entry and shipped SIM9 identity: four
   fresh Chromium contexts, positive record+replay and cutoff record+replay.
   Existing opt-in conformance helper, CE120-BUMP3/reckless/hopEvery400,
   rngSeed9, 120 Hz. Natural matching non-negated terrain fatal tick937
   (153m); all 7 checks and 234 f32 pose triplets match, last pose tick936
   2.592px from fatal XY. Cutoff tick464 has a crash header but no fatal
   on either capture or replay through 465 (3 checks, 116 f32 poses match).
   Positive tape SHA-256 `fb1732519d3642b869a346a4d0360b0ddbaa9054d301cdc8452572d37db29b6f`;
   cutoff `1d0b806d064d6c37119bba12884ca1dffa06d6dde3b4f6ae6c8f2bde6d06ddbe`.
   Next exercise a local-only annotation/provenance prototype against
   those cases and a mutated-pose/entry/receipt negative; keep original
   SVG and runtime untouched. No UI validation or general support yet.
3. Keep upstream lanes tracked. #58 gates #81 friend exchange; #60 gates
   #84/#83 and broader #70/#71; #57/#60 gate #127 full branching;
   #75/#100/#74 need trusted restoration or equivalent causal replay
   prefix; #243 and #224 are narrow milestones, not full restores.
   #82: no product cohort or SaveStore migration authorization. #85:
   no player archive verified or gallery publication. #155: preserve
   delivered cue fix but do not claim full Pulp or take over Team B.

## Changes landed and published

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
- Gal/Home audio lane: combined #322 draft `df11f055dabb700da58b5c7522c191658d0c281c`
  on #320 proposes v2.21.0/SIM9 and restacks #306/#310/#316. #321 not
  included. Corrective exact-head re-review covered fatal count-in,
  Arcade corridor and audit port; CI green but not the Pause/Play case.
  Native Chromium/actual Title jukebox clicks on exact compiled draft,
  four public OGG songs and empty grids; a legacy settings payload
  without the field inherits ON. After a test-only initial seek,
  natural scheduler commits a 2.8s fade. Pause 460ms before incoming
  onset stops 14 nodes (seven outgoing), saves incoming at zero instead
  of outgoing ~211.72s; Play starts incoming at zero. Explicit OFF
  retains outgoing ~212s; after-onset retains incoming +0.230s. Real game
  Escape then PauseScene RESUME pointer also reproduced at 481ms before
  onset (~211.70s outgoing → incoming zero); scratch suppressed run
  physics during lead-up only. No page or HTTP errors in these arms. User
  notified privately; no PR edits, merge, or private publication.
  Recommend lane owner resolve before release and retest the exact fixed
  head with the same pre/post/OFF controls. Historical #310 sampled peaks
  are not calibrated mastering or private-media clearance.
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
