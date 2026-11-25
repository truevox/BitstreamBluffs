import {jest} from '@jest/globals';
import {AudioSynth} from '../../src/systems/AudioSynth.js';
function bare(preview){
 const a=Object.create(AudioSynth.prototype),mute=jest.fn(),clear=jest.fn();
 a.game={registry:{get:k=>k==='offlineMusicDownloads'?(preview?{}:undefined):undefined}};
 a.ctx={currentTime:7,state:'running'};a.nodes={musicSrc:{gain:{setTargetAtTime:mute,cancelScheduledValues:clear}}};
 a._musicTimer=null;a._nextTime=null;a._tickMusic=jest.fn();
 return {a,mute};
}
test('experimental offline music fails closed: never schedules substitute synth, preserves other audio buses',()=>{
 const {a,mute}=bare(true);a._startScheduler();expect(a._musicTimer).toBeNull();expect(mute).toHaveBeenCalledWith(0,7,.03);expect(a._tickMusic).not.toHaveBeenCalled();
 a._musicWanted=true;a._jukeboxMode=false;a.settings={musicEnabledSongs:{x:true}};a._hasEnabledSongs=()=>true;
 a.musicProviderFailed();expect(a._musicTimer).toBeNull();expect(mute.mock.calls.at(-1)).toEqual([0,7,.03]);
});
test('ordinary non-preview game retains its existing procedural fallback',()=>{
 const {a,mute}=bare(false);try{a._startScheduler();expect(a._musicTimer).not.toBeNull();expect(mute).not.toHaveBeenCalled();}finally{if(a._musicTimer)clearInterval(a._musicTimer);}
});
test('adding preview mode stops a prior fallback and mutes its bus without touching live source buses',()=>{
 const {a,mute}=bare(false);a._startScheduler();expect(a._musicTimer).not.toBeNull();a.game.registry.get=()=>({});a._startScheduler();expect(a._musicTimer).toBeNull();expect(mute).toHaveBeenCalledWith(0,7,.03);
});
