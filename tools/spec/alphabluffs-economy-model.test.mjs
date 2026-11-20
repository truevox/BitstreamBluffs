/* Node built-in test runner. This tests a spec model, NOT production gameplay. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	HOUR, TWELVE_HOURS, freshProfile, rentSlot, buyPotion,
	startCampaign, advance, pause, resume, freeContinue, stopAndReconfigure,
} from './alphabluffs-economy-model.mjs';

test('three free sims can train indefinitely with free 12h manual check-ins', () => {
	let s = startCampaign(freshProfile());
	for (let i = 0; i < 8; i++) {
		s = advance(s, TWELVE_HOURS);
		assert.equal(s.phase, 'awaiting');
		s = freeContinue(s);
		assert.equal(s.campaignId, 1);
	}
	assert.equal(s.bank, 0);
	assert.equal(s.progress, 8 * TWELVE_HOURS);
	assert.equal(s.leases.length, 0);
});
test('Sim-Slots cannot be rented while running, paused or awaiting Continue', () => {
	let s = startCampaign(freshProfile({ bank: 100 }));
	assert.throws(() => rentSlot(s, { quotedCost: 5 }), /between/);
	s = pause(s);
	assert.throws(() => rentSlot(s, { quotedCost: 5 }), /between/);
	s = resume(s);
	s = advance(s, TWELVE_HOURS);
	assert.throws(() => rentSlot(s, { quotedCost: 5 }), /between/);
});
test('Potion adds +12h to current/next campaign and only existing leases', () => {
	let s = freshProfile({ bank: 200 });
	s = buyPotion(s, { quotedCost: 10 }); // before renting: no retroactivity
	s = rentSlot(s, { quotedCost: 20 }); // lease 1, only 12h
	assert.equal(s.leases[0].remainingMs, TWELVE_HOURS);
	s = buyPotion(s, { quotedCost: 30 });
	assert.equal(s.pendingPowerMs, 2 * TWELVE_HOURS);
	assert.equal(s.leases[0].remainingMs, 2 * TWELVE_HOURS);
	s = rentSlot(s, { quotedCost: 20 }); // lease 2, only initial 12h
	assert.equal(s.leases[1].remainingMs, TWELVE_HOURS);
	s = startCampaign(s);
	assert.equal(s.paidAttentionMs, 2 * TWELVE_HOURS);
	s = buyPotion(s, { quotedCost: 40 });
	assert.equal(s.paidAttentionMs, 3 * TWELVE_HOURS);
	assert.equal(s.leases[0].remainingMs, 3 * TWELVE_HOURS);
	assert.equal(s.leases[1].remainingMs, 2 * TWELVE_HOURS);
});
test('productive occupancy draws bonus slot leases, idle slots do not', () => {
	let s = rentSlot(freshProfile({ bank: 10 }), { quotedCost: 3 });
	s = startCampaign(s);
	s = advance(s, HOUR); // no bonus slot actually advancing
	assert.equal(s.leases[0].remainingMs, TWELVE_HOURS);
	s = advance(s, HOUR, [s.leases[0].id]);
	assert.equal(s.leases[0].remainingMs, 11 * HOUR);
});
test('Stop & Reconfigure preserves brain and credits but forfeits all invested unused time', () => {
	let s = freshProfile({ bank: 100, brainId: 'trained-001' });
	s = rentSlot(s, { quotedCost: 10 });
	s = buyPotion(s, { quotedCost: 20 });
	s = startCampaign(s);
	s = advance(s, 2 * HOUR, [s.leases[0].id]);
	const before = s.progress, bank = s.bank;
	s = stopAndReconfigure(s);
	assert.equal(s.phase, 'between');
	assert.equal(s.brainId, 'trained-001');
	assert.equal(s.progress, before);
	assert.equal(s.bank, bank); // stopping costs no extra shards
	assert.equal(s.leases.length, 0);
	assert.equal(s.paidAttentionMs, 0);
	assert.equal(s.forfeits[0].unusedPaidPowerMs, 12 * HOUR);
	assert.equal(s.forfeits[0].unusedBonusSlotMs, 22 * HOUR);
	s = startCampaign(s);
	assert.equal(s.paidAttentionMs, 0);
	assert.equal(s.freeAttentionMs, 12 * HOUR);
	assert.equal(s.campaignId, 2);
});
test('When no paid time remains, stopping is truly free', () => {
	let s = startCampaign(freshProfile({ brainId: 'saved-brain' }));
	s = advance(s, TWELVE_HOURS);
	s = stopAndReconfigure(s);
	assert.deepEqual([s.forfeits[0].unusedPaidPowerMs, s.forfeits[0].unusedBonusSlotMs], [0, 0]);
});
test('Pausing, serializing, and resuming does not consume prepaid time', () => {
	let s = startCampaign(buyPotion(freshProfile({ bank: 5 }), { quotedCost: 5 }));
	s = pause(s);
	s = JSON.parse(JSON.stringify(s)); // browser reload persistence approximation
	assert.equal(s.paidAttentionMs, TWELVE_HOURS);
	assert.equal(s.phase, 'paused');
	s = resume(s);
	assert.equal(s.paidAttentionMs, TWELVE_HOURS);
});
test('Invalid purchases and double-use of an expired bonus slot are rejected', () => {
	assert.throws(() => buyPotion(freshProfile(), { quotedCost: 1 }), /insufficient/);
	let s = startCampaign(rentSlot(freshProfile({ bank: 10 }), { quotedCost: 5 }));
	s = advance(s, TWELVE_HOURS, [s.leases[0].id]);
	s = freeContinue(s);
	assert.throws(() => advance(s, HOUR, [s.leases[0].id]), /expired/);
});
