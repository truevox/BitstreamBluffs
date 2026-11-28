import test from 'node:test';
import assert from 'node:assert/strict';
import {
	SHARD_EVENT_SCHEMA_VERSION, createLocalShardRaceEvent,
	validateLocalShardRaceEvent, projectLocalShardRanking, publicEligibilityOfLocalEvent,
} from './alphabluffs-shard-racing-events.mjs';

const ev = (eventId, pilotId='pilotA', result='win', shardsAwarded=20, seasonId='season1') =>
	createLocalShardRaceEvent({
		eventId, seasonId, pilotId,
		frozenModelHash: 'sha256:a123',
		equipmentHash: 'gear:v1',
		rulesVersion: 'game:1', resolverVersion: 'shard:1',
		estimatorVersion: 'est:1', evidenceSnapshotId: 'evidence:1', seed: 'seed:1',
		offlineSessionId: 'offline:1', settlementId: 'settlement:1',
		eventOrdinal: Number(eventId.replace('e','')) || 0,
		intervalStartMs: 1700000000000, intervalEndMs: 1700003600000,
		opponentTier: 'tier:rookie', result, shardsAwarded,
	});
test('local modeled events are schema versioned and clearly not public verified', () => {
	const e = ev('e1');
	assert.equal(e.schemaVersion, SHARD_EVENT_SCHEMA_VERSION);
	assert.equal(e.officialScope, 'local-shard-racing');
	assert.equal(e.resultOrigin, 'offline-modeled');
	assert.equal(e.publicVerification, 'not-verified');
	assert.deepEqual(publicEligibilityOfLocalEvent(e), {eligible:false, reason:'not-server-verified'});
});
test('local standings are rebuilt solely from events; replay cannot duplicate wins', () => {
	const a=ev('e1'), b=ev('e2','pilotB','win',7), c=ev('e3','pilotA','loss',3);
	const first=projectLocalShardRanking([c,b,a], 'season1');
	const second=projectLocalShardRanking([a,b,c,b], 'season1');
	assert.deepEqual(first,second);
	assert.equal(first[0].pilotId,'pilotA');
	assert.deepEqual(first[0],{pilotId:'pilotA',races:2,wins:1,losses:1,shards:23});
	assert.equal(first[1].pilotId,'pilotB');
});
test('seasons are independent', () => {
	const board=projectLocalShardRanking([ev('e1'),ev('e2','pilotB','win',10,'season2')], 'season1');
	assert.equal(board.length,1);
	assert.equal(board[0].pilotId,'pilotA');
});
test('unknown schema is rejected rather than silently entering rankings', () => {
	assert.throws(() => projectLocalShardRanking([{...ev('e1'),schemaVersion:99}],'season1'),/unsupported/);
});
test('local claims of public verification cannot be laundered into global scores', () => {
	const spoof={...ev('e1'), publicVerification:'server-verified'};
	assert.throws(() => validateLocalShardRaceEvent(spoof),/noncanonical/);
	assert.throws(() => publicEligibilityOfLocalEvent(spoof),/noncanonical/);
});
test('same event ID with different outcomes is a conflict, not another victory', () => {
	const a=ev('e1');
	const b=ev('e1','pilotB','loss');
	assert.throws(() => projectLocalShardRanking([a,b],'season1'),/conflicting/);
});
test('identity and shard counts reject malformed values', () => {
	assert.throws(() => ev('bad id'),/invalid eventId/);
	assert.throws(() => ev('e2','pilotA','win',-1),/invalid shardsAwarded/);
});

test('official local event requires provenance and a well-formed offline interval', () => {
	const valid = ev('e9');
	assert.equal(valid.estimatorVersion, 'est:1');
	assert.equal(valid.settlementId, 'settlement:1');
	assert.equal(valid.opponentTier, 'tier:rookie');
	assert.throws(() => validateLocalShardRaceEvent({...valid, settlementId: ''}), /invalid settlementId/);
	assert.throws(() => validateLocalShardRaceEvent({...valid, intervalEndMs: valid.intervalStartMs}), /invalid offline interval/);
});
