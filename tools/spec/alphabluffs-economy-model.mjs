/*
 * AlphaBluffs v0.2 economy REFERENCE MODEL, NOT wired to production.
 * This demonstrates owner-decided state transitions with explicitly
 * placeholder external pricing. It is neither a wallet implementation
 * nor evidence of physical worker throughput.
 *
 * See docs/rfcs/alphabluffs-v0.2-contract.md.
 */
export const HOUR = 60 * 60 * 1000;
export const TWELVE_HOURS = 12 * HOUR;
const safeInt = n => Number.isSafeInteger(n) && n >= 0;
const copy = s => structuredClone(s);

export function freshProfile({ bank = 0, brainId = 'starter' } = {}) {
	if (!safeInt(bank)) throw new RangeError('invalid bank');
	return {
		phase: 'between', bank, brainId, campaignId: 0, progress: 0,
		pendingPowerMs: 0, freeAttentionMs: 0, paidAttentionMs: 0,
		leases: [], nextLeaseId: 1, forfeits: [],
	};
}
function quote(s, cost) {
	if (!safeInt(cost)) throw new RangeError('invalid quoted cost');
	if (s.bank < cost) throw new Error('insufficient shards');
}
export function rentSlot(state, { quotedCost = 0 } = {}) {
	if (state.phase !== 'between') throw new Error('Sim-Slots rented only between campaigns');
	quote(state, quotedCost);
	const s = copy(state);
	s.bank -= quotedCost;
	s.leases.push({ id: s.nextLeaseId++, remainingMs: TWELVE_HOURS });
	return s;
}
export function buyPotion(state, { quotedCost = 0 } = {}) {
	quote(state, quotedCost);
	const s = copy(state);
	s.bank -= quotedCost;
	if (s.phase === 'between') s.pendingPowerMs += TWELVE_HOURS;
	else s.paidAttentionMs += TWELVE_HOURS;
	// Extends the leases held NOW, not those purchased subsequently.
	for (const lease of s.leases) if (lease.remainingMs > 0) lease.remainingMs += TWELVE_HOURS;
	return s;
}
export function startCampaign(state) {
	if (state.phase !== 'between') throw new Error('already training');
	const s = copy(state);
	s.phase = 'running';
	s.campaignId++;
	s.freeAttentionMs = TWELVE_HOURS;
	s.paidAttentionMs = s.pendingPowerMs;
	s.pendingPowerMs = 0;
	return s;
}
export function pause(state) {
	if (state.phase !== 'running') throw new Error('not running');
	const s = copy(state);
	s.phase = 'paused';
	return s;
}
export function resume(state) {
	if (state.phase !== 'paused' && state.phase !== 'awaiting') throw new Error('not paused');
	if (state.freeAttentionMs + state.paidAttentionMs <= 0) throw new Error('needs free Continue');
	const s = copy(state);
	s.phase = 'running';
	return s;
}
export function freeContinue(state) {
	if (state.phase !== 'awaiting') throw new Error('not awaiting free rearm');
	const s = copy(state);
	s.freeAttentionMs += TWELVE_HOURS;
	s.phase = 'running';
	return s;
}
/** Advance ONLY on verified active training: dtMs productive time; usedLeaseIds
 * are bonus environments that truly stepped during this dt. Never call for
 * a sleeping, closed, paused, or stalled worker. Paid lease metering is
 * proposed default, not an owner-frozen product decision.
 */
export function advance(state, dtMs, usedLeaseIds = []) {
	if (state.phase !== 'running') throw new Error('cannot bill non-running work');
	if (!safeInt(dtMs) || dtMs === 0) throw new RangeError('invalid productive duration');
	const s = copy(state);
	const n = Math.min(dtMs, s.freeAttentionMs + s.paidAttentionMs);
	if (!n) { s.phase = 'awaiting'; return s; }
	if (new Set(usedLeaseIds).size !== usedLeaseIds.length) throw new Error('duplicate slot');
	for (const id of usedLeaseIds) {
		const lease = s.leases.find(x => x.id === id && x.remainingMs > 0);
		if (!lease) throw new Error('invalid or expired bonus slot');
	}
	const fromFree = Math.min(s.freeAttentionMs, n);
	s.freeAttentionMs -= fromFree;
	s.paidAttentionMs -= n - fromFree;
	for (const id of usedLeaseIds) {
		const lease = s.leases.find(x => x.id === id);
		lease.remainingMs = Math.max(0, lease.remainingMs - n);
	}
	s.progress += n; // Only an illustrative counter; never real neural learning.
	if (s.freeAttentionMs + s.paidAttentionMs === 0) s.phase = 'awaiting';
	return s;
}
export function stopAndReconfigure(state) {
	if (state.phase === 'between') throw new Error('not in a campaign');
	const s = copy(state);
	// Only this deliberate action forfeits prepaid run-specific unused time.
	s.forfeits.push({
		campaignId: s.campaignId,
		unusedPaidPowerMs: s.paidAttentionMs,
		unusedBonusSlotMs: s.leases.reduce((a, x) => a + x.remainingMs, 0),
	});
	s.phase = 'between';
	s.freeAttentionMs = 0;
	s.paidAttentionMs = 0;
	s.leases = [];
	// NEVER reset brainId, progress, or accrued bank: no extra cancellation fee.
	return s;
}
