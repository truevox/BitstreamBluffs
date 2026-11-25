# #244 — fresh current-build SIM9 evidence corpus (QA-only, 2026-11-25)

This is a **separate complementary gate** to the 46 historical recorded-tape corpus documented in `docs/replay/evidence-corpus-244-20261125.md`. It does **not** claim physical Chromebook/browser coverage, production quota exhaustion, external authenticity, server-approved scores, or completion of #244. No telemetry, upload, score submission, new gameplay mechanics, or public rankings are introduced.

## Reproduce against this exact checkout

The Jest probe uses real `RunScene.create/update`, actual Phaser-bundled Matter simulation, terrain/score/BSOD/Kodiaks and production `GhostRecorder`; **only Phaser rendering/DOM and frame scheduling are stubbed**. It records 12 distinct seeds with four input patterns, two upgrade/sync-level profiles and 600/1,200/1,800 requested-tick horizons. Four runs crash through natural simulation before the requested tick horizon. For the other eight, the QA harness deliberately moves the BSOD wall to trigger an **actual native fatal collision**, then observes `RunScene.doCrash → _saveGhostTape → GhostRecorder.finish` and reads the real saved local tape. No fake crash cause is attached to a manually finalized tape. This is test-initiated terminal behavior, not evidence of ordinary human performance.

```sh
BSB244_FRESH_CORPUS_OUT=/tmp/bsb244-fresh-corpus-local.json \
  npm test -- --runInBand tests/replay/freshSim9Corpus.test.js

# In a separate terminal start Vite from the SAME checkout:
npm exec vite -- --host 127.0.0.1 --port 18371 --strictPort

CHROMIUM_EXECUTABLE=/usr/bin/chromium \
BSB244_FRESH_CORPUS_OUT=/tmp/bsb244-fresh-corpus-local.json \
GAME_URL=http://127.0.0.1:18371/ \
  node tools/replay/test-current-corpus-browser.mjs
```

Do not copy the generated local test corpus into `public/`, commit it to git, or host it elsewhere; the browser driver passes the bytes directly to a local Playwright page. It independently loads and hashes the *served* current ruleset, verifies each canonical envelope and its SHA-256 against the Jest-produced bytes, persists all 12 in real Chromium IndexedDB v3, closes/reopens and byte-compares them, creates two atomic `pinned` local roles, proves protected deletion fails, deletes four unpinned bundles, and proves the remaining records survive another reopen. It also injects a simulated `QuotaExceededError` on a **known-new** digest, verifies memory-only exportability is **not** called durable, then explicitly retries and confirms durable recovery. The quota failure is **fault injection**, not actual browser storage exhaustion. No mutating HTTP requests or page exceptions are permitted.

## Observed local results

- **12/12** native fatal RunScene/Recorder tapes produced complete canonical current-SIM9 envelopes; **12/12** SHA digests unique, **zero** causal fingerprint-capture errors.
- Source tick horizons 600 / 1,200 / 1,800; observed native tape endpoints 600–1,800 ticks; four natural crashes, eight deliberate fatal BSOD QA interventions.
- Complete canonical evidence envelopes: **47,651 bytes total**, minimum **2,956**, median (upper middle) **3,917**, maximum **5,379** bytes. This particular 12-run corpus is intentionally smaller than the existing 46-record historical corpus and does **not** establish realistic high-quota pressure.
- Real Chromium: **12/12 persisted and exact byte-reopened**, two protected/pinned, protected deletion refused, four unpinned deletions survive restart, and simulated quota fail-closed/export/retry pass. **Zero** page errors, **zero** mutating browser HTTP requests.

**Remaining #244 release gates:** truly representative longer-duration/high-volume fresh production capture (including real causal contacts, hazards and high input density), real quota pressure on physical target browsers/Chromebooks and cross-engine devices, independent exact-head review of this QA slice, and separate #135 trusted public score/entitlement adjudication. Successful local SHA verification is byte-integrity only, not proof of honest gameplay.
