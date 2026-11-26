# #135 — signed independent admission source integration (pre-public release)

**Provenance:** This is Gal Friday's engineering plan using existing Marvin
requirements. It does not establish new owner decisions on verifier policy,
identity, pricing, fees, deduplication, or service operation.

**Source:** draft #406 on v2.25.6, Ed25519 issuer-role signatures, SQLite
challenge and one-use admission, plus independently replayed native evidence.
**Base:** will integrate only after source-only #119 v2.25.7 current main.

## Fixed security rules

- Public leaderboard decisions may NOT accept local wallet balances, client
  receipts, verified flags, or a client-authored challenge as authority.
- Free peer and paid developer-run verification must compute identical
  validity, Verified status, rank eligibility, and rewards; no paid advantage.
- Local/offline play remains fully usable. Nothing uploads automatically.
- Provisional Unverified display and private blinded peer assignments remain
  separate future server/user-flow work, not implied by this source component.
- Only signed, role-separated issuer receipts may pass this reference ledger;
  the real authority issuer, account authentication and wallet remain absent.
- Every hostile byte/error/expired/replay/nonce/role-substitution test must
  fail closed with no verified rank/reward or double admission.
- Do NOT launch a public API, handle production keys, or create live users.
- The current dev TTL and global tape/run dedup choices are not approved
  competitive policy. Preserve their experimental status.

## Release evidence

- Restore all original #406 source and history via non-force merge.
- Independently inspect the crypto role/claim/challenge binding and SQLite
  transaction semantics. No assertion of formal review without evidence.
- Require real Node crypto/SQLite negative tests, pure trust-policy parity,
  native replay QA, client bundle isolation, source identity, and Pages CI.
- No verified public service in this release. Parent #135 stays OPEN.
