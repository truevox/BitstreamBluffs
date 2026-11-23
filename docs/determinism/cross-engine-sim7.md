# SIM_REVISION 7 conformance preflight — issue #249

**Status: EXPERIMENTAL / DRAFT, not frozen golden evidence.** SIM7 is the unmerged, owner-playtest-pending AirBrake balance candidate from [[GitHub PR #248](https://github.com/truevox/BitstreamBluffs/pull/248)]. This leaf is stacked on that PR, not on main. **Do NOT commit final fixture tapes or claim cross-engine parity until the owner has accepted the numeric feel settings and an exact clean source has been pinned and reviewed.**

## What is implemented for preliminary QA

- `CE_FIXTURE_SET=sim7` selects a new **11-case** fixture definition list, based on the nine v6 diagnostic cases plus two explicit AirBrake exercise patterns. Neither the old original `FIXTURES` nor the complete `FIXTURES_SIM6` are changed, and the existing immutable `cross-engine-sim6` tapes and browser reports are untouched.
- `airbrake-pulse` actively alternates short 200ms AirBrake holds/releases after takeoff on the deterministic `CE120-CHUTE` course. `airbrake-canopy-overlap` presses both AirBrake and finite-fuel canopy at the same time. Same seed is deliberate; their recorded inputs differ. The browser hook counts **actual physics-tick active** AirBrake, canopy and simultaneous overlap, NOT merely desired keyboard presses.
- The recording command **rejects** the new fixtures if the actual live `Sled.airBrakeActive` count is under 35 or total airborne ticks under 100; the overlap case also demands 35 live canopy ticks and at least 25 ticks where both controls are active. This avoids false success when the course crashes before the button was truly actuated.
- Recording is still allowed only in a brand-new absolute directory outside *all* versioned/historical tracked fixtures; each tape/metadata is created exclusively (`wx`) and tied to a clean committed source, exact build, ruleset revision, served build index and SHA-256. The read-only `sim7` fresh/matrix/positions commands reject unknown/cross-version/mismatched metadata and tape hashes before any browser is started. In particular a valid SIM6 tape cannot be silently treated as a SIM7 run.
- Existing sim6 source pinning/reader behavior and historical fixture semantics remain unchanged. The page JS instrumented one more **diagnostic-only** count. This does not alter production AirBrake physics, scoring or input.

## Experimental recordings (do not commit as final goldens)

Run from an **isolated, clean, pinned** SIM7 build worktree after `npm run build`. The preview must serve the exact local `dist/index.html` bytes.

```bash
# Separate terminal: same clean worktree, local 127.0.0.1 host
npx vite preview --host 127.0.0.1 --port 8492 --strictPort

# NO output in tools/conformance/fixtures; a new unique external directory:
CE_FIXTURE_SET=sim7 FIXTURES=airbrake-pulse,airbrake-canopy-overlap \
CE_TAPE_DIR=/srv/friday-audio/bsb-qa-v7-preliminary/record-UNIQUE \
GAME_URL=http://127.0.0.1:8492/ PLAYWRIGHT_BROWSERS_PATH=/home/hermes/.cache/ms-playwright \
node tools/conformance/cross-engine.mjs record

# Once a full prospective set is recorded, replay it using exact current build:
CE_FIXTURE_SET=sim7 FIXTURES=airbrake-pulse,airbrake-canopy-overlap \
CE_TAPE_DIR=/srv/friday-audio/bsb-qa-v7-preliminary/record-UNIQUE \
ENGINES=chromium-headless-shell FRESH_HZ=120 GAME_URL=http://127.0.0.1:8492/ \
PLAYWRIGHT_BROWSERS_PATH=/home/hermes/.cache/ms-playwright \
OUT=/tmp/bsb-sim7-preliminary-fresh.json node tools/conformance/cross-engine.mjs fresh
```

## Still required before merging #249

Owner accepts a numeric AirBrake version; PR #248 independently reviewed and merged (the physics needs a new sim revision). Rebase this draft on **main** after that; issue its own versioned QA release metadata. Capture every new SIM7 tape under a new immutable, source-stamped directory. Record real contact/hazard, all 11 (or expanded) paths, and cross-engine Chromium/Firefox/Playwright WebKit (not Safari) fresh and 30/60/120/144 Hz matrix. Pin byte hashes, source/build IDs, checkpoint comparisons, replay/date/session outcomes; retain the raw external evidence. Validate physical AirBrake lift profile beyond input counts, upgraded AirBrake Lift and vacuum/low-atmosphere/biome cases, and actual touch/gamepad paths separately; the two new fixtures by themselves do **not** establish these cases.

This is a recording safety and exercised-control preflight, not an announced SIM7 compatibility certificate or completed production replay implementation. Full-game playthrough inherited failures remain #241 and are not waived.
