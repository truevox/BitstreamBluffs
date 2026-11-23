# Local playable BSOD A/B testing — Issue #128

**QA only; not shipped.** `src/`, `index.html`, production builds, persistence schemas and ruleset identity are unchanged. The launcher injects a script into *its own local Vite server*, never into the game's production HTML. Do not deploy this launcher publicly.

```bash
npm ci
node tools/bsod-qa/serve.mjs
```

From the same machine, open:

- `http://127.0.0.1:5174/?bsodQa=moderate&qaSeed=bsod-ab-01`
- `http://127.0.0.1:5174/?bsodQa=buffered&qaSeed=bsod-ab-01`

If the repo is on CT223, open an SSH port-forward from your own machine first: `ssh -N -L 5174:127.0.0.1:5174 hermes@<CT223-tailscale-or-DNS-name>`. Then browse the localhost URLs. Do **not** open port 5174 to the internet.

Select **START RUN**. Both candidate links use the same pinned seed and base biome mask (`0`); compare equal sections of terrain, including the same levels and loadout from the local profile. Switching settings intentionally reloads and restarts the run. The overlay displays the current authoritative wall gap and speed. No saved scores, ghost tapes or XP are emitted; the end screen can still display this run's in-memory outcome.

| Candidate | Level-1 opening gap | Wall starting speed | Level-1 acceleration |
| --- | ---: | ---: | ---: |
| Moderate | 4,500px | 250px/s | 3px/s² |
| Buffered strong | 4,500px | 300px/s | 4px/s² |

The pursuer still applies its normal level-dependent extra start gap and acceleration attenuation, as well as actual enabled BSOD grace upgrades. This means the table is **level-1, clean-loadout effective values**; higher levels are intentionally easier. Nothing rubber-bands to the rider's skill.

## Playtest scorecard

Run each candidate on the *same seed*, record approximate time when the BSOD first becomes alarming, whether danger feels earned, whether you can recover from an airbrake/parachute mistake, BSOD/hazard crash, approximate score/distance, and whether you wanted the chase to last longer or end sooner. Alternate order between sessions to reduce learning effects; do not choose a production default solely on bot catch ratios.

## Scope and limitations

The local QA injection occurs on the `RUN_START` event, after production scene creation but before player physics advances, exactly like the browser counterfactual runner. A dedicated seed and mask are enforced through `TitleScene.startRun`. The running scene's `saveRun` and ghost saver are replaced with no-ops, and `RUN_END` listeners are removed for XP/mission credit. It does not erase any previously saved profile or scoreboard data. Verify with a *disposable browser profile* for independent human tests to avoid unrelated save-mutating activities in menus. This is a local tool, not a publishable preview. Any replay/cinematic feature with distinct start semantics warrants its own QA coverage.

Automated smoke validation: Vite launches; Chromium visits both URLs, manually invokes the normal `TitleScene.startRun`, waits for the real `RUN_START`, verifies `__bsodQaEvidence` and actual scene seed, no page errors. The QA script is *not* present on ordinary pages or production builds.
