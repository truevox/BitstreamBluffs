/** Fresh immutable v2 eight-case report mapping, in canonical old-seven + off-control order. */
export function selectEightLiveReports(canonicalCases,csv){
  if(!csv)return canonicalCases;
  if(!Array.isArray(canonicalCases)||canonicalCases.length!==8)
    throw Error('Eight-case canonical index schema missing');
  const names=csv.split(',').map(s=>s.trim());
  if(names.length!==8||new Set(names).size!==8||
    names.some(name=>!/^[-_a-zA-Z0-9.]+\.json$/.test(name)||name==='.'||name==='..'))
    throw Error('Provide exactly eight unique immutable JSON basenames in canonical order');
  return canonicalCases.map((entry,i)=>({...entry,file:names[i]}));
}
