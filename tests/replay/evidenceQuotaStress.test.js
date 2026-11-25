import {makeQuotaStressTape,QUOTA_STRESS_ROWS} from '../../tools/replay/quotaStressTape.mjs';

describe('#244 deterministic test-only quota stress rows',()=>{
  test('bounded generated bb-pad rows are canonical and stable without real-run assertions',()=>{
    const fixture={format:'bb-ghost-tape',version:1,seed:'historical-source',endTick:5,inputs:[[1,0,0]],score:99,distanceM:10};
    const a=makeQuotaStressTape(fixture,1000),b=makeQuotaStressTape(fixture,1000);
    expect(a).toEqual(b);
    expect(a.endTick).toBe(1000);
    expect(a.inputs).toHaveLength(1000);
    expect(a.checkpoints).toEqual([]);
    expect(a.inputs.every(([dt,bits,tilt])=>dt===1&&Number.isSafeInteger(bits)&&bits>=0&&bits<=0x3ffff&&Number.isSafeInteger(tilt)&&tilt>=-127&&tilt<=127)).toBe(true);
    expect(fixture.endTick).toBe(5); // never mutate committed recording
    expect(QUOTA_STRESS_ROWS).toBe(120000);
    expect(()=>makeQuotaStressTape(fixture,200001)).toThrow();
  });
});
