import { jest } from '@jest/globals';
import { streamerPolicyUrl, openStreamerPolicy } from '../../src/ui/StreamerPolicy.js';

describe('streamer-friendly in-game permission link', () => {
	test('resolves to the published page, including when deployed under a path', () => {
		expect(streamerPolicyUrl('https://game.example.com/index.html')).toBe('https://game.example.com/streamers.html');
		expect(streamerPolicyUrl('https://game.example.com/subdir/index.html')).toBe('https://game.example.com/subdir/streamers.html');
	});

	test('opens permission in a new tab and leaves gameplay/music state alone', () => {
		const open = jest.fn();
		const host = { location: { href: 'https://game.example.com/' }, open };
		expect(openStreamerPolicy(host)).toBe(true);
		expect(open).toHaveBeenCalledWith('https://game.example.com/streamers.html', '_blank', 'noopener,noreferrer');
		expect(Object.keys(host).sort()).toEqual(['location', 'open']);
	});

	test('a blocked/absent window is harmless to the game', () => {
		expect(openStreamerPolicy(null)).toBe(false);
		expect(openStreamerPolicy({ location: { href: 'https://game.example/' }, open() { throw Error('blocked'); } })).toBe(false);
	});
});
