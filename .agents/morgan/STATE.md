# Morgan — Bitstream Bluffs working checkpoint

Last verified: 2026-11-23 22:25 UTC. Main: `570fc88cc9ef241778045a5cea9787a98bb48f14` (v2.19.21).
Goal: advance the handed [#168](https://github.com/truevox/BitstreamBluffs/issues/168)
21-issue portfolio one independently testable Morgan slice at a time. “Keep
going” means resume this queue, not take over other lanes or merge a draft.

## Next actions, in order

1. Check the nine source-review handoffs (#269/#278/#281/#282/#283/#286/
   #287/#288/#290) for exact-head Gal feedback and current checks/base/overlap.
   Fix actual feedback first. No merge of drafts. If cleared, obey the
   numbered release rule (#207); #248 reserves v2.19.22. Main #292 added
   a Vite entry for opt-in BSOD QA without changing the version. No changed
   file overlaps the nine drafts. Applying #278's exact source delta to
   current main passed 30 focused tests and same-path 4,844-file build parity.
   This is integration QA, not a new draft head or review verdict.
2. #127 fair1153 (mask 16) on exact SIM6: Shatter Wall `17:2` x37680 →
   Packet Spike `18:0` x38301, 621 px. Fresh native 320 ms policy hits
   tick 9073 with 8.33 ms blind fade left; 300 ms policy hits same sensor
   tick 9097 after expiry by 33.33 ms. Both unprotected, exact repeats.
   This proves timing, not causation/unfairness. #286 includes exact
   stock commands. Preserve separate historical #202; no new speculative
   tuning. Full branch/route model remains gated on #57/#60.
3. #81 local UI fix is in #290. Friend exchange still requires #58.
   #82 storage lifecycle needs separately scoped save-system review;
   #85 still needs authentic footage; #84/#83 and product #70/#71 need #60;
   #75/#100/#74 need trusted restore or equivalent causal replay prefix.
   #243 remains a starter, not a restore. Do not take over #155 full Pulp
   or change #157 scoring coefficients.

4. #70 bounded follow-up: at SIM6 `eb281d8`, neutral rule, mask 0,
   verified classic sim-01/02/03 panel at 500 m and matched terrain-only
   Chromium repeats. Compare only band 0 [0,500) from the 44 px origin;
   later bins are streamed lookahead. Crash placements/total/generated
   jumps: sim-01 1/3/3 (ideal and steady pass), sim-02 and 03 both 2/4/2
   (neither reaches threshold). Placement is not contact, causation or
   fairness. No product, scoring, shortlist or #288 head change.
   Reproduce via existing classic panel and two fresh
   `--policy terrain --seeds sim-01,sim-02,sim-03 --biomeMask 0 --maxM 500`
   invocations; do not use terrain with the trace-specific `--verify`.

5. #79 annotation QA, not an inspector change: all nine committed SIM6
   fixture bytes match metadata, but four nonfatal cutoffs have a crash
   header. At exact main `eb281d8` with matching recorded build identity,
   two native Chromium reproductions of collision-heavy match seven
   checkpoints and the stored poses. Last pose tick 936; reproduced
   terrain fatal tick 937 ~2.623 px away. Raw cruise-baseline fails strict
   intake; two isolated replays of the exact cutoff bytes emit no fatal.
   A separate synthetic identity/time-only control passes CLI intake but
   emits no report after the fatal-event check. Never annotate from the header, last
   pose or redacted #78 brief. A local prototype must bind the exact tape
   and supported build, check stored f32 poses against the replay, and
   fail closed. Repeated both cases on current main's exact normal browser
   entry (after #292): same tick outcomes, all stored poses match, and
   public #78 cutoffs still produce no output. Current normal served index
   SHA-256 starts a1319ec7, separate QA starts dcabd1df, old normal
   starts 8d904f4c. Build ID alone does not distinguish these; require
   exact standard index/assets, no QA path, query or redirect. No changes
   to original strip/SVG, #78 JSON or #278 head.

## Active branches and ownership

| Issue / PR | Branch and exact head | State |
|---|---|---|
| #87 / #269 | `morgan/issue-87-art-v2` @ `00d47d12fa154ebcb35040a2bca0792d657390f0` | Draft, opt-in local art; 534 focused tests; pending exact-head review. |
| #79 / #278 | `morgan/issue-79-keep-selected-pose` @ `49bb37e4591228e319d88e5ceb8688fc4440be14` | Draft, cursor fix verified in Chromium; 528 focused tests; same SVG export and production build. |
| #78 / #281 | `morgan/issue-78-require-crash-match` @ `cb29f1952471b6743073dd891c43f43858a28b3e` | Draft, opt-in shell decision codes; 1,263 focused tests; same default JSON and production build. |
| #126 / #283 | `morgan/issue-126-dispatch-frame-test` @ `d402a868d505d608c4b0d3e9205c78b5880e8b7f` | Draft, test-only coalescing at frame 363; classic/fatigue, 554 focused tests and negative mutation control. |
| #127 / #286 | `morgan/issue-127-pin-preflight-examples` @ `7452a8a38f907aeb40c03912a12b9c014ddb2fe7` | Draft, docs only; historical/SIM6 inputs pinned; two repeated native timing arms on exact fair1153 entities; no fairness verdict. |
| #157 / #287 | `morgan/issue-157-utility-score-baseline` @ `a7e795f30a1889d5fa057f6e078c86184c96fe90` | Draft, test only; separates utility points, combo, flow and landing components; 111 tests and two reversion-verified negative controls. |
| #70 / #288 | `morgan/issue-70-classic-panel-diagnostic` @ `1bb776d021ad00162774e5f1ca0baf6a3f52313b` | Draft, offline diagnostic; classic output unchanged, verified fatigue fails closed with actionable message. 38 tests, 18 exact native-browser repeats and replays. |
| Bootstrap / #282 | Exact PR head `25333e9350d97f4f48563404d10273595e81c64f` | Draft recovery pointer only, not part of the 21 issues. |
| #81 / #290 | `morgan/issue-81-ghost-row-revision` @ `bd43a5adecee4dc9e60f377b9a9735d0e373ce5b` | Draft, UI compatibility parity only; built Chromium Game Over A/B, 24 Jest tests, ruleset/identity checks. |

All required work can be reconstructed from remote refs; no disposable worktree
or local patch is required for the drafts. Local-only #82 browser
prototype is not pushed and must not be mistaken for a PR.

## Original handed queue: all 21 issues

| Phase / issues | Progress or blocker |
|---|---|
| 1: #132, #82, #87, #79, #126, #85 | #132 done via #167; #82 calculations shipped #169, durable provenance / screen work gated; #87 #170/#213 and #79 #174 shipped bounded slices, active drafts above; #126 #171/#189/#218 shipped synthetic tools; #85 still needs authentic footage. |
| 2: #131, #129, #127, #84, #83, #81, #78, #77, #75, #71, #70 | Shipped slices: #131 #184/#228; #129 #205/#226; #127 #183/#202 (also draft #286); #81 #178 (also draft #290); #78 #190/#237; #77 #186/#220; #71 #197; #70 #181 (also draft #288). #84/#83 need #60 and scoped identity; #75 needs trusted restoration/testable replay prefix, not a pose trace. Remaining rank, identity, sharing and product gates in #168 still apply. |
| 3: #157, #155, #100, #74 | #157 #195 and draft #287 baseline only; no scoring change. #155 #196/#208 cue fix shipped; #140 Team B #160 merged and closed; full Pulp not complete. #100/#74 await trusted restoration or equivalent causal evidence; #224 is a narrow milestone. |

Closed after bounded work: #132, #77, #129 and #131. Explicit PR directions: #167 and #169 shipped;
#173 was reviewed for Gal and merged at `17993228`. #168 is the tracker, not a
22nd feature. GitHub owns the live status, including closed vs partial slices.

## Handoffs and decisions

- Gal: source-review requests posted on each of the nine current draft heads.
  None is a merge request, approval, or release reservation. Preserve #207.
- Isolated #81 and #127 helpers returned tested evidence; root verified and
  published current drafts, no outstanding helper handoffs.
- Internal helpers finished #157 and #70 test/evidence preparation. Root
  reviewed and published both. Instrumented #127 browser work is local,
  uses observation only and adds no code to shared runner/PR heads.
- Tracker #168 now lists all eight feature drafts and the remaining gates.
  Four of the original issues are closed; 17 are open.
- Home: #117/#68/#76 upstream work; Team A #152/#116/#118/#123; Team B
  #119/#140/#120/#115 and conditional #121. Reference as upstream, not
  assignments Morgan can take over. #155 fix already unblocked Team B #140.
- #273 Seeking/Gal pilot: Luna posted exact-head delta source approval at
  `0fd1400` after the earlier retry timed out. It is still a draft and #130
  remains open; leave release and broader work in their lane.
  #248 AirBrake remains Gal/Home-owned; latest feel freeze and fresh SIM7
  receipts are separate from historical SIM1–6. #266 preserves future
  version/identity seams, not a prerelease old-tape support requirement.
- Main stays release-controlled. Keep synthetic developer evidence out of
  gameplay, saved formats, scoring and ranked eligibility unless authorized.

Recovery: a history-free Morgan startup read this branch and caught the stale
#273 note above. The root repository pointer is in draft #282, not yet on
main. No unfinished bootstrap write is required to use this checkpoint.
