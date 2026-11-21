/**
 * OFFLINE SHARD RACING REFERENCE ENVELOPE — draft RFC v0.2.
 * Pure client-only example, not wired to production game or leaderboard.
 * LOCAL_OFFICIAL means official under the local Shard Racing rules, NOT a
 * server-verified global score. The rules/cadence/ranking metric are not frozen.
 * Never treat a client-provided attestation string as public authority.
 */
export const SHARD_EVENT_SCHEMA_VERSION = 1;
const asId = (value, name) => {
	if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(value))
		throw new TypeError('invalid ' + name);
	return value;
};
const count = (value, name) => {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new TypeError('invalid ' + name);
	return value;
};

export function createLocalShardRaceEvent({
	eventId, seasonId, pilotId, frozenModelHash, equipmentHash,
	rulesVersion, resolverVersion, estimatorVersion, evidenceSnapshotId, seed,
	offlineSessionId, settlementId, eventOrdinal, intervalStartMs, intervalEndMs,
	opponentTier, result, shardsAwarded,
}) {
	if (result !== 'win' && result !== 'loss') throw new TypeError('invalid result');
	if (!Number.isSafeInteger(intervalStartMs) || intervalStartMs < 0 ||
		!Number.isSafeInteger(intervalEndMs) || intervalEndMs <= intervalStartMs)
		throw new TypeError('invalid offline interval');
	return Object.freeze({
		schemaVersion: SHARD_EVENT_SCHEMA_VERSION,
		eventId: asId(eventId, 'eventId'),
		seasonId: asId(seasonId, 'seasonId'),
		pilotId: asId(pilotId, 'pilotId'),
		offlineSessionId: asId(offlineSessionId, 'offlineSessionId'),
		settlementId: asId(settlementId, 'settlementId'),
		eventOrdinal: count(eventOrdinal, 'eventOrdinal'),
		intervalStartMs, intervalEndMs,
		opponentTier: asId(opponentTier, 'opponentTier'),
		frozenModelHash: asId(frozenModelHash, 'frozenModelHash'),
		equipmentHash: asId(equipmentHash, 'equipmentHash'),
		rulesVersion: asId(rulesVersion, 'rulesVersion'),
		resolverVersion: asId(resolverVersion, 'resolverVersion'),
		estimatorVersion: asId(estimatorVersion, 'estimatorVersion'),
		evidenceSnapshotId: asId(evidenceSnapshotId, 'evidenceSnapshotId'),
		seed: asId(seed, 'seed'),
		result,
		shardsAwarded: count(shardsAwarded, 'shardsAwarded'),
		resultOrigin: 'offline-modeled',
		officialScope: 'local-shard-racing',
		publicVerification: 'not-verified',
	});
}
export function validateLocalShardRaceEvent(input) {
	if (!input || typeof input !== 'object') throw new TypeError('event missing');
	if (input.schemaVersion !== SHARD_EVENT_SCHEMA_VERSION)
		throw new TypeError('unsupported schema version');
	const expected = createLocalShardRaceEvent(input);
	// Reject any attempt to change authoritative local-official source labels.
	for (const name of Object.keys(expected)) {
		if (input[name] !== expected[name])
			throw new TypeError('noncanonical event field: ' + name);
	}
	return expected;
}
/**
 * Projection only: prototype ranking policy is wins, then shard income, then
 * stable pilot ID. This order is Friday's unapproved first-pass default.
 * The official mode's actual season and win rules still need owner review.
 */
export function projectLocalShardRanking(records, seasonId) {
	asId(seasonId, 'seasonId');
	if (!Array.isArray(records)) throw new TypeError('records array required');
	const byEvent = new Map();
	const byPilot = new Map();
	for (const raw of records) {
		const event = validateLocalShardRaceEvent(raw);
		if (event.seasonId !== seasonId) continue;
		if (byEvent.has(event.eventId)) {
			const first = byEvent.get(event.eventId);
			if (JSON.stringify(first) !== JSON.stringify(event))
				throw new TypeError('conflicting reused event id');
			continue; // idempotent replay of the SAME event cannot add wins
		}
		byEvent.set(event.eventId, event);
		let row = byPilot.get(event.pilotId);
		if (!row) {
			row = { pilotId: event.pilotId, races: 0, wins: 0, losses: 0, shards: 0 };
			byPilot.set(event.pilotId, row);
		}
		row.races++;
		if (event.result === 'win') row.wins++;
		else row.losses++;
		row.shards += event.shardsAwarded;
	}
	return [...byPilot.values()].sort((a, b) =>
		b.wins - a.wins || b.shards - a.shards || a.pilotId.localeCompare(b.pilotId)
	);
}
/** An offline self-reported modeled event is never verifiable public proof.
 * A future service must implement its OWN trusted authority; do not allow a
 * caller to set "verified" in the local JSON and treat that as validation.
 */
export function publicEligibilityOfLocalEvent(raw) {
	validateLocalShardRaceEvent(raw);
	return Object.freeze({ eligible: false, reason: 'not-server-verified' });
}
