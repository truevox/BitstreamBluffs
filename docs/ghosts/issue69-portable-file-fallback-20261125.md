# P0 #69 — Explicit portable `.bbghost` fallback (draft; 2026-11-25)

## What it does

An input-heavy run can produce a Ghost-in-a-Link URL longer than 8,192 characters. This candidate adds a **bounded local binary file transport** that is usable without hosted storage, tokens, required accounts, or automatic network uploads. It does **not** replace the existing versioned URL flow for shorter ghosts.

- Game Over → Course Ghosts: First SHARE LINK press attempts the existing URL; if that URL exceeds the strict 8,192-character limit, the UI switches to **SAVE FILE** and discloses `FILE SHARES INPUTS + SCORE. SELECT AGAIN.` A second real click requests a native download named `bitstream-ghost-<safe-seed>.bbghost`. Clicking elsewhere cancels the armed action. No upload or network request is made.
- Recipient explicitly opens Title → Enter Seed → OPEN GHOST LINK → **OPEN FILE**, picks `.bbghost`, and sees the **same unverified-only** preview, comparison and optional two-step unranked practice admission as a pasted URL. No file is auto-loaded merely by visiting a webpage.
- File header is ASCII `BBGHOST1:` + 24 lowercase hex characters of truncated SHA-256 + newline + existing gzip-compressed allowlisted version 1 ghost payload. Strict overall file size cap **20,034 bytes**, compressed max **20,000**, expanded JSON max **96,000**, and existing trace/input/checkpoint caps. Checksums detect accidental corruption only, **not creator authenticity**.
- Common URL/file validation and unpacking logic permit *only* the prior allowlisted tape keys and normalization. Imports regenerate an opaque `shared:` run ID, discard original timestamps/user identifiers, never read private session query parameters, and always return `canCreditScore:false`, `canCreditWallet:false`, `canSubmitOfficial:false`.
- Corrupt/oversized/future-version files refuse entry and clear stale candidate state; a native file input is torn down when its preview view closes. Protected replay evidence, local ghost roles, player profile, wallet and scores cannot be written through this reader.

## Verification

1. `npm test -- --runInBand tests/src/ghost-link.test.js` checks URL compatibility, byte-for-byte payload equivalence between URL and file, actual high-density input stream requiring a file, strict finite size bounds, forged score trust denial, malformed/future files, and decompression bomb protections. All **11/11** passed locally.
2. `tools/test-real-ghost-file-browser.mjs` in actual source-compiled Chromium, desktop and 412×915 mobile-emulated: actual on-screen two-press SAVE FILE, **15,356-byte** native download of synthetic 1,900-input tape, real `filechooser` handoff, exact 1,900-row recovery, no saved runs/ghosts/rewards/network writes; malicious files refused and input node removed. Desktop/mobile **PASS**.
3. Ordinary production-built Pages-subpath Ghost-in-a-Link preview+guest practice desktop/mobile regression must remain green. Page build and deterministic identity unchanged from shipped v2.22.7 baseline.
4. CI source-browser gate in `.github/workflows/pages.yml` exercises both desktop and mobile file handoff after existing production Pages browser checks, and an additional path trigger covers the new test tool.

## Why this is still a draft

Physical Chromebook and Android native file chooser/download and long-file end-to-end experience remain **untested**. No server-hosted fallback is offered, and no automatic upload or user-approved hosting design is implied. The file format supports payloads that are within strict gzip/JSON caps; an outlier exceeding those caps is rejected rather than silently uploaded. This is not public score authentication or #72 mid-run takeover.

Current baseline `main` at `bb9fafd7` has 9 existing failures in `tests/replay/liveReplayAcceptance.test.js` and `tests/replay/rulesetCoverage.test.js` (confirmed by an untouched detached checkout); the independent protected replay candidate #369 addresses those separately. This draft changes neither RunScene nor those replay test files. Use its specific parser, UI, production browser and CI gates for isolated regression attribution. A later coordinated release merge must increment the game version and reconcile outstanding independent drafts in order.
