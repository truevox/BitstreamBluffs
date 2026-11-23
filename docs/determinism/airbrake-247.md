# Issue #247 — AirBrake first physics A/B: a shorter, speed-paid bump

**Status: candidate only, never a released or approved balance setting.** Marvin's owner decision (2026-11-22): "AirBrake needs to be nerffed. It should slow you more, lift you a little less, and go quicker (quicker lift, quicker drop)." The coefficients below are Gal Friday's **testable first-pass interpretation**, not numbers Marvin chose. The existing SIM_REVISION 6 is preserved in its content-addressed archive; this candidate uses **SIM_REVISION 7**. A player playtest, new SIM7 source-stamped browser corpus, and independent exact-head reviewer are required before merging. #240 v2.19.21 has now merged before proposed v2.19.22.

## What changed

| Effect | Shipped SIM6 | Provisional SIM7 |
| --- | --- | --- |
| Horizontal brake | 25% speed removed after **800 ms** full hold at density=1 | 40% speed removed after **480 ms** full hold |
| Airborne descent damping | `2.4 / s` while descending | `0.65 / s`: **less gliding**, quick drop |
| Brake gravity multiplier | `0.80` of ordinary gravity | `0.94`: ordinary gravity returns faster |
| Aerodynamic lift | Continuous `1250 * tanh(abs(vx)/450) * airDensity * dt`, upgraded by AirBrake Lift multiplier | **1.40 × actual horizontal speed paid this same substep**, upgraded by the existing AirBrake Lift multiplier; no independent continuous upforce |
| Activation | Held AirBrake while airborne | Same held input, *no new press/release pulse state* or recharge |
| Canopy, vacuum, upgrades | Existing canopy fuel / zero-airflow biome / upgrade caps | Unchanged; canopy still uses the same finite tank and its own sail forces |

The key is the **time shape**: early in the brake, horizontal velocity is still large and the newly stronger braking spends more speed per tick, so the upward bump arrives promptly; as vx collapses, paid lift also collapses. The rider then falls under nearly full gravity instead of hovering under 20% suppressed gravity with severe descent damping. Releasing and pressing again does not reset any lift timer or grant a free vertical kick: it can only purchase additional lift by sacrificing still-available speed. A near-wall wind gust could replenish forward speed; if braking converts it to lift, the rider must **pay the newly gained horizontal momentum** rather than producing force by button spam.

The exact lift measurement is based on `abs(vxBeforeBrake)-abs(vxAfterBrake)` for each physics sub-step. It is not a force proportional to the wall gap or score, and does not change BSOD chase policy. Thin atmospheres make both spending and its lift smaller; Space Mountain's vacuum gives neither. Holding AirBrake on the ground retains the grounded brake behavior.

## Determinism and safety gates

- No new Sled field, input protocol field, physics clock, RNG stream, altered GhostTape format or frame-time dependency; changes only existing physics formulas and frozen tuning constants.
- Pure tests check exact speed-payment lift, held-vs-release, stationary and vacuum behavior, no tap-refill path, upgrade scaling, rapid force decay, and integrated speed/lift invariance under 4/5/8/10/16 ms sub-steps. Real game still needs its normal 120 Hz replay and conformance gates.
- A causal source tripwire is updated with `sim-revision-bumped` attestation. Current ruleset is newly archived under its own content hash, and existing archive files / historical golden tapes must remain byte-unchanged.
- **Prior SIM6 evidence (#214):** 24 paired seeds × 4 policies at biome mask 0, max 3,000 m / 90 s, headless (`sim-01…sim-24`), generated record SHA-256 `199a4ddf7d13f64840af6d51c92a8bd4bb78a94c0797fadca64410c373eeb479`. Baseline canopyFlip median score 6,913.5, max airtime 4.092 s, 18/24 runs timed out at 90 s. Flip-only median 1,272 score and 1.1125 s max airtime. This baseline is a diagnostic scripted result, not a human playtest.
- **Actual candidate SIM7 evidence:** same 24 seeds × 4 policies, zero failed arms (96/96). Raw diagnostic record `tools/exploits/out/run-2026-11-23_03-47-36.json` local CT223, SHA-256 `d71194ecc0a2a6263d4cfa30a7f6c57a03fbc3cb8816bdb1a929ec3f08b26325`. The source's SIM7 archive ID is `sha256:0dcb4d59cf6c2e9ceb6cdfa0a885d90c5f6f284aaba7684e0f0fbe9bfe668a92`. Be candid about right-censored timeouts and any unchanged canopy exploits. Do not tune competitive leaderboard scoring or Trick Flow (#157) in this PR.
- The unrelated inherited full-game playthrough failures (#241) and known prior Jest failures do not become "green" as a consequence of this tuning; compare on same source and report genuine deltas.

## Same-seed results — first 24-seed A/B

The SIM6 baseline was executed on #240's candidate source, whose compiled game output was **83/83 byte-identical to v2.19.20 main**. The SIM7 first-pass change is this PR's unmerged branch. Both use `sim-01`…`sim-24`, biomeMask 0, max 3000 m, max 90 s, four scripted policies. Neither run failed an arm. Values are **per-policy medians**, not a universal expected player score. Timeouts at 90 s are right-censored, NOT evidence of indefinite flight. Score effects include differences in survival time/hazards and cannot be attributed solely to vertical physics.

| Policy | SIM6 median score | SIM7 median score | SIM6 median *longest airtime* | SIM7 median *longest airtime* | SIM6 90s timeouts | SIM7 90s timeouts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Hands-off (AirBrake never active) | 332.5 | 332.5 | 0.921 s | 0.921 s | 0/24 | 0/24 |
| Flip-only (AirBrake never active) | 1,272 | 1,272 | 1.1125 s | 1.1125 s | 0/24 | 0/24 |
| Canopy + AirBrake + hops | 3,987.5 | **4,681.5** | 4.0665 s | **2.550 s** | 21/24 | 18/24 |
| Canopy + AirBrake + flips | 6,913.5 | **5,439.5** | 4.092 s | **2.475 s** | 18/24 | 9/24 |

Paired-seed canopyFlip score vs its *own* SIM6 scores: SIM7 wins 7, loses 17 (median per-seed delta -670.5); canopyHop wins 19, loses 5 (median per-seed delta +656.5). **An important nuance:** the deliberately stronger *braking* appears to help the canopyHop scripted policy ride further (median distance 1,849.5 m→2,004.8 m) despite shortening flight, so its score goes UP. Thus this physics experiment achieves a shorter aerial float and reduces canopyFlip dominance, but **does not cure the broad canopy-based score meta**. That belongs to a separate controlled #157 Trick Flow and #128 BSOD pursuit investigation, not an unreviewed scoring nerf here.

The compared hands-off and flip-only policy results were exactly identical, as expected from an AirBrake-only behavior change. Input exposure in SIM7 still proves both controls actually operated (canopyFlip 221.0 s active AirBrake and 220.1 s active canopy across all runs, sampled at 60 Hz). The hypothesis about *feel* must still be human-playtested; these scripts do not measure fun or animation perception.

**Focused safety checks:** 624/624 focused aerodynamic, determinism, conformance and exploit-harness tests pass after the new SIM7 archive and tripwire attestation. `npm run build`, ruleset check and exact build identity check pass. The broader QA and browser-cross-engine release acceptance remain separate gates; the old golden replay fixture bytes MUST NOT be overwritten.

## Reproduction

```bash
npm test -- --runInBand tests/src/bsod-aerodynamics.test.js tests/determinism
node tools/ruleset/build-ruleset.mjs --check
node tools/ruleset/build-ruleset.mjs --check-identity
npm run build
node tools/exploits/run-exploits.mjs --seeds 24 --policies handsOff,flip,canopyHop,canopyFlip --baseline flip --maxM 3000 --maxSec 90 --workers 4 --biomeMask 0
```

**This change is for human feel and bounded exploit mitigation.** Do not call 24 scripted seeds proof that no other player strategy exploits Airtime, and don't take away spectacular flips/parachute/airbrake moves unnecessarily. Owner-approved direction is authoritative; the numeric tuning remains playtestable.
