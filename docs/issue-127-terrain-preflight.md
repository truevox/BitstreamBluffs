# #127: Offline blind-spacing terrain preflight

Use this developer CLI to reproduce seeded hazard spacing before deciding what
to test in the game. It calls the production `TerrainGenerator` with the same
option inputs as `RunScene`, loading the five sets of checked-out JSON
definitions that the game loads with Vite. It does not open a browser, run a
sled, write a save, or change terrain.

```sh
node tools/sim/terrain-preflight.mjs --seed fair15 --mask 16 --from-chunk 22 --chunks 1
node tools/sim/terrain-preflight.mjs --seed fair4 --mask 16 --from-chunk 65 --chunks 1
node tools/sim/terrain-preflight.mjs --seed terrain-lint-417 --mask 16 --from-chunk 86 --chunks 1
```

The mask is an unsigned decimal 32-bit bitfield. The zero-based origin chunk
range is `[fromChunk, fromChunk + chunkCount)`, defaulting to `[0, 80)`. A
request can cover at most 256 origin chunks and cannot end above chunk index
4096 (exclusive). The range selects **blind spawn origins only**. The tool
looks farther forward when needed to cover each origin's reference clearance,
including through a second later chunk and at exact equality. If geometry
would exceed 64 lookahead chunks, or a scan would exceed 4,096 reported
pairs, the command fails rather than silently dropping findings. Reports go
only to stdout; redirect it to save one.

## What a finding means

The report pairs a blind hazard with each crash-classified hazard whose
**spawn-center X** lies strictly ahead and no farther than the production
`blindClearAheadPx` reference distance, including placements in other chunks.
It also reports the separate nominal distance at the generator's expected
speed during the blind timer alone, without speed or reaction padding. The
production generator currently uses the padded rule within its ground-blind
placement pass; here it is a comparison reference for ground and air origins.

Each entry gives exact world X/Y, chunk index, and separation in pixels and
meters. Generator distance is world X divided by its scale; it is not HUD
distance from the spawned sled. `motionKind` shows a declared moving or gated
hazard, if any; we don't estimate where a rolling hazard ends up, when a gate
opens, where a sled lands, the actual hitbox clearance, or whether the blind
effect triggers. The `glitchChasm` name in a finding refers to the crash hazard
definition, not a measurement of arbitrary terrain gaps. This is **not** a
finding of unfairness or unreachability. Branch routing, stall traps, dynamic
motion, actual physics rollouts and reproducible tapes are not implemented.

Selected reproducible pairs from the current content:

| Seed / mask | From → to | Spawn X → X | Separation / padded reference | Inside nominal distance |
| --- | --- | --- | --- | --- |
| `fair15` / 16 | Shatter Wall 22 → Packet Spike 23 | 43193 → 43819 | 626 / 1287 px | Yes |
| `fair4` / 16 | Shatter Wall 65 → Glitch Chasm 66 | 144710 → 145300 | 590 / 1428 px | Yes |
| `terrain-lint-417` / 16 | Shatter Wall 86 → Packet Spike 88 | 182292 → 183720 | 1428 / 1428 px | No |

The output fingerprints the four generator/dependency files and the JSON it
loaded. The algorithm prefixes `bitstream-terrain-preflight-inputs-v1` plus a
NUL, then hashes each repository-relative path, a NUL, its decimal byte
length, a NUL, and the raw bytes, with paths in code-unit order. This identifies
these local inputs, not an authenticated game build or a verified run.
