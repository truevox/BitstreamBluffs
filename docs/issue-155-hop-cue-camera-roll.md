# #155: Camera-roll hop-cue diagnostic

This opt-in local diagnostic is pinned to the normal v2.22.7/SIM9 production
build at `bb9fafd71f4a700b3c544bae3fa028996ee31669`. It does not implement or
suggest enabling the Pulp camera. [The earlier no-roll diagnostic](./issue-155-hop-cue-visibility.md)
is unchanged.

From a disposable checkout at the pinned source, run `npm ci`, `npm run build`
and `npm run preview -- --host 127.0.0.1 --port 8455 --strictPort`. From the
checkout with this tool, run `node tools/qa/hop-cue-camera-roll.mjs`.
Use Playwright Chromium or set `CHROMIUM_EXECUTABLE` to an installed Chromium.
An alternate HTTP loopback port can be set with `--url`. The harness checks the
normal HTML and loaded module bytes, uses two fresh browser contexts, blocks
external requests and does not write or export player data.

A stock `sim-11` run is frozen at tick 120. A synthetic ground hazard enters
only the real cue planner, not the physics world. At fixed zoom, compare two
positions at zero roll, at opposite 6° rolls, and at the same rolls with the
existing edge badge forced by the harness. The badge is a **draw-only positive
control**, not a proposed production selection rule. Both rolled columns lose
part of the response triangle; both forced badge response triangles fit.
The rider remains in view in these frames, but these are not framing safe-zone
or look-ahead acceptance tests.

| Case | Column triangle right edge (480 px viewport) | Forced badge triangle right edge |
| --- | ---: | ---: |
| High, level → +6° | 476.25 → 485.30 | 464.43 |
| Low, level → −6° | 476.25 → 481.23 | 467.72 |

WebGL changes inside the triangle bounds are checked against a hidden cue,
with bracketing visible frames required to match. The numbers above are
reference observations, not portable pixel-count assertions. Every arm asks
for warn at 800 ms and hop at 1000 ms; sampled simulation state is unchanged.
This is not an audio-output check, general fallback guarantee, or whole-run
determinism proof. A future camera implementation should use projected bounds
and prove cue visibility, rider framing, downhill look-ahead and performance
over real canaries with the project’s existing verification gates.
