import {jest} from '@jest/globals';
import {
  LAB_STEMS,LAB_MIX_PRESETS,freshLabLevels,labGainFor,
  applyLabStemLevels,gainLabel,
} from '../../src/systems/music/LabStemMix.js';

function sandbox(){
  const sources=new Map(['voice:debutmont','voice:crystal-cavern','voice:bitstream-bluffs']
    .map(name=>[name,{}]));
  const d={pack:{id:'song',sourceNames:[...sources.keys()]},
    gains:sources,mixer:{setGain:jest.fn()},
    setStemGain:jest.fn(),_activeVoiceFor:()=> 'voice:debutmont'};
  return d;
}

describe('Music Lab per-stem independent sandbox mixer',()=>{
  test('all six roles start at normal gain in a fresh independent state',()=>{
    expect(LAB_STEMS).toEqual(['drums','bass','guitar','piano','other','melody']);
    const a=freshLabLevels(),b=freshLabLevels();
    expect(Object.values(a)).toEqual([1,1,1,1,1,1]);
    a.bass=0;
    expect(b.bass).toBe(1);
    expect(LAB_MIX_PRESETS.map(p=>p.gain)).toEqual([0,.35,1,1.35]);
  });
  test('each role can independently mute, duck or boost; solo hides others without erasing mix',()=>{
    const level=freshLabLevels();level.bass=0;level.drums=.35;level.guitar=1.35;
    expect(labGainFor('bass',level)).toBe(0);
    expect(labGainFor('drums',level)).toBe(.35);
    expect(labGainFor('guitar',level)).toBe(1.35);
    expect(labGainFor('guitar',level,'DRUMS')).toBe(0);
    expect(labGainFor('drums',level,'DRUMS')).toBe(.35);
    expect(level.guitar).toBe(1.35);
    expect(labGainFor('bass',level,'ALL')).toBe(0);
  });
  test('normal and boost stay bounded even if a test injects a bad value',()=>{
    const levels=freshLabLevels();levels.guitar=200;levels.drums=-25;
    expect(labGainFor('guitar',levels)).toBe(1.35);
    expect(labGainFor('drums',levels)).toBe(0);
    expect(labGainFor('unknown',levels)).toBe(0);
    expect(gainLabel(1.35)).toBe('BOOST (1.35x)');
  });
  test('only isolated director receives changes; source and adaptive user levels retained',()=>{
    const d=sandbox(),l=freshLabLevels();
    l.bass=.35;l.piano=1.35;l.melody=0;
    expect(applyLabStemLevels(d,l)).toBe(true);
    expect(d.setStemGain).toHaveBeenCalledWith('bass',.35);
    expect(d.setStemGain).toHaveBeenCalledWith('piano',1.35);
    expect(d.mixer.setGain).toHaveBeenCalledWith('voice:debutmont',0,{time:.07});
    expect(d.mixer.setGain).toHaveBeenCalledWith('voice:crystal-cavern',0,{time:.07});
    expect(d.mixer.setGain).toHaveBeenCalledWith('voice:bitstream-bluffs',0,{time:.07});
    expect(d.setStemGain).toHaveBeenCalledTimes(5);
  });
  test('solo melody leaves all original instrument beds muted; un-solo retains custom mix',()=>{
    const d=sandbox(),l=freshLabLevels();l.bass=1.35;
    applyLabStemLevels(d,l,'MELODY');
    expect(d.setStemGain).toHaveBeenCalledWith('bass',0);
    expect(d.mixer.setGain).toHaveBeenCalledWith('voice:debutmont',1,{time:.07});
    d.setStemGain.mockClear();
    applyLabStemLevels(d,l,'ALL');
    expect(d.setStemGain).toHaveBeenCalledWith('bass',1.35);
  });
  test('no pack or mixer is fail-closed and cannot modify live song',()=>{
    const d=sandbox();d.pack=null;
    expect(applyLabStemLevels(d,freshLabLevels())).toBe(false);
    expect(d.setStemGain).not.toHaveBeenCalled();
    expect(applyLabStemLevels(null,freshLabLevels())).toBe(false);
  });
});
