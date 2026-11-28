import {droneCameraIntent,effectivePulpLevel,sanitizePulpLevel,PULP_SAFE} from '../../src/systems/PulpCameraIntent.js';
import {GAME_WIDTH,GAME_HEIGHT} from '../../src/constants.js';

describe('#155 pure presentation-only Pulp camera intent',()=>{
  test('levels sanitize and Reduce Motion always forces 99% Less Pulp',()=>{
    expect(['less','original','drone'].map(sanitizePulpLevel)).toEqual(['less','original','drone']);
    expect(sanitizePulpLevel('malicious')).toBe('original');
    for(const level of ['less','original','drone'])
      expect(effectivePulpLevel(level,true)).toBe('less');
    expect(effectivePulpLevel('drone',false)).toBe('drone');
  });

  test('every canary tick preserves safe rider and downhill look-ahead, even with camera roll',()=>{
    for(const seed of ['canary-alpha','canary-beta','empty','snowpack','1234567890']){
      for(let tick=0;tick<15000;tick+=37){
        const speed=(tick*17)%1600;
        const grounded=tick%5===0;
        const state={seed,tick,x:10000+tick*2,y:750+Math.sin(tick*.015)*200,
          vx:speed,vy:Math.sin(tick*.03)*600,speed,grounded,
          bsodProximity:tick%13/12,hazardAheadPx:tick%7===0?20:Infinity};
        const intent=droneCameraIntent(state);
        expect(intent.zoom).toBeGreaterThanOrEqual(.45);
        expect(intent.zoom).toBeLessThanOrEqual(1.04);
        expect(Math.abs(intent.roll)).toBeLessThanOrEqual(PULP_SAFE.maxRollRad);
        const a=intent.roll,c=Math.cos(a),s=Math.sin(a);
        const rx=intent.riderScreenX-GAME_WIDTH/2;
        const ry=intent.riderScreenY-GAME_HEIGHT/2;
        const actualX=GAME_WIDTH/2+rx*c-ry*s;
        const actualY=GAME_HEIGHT/2+rx*s+ry*c;
        expect(actualX).toBeGreaterThanOrEqual(PULP_SAFE.minScreenX);
        expect(actualX).toBeLessThanOrEqual(PULP_SAFE.maxScreenX);
        expect(actualY).toBeGreaterThanOrEqual(PULP_SAFE.minScreenY);
        expect(actualY).toBeLessThanOrEqual(PULP_SAFE.maxScreenY);
        expect(intent.lookAhead).toBeGreaterThanOrEqual(PULP_SAFE.minDownhillLookAheadPx);
        expect(intent.focusX-GAME_WIDTH/2).toBeCloseTo(
          state.x-GAME_WIDTH/2-(intent.riderScreenX-GAME_WIDTH/2)/intent.zoom,8);
        expect(intent.focusY-GAME_HEIGHT/2).toBeCloseTo(
          state.y-GAME_HEIGHT/2-(intent.riderScreenY-GAME_HEIGHT/2)/intent.zoom,8);
      }
    }
  });

  test('same seed/tick/authoritative pose repeats exactly regardless of renderer frame timing',()=>{
    const sample={seed:'nightmare',tick:936,tickMs:1000/120,x:44722,y:3145,vx:715,vy:-250,
      speed:755,grounded:false,bsodProximity:.34,hazardAheadPx:180};
    const input=JSON.stringify(sample);
    const first=droneCameraIntent(sample);
    for(let i=0;i<100;i++)expect(droneCameraIntent({...sample})).toEqual(first);
    expect(JSON.stringify(sample)).toBe(input); // read-only sim data
    expect(Object.isFrozen(first)).toBe(true);
    expect(droneCameraIntent({...sample,seed:'different'})).not.toEqual(first);
  });

  test('danger increases downhill visibility and damps roll',()=>{
    const base={seed:'z',tick:888,x:24000,y:2500,speed:1000,grounded:false};
    const calm=droneCameraIntent({...base,bsodProximity:0});
    const danger=droneCameraIntent({...base,bsodProximity:1});
    expect(danger.riderScreenX).toBeLessThanOrEqual(calm.riderScreenX);
    expect(Math.abs(danger.roll)).toBeLessThanOrEqual(Math.abs(calm.roll)+1e-12);
  });
});
