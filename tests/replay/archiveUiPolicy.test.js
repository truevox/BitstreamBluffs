import { digestFromLocalReplayFilename, currentRunEvidence } from '../../src/systems/replay/archiveUiPolicy.js';
const d='sha256:'+'a'.repeat(64);

describe('Game Over archive local-only UI policy (#244)',()=>{
  test('strict filename requires exact hex digest and .bbreplay extension',()=>{
    expect(digestFromLocalReplayFilename(`${'A'.repeat(64)}.BBREPLAY`)).toBe(d);
    for(const invalid of ['run.bbreplay',`../${'a'.repeat(64)}.bbreplay`,
      ` ${'a'.repeat(64)}.bbreplay`,`${'a'.repeat(64)}.bbreplay.exe`,
      `${'g'.repeat(64)}.bbreplay`,null,{},''])
      expect(digestFromLocalReplayFilename(invalid)).toBeNull();
  });
  test('only successful capture status tagged to the exact finished run is actionable',()=>{
    const status={runId:'actual-run',ok:true,digest:d,durable:false};
    expect(currentRunEvidence(status,'actual-run')).toEqual({runId:'actual-run',digest:d,durable:false});
    expect(Object.isFrozen(currentRunEvidence(status,'actual-run'))).toBe(true);
    for(const invalid of [null,{}, {...status,runId:'previous-run'},
      {...status,ok:false},{...status,digest:'sha256:???'}])
      expect(currentRunEvidence(invalid,'actual-run')).toBeNull();
  });
  test('a validated digest from failed durable storage is exportable only when explicitly permitted',()=>{
    const failed={runId:'actual-run',ok:false,code:'quota-exceeded',digest:d,durable:false};
    expect(currentRunEvidence(failed,'actual-run')).toBeNull();
    expect(currentRunEvidence(failed,'actual-run',{allowFailed:true})).toEqual({runId:'actual-run',digest:d,durable:false});
    expect(currentRunEvidence({...failed,runId:'prior'},'actual-run',{allowFailed:true})).toBeNull();
  });
});
