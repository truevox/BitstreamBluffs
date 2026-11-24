import {assertPrivateAudioQaLoopbackHost} from '../../tools/music/private-qa-loopback.js';
describe('owner-private OGG source overlay binding safety',()=>{
	test.each(['127.0.0.1','::1'])('permits numeric loopback %s',host=>{
		expect(assertPrivateAudioQaLoopbackHost(host)).toBe(host);
	});
	test.each(['0.0.0.0','::','[::]','localhost','100.115.120.66',
		'192.168.1.2','2001:db8::1',''])('refuses unverified host %s',host=>{
		expect(()=>assertPrivateAudioQaLoopbackHost(host)).toThrow(/loopback-only/);
	});
});
