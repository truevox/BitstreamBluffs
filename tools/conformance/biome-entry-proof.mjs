/**
 * #65 / #140: a browser isolation comparison is meaningful only when the
 * baseline and perturbed runs both cross an ACTUAL arcade bridge (null biome)
 * into a playable biome while the recorded causal state is being compared.
 * Pure: no browser or Playwright imports so the negative gates are unit-testable.
 */
export function witnessedBiomeTransition(result) {
  const meta = result?.meta;
  return meta?.biomeEntryFromBridge === true &&
    Number.isSafeInteger(meta.biomeEntryTick) && meta.biomeEntryTick > 0 &&
    Number.isSafeInteger(meta.ticks) && meta.biomeEntryTick <= meta.ticks &&
    result?.baselineBiomeEntryFromBridge === true &&
    Number.isSafeInteger(result.baselineBiomeEntryTick) &&
    result.baselineBiomeEntryTick > 0 && result.baselineBiomeEntryTick <= meta.ticks;
}
