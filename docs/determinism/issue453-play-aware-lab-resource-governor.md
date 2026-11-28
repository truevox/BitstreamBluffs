# P0 #453 — conservative Lab admission governor: first implementation slice

`src/systems/lab/LabResourceGovernor.js` implements a pure, versioned
admission-policy function for **future** browser or desktop Lab workers.
It changes no current gameplay, worker pool, physics, rewards or purchases.
The upstream entitlement code MUST provide `authorizedSlots`; the governor
cannot grant or authenticate any paid/local entitlement. `requestedSlots`
controls the user's requested concurrency, `activeWorkers` MUST be a real
scheduler count; a caller must not substitute the admission ceiling for an
observed active count. Missing or malformed counts fail closed by throwing.

Heuristics are initial **Friday-selected defaults**, not approved commercial
prices or measured throughput. Defaults in this policy reserve one reported
logical CPU for foreground use, and conservatively bound memory admission by
the browser's coarse `navigator.deviceMemory` hints. Absent CPU/memory info
caps admissions to one, not to a fabricated 4/8-core machine. The school
preset also caps at one. Explicit reported low battery (discharging <=20%)
blocks admission, 20–35% caps at one; reported moderate pressure caps at one,
and serious/critical pressure blocks admission. Browser pressure is **not**
collected here: no invented CPU temperature or unportable performance proxy.
Unknown pressure is labeled not reported. Unknown browser visibility blocks
new admissions. Hidden-tab, active Ride, and severe pressure stop NEW
admission, but in-flight work still exists and must be drained/cooperatively
paused by a future real Worker adapter; `draining=true` communicates this
truthful over-budget state. Foreground play never waits for this scheduler.

`readBrowserLabSignals` obtains only actual browser-exposed visibility,
reported CPU count, coarse reported device memory and optional Battery API.
If browser does not expose battery or access is refused, battery is unknown;
no synthetic 100% charge. This is NOT guaranteed OS memory, battery, thermal
or Chromebook telemetry. Future real Worker scheduling must re-evaluate
whenever Ride starts/stops, visibility changes, battery/pressure change, or
worker count changes; and must bind observed active workers to actual Worker
lifecycle. No browser Worker, true throughput data, physical Chromebook QA,
initial Lab onboarding, or model training is delivered here.

Regression suite verifies no fabricated worker count or slot rights;
Ride/visibility and school backoff, real/unknown battery and pressure signals,
API denial, deterministic recalculation and input validation. Existing
#134 golden seeded episode batch test runs alongside this policy suite in
exact-head CI. #453 stays open for wiring and physical hardware acceptance.
