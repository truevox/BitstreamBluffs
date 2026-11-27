import {stockResumeBiomeMask} from '../../src/systems/savestate/manualSuspendController.js';
const source=mask=>({seed:'mask-run',sections:{recorder:{recorder:{header:{seed:'mask-run',biomeMask:mask}}}}});
test.each([0,1,3,0x7fffffff,0xffffffff])('recovers original recorder biome mask %s independent of registry',mask=>{
 expect(stockResumeBiomeMask(source(mask))).toBe(mask);
});
test.each([-1,-0,0x100000000,1.5,NaN,Infinity,null,undefined,'3',{},[]])(
 'refuses invalid/untrusted recorded mask %s',mask=>{
 expect(()=>stockResumeBiomeMask(source(mask))).toThrow('suspend:invalid-recorded-biome-mask');
});
test('rejects a header belonging to another run before staging',()=>{
 const f=source(3);f.sections.recorder.recorder.header.seed='different';
 expect(()=>stockResumeBiomeMask(f)).toThrow('suspend:invalid-recorded-biome-mask');
});
test('rejects missing recorder and candidate sections rather than using profile fallback',()=>{
 expect(()=>stockResumeBiomeMask({seed:'mask-run',sections:{}})).toThrow();
 expect(()=>stockResumeBiomeMask(null)).toThrow();
});
