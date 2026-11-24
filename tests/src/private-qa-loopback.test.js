import {assertPrivateAudioQaLoopbackHost,isPrivateQaRequestHost} from '../../tools/music/private-qa-loopback.js';
describe('owner-private OGG source overlay binding safety',()=>{
	test.each(['127.0.0.1','::1'])('permits numeric loopback %s',host=>{
		expect(assertPrivateAudioQaLoopbackHost(host)).toBe(host);
	});
	test.each(['0.0.0.0','::','[::]','localhost','100.115.120.66',
		'192.168.1.2','2001:db8::1',''])('refuses unverified host %s',host=>{
		expect(()=>assertPrivateAudioQaLoopbackHost(host)).toThrow(/loopback-only/);
	});
});

test('private requests require exact numeric authority including port',()=>{
	expect(isPrivateQaRequestHost('127.0.0.1:8220','127.0.0.1',8220)).toBe(true);
	expect(isPrivateQaRequestHost('[::1]:8220','::1',8220)).toBe(true);
	for(const host of ['attacker.invalid:8220','localhost:8220','127.0.0.1','127.0.0.1:8221',undefined])
		expect(isPrivateQaRequestHost(host,'127.0.0.1',8220)).toBe(false);
});
