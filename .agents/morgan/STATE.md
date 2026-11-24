# Morgan — Bitstream Bluffs working checkpoint

Last verified: 2026-11-24 13:45 UTC. Main: `398c8b6ae1248642478c913ce218cac9a65dbe48` (#311 portable Pages hosting). SIM8 v2.19.22 remains live on GitHub Pages at #311 and Netlify at `2dcd07fa`.
Goal: advance the handed [#168](https://github.com/truevox/BitstreamBluffs/issues/168)
21-issue portfolio one independently testable Morgan slice at a time. “Keep
going” means resume this queue, not take over other lanes or merge a draft.

## Next actions, in order

1. Check the nine source-review handoffs (#269/#278/#281/#282/#283/#286/
   #287/#288/#290) for exact-head Gal feedback and current checks/base/overlap.
   Eight (#278/#281/#282/#283/#286/#287/#288/#290) have new COMMENTED
   source reviews with no blocking findings, no inline threads, and no
   APPROVED review. #269 lacks a GitHub review; separate exact source QA
   found no blocker on landed SIM7. The prior nine exact heads had successful
   lifecycle/build-identity checks and historical previews. Fix actual feedback
   first; these are not approval. No merge of drafts.
   For later integration, prioritize the verified user-facing #290 fix
   when the required review and release slot are clear. #282 is again a
   clean docs-only draft against current main; its prior comment is on the
   old head. Obey the numbered release rule (#207). #299 landed SIM8 at 2dcd07fa and used
   v2.19.22. #311 kept version/identity, skipped Netlify, and deployed Pages
   via Actions run 45395454827. Public GitHub Pages HTML/main JS byte-match
   the exact local subpath build; actual Chromium title/run, manifest/icons,
   four public tracks, 44 same-origin responses, zero errors. Netlify still
   serves the earlier root build. Distinct origins keep separate browser
   scores, preferences and ghosts; do not imply automatic migration. #300
   and #306 both propose 2.20.0; leave release ordering and next Morgan slot
   with the release owner. SIM7's #294 BSOD changes are in source history,
   not a separate changelog entry. Exact build ID now 7641c907…; preserve
   old receipts as historical and recapture exact evidence on each release.
   #308 adds the owner’s spend and prelaunch policy. Put `[skip netlify]`
   in every initial PR title; prefer local tests and GitHub Actions. Default
   zero discretionary previews; at most 10 actual preview builds across
   agents per Eastern date, only for owner testing, logged first in the
   ledger and #309. Owner-requested exceptions are separate. Production
   deployments are separately coordinated; a skipped PR is not a skipped
   merge deploy. #308’s actual commit skipped production. Preserve replay
   versioning; no old-tape migration or compatibility gate before public
   launch and at least 10 real players. #290 is current UI parity only.
   Gal Friday Review App worked on the empty #307 fixture, but its polling
   check is advisory and #295 is still draft. Treat only a fresh independent
   exact-head judgment as real approval; #290 has COMMENTED only.
   Main #292 added a Vite entry for opt-in BSOD QA without changing the version. No #292
   file overlaps the nine drafts. Applying #278's exact source delta to
   570fc88 passed 30 focused tests and same-path 4,844-file build parity.
   This is integration QA, not a new draft head or review verdict.
   On 570fc88, exact #281/#282/#283/#286/#287/#290 deltas also apply
   together in scratch: 229 focused tests across 11 suites, ruleset and
   identity checks, and production build pass. #290 repeats real Chromium
   Game Over A/B with no errors/outbound requests. #269 exact delta reapplies on
   landed SIM7 5a7e3be: 42 tests and all 4,846 production files unchanged.
   A genuine SIM7 QA tape from two identical native 185 m runs and nine
   historical fixtures retain V1 bytes; opt-in V2 CLI/Chromium SVG bytes
   match across all ten. No errors or outbound requests; not replay/score
   verification or an independent Gal approval. #288 passes 47 tests, plus
   18 fresh current-source browser repeat/playbacks; classic output stays
   byte-identical, fatigue fails closed with the corrected diagnostic.
   Main then added #293, opt-in BSOD QA files only (no overlap). Exact
   combined #290 and #293 focused checks pass 13 tests; the heavier browser
   and artifact results above remain pinned to 570fc88. No draft heads
   changed. Recheck the actual current base on any release candidate. #288 on exact
   landed SIM7 main plus its unchanged patch passes 47 focused tests and
   18/18 fresh Chromium repeat/playbacks: same classic output, verified
   fatigue fails closed with no output and better diagnostics. This does
   not imply SIM6 tape playback compatibility.
2. #127 fair1153 (mask 16) on exact SIM6: Shatter Wall `17:2` x37680 →
   Packet Spike `18:0` x38301, 621 px. Fresh native 320 ms policy hits
   tick 9073 with 8.33 ms blind fade left; 300 ms policy hits same sensor
   tick 9097 after expiry by 33.33 ms. Both unprotected, exact repeats.
   This proves timing, not causation/unfairness. #286 includes exact
   stock commands. Preserve separate historical #202; no new speculative
   tuning. Full branch/route model remains gated on #57/#60.
3. #81/#290 exact unchanged bd43a5a composes onto #311 main 398c8b6.
   Built both unpatched/patched Pages subpaths, 49 focused tests and
   identity passed. Fresh persisted Chromium root-to-subpath test on
   the SAME origin retained the identical two natural 185 m SIM7 test tapes
   across separate profiles, and each new session saved a 28 m SIM8 run.
   Only the patch labels three stale/unstamped slots INCOMPATIBLE and
   removes their false Shared Run; same-origin replace, clear, Escape and
   retry passed, drawing one current rider. A second origin in the same
   profile did not see the first origin's stored course. This is local
   integration proof, not a deployment or a new approval; #290 stays draft.
   Earlier same-origin persistent Chromium A/B passed on landed SIM8
   2dcd07fa and unchanged bd43a5a. A genuine natural 185 m
   SIM7 b569fa7 tape persisted; a controlled shorter 28 m SIM8 run became
   Best/Latest. Old/unstamped still read, only current rendered; the patch
   removed false Shared Run and labelled old rows INCOMPATIBLE. Real
   replace/clear/escape/retry, 27 focused tests and build identity passed.
   Prior on-disk Chromium A/B also passed on exact landed SIM7 main 5a7e3be with and without exact #290 bd43a5a. Genuine SIM6
   b848b03 sim-02 tape (185 m) stayed readable across a fresh process and
   unrendered; a controlled shorter SIM7 run (28 m) became Best/Latest.
   Baseline shows stale distances/false Shared Run, patch says
   INCOMPATIBLE. Replace, clear and retry work; only the current ghost
   draws. 24 focused tests, ruleset/identity and builds pass, no outbound
   or page errors. This is the local UI/upgrade fix, not old replay or
   sharing support. Previous #248-draft A/B remains separate evidence.
   Exact #302 draft 4ca840e plus the #290 delta composes without conflict:
   60 focused tests, normal build/identity and same-origin Chromium A/B.
   Both variants kept the 416×236 Shop frame stable; interior click/G
   stayed in Shop, Escape closed it, then Ghost labels and replace/clear/
   retry behaved correctly. This is SIM7 scratch evidence, not a merged
   head. Repeat on the actual integration base after any release change.
   Friend exchange still requires #58.
   #82 needs separately scoped save-system review. Exact main `e3fdd81`:
   two identical disposable Chromium runs observed a native put success
   followed by transaction abort. saveRun resolved and kept the row in
   memory; duplicate ID opened no write even after diagnostic re-init.
   After full browser restart, the completed control survived and the
   aborted row did not. Fresh-store same-ID save was durable. The separate
   synthetic two-store check again rolled both rows back together, unlike
   split storage. Require a completed atomic run + provenance commit and
   verify on reopen before counting a durable cohort; preserve legacy
   memory fallback. No production storage or ranking change.
   #85 has a private 9-second scripted recapture candidate, not archival
   footage or gallery approval. Exact #272 SIM6 `22b6ade` and #297 SIM7
   `d3e80fa`, stock level 1, neutral modifiers, `canopyHop`: fresh paired
   Chromium runs for sim-01 and sim-02 exactly repeated. SIM6 reached
   180.02s cutoffs at 3,574.3/3,720.4m; SIM7 actual BSOD at
   84.42/80.62s and 1,596.2/1,542.3m. Capture uses sim-01, matched
   78.42–84.42s; render-only sampling preserved stock run records
   (excluding wall clock). No build deployed, official scores, replay
   migration or gallery code. Original archival footage remains unverified.
   #84/#83 and product #70/#71 need #60;
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
   fail closed. Repeated both cases on historical SIM6 570fc88's exact
   normal browser entry (after #292): same tick outcomes, all stored poses match, and
   public #78 cutoffs still produce no output. In that SIM6 check, normal served index
   SHA-256 starts a1319ec7, separate QA starts dcabd1df, old normal
   starts 8d904f4c. Build ID alone does not distinguish these; require
   exact standard index/assets, no QA path, query or redirect. No changes
   to original strip/SVG, #78 JSON or #278 head. Isolated prototype on
   pinned eb281d8 now shows a separate fatal detail only for the verified
   fixture. Chromium checked positive/cutoff UI and both byte-identical
   SVG downloads. It rejects wrong tape/build/entry, changed stored pose
   or tick, and copied receipts. Fixture-local only, not a public contract
   or product rollout; wait for independent review before integrating.

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
| Bootstrap / #282 | Exact PR head `cc200434c7625497cbf1153528c6320492f44c70` | Draft recovery pointer only, not part of the 21 issues. |
| #81 / #290 | `morgan/issue-81-ghost-row-revision` @ `bd43a5adecee4dc9e60f377b9a9735d0e373ce5b` | Draft, local UI parity only; #311 exact Pages-subpath persistent Chromium A/B, 49 tests, identity. Not deployed. |

All required work can be reconstructed from remote refs; no disposable worktree
or local patch is required for the drafts. Local-only #82 browser
prototype is not pushed and must not be mistaken for a PR.

## Original handed queue: all 21 issues

| Phase / issues | Progress or blocker |
|---|---|
| 1: #132, #82, #87, #79, #126, #85 | #132 done via #167; #82 calculations shipped #169, durable provenance / screen work gated; #87 #170/#213 and #79 #174 shipped bounded slices, active drafts above; #126 #171/#189/#218 shipped synthetic tools; #85 has a provenance-pinned scripted recapture candidate; original footage and gallery decision remain open. |
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
  #248 is historical preview only. Owner approved the tested 60% AirBrake
  kick and unchanged upward impulse. #299 SIM8 landed as 2dcd07fa. Gal/Home's
  #300 latest draft `f91134e7d48306bb9f0a9a3447969a97c7a858da`
  reconciles the two parents without force-pushing. It retains the
  approved one-shot 60% cut/same pop, ordered substep settlement, Flow
  elapsed before touchdown, and no vacuum payment. The candidate is SIM9
  with last-released still 8; no release seal until authorized.
  #306 music draft `8fbdc753ad6e1f15b4d47bf3ae76bc7a9efdd30b` and #300
  BOTH propose 2.20.0. Do not release both separately as 2.20.0, nor infer
  order or a joint release. Re-evaluate the second on actual landed main.
  Exact #311 + these heads auto-merge RunScene, Views and StemMusicDirector;
  only changelog and source digest conflict textually; matching package
  metadata hides the semantic version conflict. Local scratch resolution
  passed 274 focused tests (including conditional #287), the exact Pages
  subpath build/identity and actual Chromium title/run/catalog/install
  smoke. Paired 440-tick physics paths match despite 440 motion exceptions
  and injected landing fault at 104. The paid kick at 37, actual later
  contact, ordinary landing SFX and downstream listener remain intact.
  No deploy; same-tick relaunch is separately unit-tested. Both drafts
  still require fresh independent exact-head review and release order.
  #287 unchanged passes 111/111 on landed SIM8; exact #311+#300 f91134e7
  still shows two expected held-input failures. Conditional test-only
  follow-up (not pushed): charge a consumed pulse, not held input; add
  immediate 40-point pulse and held/duplicate negatives; keep separate
  canopy, pending, bank, landing bonus, combo and earned-flow controls.
  152 focused tests pass on just #311+#300; replacing paid with raw-held
  and removing duplicate guard each fail as intended. Refresh after
  actual SIM9 release; no #287 head or point coefficient change.
  #310 QA draft `cf0ba71de69a7cb818516a18db063e829bb28c7b` is on #306
  8fbdc75. Author reports qualified, scripted QA-triggered live crashes on
  all 33 opening segments in one biome, worst estimated -0.404 dBTP.
  Exact-source synthetic audit: all armed samples are captured, but native
  finite/peak metrics trim 48 frames per side. Full-range existing meter
  catches previously missed edge impulses, unity, NaN, and Infinity,
  still reporting 48 interpolation-only edge frames. No real clipping
  observed by this synthetic test; do not re-label old private receipts.
  Independently calibrated FFmpeg passed EBU 3341 vectors 15–23, but both
  4x meters underread the synthetic 19.2kHz control by about 0.43 dB;
  16x diagnostic recovered its known peak. Next in #291: full-buffer
  native gate and fresh same-host float reference metering of worst,
  overlap, crash and transition tails, retaining only metrics. Preserve
  gains, private media and all release/listening/beat gates.
  #312 is separate listening work in the music lane: 15 low dry-stem
  endings despite source clock handoffs. Not a measured audible gap or an
  approved fade; retain original masters and await actual private A/B.
- Main stays release-controlled. Keep synthetic developer evidence out of
  gameplay, saved formats, scoring and ranked eligibility unless authorized.

Recovery: a history-free Morgan startup read this branch and caught the stale
#273 note above. The root repository pointer is in draft #282, not yet on
main. No unfinished bootstrap write is required to use this checkpoint.
