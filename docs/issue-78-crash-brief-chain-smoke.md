# #78: end-to-end crash brief smoke on v2.21.2

This is a local, opt-in diagnostic with scripted inputs, built from
`044ebd4b68b4c80134cde5ec35f661b471a2e0b0` (SIM9). It checks the
normal production entry, not Vite dev mode, a QA entry or a player's browser.
Use a disposable checkout; there is no player tape argument and nothing is
uploaded. The smoke is pinned to one version, not a compatibility gate.

1. Build the exact commit with `npm ci`, `node tools/ruleset/build-ruleset.mjs --check-identity`,
   and `npm run build`. Start `npm run preview -- --host 127.0.0.1 --port 8293 --strictPort`
   in that checkout. This documentation/tool change does not alter the entry, so
   a production build of the tool branch at review time works as well.
2. From the checkout containing this smoke, use Playwright Chromium
   (`npx playwright install chromium` or set `CHROMIUM_EXECUTABLE`).
   Run `node tools/sim/crash-brief-chain-smoke.mjs`. For a different preview
   port, set `GAME_URL` to its HTTP `127.0.0.1` root.
3. Expect `CRASH_BRIEF_CHAIN_PASS terrain=2x7 cutoff=2x3+refused compare=0/2`.
   This is not a timing benchmark; software WebGL can take a minute or longer.

The smoke checks the preview index and game entry hashes before capturing
two fresh normal runs with the existing conformance recorder. Each uses
the classic mask, `CE120-BUMP3`, 120 Hz, `reckless` with `hopEvery: 400`
and RNG seed 9. The first naturally crashes at tick 937. Its v1 tape ends
at completed tick 936; two fresh production playbacks pass all seven
checkpoints and emit a redacted terrain brief without saving a run or tape.

The second run stops at tick 464 without crashing. The fixture gives its
synthetic cutoff valid run ID and end-time metadata, leaving the misleading
`cause: "crash"` header, encoded inputs, checkpoints and poses unchanged.
The same bytes pass strict tape intake and two fresh strict saved-tape
playbacks to tick 464, each with all three checkpoints, matched per-tick
state, no dropped time and no saved run or tape. In the separate
crash-brief invocation the CLI then exits 1 without JSON at the
missing-fatal gate. The clean playback proof ends at the recorded
boundary; no extra-tick replay proof is claimed.

The unchanged shell comparator returns 0 when given the new terrain brief
against itself and 2 when compared against the committed, historical
Packet Spike brief. This checks only category agreement; it does not replay
the historical fixture or prove two runs, builds, or underlying bugs match.
The recording contexts are disposable, browser requests stay on loopback,
and the smoke removes its temporary tapes and briefs on normal completion
or handled failure. No player export, sharing, scoring or storage code changes.
