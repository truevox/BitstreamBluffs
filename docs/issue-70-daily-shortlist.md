# #70: Offline Daily course shortlist (developer tool)

Use the existing #126 harness to record one small, comparable panel. Run it
from the game and harness revision you intend to identify. For example:

```sh
node tools/sim/run.mjs --noiseProfiles ideal,steady,distracted \
  --seeds sim-01,sim-02,sim-03 --biomeMask 0 --rule none \
  --maxM 500 --maxSec 25 --verify --out bot-panel.json

node tools/sim/shortlist-daily.mjs --panel bot-panel.json \
  --build "$PRODUCER_COMMIT" > shortlist.json
```

`PRODUCER_COMMIT` is the full 40-hex Git commit for the game and harness
checkout that actually produced the panel, not necessarily the revision of
this reader. If the producer had local changes, do not present its commit as
an exact source pin. The flag is a **caller assertion**: this reader does not
resolve Git, inspect the producing checkout, or authenticate the file. It
prints the SHA-256 of the exact input bytes to identify which file it read.
Given those same bytes and the same commit, it writes byte-identical JSON.

The reader runs offline and opens no browser, network connection, or save.
It takes one regular UTF-8 JSON file up to 4 MiB, and writes only to stdout
(or a destination chosen through shell redirection). It requires the
successful #126 `--verify` report, ideal plus at least one noisy profile,
1–12 distinct seeds, and exactly one result per seed/profile pair under the
panel's settings. It checks the two runner-reported verification flags in
every cell, the profile summaries, and basic structure and consistency of
the original trial's input encoding, frame/tick counts, pose samples, planner
counters and terminal fields. Failed checks exit nonzero rather than counting as
failed runs. This does not check all policy constraints or recalculate
physics from the input. The report does **not** carry the alternate
repeat/playback runs, so the reader cannot recompute those comparisons
without running the harness again. The hash identifies source bytes; it does
not prove who wrote them.

## Reading the shortlist

A candidate is a seed where `ideal` reached the distance threshold and at
least one tested noisy profile did not. Crashes, simulated timeouts and
stalls remain distinct in the evidence. A seed that only a noisy profile
passed is not shortlisted without a passing ideal baseline. Unselected
seeds remain visible as controls. Seeds are listed in code-unit order, not
ranked by score, distance, or inferred difficulty. The output contains the
seed/settings, per-profile observations, and the report digest and build
assertion. It does not export score, input rows, poses, replay data, or
raw terminal state.

The profiles are **variants of one synthetic hop policy**, not different
player populations or independent riding policies. Threshold contrast is a
cue for playtesting, not evidence of fairness. At 500 m and mask 0 this
experiment does not compare biomes, detect geometric diversity, generate a
candidate pool, select an official Daily, or change Daily rules or standings.
