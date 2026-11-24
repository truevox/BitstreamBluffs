import { jest } from '@jest/globals';
import { StemMusicDirector } from '../../src/systems/music/StemMusicDirector.js';
import { GAME_SONGS, defaultSongSelection } from '../../src/systems/music/MusicPlaylist.js';
import { JukeboxHUD } from '../../src/ui/JukeboxHUD.js';

function bare(){
	const d=Object.create(StemMusicDirector.prototype);
	d.catalog=GAME_SONGS.slice(0,4).map(song=>({id:song.id,title:song.label}));
	d.songEnabled=defaultSongSelection();
	d.trackIndex=0;
	d.track=d.catalog[0];
	d.pack={duration:180};
	d.ctx={currentTime:35,state:'running'};
	d.clockStart=10;
	d.started=true;
	d.ready=true;
	d.disposed=false;
	d.transportPaused=false;
	d._resumeOffset=0;
	d._transportHistory=[];
	d._skipHistoryOnce=false;
	d._token=7;
	d._timer=null;
	d._nextPromise=null;
	d._nextIndex=null;
	d._loading=null;
	d.cache=new Map();
	d.scheduled=new Set();
	d.inflight=new Map();
	d.activeNodes=new Set();
	d.adaptive={reset:jest.fn()};
	d.bus={gain:{setTargetAtTime:jest.fn()}};
	d._ensureRunning=jest.fn();
	return d;
}

test('Game Over background tap guard owns real jukebox and open queue geometry',()=>{
	const owns=JukeboxHUD.prototype.ownsPointer;
	const hud={_closed:false,bounds:{x:335,y:4,w:141,h:31},
		queueBounds:{x:245,y:94,w:230,h:93},queue:null};
	expect(owns.call(hud,{x:400,y:18})).toBe(true);
	expect(owns.call(hud,{x:252,y:181})).toBe(false);
	expect(owns.call(hud,{x:120,y:200})).toBe(false);
	hud.queue={};
	expect(owns.call(hud,{x:252,y:181})).toBe(true);
	expect(owns.call(hud,{x:469,y:180})).toBe(true);
	expect(owns.call(hud,{x:250,y:188})).toBe(false);
	expect(owns.call(hud,{x:Number.NaN,y:101})).toBe(false);
	hud._closed=true;
	expect(owns.call(hud,{x:252,y:181})).toBe(false);
});

describe('Jukebox: one shared music director, reliable paused and skipped intent',()=>{
	test('snapshot shows current, previous, two queued and true clock time',()=>{
		const d=bare();
		d._transportHistory=[d.catalog[3]];
		expect(d.transportSnapshot()).toMatchObject({
			state:'playing',current:d.catalog[0],previous:d.catalog[3],
			upcoming:[d.catalog[1],d.catalog[2]],position:25,
			audioSuspended:false,
		});
	});
	test('pause stops one-shot nodes and preserves exact clock position for resume',()=>{
		const d=bare();
		d.activeNodes.add({stop:jest.fn()});
		expect(d.transportPause()).toBe(true);
		expect(d.started).toBe(false);
		expect(d.transportPaused).toBe(true);
		expect(d._resumeOffset).toBe(25);
		expect(d.transportSnapshot().state).toBe('paused');
		expect(d.transportPlay()).toBe(true);
		expect(d.started).toBe(true);
		expect(d.transportPaused).toBe(false);
		expect(d._resumeOffset).toBe(25); // consumed by _ensureRunning()
	});
	test('skip preserves pause, skips disabled songs, clears old playback offset',()=>{
		const d=bare();
		d.songEnabled[d.catalog[1].id]=false;
		d.transportPause();
		expect(d.transportStep(1)).toBe(true);
		expect(d.trackIndex).toBe(2);
		expect(d._resumeOffset).toBe(0);
		expect(d.transportPaused).toBe(true);
		expect(d.transportSnapshot().state).toBe('paused');
		expect(d.transportSnapshot().current).toBe(d.catalog[2]);
	});
	test('previous takes actual history before wrapping playlist',()=>{
		const d=bare();
		d.trackIndex=2;
		d.track=d.catalog[2];
		d._transportHistory=[d.catalog[0]];
		expect(d.transportStep(-1)).toBe(true);
		expect(d.trackIndex).toBe(0);
		expect(d._skipHistoryOnce).toBe(true);
		expect(d._transportHistory).toHaveLength(0);
	});
	test('all four disabled silences playlist; no procedural music fallback',()=>{
		const d=bare();
		d.setSongSelection(Object.fromEntries(GAME_SONGS.map(song=>[song.id,false])));
		expect(d.started).toBe(false);
		expect(d.transportSnapshot()).toMatchObject({
			state:'stopped',current:null,upcoming:[],
		});
		expect(d.transportPlay()).toBe(false);
		expect(d.transportStep(1)).toBe(false);
	});
	test('stale preload cleanup cannot erase newer loading promise',async()=>{
		const d=bare();
		d.pack=null;
		d.started=true;
		d._ensureRunning=StemMusicDirector.prototype._ensureRunning.bind(d);
		d._timer=setInterval(()=>{},100000);
		d._beginTrack=jest.fn(()=>Promise.resolve());
		d._resumeOffset=18.3;
		try {
			d._ensureRunning();
			expect(d._beginTrack).toHaveBeenCalledWith(0,null,18.3);
			expect(d._resumeOffset).toBe(0);
			await d._loading;
		}finally{
			clearInterval(d._timer);
			d._timer=null;
		}
	});
});
