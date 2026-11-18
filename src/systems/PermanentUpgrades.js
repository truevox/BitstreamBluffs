/**
 * Permanent, opt-in, softcapped upgrades.
 *
 * Bought ranks never disappear and there is no designer-imposed maximum rank.
 * Gameplay impact approaches finite asymptotes so repeated purchasing gives
 * diminishing returns. Cost rises as ranks rise. Purchased ranks are disabled
 * on official Daily runs and when UPGRADE MODE is off.
 *
 * This is a pure module: bank mutations and persistence are owned by ProfileStore.
 */
export const UPGRADE_CATALOG = Object.freeze([
  { id: 'speed', label: 'RACE SPEED', basePrice: 28, priceScale: 4, curveK: 12, cap: .30 },
  { id: 'hop', label: 'HOP HEIGHT', basePrice: 26, priceScale: 4, curveK: 12, cap: .22 },
  { id: 'flip', label: 'FLIP CONTROL', basePrice: 30, priceScale: 5, curveK: 10, cap: .33 },
  { id: 'canopy', label: 'PARACHUTE FUEL', basePrice: 34, priceScale: 5, curveK: 14, cap: .70 },
  { id: 'airbrake', label: 'AIRBRAKE LIFT', basePrice: 30, priceScale: 4, curveK: 12, cap: .55 },
  { id: 'divebomb', label: 'DIVEBOMB POWER', basePrice: 27, priceScale: 4, curveK: 10, cap: .48 },
  { id: 'bsodGrace', label: 'BSOD HEAD START', basePrice: 48, priceScale: 7, curveK: 18, cap: .25 },
]);
/**
 * High-tier canopy milestone: successful BSOD Bluffing pressurizes the sail.
 * The original 880ms one-tank-per-flight rule remains intact for every
 * clean run and for purchased ranks below 12. Only an actual earned escape
 * (never merely surviving near the wall) can restore spent canopy fuel.
 *
 * Milestone and coefficients are provisional balancing values; recovery
 * per successive Bluff declines without imposing a hard chain limit.
 */
export const CANOPY_BLUFF_RECOVERY_RANK = 12;
export function canopyBluffRecoveryMs(rank, chain, fullMs) {
  if (!Number.isSafeInteger(rank) || rank < CANOPY_BLUFF_RECOVERY_RANK
      || !Number.isSafeInteger(chain) || chain < 1
      || !Number.isFinite(fullMs) || fullMs <= 0) return 0;
  const milestoneRanks = rank - CANOPY_BLUFF_RECOVERY_RANK + 1;
  const fraction = 0.74 * milestoneRanks / (milestoneRanks + 2) / Math.sqrt(chain);
  return Math.max(0, Math.min(fullMs, fullMs * fraction));
}
export const UPGRADE_IDS = Object.freeze(UPGRADE_CATALOG.map(u => u.id));
const byId = Object.fromEntries(UPGRADE_CATALOG.map(u => [u.id, u]));
const validRank = n => Number.isSafeInteger(n) && n >= 0;
export const emptyUpgradeRanks = () => Object.fromEntries(UPGRADE_IDS.map(id => [id, 0]));

/** Unknown keys and invalid ranks cannot become invisible, ranked gameplay modifiers. */
export function sanitizeUpgradeRanks(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const ranks = emptyUpgradeRanks();
  for (const id of UPGRADE_IDS) if (validRank(raw[id])) ranks[id] = raw[id];
  return ranks;
}

/** Canonical on-record snapshot: only positive known ranks, in stable catalogue order. */
export function activeUpgradeRanks(input) {
  const raw = sanitizeUpgradeRanks(input);
  return Object.fromEntries(UPGRADE_IDS.filter(id => raw[id] > 0).map(id => [id, raw[id]]));
}

/** A null price represents an unrepresentable transaction, never a free purchase. */
export function nextUpgradePrice(id, currentRank = 0) {
  const spec = byId[id];
  if (!spec || !validRank(currentRank)) return null;
  const r = currentRank;
  const price = Math.ceil(spec.basePrice + spec.priceScale * r * (1 + r / 12));
  return Number.isSafeInteger(price) && price >= 1 ? price : null;
}

export function upgradeBenefit(id, rank = 0) {
  const spec = byId[id];
  if (!spec || !validRank(rank) || !rank) return 0;
  return spec.cap * (rank / (rank + spec.curveK));
}

export function upgradeEffects(input) {
  const ranks = sanitizeUpgradeRanks(input);
  const b = (id) => upgradeBenefit(id, ranks[id]);
  return Object.freeze({
    speedMul: 1 + b('speed'),
    hopMul: 1 + b('hop'),
    flipMul: 1 + b('flip'),
    canopyFuelMul: 1 + b('canopy'),
    airbrakeLiftMul: 1 + b('airbrake'),
    divebombMul: 1 + b('divebomb'),
    bsodAccelerationMul: 1 - b('bsodGrace'),
  });
}

/**
 * A run snapshot is taken ONCE at run start. Daylies must refuse all upgrades;
 * a purchased rank alone has no effect until UPGRADE MODE is explicitly enabled.
 */
export function upgradeLoadoutForRun(profile, { daily = false } = {}) {
  const ranks = activeUpgradeRanks(profile?.upgrades);
  const enabled = profile?.upgradesEnabled === true && daily !== true && Object.keys(ranks).length > 0;
  return { enabled, ranks: enabled ? ranks : {}, effects: upgradeEffects(enabled ? ranks : {}) };
}

/** Atomic pure transaction: return original identity on any refusal. */
export function purchaseUpgrade(profile, id) {
  if (!profile || typeof profile !== 'object' || !byId[id]) return profile;
  const ranks = sanitizeUpgradeRanks(profile.upgrades);
  const rank = ranks[id];
  if (!Number.isSafeInteger(profile.bank) || profile.bank < 0) return profile;
  if (!Number.isSafeInteger(rank + 1)) return profile;
  const price = nextUpgradePrice(id, rank);
  if (price === null || profile.bank < price) return profile;
  return { ...profile, bank: profile.bank - price, upgrades: { ...ranks, [id]: rank + 1 } };
}
