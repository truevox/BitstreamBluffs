# #78: compare two existing local crash briefs

This developer-only helper compares the redacted outcome in two existing
[#190 v1 crash briefs](https://github.com/truevox/BitstreamBluffs/pull/190).
Choose each file explicitly. It does not read a replay tape, open a browser,
fetch anything, authenticate a report or modify the game.

```sh
node tools/sim/compare-crash-briefs.mjs \
  --observed /tmp/observed-brief.json --reference /tmp/reference-brief.json
```

Use the original JSON stdout from #190, including its indentation, field
ordering and final newline. The stricter byte check rejects duplicate keys,
unknown fields and edited formatting instead of silently throwing any of
them away. Each input must be a regular local file no larger than 4 KiB.
The helper checks the exact v1 shape (including its reported replay flags
and counts), but does not independently verify those claims. Its output
contains only the two bounded crash signatures and the decision:

- `match`: same nonhazard category, or same hazard category and public hazard ID.
- `mismatch`: different categories, or both have different public hazard IDs.
- `inconclusive`: both are `hazard`, but at least one brief did not expose an ID.

Matching labels do not mean the same crash, position, run, build, player,
cause of a defect, or legitimate leaderboard result. Replay and checkpoint
counts are not compared. By default, valid comparisons write one JSON result
to stdout and exit 0, including a mismatch. Invalid input exits 1 with a fixed
stderr diagnostic and no stdout. Neither output includes input file paths,
seeds, coordinates, raw observations or full receipt payloads.

For a local script that needs to branch on the decision, add
`--require-match`. Stdout is the same JSON for every valid result, and the
exit status is 0 for a signature match, 2 for a mismatch, or 3 for an
inconclusive comparison. Usage and input errors still exit 1. This checks
only the redacted signature, not replay verification or authenticity.

## Synthetic controls

The files in `tests/fixtures/crash-brief/` are unchanged #190 stdout from
locally reproduced synthetic runs, not raw tapes. `terrain-v1.json` is the
historical collision-heavy control on the v2.16.0 runtime (13 native
checkpoints per run). `packet-spike-v1.json` is the stock
[#205 canonical control](https://github.com/truevox/BitstreamBluffs/pull/205)
(8 native checkpoints). Each was reproduced in two fresh Chromium sessions
on its own pinned build. Packet Spike versus itself is a signature `match`;
Packet Spike versus terrain is a `mismatch`. The helper does not rerun them.
