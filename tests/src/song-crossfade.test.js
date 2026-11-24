import {jest} from '@jest/globals';
import {normalizeTransitionGrids,planSongCrossfade,transitionGain,automateTransition} from '../../src/systems/music/SongCrossfade.js';
import {StemMusicDirector} from '../../src/systems/music/StemMusicDirector.js';

test('normal and quiet tails choose different bounded durations; valid bar alignment never seeks incoming audio',()=>{
	expect(planSongCrossfade(100,null,null)).toEqual({start:97.2,duration:expect.closeTo(2.8),beatAligned:false});
	const p=planSongCrossfade(100,{duration:100,quietTail:true,downbeats:[94,96.5,99]},{downbeats:[.25]});
	expect(p).toEqual({start:96.25,duration:3.75,beatAligned:true});
	expect(planSongCrossfade(100,{duration:99,quietTail:true,downbeats:[96]},{downbeats:[.25]}).beatAligned).toBe(false);
});
test('lyrics never compete, rhythmic pair never exceeds unity sum, melodic power stays constant',()=>{
	for(let i=0;i<=100;i++){
		const t=i/100;
		expect(transitionGain('vocals','in',t)*transitionGain('vocals','out',t)).toBe(0);
		expect(transitionGain('drums','in',t)+transitionGain('drums','out',t)).toBeCloseTo(1);
		expect(transitionGain('guitar','in',t)**2+transitionGain('guitar','out',t)**2).toBeCloseTo(1);
	}
});
test('late-created incoming segment starts at correct envelope value',()=>{
	const param={setValueAtTime:jest.fn(),linearRampToValueAtTime:jest.fn()};
	automateTransition(param,'bass','in',10,14,12);
	expect(param.setValueAtTime).toHaveBeenCalledWith(.5,12);
	expect(param.linearRampToValueAtTime).toHaveBeenLastCalledWith(1,14);
});
test('malformed, out-of-duration, or mislabeled grids never enter transition map',()=>{
	const good={id:'a',status:'estimated-4/4',duration:10,bpm:120,downbeats:[.5,2.5,4.5]};
	const map=normalizeTransitionGrids({format:'bsb-provisional-transition-grids-v1',tracks:[good,{...good,id:'b',downbeats:[3,2]},{...good,id:'c',downbeats:[0,11]},{...good,id:'d',status:'verified'}]});
	expect([...map.keys()]).toEqual(['a']);
});
test('transition only commits with complete preloaded incoming and scheduled outgoing roles',()=>{
	const d=Object.create(StemMusicDirector.prototype);
	Object.assign(d,{crossfadeEnabled:true,_loading:null,_nextPromise:Promise.resolve(),_nextIndex:1,_token:5,track:{id:'a'},catalog:[{id:'a'},{id:'b'}],songEnabled:{},clockStart:10,pack:{sampleRate:1,segments:[{startFrame:0,frames:96},{startFrame:96,frames:4}]},_nextPrepared:{track:{id:'b'},pack:{},buffers:new Map([['0/drums',{}]])},_wantedNames:()=>['drums'],scheduled:new Set(),_beginTrack:jest.fn(()=>Promise.resolve())});
	d._trySongCrossfade(106.9,96.9,100);
	expect(d._beginTrack).not.toHaveBeenCalled();
	d.scheduled.add('1/drums');
	d._trySongCrossfade(106.9,96.9,100);
	expect(d._beginTrack).toHaveBeenCalledWith(1,107.2,0,expect.objectContaining({oldToken:5,end:110,from:'a'}));
});

test('explicit OFF prevents automatic transition without changing physics or transport',()=>{
	const d=Object.create(StemMusicDirector.prototype);
	d.crossfadeEnabled=true;d._beginTrack=jest.fn();
	d.setCrossfade(false);
	d._trySongCrossfade(96.9,96.9,100);
	expect(d.crossfadeEnabled).toBe(false);
	expect(d._beginTrack).not.toHaveBeenCalled();
});

import {GAME_SONGS,defaultSongSelection} from '../../src/systems/music/MusicPlaylist.js';
function overlapFixture(){
	const [a,b]=GAME_SONGS.map(s=>({id:s.id}));
	const d=Object.create(StemMusicDirector.prototype);
	const node=()=>({stop:jest.fn(),disconnect:jest.fn()});
	const param=()=>({cancelScheduledValues:jest.fn(),cancelAndHoldAtTime:jest.fn(),setTargetAtTime:jest.fn()});
	const old=node(),incoming=node(),oldGain=param(),newGain=param();
	Object.assign(d,{ctx:{currentTime:11,state:'running'},bus:{gain:param()},started:true,ready:true,
		track:b,trackIndex:1,catalog:[a,b],songEnabled:defaultSongSelection(),clockStart:10,
		pack:{id:b.id,duration:100},_token:8,_incomingFade:{token:8,start:10,end:13},
		activeNodes:new Set([old,incoming]),_sourceEnvelopes:new Map([
			[old,{songId:a.id,token:7,gain:{gain:oldGain,disconnect:jest.fn()},role:'drums',end:13}],
			[incoming,{songId:b.id,token:8,gain:{gain:newGain,disconnect:jest.fn()},role:'drums',end:20}]]),
		cache:new Map(),scheduled:new Set(),inflight:new Map(),_pump:jest.fn(),_syncAdaptiveUserLevels:jest.fn(),
		start:jest.fn(()=>true)});
	return {d,a,b,old,incoming,oldGain,newGain};
}
test('disabling outgoing mid-overlap retires only its nodes, completes incoming gain without a restart',()=>{
	const {d,a,b,old,incoming,oldGain,newGain}=overlapFixture();
	d.setSongSelection({...d.songEnabled,[a.id]:false});
	expect(oldGain.cancelAndHoldAtTime).toHaveBeenCalledWith(11);
	expect(oldGain.setTargetAtTime).toHaveBeenCalledWith(0,11,.003);
	expect(old.stop).toHaveBeenCalledWith(11.015);
	expect(incoming.stop).not.toHaveBeenCalled();
	expect(newGain.setTargetAtTime).toHaveBeenCalledWith(1,11,.015);
	expect(d.activeNodes.has(old)).toBe(false);
	expect(d._sourceEnvelopes.has(old)).toBe(false);
	expect(d.track.id).toBe(b.id);expect(d.clockStart).toBe(10);expect(d._token).toBe(8);
	expect(d.start).not.toHaveBeenCalled();expect(d._incomingFade).toBeNull();
	// Toggling back does not resurrect the already retired outgoing nodes.
	d.setSongSelection({...d.songEnabled,[a.id]:true});
	expect(old.stop).toHaveBeenCalledTimes(1);
	expect(d.start).not.toHaveBeenCalled();
});
test.each(['pause','seek'])('%s after outgoing mute does not extend its stop or retain old ownership',kind=>{
	const {d,a,old,incoming}=overlapFixture();
	d.setSongSelection({...d.songEnabled,[a.id]:false});
	if(kind==='pause')expect(d.transportPause()).toBe(true);
	else expect(d.seekTo(5)).toBe(true);
	expect(old.stop).toHaveBeenCalledTimes(1);
	expect(incoming.stop).toHaveBeenCalledTimes(1);
	expect(d.activeNodes.size).toBe(0);expect(d._sourceEnvelopes.size).toBe(0);
	expect(d._incomingFade).toBeNull();
});
test('all songs disabled during overlap retires both and stops transport',()=>{
	const {d,old,incoming}=overlapFixture();
	d.setSongSelection(Object.fromEntries(GAME_SONGS.map(s=>[s.id,false])));
	expect(old.stop).toHaveBeenCalledTimes(1);expect(incoming.stop).toHaveBeenCalledTimes(1);
	expect(d.started).toBe(false);expect(d._sourceEnvelopes.size).toBe(0);
	expect(d.start).not.toHaveBeenCalled();
});
