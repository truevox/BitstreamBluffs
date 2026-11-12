#!/usr/bin/env bash
# Regenerate the baseline JSONs + markdown. Usage: tools/sim/baseline.sh <outdir> [seedsHands=100] [seedsFlip=96]
set -euo pipefail
OUT=${1:?usage: baseline.sh <outdir>}
NH=${2:-100}
NF=${3:-96}
mkdir -p "$OUT"
cd "$(dirname "$0")/../.."
R="node tools/sim/run.mjs --workers 6 --quiet"
$R --seeds "$NH" --policy handsOff --maxM 4000 --out "$OUT/handsOff.json" > "$OUT/handsOff.txt"
$R --seeds "$NH" --policy hop --maxM 4000 --out "$OUT/hop.json" > "$OUT/hop.txt"
for L in 0 100 200 300 400; do
  $R --seeds "$NF" --policy flip --releaseLateMs "$L" --maxM 4000 --out "$OUT/flip-late$L.json" > "$OUT/flip-late$L.txt"
done
$R --seeds 24 --policy stallProbe --out "$OUT/stall.json" > "$OUT/stall.txt"
$R --seeds 48 --policy terrain --maxM 4000 --out "$OUT/terrain.json" > "$OUT/terrain.txt"
node tools/sim/report.mjs "$OUT" > "$OUT/baseline.md"
echo "wrote $OUT/baseline.md"
