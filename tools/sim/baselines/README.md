# Sim baselines

## `biomes-b0.json`: the biome full-treatment tolerance reference (B0)

This is the reference for the B1-B4 per-biome gate: "survival and mean speed per policy within +/-15 % of that biome's
B0 baseline" (spec §6).

**Refreshed for #65 (Debutmont base biome + arcade bridges).** `reference` now holds the numbers on the #65 gameplay branch,
`beforeIssue65` the same commands on the rename head `abf738c` (terrain identical to main `0c8c6c1`), and `issue65Delta`
the difference. The original B0 numbers moved to `b0Reference`; with `beforeE7` (`8db8dee`, v2.4.1) and `e7Delta` they are
kept for history only: they predate the B1-B4 tuning and later hazard changes (the hop policy already survived 0/48 on main
before #65, against 19/48 in `b0Reference`), so the like-for-like comparison is `beforeIssue65` -> `reference`. Mask 0 is now
Debutmont terrain, and mask 1 (Debutmont's own bit) is the same terrain, so their rows are identical in the new columns.
What #65 changed, per row: hop mean distance -7 % to -16 % and mean speed -2 % to -4 %; flip mean distance +2 % to +10 %
and mean speed -5 %; handsOff mean distance -15 %. The hop and flip rows move by about the same amount in every mask, so the
shift is Debutmont's base content (its Groomer Cat in every sector) and the arcade bridges, not any one biome.

How it was made (system Chrome on NixOS: `BB_CHROME=... node -r <preload shim> tools/sim/run.mjs ...`):

    node tools/sim/run.mjs --seeds 48 --policy hop  --maxM 5000 --maxSec 300 --biomeMask <M> --workers 8 --quiet --out hop-m<M>.json
    node tools/sim/run.mjs --seeds 24 --policy flip --maxM 5000 --maxSec 300 --biomeMask <M> --workers 8 --quiet --out flip-m<M>.json

M is 0 and each biome bit (1 ... 1024). Run it on a `git archive` snapshot, never on a tree you are editing: `run.mjs`
serves the live tree through vite and reloads the page for every job.

Metrics, per policy and mask:
- `survived`: runs that reached 5000 m (end `maxM` or `maxSec`).
- `meanDistM`: mean `distM`.
- `meanSpeedPxS`: mean over runs of `distM * 20 / simSec`. `run.mjs` has no mean speed of its own; compute it the same way.

Read these limits before you use the numbers:
- **hop** is the policy that matters: it reaches the biome sectors, which start at 1000 m. With 48 seeds, one survivor
  is about 5 % of a mask's survival, so compare `meanDistM` and `meanSpeedPxS` first and treat survival as a coarse check.
- **flip** survives in 0-2 of 24 runs, so its survival count cannot carry a +/-15 % test. Use its `meanDistM` and
  `meanSpeedPxS`.
- **handsOff** crashes at about 330 m (median), before any biome sector, so it is the same for every mask. It is recorded
  only to show that.

| policy | mask | before #65: survived | meanDistM | meanSpeedPxS | #65: survived | meanDistM | meanSpeedPxS | meanDistM change | meanSpeedPxS change |
|---|---|---|---|---|---|---|---|---|---|
| hop | 0 base = Debutmont | 0/48 | 1331.6 | 530.7 | 0/48 | 1182.6 | 515.5 | -11.2% | -2.9% |
| hop | 1 debutmont (= mask 0) | 0/48 | 1402.5 | 529.1 | 0/48 | 1182.6 | 515.5 | -15.7% | -2.6% |
| hop | 2 garbage-dump-glacier | 0/48 | 1440.3 | 530.8 | 0/48 | 1253.8 | 516.4 | -12.9% | -2.7% |
| hop | 4 pyramid-peak | 0/48 | 1424.5 | 530.0 | 0/48 | 1212.0 | 516.9 | -14.9% | -2.5% |
| hop | 8 underwater-mountain | 0/48 | 1509.2 | 524.9 | 1/48 | 1384.8 | 511.5 | -8.2% | -2.6% |
| hop | 16 crystal-cavern | 0/48 | 1427.4 | 528.3 | 0/48 | 1240.7 | 514.6 | -13.1% | -2.6% |
| hop | 32 space-mountain | 0/48 | 1377.5 | 529.1 | 0/48 | 1247.6 | 515.4 | -9.4% | -2.6% |
| hop | 64 candy-cane-canyon | 0/48 | 1427.2 | 528.2 | 0/48 | 1240.4 | 514.5 | -13.1% | -2.6% |
| hop | 128 sky-jellyfish-mountain | 0/48 | 1331.6 | 529.6 | 0/48 | 1244.3 | 518.1 | -6.6% | -2.2% |
| hop | 256 steampunk-slopes | 0/48 | 1437.4 | 538.9 | 0/48 | 1282.7 | 518.3 | -10.8% | -3.8% |
| hop | 512 micro-mountain | 0/48 | 1384.0 | 531.2 | 0/48 | 1208.1 | 516.8 | -12.7% | -2.7% |
| hop | 1024 vertigo-vents | 0/48 | 1453.0 | 520.0 | 1/48 | 1309.1 | 502.7 | -9.9% | -3.3% |
| flip | 0 base = Debutmont | 0/24 | 878.7 | 550.3 | 0/24 | 962.1 | 525.1 | +9.5% | -4.6% |
| flip | 1 debutmont (= mask 0) | 0/24 | 912.7 | 551.1 | 0/24 | 962.1 | 525.1 | +5.4% | -4.7% |
| flip | 2 garbage-dump-glacier | 0/24 | 912.6 | 550.5 | 0/24 | 990.0 | 523.7 | +8.5% | -4.9% |
| flip | 4 pyramid-peak | 0/24 | 921.8 | 551.1 | 0/24 | 957.3 | 523.7 | +3.9% | -5.0% |
| flip | 8 underwater-mountain | 0/24 | 916.4 | 550.1 | 0/24 | 986.5 | 522.4 | +7.6% | -5.0% |
| flip | 16 crystal-cavern | 0/24 | 914.5 | 551.6 | 0/24 | 989.6 | 523.1 | +8.2% | -5.2% |
| flip | 32 space-mountain | 0/24 | 935.6 | 551.3 | 0/24 | 951.7 | 522.1 | +1.7% | -5.3% |
| flip | 64 candy-cane-canyon | 0/24 | 937.7 | 550.7 | 0/24 | 988.4 | 523.3 | +5.4% | -5.0% |
| flip | 128 sky-jellyfish-mountain | 0/24 | 912.5 | 551.2 | 0/24 | 988.8 | 522.8 | +8.4% | -5.2% |
| flip | 256 steampunk-slopes | 0/24 | 947.0 | 552.6 | 0/24 | 970.0 | 524.8 | +2.4% | -5.0% |
| flip | 512 micro-mountain | 0/24 | 912.4 | 551.8 | 0/24 | 974.7 | 525.3 | +6.8% | -4.8% |
| flip | 1024 vertigo-vents | 0/24 | 944.0 | 552.6 | 0/24 | 1023.2 | 521.1 | +8.4% | -5.7% |
| handsOff | 0 base = Debutmont | 0/24 | 438.2 | 515.4 | 0/24 | 374.5 | 494.1 | -14.5% | -4.1% |

The `reference` numbers above (the #65 columns) are the tolerance reference from now on. They were made like this
(Chromium headless shell, a `git archive` snapshot of each commit, 4 workers):

    node tools/sim/run.mjs --seeds 48 --policy hop  --maxM 5000 --maxSec 300 --biomeMask <M> --workers 4 --quiet --out hop-m<M>.json
    node tools/sim/run.mjs --seeds 24 --policy flip --maxM 5000 --maxSec 300 --biomeMask <M> --workers 4 --quiet --out flip-m<M>.json
    node tools/sim/run.mjs --seeds 24 --policy handsOff --maxM 5000 --maxSec 300 --biomeMask 0 --workers 4 --quiet --out handsOff-m0.json

Survival is 0-1 of 48 in every hop row on both sides, so it carries no signal; compare `meanDistM` and `meanSpeedPxS`.
