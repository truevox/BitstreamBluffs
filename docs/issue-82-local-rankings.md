# #82: Local percentile and Pareto calculations

This is a calculation-only slice. It does not change what the game saves,
scores, displays, or ranks. There is no production call site or new standings
view.

```js
import { calculateLocalRankings } from './src/systems/local-rankings.js';

const history = await saveStore.getRecentRuns(500);
const analysis = calculateLocalRankings(history, {
  board: 'clean',
  seed: 'ALPHA',
  biomeMask: 0,
  dailyRuleId: 'featherweight',
});
```

The caller picks a finite recent-history window explicitly: the example
uses the 500 most recent stored records **before** eligibility and cohort
filtering. This is not an all-time or cross-player sample. The calculation
rejects inputs above 1,000 records, rather than silently trimming them.
It does not read IndexedDB itself or mutate the supplied history.

## Cohorts and valid input

Use the existing public SaveStore history method. Unlike exported standings,
this method retains the local `imported` marker. The calculation includes only
records with initials, a completed crash (not a quit), no local import marker,
and a matching ledger hash under supported v2, v3, or v4. It rejects unversioned
v1 and unknown ledger versions even where the old verifier's fallback succeeds:
v1 does not bind the fields needed to identify this cohort. Other leaderboard
surfaces retain their original behavior.

Select one board, exact stored seed, unsigned biome mask, movement-rule ID,
and exact known applied loadout. An omitted recorded mask means 0. An omitted
selection boost list or upgrade snapshot means empty, not “any.” Known boosts
are compared as an order-independent set; upgrade ranks are the known positive
applied ranks, not the entire profile. V2 cannot attest to applied upgrade
ranks. Hash-consistent rows with an impossible board/loadout combination do
not enter a cohort.

- `clean`: ordinary and typed-seed practice runs accepted by the current
  clean eligibility helper, with no applied boosts or ranks in this slice.
- `modded`: ordinary runs accepted by the current modded eligibility helper,
  with a known nonempty loadout. Different boost sets or upgrade ranks never mix.
- `daily-classic`: official Classic runs accepted by the current Daily helper,
  with no applied boosts or ranks in this slice.
- `daily-draft`: runs accepted by the current official Draft helper, including
  its current rules version and budget check. Select the exact applied Draft
  ranks. A correctly stamped but unrankable official run, or an invalid
  official stamp, does not fall back to ordinary or modded analytics.

Malformed, unsupported, or hash-mismatched rows are skipped, not repaired.
Analysis-equivalent copies of the same verified run ID count once; if two
eligible copies conflict on hash, cohort, or metric values, exclude the ID
from every cohort. Run IDs order output deterministically using string order.
That order is not a claim about official placement. Initials and imported
provenance are local metadata, not fields vouched for by the ledger hash.

## Metrics and statistics

All objectives are higher-is-better. Calculations use full numeric values,
without rounding for ties or comparisons:

| Key | Units | Source |
| --- | --- | --- |
| `distanceM` | m | Stored furthest distance |
| `score` | points | Stored final score, unchanged |
| `averageProgressMps` | m/s | Furthest metres divided by active run seconds; an average progress rate, not measured instantaneous or peak speed |
| `trickVariety` | types | Count of stored trick types with a positive count |
| `efficiencyPointsPerM` | points/m | Final score divided by furthest metres |
| `maxAirtimeMs` | ms | Stored longest airtime |
| `survivalMs` | ms | Stored active run duration until a crash, excluding pauses; not wall-clock time and not a count of quits |

Zero or unavailable duration makes average progress and survival unavailable.
Zero distance makes points per metre unavailable. Nonfinite derived values are
also unavailable. An unavailable metric is `null`, not a minimum score; its
record is still eligible for other metrics. Missing or invalid required base
measurements in the supplied row cause exclusion. Previously normalized stored
defaults cannot generally be distinguished from actual recorded zeroes.

The per-metric sample size counts available values. Fewer than two means
**no percentile** (`null`). Otherwise the percentile is
`100 × (strictly lower count + equal count / 2) / available count`.
Equal values share a percentile; the best need not be 100. Percentiles
describe runs within this sample, not unique people.

A run dominates another if it is at least as good on **every** metric and
better on at least one. Identical vectors never dominate each other. Only
complete vectors participate; incomplete vectors are unassessed (`pareto:
null`), not ranked last. A one-run complete sample is trivially nondominated,
not evidence of superiority. The report includes both the total cohort size
and the number of complete vectors so sparse metrics stay visible. Pairwise
frontier evaluation is bounded by the explicit history cap.

The ledger verifier checks local record consistency. It is not a cryptographic
signature or independent replay verification. The record has no verified human,
AI, or tool-assisted actor classification, and it does not identify the exact
physics build or capture every gameplay setting. The saved record's schema
version isn't a gameplay ruleset version. Matching stored identifiers
does not prove cross-release fairness. Do not present the result as a public,
verified, or official leaderboard.
