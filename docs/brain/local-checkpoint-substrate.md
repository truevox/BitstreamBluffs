# #451 — local Lab brain checkpoint storage substrate (NOT yet production training)

This branch adds a standalone, unregistered, local-only IndexedDB storage helper. It does **not** wire a trainer, load a model as executable policy, admit external brains, award Bits/Verified, or create visible training UI. #24's observation/action/model ABI validator and a real trainer remain prerequisites. **Do not close #451 yet.**

## Guaranteed by this substrate

- One atomic IndexedDB record for complete bounded JSON checkpoint state (`brain`, `optimizer`, `queue`, `rng`) plus model ABI, `SIM_REVISION`, generation and SHA-256. Incomplete/cyclic/untrusted bytes fail #450 preflight and the checkpoint wrapper; the wrapper is still `storage-only`, NOT a validated model.
- Browser storage `persisted()` / `persist()` is attempted once per instance on first save. `persistent-storage` only when the browser reports approval; otherwise success is clearly labeled `best-effort` with an explicit export warning. A completed IndexedDB transaction is not proof the OS will retain it forever.
- Quota/security/IDB failure returns `ok:false`, NEVER a durable-success result; a detached memory-only checkpoint remains explicitly exportable. A second concurrent save is refused rather than mixing RNG/model bytes. Existing durable checkpoint is kept on incompatible model ABI, SIM revision mismatch, or older generation. A future migration/re-evaluation decision belongs to #452, not automatic rollback here.
- A separate `quarantine` record holds syntax-checked imported JSON without overwriting or running the active brain. Read-back checksum and metadata are checked before any bytes are returned. Export copies bytes defensively; browser download helper only reports *requested*, never claimed saved by the operating system.
- A best-effort independent `localStorage` marker provides a loud warning if Chrome clears only IndexedDB and marker remains. **Total origin eviction removes both marker and DB**, so loss cannot always be detected. A marker is never a backup.

## Test scope and caveats

`npm test -- --runInBand tests/brain/lab-checkpoint-storage.test.js` tests hostile inputs, refused persistence, explicit quota and security failure injection, full-state preservation, download gesture, corruption and eviction advisory. `node tools/lab/test-brain-checkpoint-browser.mjs` uses ephemeral real Chromium + native IndexedDB, reload, model downgrade refusal, quarantine corruption, separate IDB partition clear and CDP quota override. The CDP override is *reported honestly*: the current tested Chrome may keep accepting IDB writes even while quota override is active. If not enforced, that run is **NOT** evidence of a real quota failure. The test reports `enforced:false` instead of inventing a pass. Genuine OS disk-pressure eviction and physical Chromebook remain untested.

### Remaining #451 integration work

Connect the real validated model/optimizer and episode scheduler, choose a reviewed compatible ABI, provide player-facing save/export/import/restore controls and full disk-pressure/device testing. Preserve no-censorship/data-sovereignty goals without claiming that a browser can guarantee storage permanence. Offline backup bytes are inert until a reviewed model admission pipeline exists.

**Provenance:** Gal Friday engineering implementation and safety boundaries under issue #451. Not a new Marvin approval of checkpoint formats or a claim of released trainer functionality. [skip netlify]
