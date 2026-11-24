import {mixedOverlapCases,assertMixedOverlapCase} from '../../tools/music/mixed-overlap-cases.js';
test('exact four stress cases only; same song wrong segment/biome/scenario cannot pass',()=>{
	const songs=[{id:'a'},{id:'b'},{id:'c'},{id:'d'}];
	for(const c of mixedOverlapCases()){
		const value={trackId:songs[c.songIndex].id,sourceSegment:c.segment,biome:c.biome,
			scenario:c.scenario,test:{profile:c.profile}};
		expect(()=>assertMixedOverlapCase(value,songs)).not.toThrow();
		for(const patch of [{trackId:'wrong'},{sourceSegment:c.segment+1},{biome:'wrong'},{scenario:'music-only'},{test:{profile:'wrong'}}])
			expect(()=>assertMixedOverlapCase({...value,...patch},songs)).toThrow();
	}
});
