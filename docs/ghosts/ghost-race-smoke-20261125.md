# Guest Race Pages smoke timing regression (2026-11-25)

## Failure and controlled reproduction

PR #391 head `39a83c15`, Pages job 139648918860, failed in the
fourth URL scenario (mobile-emulated Guest Practice with pause/restart)
at `Race Guest hitzone disappeared before consent`. The same game
source subsequently passed Pages smoke on #392 and shipped in v2.25.0;
this report concerns a real browser **test-harness** race, not a proven
keyboard consent bypass.

The Ghost preview can decode while its CRT-open panel is still
invisible or transforming. Motion.transitionIn initially sets alpha
zero while leaving full geometry, then unfolds vertically around the
panel center. The old test read a hit-zone center before the animation
settled and retried real clicks at changing positions. The old
`raceState.view` check allowed the replacement SeedView to look like
the original GhostLinkView.

Controlled red on a compiled Pages-subpath v2.25.0 game (Chromium
412x915 mobile emulation, NixVox, 2026-11-25): pause the real opening
tween, obtain the full-geometry Race center, seek the actual tween to
122 ms, render, then use a real Playwright pointer click at the stale
coordinate. Observed:

- stale Race center: CSS (330.4583, 522.1083)
- actual Race center: CSS (330.4583, 504.3035)
- actual Back center: CSS (350.2000, 520.1200)
- panel scaleY 0.7370801, alpha 1
- original view destroyed, replacement view present, Race zone absent,
  no RunScene launched; trace `close, destroy`.

This reproduces the specific missing-zone signature. It does not
establish the exact frame timing on the historical GitHub runner. An
ordinary instrumented run also recorded a missed click while alpha
was zero followed by a successful retry. Two other stress runs
failed earlier at sender share arming before recipient throttling;
those are separate timeouts, not additional reproductions of this
failure.

## Regression and correction

The compiled browser smoke now holds the actual mobile Ghost open
tween at the measured intermediate scale, asserts the stale
full-size Race point is inside Back, and requires the stable-target
wait to reject partial-open geometry before releasing the tween.
It then waits for three consecutive visible, settled geometry
samples and a real canvas DOM target, preserves the original view
identity, and performs **one** first pointer click. It checks the
actual Race pointer event, explicit unranked disclosure, and no
run/scene transition before a separate second click. The second
click uses a freshly verified target. It never retries consent
clicks. The sender-side fixed 450 ms wait is replaced by a settled
panel condition for the same animation family.

No game source, ranking, persistence, consent or SIM rules changed.
The existing subsequent no-save, restart/quit, and normal-run
positive controls remain. This test-only follow-up must pass exact
head Pages smoke; historical green checks are not a substitute.
