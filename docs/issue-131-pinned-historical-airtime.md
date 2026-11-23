# #131: airtime from one pinned historical replay

This developer pilot reads one existing synthetic recording,
`tools/conformance/fixtures/cross-engine/collision-heavy.tape.json`, from the
[cross-engine conformance fixtures](determinism/cross-engine-matrix.md).
It derives airtime from the original game's own grounded state; it does not
read a player recording, add telemetry or change replay compatibility.

## Reproduce

1. Check out the exact [recording source](https://github.com/truevox/BitstreamBluffs/commit/1e0e52469a7574893349b3f9afa8f0c90ccebe31)
   named in the fixture's `record-meta.json`:
   `1e0e52469a7574893349b3f9afa8f0c90ccebe31`. That checkout reports v2.16.0
   and simulation revision 1. The v2.18.1 label in the conformance report
   refers to its later matrix, not the recording checkout.
2. Install that checkout's locked dependencies, build it with `npm run build`,
   and serve the compiled preview on `127.0.0.1:8346`.
3. In the newer checkout containing this tool, use Playwright with Chromium and
   explicitly opt into the fixed fixture:

```sh
node tools/qa/historical-airtime-pilot.mjs --url http://127.0.0.1:8346/ --use-synthetic-fixture
```

The tool checks the fixture's exact bytes before parsing and checks the
compiled boot module, ruleset loader, active ruleset archive and live ruleset
ID before playback. It checks those runtime modules, not the provenance of
every served file. Use a local preview you built and trust. Unsupported
fixtures and newer runtime builds fail rather than opening a legacy tape in
the new game. There is no option to pass an arbitrary local tape.

Two fresh Chromium replays must agree at all 13 native cadence checkpoints
and on sampled state and groundedness at each of the 1,668 completed fixed
ticks. Airtime counts observed ticks where the native grounded flag was off,
converted at 120 Hz. An episode can overlap either observation boundary;
such an episode is not counted as a distinct takeoff-to-landing cycle.
No fatal tick is measured, and pose traces are not used to infer airtime.

On the pinned fixture the original-build check measured **418 airborne
ticks (3.483 seconds)** and **six observed episodes, four bounded by
grounded ticks**. This is fixed-tick simulation time, not wall time,
real-world air time or certification of any player result.

The bounded receipt reports aggregate numbers and the fixed pins, not raw
inputs, poses, local paths, seed, score, or profile information. It is not
general compatibility for older formats, cross-browser proof, or a public
replay verifier. The existing same-build airtime command is unchanged.
