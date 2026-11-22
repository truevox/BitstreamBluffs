# #126: compare reaction seeds across matched bot panels

Use this developer-only report to find courses where the same synthetic hop policy reaches the distance threshold with one reaction RNG label but not another. This complements the single-panel #70 shortlist. It does not select or publish an official Daily, replay the trials, modify any game path, rank courses, or estimate human fairness.

Produce the panels from the **same checkout/build and browser environment**, changing only `--noiseSeed`. Example from the repository root:

```sh
build=$(git rev-parse HEAD)
node tools/sim/run.mjs --verify --seeds sim-01,sim-02,sim-03 \
  --policy hop --noiseProfiles ideal,steady,distracted --maxM 500 --maxSec 25 \
  --noiseSeed bb-noise-1 --out /tmp/bb-noise-a.json
node tools/sim/run.mjs --verify --seeds sim-01,sim-02,sim-03 \
  --policy hop --noiseProfiles ideal,steady,distracted --maxM 500 --maxSec 25 \
  --noiseSeed independent-review --out /tmp/bb-noise-b.json
node tools/sim/compare-noise-seeds.mjs --build "$build" \
  --panel /tmp/bb-noise-a.json --panel /tmp/bb-noise-b.json
```

- Pass 2–8 regular local UTF-8 JSON panel files (at most 4 MiB each; 32 MiB total input). Use distinct reaction labels and simple course/reaction IDs, 1–64 ASCII letters, digits, dots, underscores or hyphens, starting with a letter or digit. Use the full 40-hex commit of the producing checkout, not the report tool's checkout if they differ.
- Only complete classic v1 hop-noise panels with successful runner-reported seeded repeat and input playback are accepted; unverified, fatigue, partial, and derived reports are not accepted. All panels must have the same course set, profile definitions, pass distance, time limit, biome mask, movement rule and hop lead. Unrecognized panel/settings fields are rejected rather than silently ignored.
- For each course, the full recorded `ideal` trial must match, not just its pass result. A changed input row, trace, final state or swapped control invalidates the comparison. Panel order, seed order, and JSON object key order do not change how trials are matched.
- Each profile has pass/non-pass counts per reaction label over the whole matched course set. A flip lists a course with both a pass and a non-pass across tested labels and identifies the labels that passed. Two different kinds of non-pass are not a flip. Different labels can produce the same effective actions. No rates are extrapolated beyond those tested labels and courses.
- The JSON report hashes the exact bytes read for every panel. The source Git commit is caller-asserted, and the comparison does not authenticate source files, independently rerun verification, or prove the browser/build settings. The CLI writes the report to stdout only; on failure it writes a diagnostic to stderr and exits nonzero. Input paths, scores, clocks, poses, input rows, traces and per-course raw trial records are not copied to the result.
