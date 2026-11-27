# #441 Platform capability bridge — ABI 1 (web/fake foundation)

For external-distribution eligibility and actual publisher submission gates, see [#445 portal preflight](portal-distribution-readiness.md). This document is the ABI implementation contract, not authorization for ad SDKs or partner submission.

The game registry has one shared `REG.PLATFORM` adapter initialized once by
`createServices`. Own-site Ride *always* chooses the explicit **web** adapter;
no hostname sniffing or SDK autoload. **Ride is always ad-free.** The
current web adapter has no ad SDK, but #444 explicitly permits a future,
separately reviewed, *optional Lab-only* rewarded-ad path on our own site.
That is not a blanket permission for ads in Ride or automatic rewards.

Contract: `{id, abi:1, capabilities:{storage,ownership,rewards},
 storage:{read,write,remove}, ownership:{get}, requestReward}`.
Methods are asynchronous and return tagged results instead of throwing for
permission denied, missing SDK, quota, and unsupported capability. `storage`
contains UTF-8 strings only, in `bb.platform.v1.` namespaced localStorage; this
is NOT the existing SaveStore/IndexedDB database nor a replacement for atomic
Steam file saves. A successful write means browser API accepted it, **not**
OS-backed durability or verified cloud sync. Never silently claim a payment,
Shard, score, Verified run, or rewarded outcome through adapter metadata.

`requestReward({placement})` resolves with an explicit status: `completed`,
`closed-early`, `no-ad`, `blocked`, `busy`, or `unavailable`. Only an eventual
platform-reviewed handler can return a real earned reward. The **current web adapter** always returns
`unavailable`, so Ride cannot accidentally show or award ads. Future Lab
opt-in must use the separately reviewed #444 campaign/reward state machine
and preserve the ad-free Ride invariant; it must never infer an earned reward
from an absent SDK or a fake adapter. Fake is isolated
for deterministic tests and can be programmed to simulate the state machine;
its outcomes have no authority outside a test. Invalid requests fail closed.

Web and fake are implemented. `crazygames` and `steam` are **unavailable
stubs**, not a claim that these SDKs, billing, ownership, file saves, or rewards
are implemented. They share the same contract test and must be replaced by
reviewed implementations before any real feature can rely on them. Future
platform selectors must be explicit, must pass this suite, and must not expose
privileged SDK handles to gameplay.

Test: `npm test -- --runInBand tests/platform/adapter-contract.test.js`.
The tests execute the same four contract checks against all four targets,
plus own-site no-ads, denied/quota storage, fake concurrency and unknown IDs.
Follow-ups under #441/#442/#443/#444: integrate actual SDKs only after secure
platform packaging, replace the storage bridge with atomic file saves for
Steam, extend reward gating for hidden tabs and ad callbacks, and route user
save consumers through platform-dependent durable interfaces. This foundation
itself does not authorize an external ad platform or Steam entitlement.
