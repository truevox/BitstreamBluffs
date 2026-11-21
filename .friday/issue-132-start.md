# Issue #132 start: deterministic performance benchmarks

Owner: Morgan. This draft starts the benchmark-only work approved by the repository owner.

Use established fixed-tick replay inputs. Measure developer-side throughput and p95/p99 tick time separately from browser/page startup and record the test environment. Verify that selecting or enabling timing does not change replay results. The benchmark does not establish cross-browser conformance or server-side verification.

Out of scope: changes to production gameplay, replay/physics contracts, scores, player categories, or other teams' fixtures. Keep draft until tests and independent review are complete.
