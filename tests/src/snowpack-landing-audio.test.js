import { jest } from '@jest/globals';
import { EventEmitter } from 'events';
import { AudioSynth } from '../../src/systems/AudioSynth.js';
import { EVT } from '../../src/events.js';

test('the authoritative landing event reaches stem music in runs but not menus or crashes', () => {
	const events = new EventEmitter();
	const audio = new AudioSynth({ events });
	audio._musicMode = 'run';
	audio.playSfx = jest.fn();
	audio._stemMusic.onLanding = jest.fn();
	const landing = { quality:'good', impactSpeedPxS:700, hard:true };
	events.emit(EVT.LANDING, landing);
	expect(audio._stemMusic.onLanding).toHaveBeenCalledWith(landing);
	expect(audio.playSfx).toHaveBeenCalled();
	audio._stemMusic.onLanding.mockClear();
	events.emit(EVT.LANDING, { quality:'crash', impactSpeedPxS:1500 });
	expect(audio._stemMusic.onLanding).not.toHaveBeenCalled();
	audio._musicMode = 'menu';
	events.emit(EVT.LANDING, landing);
	expect(audio._stemMusic.onLanding).not.toHaveBeenCalled();
	audio.destroy();
});
