# #79: Downhill Run Strip, recorded poses (v1)

Inspect an existing **local GhostTape v1 JSON file** without starting the game
or replaying its inputs. This is a standalone developer tool. The game does
not yet supply a player-facing tape JSON export or an in-game strip button.

1. From the checkout: `npm run dev -- --host 127.0.0.1`.
2. Open `http://127.0.0.1:5173/tools/downhill-run-strip.html` (use the port
   printed by Vite if different). Choose the local JSON file.
3. Open an evenly spaced section, enter a first and last sample, or zoom
   around the current sample. Move the slider with the arrow keys to inspect
   exact stored X and Y. **Show full trace** returns to the overview.
4. Use **Download section SVG** to save the displayed interval. The SVG can
   be viewed and shared without the inspector. It is static and does not
   include the preview cursor or a way to reopen the source tape.

The plotted line joins recorded X/Y samples in their original order, including
backtracking. It fits the chosen section with the **same unit scale on both
axes**, +X right and +Y down. These are game-world coordinates, not elevation
or measured distance. The inspector reads exact decoded Float32 coordinates;
the SVG contains only projected path geometry, not the world origin. Window
endpoints and the actual first and last **recorded samples** are labeled
separately. The first recorded sample is at tick 4; v1 saves one pose every 4
ticks at nominal 120 Hz. This does not identify the exact run start or crash.

To bound large overviews, windows above 1,024 poses draw the endpoints and the
recorded X/Y extrema of small consecutive buckets, in original order. The image
says how many vertices it shows; zoom into at most 1,024 poses to see each
recorded pose. There is no smoothing or extrapolation. The inspector accepts a
UTF-8 JSON file up to 2 MiB with 2–32,768 complete v1 pose triples (Float32 X,
Y and angle); exact pose encoding and finite bounded components are checked.
Other tape data and verification claims are not used. SVG output is capped at
48 KiB and is byte-identical for the same decoded poses and selected interval
in the same tool version. Display fonts can differ across viewers.

**Local / unverified** means the inspector does not verify the replay or certify
play. The file is read in browser memory without uploads, saved history or app
state changes. The downloaded SVG has no seed, run or account ID, score, date,
inputs, tape payload, scripts, external links or assets. The depicted path and
sample range can still identify a recognizable run; this is not anonymization.

Terrain, biomes, tricks, BSOD proximity, hazards and crash markers are not in
this stored trace and are not guessed. Those annotations and player-facing
integration remain follow-up work; scoring, saves and replay contracts are
unchanged.
