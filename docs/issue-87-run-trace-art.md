# #87: Run DNA, local trace artwork

Generate a standalone neon SVG from a **local GhostTape v1 JSON file** you
already have. This developer tool does not add an in-game export button or a way
to retrieve or share tapes.

```sh
node tools/run-trace-art.mjs /path/to/local-ghost-tape.json > run-dna.svg
```

By default the command renders the original Art V1. It reads one regular
file and, on successful conversion, writes only SVG to stdout; it does not
save anything itself, contact a server, or open a browser. Open the SVG
locally to preview it. Keep the raw tape private. The SVG carries the visible
label **LOCAL / UNVERIFIED** and **ART V1**. It is artwork, not a run receipt,
proof of human play, or an assertion that a replay can be verified.

The CLI accepts the current v1 pose representation of three Float32 values
(X, Y, angle) per sample. It requires whole canonical base64 pose blocks and
uses the existing ghost decoder. Header format and version select the byte
layout, not authenticity. JSON is limited to 2 MiB and the trace must have
2–32,768 complete poses. Every component must be finite and within ±1 billion.
Unsupported, malformed, missing, and oversized inputs fail with a nonzero
status and no SVG. The artwork is limited to 8 KiB.

In developer code, the browser-safe `renderRunTraceArt(decodedPoses)` takes
only the decoded Float32 array. V1 removes each axis's original position and
scale, resamples the path to 64 points, and projects it onto a coarse canvas
grid of four-unit steps. Constant axes are centered. V1 validates recorded
angles but does not use them for the motif. Identical decoded poses and art
version produce identical SVG bytes,
although font appearance can differ by platform. Different poses can
produce the same coarse motif. The path may still be recognizable; this
is **not anonymization**.

The artwork carries no account details, run ID, initials, seed, dates,
scores, inputs, checkpoints, replay payload, exact world coordinates,
link, scripts, embeds or external assets. Verification status claims in
the input are ignored. No game screens, scoring, storage, replay formats,
or standings change. Trick cadence, risk, biome events, authenticated run
linkage and sharing are deferred; they are not inferred from the pose path.


## Opt-in Art V2 orientation study

```sh
node tools/run-trace-art.mjs --art-v2 /path/to/local-ghost-tape.json > run-dna-v2.svg
```

The option changes the **art** version, not the input tape version. It uses
the same GhostTape v1 bounds and the same 64-point path as V1, with one fixed
row of 16 accents. Each accent shows the highest of four coarse tiers for
the absolute shortest orientation change between adjacent recorded poses in
that relative band. Empty bands and changes below the first threshold look
the same. The row is not a time axis; it does not identify direction, full spins,
tricks, biome or risk, and can miss motion between recorded poses.

V2 does not alter the default CLI SVG or the developer inspector, which
still uses Art V1. Both outputs remain **LOCAL / UNVERIFIED**. The new motif
may be recognizable and remains artwork, not proof or anonymization.
