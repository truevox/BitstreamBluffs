# Morgan — Bitstream Bluffs working checkpoint

Last verified: 2026-11-23 19:47 UTC. Main: `eb281d8ee34c51c16c10dbe7735c4bcbab5aaede` (v2.19.21).
Goal: advance the handed [#168](https://github.com/truevox/BitstreamBluffs/issues/168)
21-issue portfolio one independently testable Morgan slice at a time. “Keep
going” means resume this queue, not take over other lanes or merge a draft.

## Next actions, in order

1. Check #269 / #278 / #281 / #283 for exact-head independent review, identity,
   and changed base/overlap. If Gal has approved the exact head, coordinate
   integration against fresh main and the numbered release rule (#207).
   #248 currently reserves v2.19.22; don't preempt it. No blanket merge.
2. If reviews are pending, #127: pin the old geometry examples as historical
   and add current source-stamped examples with no reachability claim.
   On main, the three documented origin windows now have no blind spawn.
   Current fair15/mask 16 is c28→29, 527 px; two policies died upstream.
   The shorter fair171/mask 16 is Shatter Wall c12 → Glitch Chasm c13,
   649 px. Native hop-policy repeats reached beyond them with no blind
   event and an earlier negated crash. A real blind-to-sensor witness
   still needs exact identity, live timer, and an unprotected approach.
   sim-02 is an early Glitch Chasm, not the blind pair. Keep #202 intact.
3. #82 connection cleanup needs a separately scoped save-system review;
   use the local experiment as evidence, not authority to patch SaveStore.
   Keep #85 awaiting authentic footage; current reconstruction is not archival.

## Active branches and ownership

| Issue / PR | Branch and exact head | State |
|---|---|---|
| #87 / #269 | `morgan/issue-87-art-v2` @ `00d47d12fa154ebcb35040a2bca0792d657390f0` | Draft, opt-in local art; 534 focused tests; pending exact-head review. |
| #79 / #278 | `morgan/issue-79-keep-selected-pose` @ `49bb37e4591228e319d88e5ceb8688fc4440be14` | Draft, cursor fix verified in Chromium; 528 focused tests; same SVG export and production build. |
| #78 / #281 | `morgan/issue-78-require-crash-match` @ `cb29f1952471b6743073dd891c43f43858a28b3e` | Draft, opt-in shell decision codes; 1,263 focused tests; same default JSON and production build. |
| #126 / #283 | `morgan/issue-126-dispatch-frame-test` @ `d402a868d505d608c4b0d3e9205c78b5880e8b7f` | Draft, test-only coalescing at frame 363; classic/fatigue, 554 focused tests and negative mutation control. |

All required work can be reconstructed from remote refs; no disposable worktree
or local patch is required for the drafts. Local-only #82 browser
prototype is not pushed and must not be mistaken for a PR.

## Original handed queue: all 21 issues

| Phase / issues | Progress or blocker |
|---|---|
| 1: #132, #82, #87, #79, #126, #85 | #132 done via #167; #82 calculations shipped #169, durable provenance / screen work gated; #87 #170/#213 and #79 #174 shipped bounded slices, active drafts above; #126 #171/#189/#218 shipped synthetic tools; #85 still needs authentic footage. |
| 2: #131, #129, #127, #84, #83, #81, #78, #77, #75, #71, #70 | Shipped slices: #131 #184/#228; #129 #205/#226; #127 #183/#202; #81 #178; #78 #190/#237; #77 #186/#220; #71 #197; #70 #181. #84/#83 need #60 and scoped identity; #75 needs trusted restoration/testable replay prefix, not a pose trace. Remaining rank, identity, sharing and product gates in #168 still apply. |
| 3: #157, #155, #100, #74 | #157 #195 baseline only; no scoring change. #155 #196/#208 cue fix shipped; #140 Team B #160 merged and closed; full Pulp not complete. #100/#74 await trusted restoration or equivalent causal evidence; #224 is a narrow milestone. |

Closed after bounded work: #132, #77, #129 and #131. Explicit PR directions: #167 and #169 shipped;
#173 was reviewed for Gal and merged at `17993228`. #168 is the tracker, not a
22nd feature. GitHub owns the live status, including closed vs partial slices.

## Handoffs and decisions

- Gal: exact-head independent review gate for Morgan drafts; no reviewer
  verdict on the active heads observed at this checkpoint. Preserve #207.
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
