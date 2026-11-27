# #424: old READY saves remain untouched across installed PWA updates

Every local one-use snapshot is exact-build-bound. A new build must
never automatically consume or delete an incompatible saved run.

This real two-version Chromium test uses the actual v2.25.30
source/identity at commit 87874c61 and the unmodified compiled
v2.25.31 Pages PWA. Since the shipped v30 minifier mangled class
names and could not create a valid ordinary stock Suspend, the OLD
test fixture alone adds esbuild.keepNames to its Vite build setting.
No old runtime/ruleset/source identity is changed, and its exact
identity gate is checked. This is NOT a claim that the shipped
v30 bundle could successfully suspend.

Acceptance:
1. Install old worker, start native stock RunScene and physically
   press the Pause SUSPEND RUN menu. Confirm a valid READY IDB row
   with run ID, exact tick, build ID and SHA-256.
2. Keep two old clients open; install a new waiting worker and
   confirm an old reload still uses old JS and the same READY slot.
3. Close both old clients, go fully offline and open a new cached
   v2.25.31 page. The old READY slot must be byte-for-byte
   unchanged and Title must show CLEAR OLD SAVE, not Resume.
4. First real canvas click changes label only to CONFIRM ERASE,
   with persisted slot unchanged. Only a SECOND deliberate
   physical click deletes the slot. No automatic migration,
   scoring authority, JavaScript exceptions or external writes.

Local actual Chromium result: PASS. Saved native tick 181,
258,248-byte v30-format row preserved exactly across worker
installation, two-client waiting state and fully offline cold
reopen. New build refused admission, first click preserved data,
second explicit click erased only the READY row. External music
catalog GET requests blocked; no outbound mutation.

This PROVES PRESERVATION, not migration: older exact-build READY
runs remain incompatible and cannot resume on v2.25.31. Future
reviewed migration/export policy, storage eviction, physical
Chromebook and non-stock states stay OPEN under #424/#119.
