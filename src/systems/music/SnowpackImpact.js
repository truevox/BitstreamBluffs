/**
 * Pure, physical touchdown-to-snow-burial mapping.
 * 520 px/s is the game's existing hard-land threshold (TrickTracker).
 * Only genuine finite positive impact velocity can excite a burial pulse.
 * This is deliberately audio-only: never feed it back into gameplay.
 */
export function snowpackImpactFromLanding(landing) {
	if (!landing || landing.quality === 'crash') return 0;
	const speed = landing.impactSpeedPxS;
	if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) return 0;
	const normal = Math.max(0, Math.min(1, (speed - 80) / 920));
	return landing.hard === true ? Math.max(0.55, normal) : normal;
}
