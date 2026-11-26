/** Deterministic structural stress fixture for actual Chromium IDB quota gates.
 * NEVER claim this input sequence was played or recorded; synthetic only.
 * The physical tape header/initial setup is borrowed from a committed fixture.
 */
export const QUOTA_STRESS_ROWS=120000;
export function makeQuotaStressTape(source, count=QUOTA_STRESS_ROWS){
  if(!Number.isSafeInteger(count)||count<1||count>200000)throw Error('invalid bounded stress count');
  return {...source,
    inputs:Array.from({length:count},(_,i)=>{
      const bits=((Math.imul(i+1,2654435761)>>>0)^(i>>>3))&0x3ffff;
      return [1,bits,((i*17)%255)-127];
    }),
    endTick:count,checkpoints:[],score:0,distanceM:0,
    cause:'crash', // required contract enum, NOT a claim of actual recorded gameplay
  };
}
