/**
 * Transparent final-output peak *backstop*, after the actual game compressor.
 * Unlike a slow dynamics compressor, a waveshaper guarantees the sampled
 * output cannot exceed its bounded transfer function even on an unexpected
 * original-stem + source-FX transient. Not a brickwall true-peak limiter:
 * no lookahead, oversampling/transient handling is browser dependent.
 *
 * Below 0.74, transfer function is exactly linear; it does not
 * automatically normalize strong but owner-liked biome mix identities.
 */
export const PEAK_GUARD_KNEE = 0.74;
export const PEAK_GUARD_CEILING = 0.82;
export const PEAK_GUARD_POINTS = 8193;
const span = PEAK_GUARD_CEILING - PEAK_GUARD_KNEE;
export function peakGuardTransfer(value) {
	if (!Number.isFinite(value)) return 0;
	const magnitude = Math.abs(value);
	if (magnitude <= PEAK_GUARD_KNEE) return value;
	// The deterministic source-math boundary intentionally forbids new
	// transcendental Math calls even in audio-only code. This positive
	// third-order Padé-like exponential decay has unit slope at the knee
	// and smoothly approaches the same bounded ceiling.
	const t = (magnitude - PEAK_GUARD_KNEE) / span;
	const fade = 1 / (1 + t + t*t/2 + t*t*t/6);
	const limited = PEAK_GUARD_KNEE + span * (1 - fade);
	return (value < 0 ? -1 : 1) * Math.min(PEAK_GUARD_CEILING, limited);
}
export function createPeakGuardCurve() {
	const result = new Float32Array(PEAK_GUARD_POINTS);
	for (let i = 0; i < result.length; i++) {
		const normalized = (i / (result.length - 1)) * 2 - 1;
		result[i] = peakGuardTransfer(normalized);
	}
	return result;
}
export function createOutputPeakGuard(ctx) {
	const shaper = ctx.createWaveShaper();
	shaper.curve = createPeakGuardCurve();
	shaper.oversample = '2x';
	return shaper;
}
