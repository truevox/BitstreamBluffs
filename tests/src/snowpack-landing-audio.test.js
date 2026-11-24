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


test('throwing musical-physics landing effect cannot interrupt gameplay event or ordinary SFX',()=>{
	const events=new EventEmitter();
	const audio=new AudioSynth({events});
	audio._musicMode='run';
	const land={quality:'perfect',impactSpeedPxS:950,hard:true};
	const tail=jest.fn();
	audio.playSfx=jest.fn();
	audio._stemMusic.onLanding=jest.fn(()=>{throw new Error('bad audio effect node');});
	events.on(EVT.LANDING,tail); // like other authoritative gameplay consumers
	expect(()=>events.emit(EVT.LANDING,land)).not.toThrow();
	expect(audio._stemMusic.onLanding).toHaveBeenCalledWith(land);
	expect(audio.playSfx).toHaveBeenCalledWith('landPerfect');
	expect(tail).toHaveBeenCalledWith(land);
	audio.destroy();
});
