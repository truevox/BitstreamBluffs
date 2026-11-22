# Scrapheap physics lab — self-contained build snapshot

This is the **built demo asset** from PR #221 (head `a1a92ed`), not a second gameplay implementation. Music processor and control signal code lives in PR #221, based on Snowpack PR #194. The 5 20-second samples are separately encoded excerpts from the original stems and are derived review media only. Originals untouched.

The demo is isolated because the primary implementation PR is stacked and does not receive a Netlify deploy preview. Regenerate this demo when the underlying processor changes. Do not merge compiled snapshot into gameplay systems.

## Audibility correction (2026-11-22)

The first deployed audition was too subtle. This snapshot is from implementation commit `f5cc898`: stronger grounded metallic texture, an independent physics-triggered metal strike on landing, and a **Solo drums** control. The updated full-mix Chromium test measured 26.3% signal-difference RMS relative to original mix and a nonzero metal-strike output even with all recorded stems absent. Headroom verified in the short tested excerpt only. Human listening remains required.
