# Morgan — Bitstream Bluffs working checkpoint

Last verified: 2026-11-23 20:29 UTC. Main: `eb281d8ee34c51c16c10dbe7735c4bcbab5aaede` (v2.19.21).
Goal: advance the handed [#168](https://github.com/truevox/BitstreamBluffs/issues/168)
21-issue portfolio one independently testable Morgan slice at a time. “Keep
going” means resume this queue, not take over other lanes or merge a draft.

## Next actions, in order

1. Check the eight source-review handoffs (#269/#278/#281/#282/#283/#286/
   #287/#288) for exact-head Gal feedback and current checks/base/overlap.
   Fix actual feedback before expansion. No merge of drafts. If cleared,
   obey the numbered release rule (#207); #248 reserves v2.19.22.
2. #127's docs are reviewable; no live blind-to-sensor witness yet.
   Extended corpus: mask 16 fair1139 Shatter Wall `12:2` (x26675) →
   Packet Spike `13:0` (x27254), 579 px. Native Chromium hop 320/380ms
   repeats hit the exact wall, but the sampled timer expires about 140–150 px
   before target center, and the live target sensor receives no contact.
   Stock pickup shield was held; not an unprotected run. Nominal geometry
   is not a gameplay verdict. Preserve separate #202 historical evidence.
   New positive evidence would need live timer, exact sensor contact,
   matched controls, and protection checks; do not re-test this failed pair
   unchanged.
3. Revisit blocked work only when its evidence or prerequisites move:
   #82 storage lifecycle needs a separately scoped save-system review;
   #85 needs authentic footage; #84/#83 and product #70/#71 need #60;
   #81 friend exchange needs #58; #75/#100/#74 need trusted restore or
   equivalent causal replay prefix. #243 remains a starter, not a restore.
   Do not take over #155 full Pulp or change #157 scoring coefficients.

## Active branches and ownership

| Issue / PR | Branch and exact head | State |
|---|---|---|
| #87 / #269 | `morgan/issue-87-art-v2` @ `00d47d12fa154ebcb35040a2bca0792d657390f0` | Draft, opt-in local art; 534 focused tests; pending exact-head review. |
| #79 / #278 | `morgan/issue-79-keep-selected-pose` @ `49bb37e4591228e319d88e5ceb8688fc4440be14` | Draft, cursor fix verified in Chromium; 528 focused tests; same SVG export and production build. |
| #78 / #281 | `morgan/issue-78-require-crash-match` @ `cb29f1952471b6743073dd891c43f43858a28b3e` | Draft, opt-in shell decision codes; 1,263 focused tests; same default JSON and production build. |
| #126 / #283 | `morgan/issue-126-dispatch-frame-test` @ `d402a868d505d608c4b0d3e9205c78b5880e8b7f` | Draft, test-only coalescing at frame 363; classic/fatigue, 554 focused tests and negative mutation control. |
| #127 / #286 | `morgan/issue-127-pin-preflight-examples` @ `c60ceb4c24b13bebb4dc40e785b22e28ae3e5193` | Draft, docs only; three historical commands verified at both revisions; two SIM6 geometry examples verified, no live verdict. |
| #157 / #287 | `morgan/issue-157-utility-score-baseline` @ `a7e795f30a1889d5fa057f6e078c86184c96fe90` | Draft, test only; separates utility points, combo, flow and landing components; 111 tests and two reversion-verified negative controls. |
| #70 / #288 | `morgan/issue-70-classic-panel-diagnostic` @ `1bb776d021ad00162774e5f1ca0baf6a3f52313b` | Draft, offline diagnostic; classic output unchanged, verified fatigue fails closed with actionable message. 38 tests, 18 exact native-browser repeats and replays. |
| Bootstrap / #282 | Exact PR head `25333e9350d97f4f48563404d10273595e81c64f` | Draft recovery pointer only, not part of the 21 issues. |

All required work can be reconstructed from remote refs; no disposable worktree
or local patch is required for the drafts. Local-only #82 browser
prototype is not pushed and must not be mistaken for a PR.

## Original handed queue: all 21 issues

| Phase / issues | Progress or blocker |
|---|---|
| 1: #132, #82, #87, #79, #126, #85 | #132 done via #167; #82 calculations shipped #169, durable provenance / screen work gated; #87 #170/#213 and #79 #174 shipped bounded slices, active drafts above; #126 #171/#189/#218 shipped synthetic tools; #85 still needs authentic footage. |
| 2: #131, #129, #127, #84, #83, #81, #78, #77, #75, #71, #70 | Shipped slices: #131 #184/#228; #129 #205/#226; #127 #183/#202 (also draft #286); #81 #178; #78 #190/#237; #77 #186/#220; #71 #197; #70 #181 (also draft #288). #84/#83 need #60 and scoped identity; #75 needs trusted restoration/testable replay prefix, not a pose trace. Remaining rank, identity, sharing and product gates in #168 still apply. |
| 3: #157, #155, #100, #74 | #157 #195 and draft #287 baseline only; no scoring change. #155 #196/#208 cue fix shipped; #140 Team B #160 merged and closed; full Pulp not complete. #100/#74 await trusted restoration or equivalent causal evidence; #224 is a narrow milestone. |

Closed after bounded work: #132, #77, #129 and #131. Explicit PR directions: #167 and #169 shipped;
#173 was reviewed for Gal and merged at `17993228`. #168 is the tracker, not a
22nd feature. GitHub owns the live status, including closed vs partial slices.

## Handoffs and decisions

- Gal: source-review requests posted on each of the eight exact draft heads.
  None is a merge request, approval, or release reservation. Preserve #207.
- Internal helpers finished #157 and #70 test/evidence preparation. Root
  reviewed and published both. Instrumented #127 browser work is local,
  uses observation only and adds no code to shared runner/PR heads.
- Tracker #168 now lists all seven feature drafts and the remaining gates.
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
