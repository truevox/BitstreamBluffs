/** QA-only pure chase curve: full-speed approach, softer last ~3000 px.
 * No player-speed matching, rubber-banding, teleporting, or forced collision.
 */
export function softApproachFactor(gapPx) {
  if (!Number.isFinite(gapPx)) return 1;
  const t = Math.max(0, Math.min(1, (3000 - gapPx) / 3000));
  const eased = t * t * (3 - 2 * t);
  return 1 - 0.18 * eased;
}

/** Override only the isolated QA pursuer's advance, never the production class.
 * The nominal velocity maintains its original acceleration curve; the actual
 * collision-edge motion and published velocity both use the eased velocity.
 */
export function installSoftApproach(pursuit, sled) {
  let nominalSpeed = pursuit.wallSpeedPxS;
  pursuit.advance = (stepMs) => {
    if (!pursuit.active || !Number.isFinite(stepMs) || stepMs <= 0) return;
    const dt = stepMs / 1000;
    const sledEdge = Number.isFinite(sled?.body?.bounds?.min?.x)
      ? sled.body.bounds.min.x : sled.x - 20;
    const gap = sledEdge - pursuit.wallX;
    const factor = softApproachFactor(gap);
    const nextNominal = nominalSpeed + pursuit.accelerationPxS2 * dt;
    const currentActual = nominalSpeed * factor;
    const nextActual = nextNominal * factor;
    pursuit.wallX += (currentActual + nextActual) * 0.5 * dt;
    pursuit.wallSpeedPxS = nextActual;
    nominalSpeed = nextNominal;
  };
}
