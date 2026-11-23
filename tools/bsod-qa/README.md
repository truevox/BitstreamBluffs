# Playable experimental A/B chase (public opt-in QA page)

The published site exposes `/bsod-qa.html?bsodQa=moderate&qaSeed=bsod-ab-01` , `/bsod-qa.html?bsodQa=buffered&qaSeed=bsod-ab-01`, and `/bsod-qa.html?bsodQa=soft&qaSeed=bsod-ab-01`. **Normal `index.html` is unchanged.** This is an explicitly opt-in experimental page for pre-release tests, not a production chase retune. It uses the real game engine on the same seed, applies changes only after pursuer initialization, suppresses save/tape and XP/mission credits, and displays a diagnostic overlay.

Player-supplied seeds are restricted to `[A-Za-z0-9_-]` (1–64 characters). QA runs should use a disposable browser profile; this launcher does not undo other activity performed on the site outside its experimental run.

The original local-only developer server remains on the research branch, but this deployed page **requires no tunnel**. It does not change replay schema, canonical ruleset, main game physics or player save compatibility. Use these candidate settings only for human evaluation, not normal ranked play.

## Fast Approach / Soft Finish (experimental third candidate)

Keeps buffered strong's opening gap, starting wall speed and acceleration. During the final 3000px of closing distance, a smoothstep envelope reduces the **actual moving wall speed** from 100% to 82% of its nominal accelerating speed at contact. The displayed speed and collision edge use that reduced value. The wall does not key off the player's velocity or teleport to catch them. The first two original A/B presets are unchanged.
