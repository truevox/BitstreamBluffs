# #77: a fixed stock neutral-run panel

This developer-only check extends the single [sim-11 pilot](issue-77-hands-off-pilot.md).
It checks one fixed set of 12 course seeds, not arbitrary seed discovery or
an official challenge. Use Playwright Chromium or an existing compatible
Chromium via `CHROMIUM_EXECUTABLE`.

Build main `7d5780fed63955d72691e2aaa436a9c59652f852`, then serve that compiled
preview on loopback. Run the CLI from the checkout containing this tool:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 8293
# In another terminal from the tool checkout:
node tools/sim/scan-hands-off.mjs --url http://127.0.0.1:8293/
```

The CLI checks the bytes of the compiled boot module, active ruleset loader
and active archive module, and the actual in-browser ruleset ID. The source
commit identifies the reference build; this does not authenticate an entire
checkout, asset set or server. No cross-version support is claimed. The
older #77 receipt stays pinned to its original run and is not reused here.

Every seed uses a fresh disposable stock **normal** run, biome mask 0, default
Trick Deck Right, no initial loadout and the Featherweight rule selected by
`2026-01-05T12:00:00Z`. The ordinary game ticks at 120 Hz through Phaser's
headless loop, with no per-tick rendering, input events/stub, physics setup
injection, or forced crash. The native pad codec checks that recorded input is
neutral. The boundary is 500 m at a **completed tick**; a fatal tick does not
count. Each trial is capped at 4,200 fixed ticks (35 simulated seconds), with
a separate 45-second wall deadline for simulation evaluation.

- **Verified candidate:** crossed 500 m on a completed tick, then reached a
  natural fatal event by the cap. A fresh native TapePlayer run must match the
  goal tick, exact terminal signature and all exact sled checkpoints. It also
  matches all 13 subsystem fingerprints at each native 120-tick checkpoint,
  with no omitted rows or fingerprint errors. It does not check a fingerprint
  on every fixed tick. Playback must not produce run, award, ghost or evidence
  saves in its disposable context.
- **Finished short:** a normal capture with a natural fatal event, but no
  completed tick at 500 m. Not replay-verified.
- **Capped, unverified:** still alive at the cap, even if 500 m was crossed.
  No finished native tape exists in this measured window. Not a verified
  candidate or a claim about the rest of the course.

Observed on the reference build: sim-11, sim-18 and sim-19 verified, each with
21 native checkpoints and all 13 fingerprint channels per row. Seven finished
short. Sim-16 and sim-20 crossed 500 m but were still alive at the cap, at
863.940 m and 839.637 m peak completed distance respectively. All output stays
in declared seed order; it is not a ranking or a human difficulty estimate.

The preview is HTTP `127.0.0.1` only; cross-origin requests, redirects,
WebSockets and service workers are blocked. The normal capture path can
create transient run/ghost/evidence data in its disposable context. The probe
does not retain them or transfer them to another origin. It writes only the
summary to stdout, never the tape, input rows, player data, scores or raw
fingerprints. Wrong build, incomplete or divergent evidence aborts without
a report; there is no official Daily, game menu, scoring or sharing change.
