#!/bin/bash
set -euo pipefail
cd /opt/ace15
base=/opt/ace15/auditions/bitstream-vocal-cover-20261115
source="$base/input/maxi-vocal-stem.mp3"
export OMP_NUM_THREADS=4 OPENBLAS_NUM_THREADS=2 TOKENIZERS_PARALLELISM=false
for row in "organ 0.9" "holo 0.9" "organ 0.7" "holo 0.7"; do
	read -r preset strength <<< "$row"
	nospace="$(echo "$strength" | tr -d .)"
	name="$preset-215s-$nospace"
	log="$base/logs/$name.log"
	echo "BEGIN $preset $strength full-original 215sec" | tee -a "$base/logs/matrix.status"
	if /usr/bin/nice -n 12 .venv/bin/python -u "$base/generate.py" \
		--source "$source" --preset "$preset" --strength "$strength" \
		--seconds 215 --seed 20261115 --steps 8 > "$log" 2>&1; then
		tail -6 "$log"
		echo "SUCCESS $preset $strength $(date -Is)" | tee -a "$base/logs/matrix.status"
	else
		code="$?"
		tail -35 "$log"
		echo "FAILED $preset $strength exit=$code $(date -Is)" | tee -a "$base/logs/matrix.status"
		exit "$code"
	fi
done
echo "MATRIX_COMPLETE $(date -Is)" | tee -a "$base/logs/matrix.status"
