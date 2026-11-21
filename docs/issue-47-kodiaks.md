# Issue #47: hostile racing Kodiaks

Status: **playable slice** on `feature/kodiaks-47`, for Marvin to playtest.

## Owner decisions

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
| Counter | hop the charge; it runs well clear, then slows to 40%, so re-passing is a clean hop | hop it at speed | change the landing: divebomb short, or parachute/airbrake long |

**Packs** have 2 or 3 bears; the first pack of a run is always 2.
- **SAME TYPE:** every bear is the same type.
- **MIXED:** every bear differs, so a pack of three has all three types. A mixed pack can pincer,
  with a grizzly behind and the others ahead.

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
- A hit is a crash hazard, so shields, Hashed Backup and respawn grace apply. The crash is named
  after the bear.

**Determinism:**
- Bears advance in the fixed simulation tick, with a tick-exact box collision and no Matter body.
- The schedule, type, pack size, mix and feints all come from seeded streams per encounter.
- Ghost tapes record `kodiaksOn`, `kodiakPackMode` and `kodiakVersion`. A Kodiak run replays
  exactly at 30 and 120 Hz.

## Evidence

`tools/kodiak-browser-smoke.mjs`, real game, Sync Level 6. It covers three types × SAME/MIXED.
- **Every pack is a real threat.** A rider who does nothing is wrecked by any pack with a
  Kernel-Panic or Brute-Force in it. A Black-Ice pack spares a rider who stays on the ground.
- **Every pack is survivable.** A skilled rider survives all six packs. "Skilled" here means
  hopping just before contact and divebombing off a landing that would come down on a bear.
- **No Kodiaks below Sync Level 6.**
- **Replay is exact** at 30 and 120 Hz.

Balance problems found and fixed while proving this:
- A tired grizzly crawled ahead at 80% of the player's speed, too slow a closing speed to hop.
- A grizzly slowed down under a sled that was in the air.
- Black-Ice re-aimed at the landing every tick, so it couldn't be dodged.
- Two bears could attack at once.

## Still open

- Marvin's playtest verdict on SAME TYPE vs MIXED.
- Tuning: the encounter spacing (first at 450 m, then every 650–1200 m), the pack sizes, and the
  telegraph timings.
- Kodiaks in AlphaBluffs (Idle and the Evolution Lab, the observation schema) once those modes
  exist in this codebase.
