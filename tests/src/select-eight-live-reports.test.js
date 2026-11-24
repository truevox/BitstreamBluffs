import {selectEightLiveReports} from '../../tools/music/select-eight-live-reports.js';
const old=Array.from({length:8},(_,i)=>({index:i,file:'historic'+i+'.json',vocals:i!==7}));
test('fresh named quantum-v2 captures replace all eight historical names without changing case order',()=>{
  const selected=selectEightLiveReports(old,Array.from({length:8},(_,i)=>'v2-'+i+'.json').join(','));
  expect(selected.map(x=>x.file)).toEqual(Array.from({length:8},(_,i)=>'v2-'+i+'.json'));
  expect(selected.map(x=>x.index)).toEqual(old.map(x=>x.index));
  expect(old[0].file).toBe('historic0.json');
});
test('default preserves immutable historical names but does not certify them as v2',()=>{
  expect(selectEightLiveReports(old,'')).toBe(old);
});
test.each(['one.json','../bad.json,a.json,b.json,c.json,d.json,e.json,f.json,g.json',
  Array(8).fill('duplicate.json').join(',')])('bad or ambiguous 8-case manifest fails closed',csv=>{
  expect(()=>selectEightLiveReports(old,csv)).toThrow();
});
