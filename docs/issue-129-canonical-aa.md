# #129: one canonical same-build A/A control

This developer check compares one **newly recorded** stock fixture against two fresh replays of the same tape, on the same compiled build and Chromium engine. It qualifies one control for later matched-input comparisons. It does not compare different physics versions, verify historical compatibility, prove cross-browser parity, or establish player identity, anti-cheat or ranked eligibility. Keep #129 open.

Build `ca5850cabf2f03bbb6832393ef22c4a49f1006e7` (or a checkout that produces the same pinned entry and active ruleset module bytes). The runner checks those three served JavaScript assets and the loaded ruleset, not the provenance of every public asset, checkout or host. Run from the checkout containing this tool, with Playwright and Chromium installed. `CHROMIUM_EXECUTABLE` can select a compatible installed browser.

```sh
node tools/ruleset/build-ruleset.mjs --check
npm run build
npm run preview -- --host 127.0.0.1 --port 8293
# In another terminal:
node tools/qa/canonical-replay-aa.mjs --url http://127.0.0.1:8293/
```

Three isolated Chromium contexts use the normal game scene and stock `sim-05`, mask 0, Featherweight, with a frozen UTC start (`2026-01-05T12:00:00Z`). The first run receives no controls and naturally crashes on a Packet Spike at tick 984. The actual production recorder creates the tape and the normal deferred pipeline puts its canonical v1.1 evidence in disposable IndexedDB. The runner reads the stored bytes in a read-only transaction and validates with the committed ruleset. The byte digest, input/tape digest, course, eight combined and eight exact sled checkpoints all have to bind to this capture. The deliberate byte rebuild also binds the recorded header and claims to the native IDB row. The canonical manifest format is version 1, as specified by Replay Contract v1.1. Its advisory frame-first-tick metadata does not establish live keyboard timing provenance; #162 live sampling is outside this neutral fixed-pad check.

Both replays start at tick zero from the same newly captured tape, using the actual `TapePlayer`, and must match every saved exact checkpoint without saving another run, award, ghost or evidence. A detached compiled `GhostRecorder` captures all 13 expected subsystem fingerprints immediately after each of the 983 completed simulation ticks, before render updates, in all three arms. Missing ticks, unknown/missing channels and any mismatch reject the proof. The fatal tick is not a completed checkpoint; its emitted cause, hazard, position and speed are separately checked for exact equality. This compares the specified fingerprint fields and the observed terminal event, not every hidden browser state. It does not use snapshots, mid-run restores, or altered physics. It uses Phaser `headlessStep` at 120 Hz without per-tick rendering; this is not a visual/performance test.

The synthetic recording may write temporary run/progression/evidence data **only** in its disposable context. The verifier does not export the raw tape, bundle, fingerprints or terminal geometry, does not request persistent browser storage and does not publish a score. It prints a bounded local receipt with the controlled fixture seed, checksums and evidence counts. Only same-origin loopback GET/HEAD is allowed; redirects, WebSockets and service workers are blocked.

Focused checks: `npm test -- --runInBand tests/src/canonical-aa-guards.test.js tests/replay`.
