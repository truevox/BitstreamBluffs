/**
 * Deterministic, read-only adaptation of EXISTING gameplay facts.
 * None of these functions changes physics, transport, or score state.
 *
 * No invented "roughness" sensor: contact01 is explicitly a grounded
 * speed proxy. Future real surface contacts can supersede this input.
 */
export function contactFromMotion(speedPxS, grounded) {
	if (grounded !== true || typeof speedPxS !== 'number' || !Number.isFinite(speedPxS))
		return 0;
	return Math.max(0, Math.min(1, (Math.abs(speedPxS) - 100) / 1100));
}

/**
 * Convert the game's physical touchdown speed into a bounded audio impulse.
 * ~520 px/s is the established hard-landing threshold; invalid inputs,
 * non-landings and crash grades never synthesize a musical impact.
 */
export function impactFromLanding(landing) {
	if (!landing || landing.quality === 'crash') return 0;
	const speed = landing.impactSpeedPxS;
	if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) return 0;
	const normalized = Math.max(0, Math.min(1, (speed - 80) / 920));
	return landing.hard === true ? Math.max(.55, normalized) : normalized;
}
