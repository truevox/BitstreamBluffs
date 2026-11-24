import assert from 'node:assert/strict';
export const mixedOverlapCases=()=>[0,1,2,3].map(songIndex=>({
	songIndex,segment:songIndex===1?12:0,
	biome:['vertigo-vents','garbage-dump-glacier','crystal-cavern','bitstream-bluffs'][songIndex],
	scenario:'mixed-game-stress',profile:'crash-static-overlap',
}));
export function assertMixedOverlapCase(value,songs){
	const index=songs.findIndex(x=>x.id===value.trackId);
	assert.ok(index>=0,'Unexpected overlap song');
	const expected=mixedOverlapCases()[index];
	assert.equal(value.sourceSegment,expected.segment);
	assert.equal(value.biome,expected.biome);
	assert.equal(value.scenario,expected.scenario);
	assert.equal(value.test?.profile,expected.profile);
}
