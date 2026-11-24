# Morgan — Bitstream Bluffs working checkpoint

Last verified: 2026-11-24 15:49 UTC. Main `0229045d1c51a8351df7d0119f407562ccba407f` (#318), SIM9 sealed, v2.20.1 live at https://simulate.sledhead.ing/.
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
   No coefficient or runtime change. Next inspect exact-head checks and
   independent review; resolve real feedback only. This is not merge-ready.
2. Reconcile #168 against current issue states and release notes. All 17
   original open issues were rechecked after #318; no parent issue closed.
   When #287 is waiting on Gal, advance a separately testable developer
   slice without crossing the listed dependencies, starting with #79 local
   annotation QA if current SIM9 source can reproduce its own native
   positive and nonfatal negative. Historical SIM6 evidence cannot certify
   current input. Preserve exact supported normal-entry/build gating, tape
   binding, replay pose equality, fatal-event proof and unchanged SVG.
3. Keep upstream lanes tracked. #58 gates #81 friend exchange; #60 gates
   #84/#83 and broader #70/#71; #57/#60 gate #127 full branching;
   #75/#100/#74 need trusted restoration or equivalent causal replay
   prefix; #243 and #224 are narrow milestones, not full restores.
   #82: no product cohort or SaveStore migration authorization. #85:
   no player archive verified or gallery publication. #155: preserve
   delivered cue fix but do not claim full Pulp or take over Team B.

## Changes landed and published

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
- #82 real native put then abort: the legacy memory fallback still
  returned a row, but restart recovered only a positively completed
  transaction. Require atomic run + provenance completion and reopen proof
  before calling a row durable. Scratch only, no production/ranking change.
- #85 private scripted recapture candidate, not player footage: SIM6
  `22b6ade` reached 180s cutoff under stock level 1 neutral canopyHop
  on two seeds; SIM7 `d3e80fa` actual BSOD at 84.42/80.62s.
  Do not attribute the whole difference to the wall alone.
- Home: #117/#68/#76; Team A #152/#116/#118/#123; Team B #119/#140/#120/#115
  and conditional #121. #155 cue already unblocked #140/#160. #273 is
  the other lane (historical Luna source approval exact `0fd1400` only).
- #306 music draft `8fbdc753ad6e1f15b4d47bf3ae76bc7a9efdd30b` must
  restack on SIM9 and choose a later version: AirBrake used 2.20.0 and
  #318 used 2.20.1. Exact three-way conflict in changelog, package, lock
  and source digest; RunScene text auto-merges but integration unproven.
  Old #311/#300/#306 scratch physics/audio isolation proof is historical.
  #310 `8ed7d367` sampled 33 native opening segments, estimated worst
  -0.362 dBTP per author; not calibrated mastering, full transitions,
  overlap or rights. #312/#316 another lane: exact `a11b45c` direct
  native 48 kHz transport before onset paused outgoing but resumed incoming
  at offset zero. No-fade and after-onset controls did not. Real Phaser UI
  and fixed-head recheck outstanding; no private media published.
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
