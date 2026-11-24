# #81: local ghost lineup on Game Over

Open **GHOST FAV** on Game Over (or press **G**) after a run that saved a
local ghost tape. **Course Ghosts** shows the completed run's seed and biome
mask's five existing roles: **Best** (furthest), **Latest**, and **Favorites
A–C**. Changes apply the next time you enter that exact course; opening,
changing or backing out of the panel never starts a run.

- Use Up/Down to select a row and Left/Right to switch that role on or off.
  Enter switches Best/Latest, or saves/replaces/clears the run in a Favorite.
  The panel still opens on Favorite A, so G then Enter still pins this run.
  The corresponding buttons also work with pointer/touch.
- **Show** is a course preference. Existing global Best/Latest choices in
  Settings still win over that preference. **Off in Settings** explains
  when a role cannot draw even if its course switch is on.
- A role can be **Empty**, have a **Tape Missing**, or be **Incompatible**
  with the current ghost renderer, or have **No Trace** if the run ended
  before a pose was recorded. Its preference can still apply to a later
  available tape. **Shared Run** means another role has the same
  compatible tape: it draws only once if any of its roles can show, and
  turning one role off will not hide a tape still selected through another.

The panel uses the existing format/physics/tick checks and the same current
simulation-revision check as the in-run ghost display. A tape with a different
or missing revision shows **Incompatible** and won't draw on the current
terrain. It remains in its slot until replaced or cleared. The panel flags
empty traces but does not decode or validate the pose data. These are
local cosmetic traces, not proof of identical rules or loadout, competitive
parity, or human play. There are no friends, uploads, imports, score/standings changes, replay
changes, or new settings or storage contracts in this slice.
