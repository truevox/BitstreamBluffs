# Scrapheap physics lab — self-contained build snapshot

This is the **built demo asset** from PR #221 (head `a1a92ed`), not a second gameplay implementation. Music processor and control signal code lives in PR #221, based on Snowpack PR #194. The 5 20-second samples are separately encoded excerpts from the original stems and are derived review media only. Originals untouched.

The demo is isolated because the primary implementation PR is stacked and does not receive a Netlify deploy preview. Regenerate this demo when the underlying processor changes. Do not merge compiled snapshot into gameplay systems.

## Audibility correction (2026-11-22)

The first deployed audition was too subtle. This snapshot is from implementation commit `f5cc898`: stronger grounded metallic texture, an independent physics-triggered metal strike on landing, and a **Solo drums** control. The updated full-mix Chromium test measured 26.3% signal-difference RMS relative to original mix and a nonzero metal-strike output even with all recorded stems absent. Headroom verified in the short tested excerpt only. Human listening remains required.

## Sticky puddle splock refinement (Nov 22, 2026)

Owner described the current audible impact as pulling a foot from a wet sticky garbage puddle, and wanted a little more of that quality. Updated from code PR #221 commit `e5b838d`: short synthetic rising suction chirp, hollow lip pop and debris, adjustable Splock impact weight 60–160% (default 120%), repeatable Test splock control; original stems, mixer, and vocal lead pipeline preserved. Offline four-second sample at three hard hits had sampled peaks 0.2184 / 0.3259 / 0.4130 at weights .6 / 1.2 / 1.6 with no invalid values. Not a full release loudness evaluation; owner re-listening outstanding.
