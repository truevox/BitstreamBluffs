# Issue #47: playful snow-racing Kodiaks

Status: **playable slice** on `feature/kodiaks-47`, for Marvin to playtest.

## Owner decisions

- **Rivals, not killers (owner override, 2026-11-21).** The bears are competitive, spirited racers. Contact
  shoves the sled back and up. It never crashes it.
- Three types, as Marvin named and coloured them:
  - **Kernel-Panic**: white, polar.
  - **Brute-Force**: brown grizzly.
  - **Black-Ice**: black, Vermont black bear.
- Kodiaks appear from **Sync Level 6** (2026-11-21).
- **No Kodiaks on Dailies**, classic or Draft (2026-11-21). The Gym has none either.
- **Race bears come in packs** (2026-11-21). Whether same-type or mixed packs play better is an
  open playtest question. The Settings switch **KODIAK PACKS: SAME TYPE / MIXED** chooses between
  them, defaulting to SAME TYPE.

## How each type plays

The types differ in mechanics, not only in look.

| | Brute-Force (brown grizzly) | Kernel-Panic (white polar) | Black-Ice (black bear) |
|---|---|---|---|
| Shape | heavy, shoulder hump | long, low body, long neck | round, tall rounded ears, tan muzzle |
| Arrives | from behind, faster than you | ahead, slower, so you close on it | ahead, matching you; never blocks the ground |
| Attack | rears up for 0.65 s, then charges | up to 2 amber feints, then a red telegraph and it stops dead in your line | while you're airborne, commits to your predicted landing (a glint marks it) and slides there |
| Counter | hop the charge; it runs well clear, then slows to 40%, so re-passing is a clean hop | hop it at speed, or it shoves you back | change the landing: divebomb short, or parachute/airbrake long |

**Packs** have 2 or 3 bears; the first pack of a run is always 2.
- **SAME TYPE:** every bear is the same type.
- **MIXED:** every bear differs, so a pack of three has all three types. A mixed pack can pincer,
  with a grizzly behind and the others ahead.

**Contact is a shove, not a crash** (`kodiakKnockback`, `KODIAK_KNOCK`):
- The sled is pushed **backward**, against its travel, and **up**. The backward push is bounded
  (80 px/s base, plus 0.35 × the closing speed, capped at 220 px/s). The lift is 200 px/s.
- Each bear shoves at most once per encounter. After any shove, no bear shoves again for 1 s, so a
  pack cannot chain shoves.
- Shields, Hashed Backup and the respawn grace do not apply: there is no crash to absorb. A sled
  that is invulnerable (respawn grace) is not shoved either.
- A shoved sled keeps going. The shove does not stop it, and the run carries on.
- All three bears share one envelope until playtests say otherwise. The owner has not chosen
  per-bear values.

**Fairness rules**, enforced in `stepKodiakPack` and the unit tests:
- Only one bear telegraphs or attacks at a time.
- No bear starts an attack while another is within 220 px of the sled, close enough to need
  hopping.
- A bear you must pass on the ground is always much slower than you, so a hop clears it at real
  closing speed.
- A bear never slows down underneath a sled that's in the air.

**Scoring and outcomes:**
- Passing a bear on the ground scores +150. You can only pass on the ground after it has stopped
  or tired.
- Clearing a bear in the air (BEAR HOP) scores +250.
- A shoved bear earns no pass bonus. Touching a bear never scores.
- A sled that is shoved can still lose the race by an ordinary route: into terrain, into a chasm,
  or into the BSOD. Those use the existing crash paths, so the crash report names the terrain
  or hazard, never a bear.

**Determinism:**
- Bears advance in the fixed simulation tick, with a tick-exact box collision and no Matter body.
- The schedule, type, pack size, mix and feints all come from seeded streams per encounter.
- Ghost tapes record `kodiaksOn`, `kodiakPackMode` and `kodiakVersion`. A Kodiak run replays
  exactly at 30 and 120 Hz.
- `KODIAK_VERSION` is **3** (v2 was crash-on-contact). The ghost library does not offer a Kodiak
  tape recorded under another version, since it would not replay.

## Evidence

`tools/kodiak-browser-smoke.mjs`, real game, Sync Level 6. It covers three types × SAME/MIXED.
- **Contact shoves.** A rider who does nothing is shoved by every pack with a Kernel-Panic or
  Brute-Force in it. A Black-Ice pack never reaches a rider who stays on the ground.
- **No bear crashes the sled.** No run ends by a bear, and every shove is backward, up, and within
  the bound. No bear shoves twice.
- **A shoved sled keeps racing.** After a shove the run continues for seconds, and a shoved sled
  keeps moving forward.
- **A skilled rider is never crashed by a bear.** In two Brute-Force packs a skilled rider was
  shoved and then fell into a chasm. That is the intended secondary loss, but it is a balance item.
- **No Kodiaks below Sync Level 6.**
- **Replay is exact** at 30 and 120 Hz, with shoves in the tape.

Balance problems found and fixed while proving the earlier crash version:
- A tired grizzly crawled ahead at 80% of the player's speed, too slow a closing speed to hop.
- A grizzly slowed down under a sled that was in the air.
- Black-Ice re-aimed at the landing every tick, so it couldn't be dodged.
- Two bears could attack at once.

## Still open

- Marvin's playtest verdict on SAME TYPE vs MIXED.
- Tuning: the shove strength (`KODIAK_KNOCK`), whether the three bears get different envelopes,
  the encounter spacing (first at 450 m, then every 650–1200 m), the pack sizes, and the telegraph
  timings.
- A shove that drops a skilled rider into a chasm: the Brute-Force shove may be too strong or too
  easy to take on a hop.
- Angular rotation on the shove (optional in the issue) is not implemented. Any trick points come
  from the existing trick rules, not from contact.
- Rival racing behaviour (overtaking, defending a line, competing for the win): the shoves are the
  only contact behaviour so far. The bears still follow the attack scripts above.
- Kodiaks in AlphaBluffs (Idle and the Evolution Lab, the observation schema) once those modes
  exist in this codebase.
