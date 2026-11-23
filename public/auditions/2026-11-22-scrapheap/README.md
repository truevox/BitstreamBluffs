# Scrapheap physics lab — self-contained build snapshot

This is the **built demo asset** from PR #221 (head `a1a92ed`), not a second gameplay implementation. Music processor and control signal code lives in PR #221, based on Snowpack PR #194. The 5 20-second samples are separately encoded excerpts from the original stems and are derived review media only. Originals untouched.

The demo is isolated because the primary implementation PR is stacked and does not receive a Netlify deploy preview. Regenerate this demo when the underlying processor changes. Do not merge compiled snapshot into gameplay systems.

## Audibility correction (2026-11-22)

The first deployed audition was too subtle. This snapshot is from implementation commit `f5cc898`: stronger grounded metallic texture, an independent physics-triggered metal strike on landing, and a **Solo drums** control. The updated full-mix Chromium test measured 26.3% signal-difference RMS relative to original mix and a nonzero metal-strike output even with all recorded stems absent. Headroom verified in the short tested excerpt only. Human listening remains required.

## Sticky puddle splock refinement (Nov 22, 2026)

Owner described the current audible impact as pulling a foot from a wet sticky garbage puddle, and wanted a little more of that quality. Updated from code PR #221 commit `e5b838d`: short synthetic rising suction chirp, hollow lip pop and debris, adjustable Splock impact weight 60–160% (default 120%), repeatable Test splock control; original stems, mixer, and vocal lead pipeline preserved. Offline four-second sample at three hard hits had sampled peaks 0.2184 / 0.3259 / 0.4130 at weights .6 / 1.2 / 1.6 with no invalid values. Not a full release loudness evaluation; owner re-listening outstanding.

## Owner-favorite SPLORP + suction takeoff pair

Compiled static snapshot from **implementation PR #221 commit `579b566`**. Splock default is now 160% (owner-preferred maximum), and the game now triggers a shorter, lower-volume deterministic suction-release on a real Garbage grounded-to-airborne edge. Added separate **Test suction** button to the standalone demo and labelled **Take off (suction)** so users can compare the two moments; existing source stems and melody pipe are not modified. The underlying native DSP remains in PR #221, not this audition-only PR. 133 focused tests and the representative multi-event five-second offline headroom probe passed. Human listening review remains necessary.

## 2026-11-22 audibility correction — schlorp too quiet

Marvin reported: “You can BARELY HEAR the schlorp/.” The takeoff effect, **not** the already-loved 160% landing SPLORP, needed more audible presence in the original full music mix. This snapshot builds from implementation PR #221 commit `901c4ef`: longer 340 ms midrange suction and lip-pop, calibrated to remain smaller than the landing. Independent takeoff schlorp volume slider 50–240%, default 180%; landing stays at 160% and unchanged. Full mix Chromium sound probe now produces takeoff difference RMS 0.04707 (versus former 0.00895, ~5.26×), landing difference RMS 0.06144. Test passage peaks 0.17685 default and 0.23578 takeoff at 240% (not full-song loudness certification). Focused 133/133 audio/music tests, production build and local browser smoke passed; human re-listening remains outstanding.
