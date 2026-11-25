# #244 — Native high-input-density SIM9 evidence QA (2026-11-25)

**Purpose:** complement the 12-run fresh-current corpus and historical corpus with a measured, source-bound *actual recorder* stress case. This is **not** a human-play dataset and not authentication of the resulting score. No gameplay logic is changed. No production evidence is uploaded.

## Reproduction

Run from a checkout containing the full #244 protected-evidence PR stack and current SIM9 source/ruleset, with dependencies installed:

```sh
export BSB244_FRESH_CORPUS_OUT=/path/to/local/dense-current-sim9.json
npm test -- --runInBand tests/replay/denseSim9Corpus.test.js
npm exec vite -- --host 127.0.0.1 --port 18371 --strictPort
# In a second terminal, with the SAME export, and Chromium installed:
GAME_URL=http://127.0.0.1:18371/ node tools/replay/test-current-corpus-browser.mjs
```

`denseSim9Corpus.test.js` drives **twelve fresh actual RunScene/Matter/SimClock/GhostRecorder runs**, with real `doCrash` terminal saves and production deferred evidence publication. It pins only the day for the daily rule, not the runtime timer scheduling. It varies two upgrade modes and four automated input patterns. **Tilt changes by one quantized analog step every simulation tick** to maximize the number of delta input rows; this is intentionally harsh synthetic-controller *input*, not a fake recorded-tape object or a claim of natural human input. Hazard/contact/score simulation remains native. Runs are attempted for 1,200/2,400/3,600 ticks, but natural crashes can truncate them. Remaining runs are ended by a QA-induced *native fatal BSOD collision* rather than inventing a terminal tape. Exact every-120-tick checkpoints/fingerprints, valid strict canonical manifest, native saver status, and a distinct SHA-256 per bundle must all pass. Every recorded changed input row must have tick delta 1, including the native fatal input after the last fully recorded tick.

The browser consumer independently checks the actual native source-built ruleset, byte digest, and complete canonical bundle. It performs **real Chromium IndexedDB writes**, two fresh reopen operations, protected pin refusal, unprotected deletions, and a simulated quota-retry path (fault injection). It must see zero page exceptions and zero HTTP mutations. The separate existing `test-real-evidence-quota-browser.mjs` checks real Chromium CDP-overridden quota using a *labeled synthetic stress envelope*; the native dense test does **not** establish actual quota exhaustion.

## Observed results on 2026-11-25 (one local run)

- **12/12** source-bound native terminal evidence bundles validated; 6 natural crashes and 6 QA-induced fatal BSOD collisions.
- **12/12** unique SHA-256 digests, zero native fingerprint-capture omissions, all native deferred saver statuses matched the independently rebuilt bundle. Native test asserts nonzero real Matter contacts and at least one naturally fatal hazard and terrain event.
- Actual recorded end ticks: **1,200; 768; 2,578; 1,200; 1,551; 1,155; 1,200; 2,400; 1,463; 1,200; 2,400; 1,391**. There are **18,518** actual per-tick input rows (including the fatal tick), with **6,006 native Matter collision-start pairs** observed. Five runs ended naturally by hazard collisions and one by terrain; the other six ended through the explicit BSOD QA intervention.
- Complete canonical envelope size **209,510 bytes total**, **10,071 minimum**, **15,870 median** (upper middle), **27,609 maximum**. By comparison, the less input-dense 12-run baseline measured 48,452 bytes; do not extrapolate either corpus to a universal human-player maximum.
- Real Chromium: **12/12** exact canonical bundles durable/reopened; two protected pins survive; deletion of pinned evidence refused; four unpinned deletions persisted after second reopen; explicit simulated quota failure correctly reported non-durable before retry, recovered on retry; **zero browser page errors, zero mutating HTTP requests**.

CI now runs both native corpus variants against the same tested source revision. **Still open:** actual long-form human/controller samples, physical Chromebook/storage pressure, cross-engine device behavior, public score authenticity/eligibility (#135), and parent #244 integration. This test does not close #244 or enable public submissions.
