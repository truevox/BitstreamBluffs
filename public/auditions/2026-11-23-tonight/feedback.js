/** Static audition review notes: LOCAL-ONLY, no network requests or telemetry.
 * User must choose Copy to export; no account data leaves the browser. */
(() => {
  'use strict';
  const STORAGE='bsb-audio-review-2026-11-23-v1';
  const labs=[
    ['candy','Candy Cane Canyon'],
    ['vertigo','Vertigo Vents'],
    ['jellyfish','Sky Jellyfish Mountain'],
    ['steampunk','Steampunk Slopes'],
    ['crystal','Crystal Cavern'],
    ['clang','Garbage Musical Clangs'],
    ['micro','Micro Mountain'],
    ['underwater','Underwater Mountain'],
    ['splorp','Garbage SPLORP + Suction'],
    ['reference','Original Soundcheck comparison'],
  ];
  const $=id=>document.getElementById(id);
  const values=['untried','love','tweak','redo'];
  const labels={untried:'Not tried yet',love:'Love it! 💚',tweak:'Close — needs tuning',redo:'Needs a rethink'};
  const state=Object.fromEntries(labs.map(([id])=>[id,{verdict:'untried',note:''}]));
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE)||'{}');
    for(const [id] of labs){
      if(saved[id]&&values.includes(saved[id].verdict))
        state[id].verdict=saved[id].verdict;
      if(saved[id]&&typeof saved[id].note==='string')
        state[id].note=saved[id].note.slice(0,1800);
    }
  }catch{}
  const grid=$('review-grid');
  for(const [id,label] of labs){
    const card=document.createElement('section');card.className='rating';
    const title=document.createElement('h3');title.textContent=label;card.append(title);
    const statusLabel=document.createElement('label');statusLabel.textContent='My verdict';
    statusLabel.setAttribute('for','review-verdict-'+id);card.append(statusLabel);
    const select=document.createElement('select');select.id='review-verdict-'+id;
    for(const choice of values){
      const option=document.createElement('option');option.value=choice;
      option.textContent=labels[choice];select.append(option);
    }
    select.value=state[id].verdict;card.append(select);
    const noteLabel=document.createElement('label');noteLabel.textContent='What I heard / what to change';
    noteLabel.setAttribute('for','review-note-'+id);card.append(noteLabel);
    const note=document.createElement('textarea');note.id='review-note-'+id;
    note.rows=2;note.maxLength=1800;note.placeholder='e.g., More air bloom, less bright impact…';
    note.value=state[id].note;card.append(note);
    grid.append(card);
    select.addEventListener('change',()=>{state[id].verdict=select.value;update();});
    note.addEventListener('input',()=>{state[id].note=note.value;update();});
  }
  function report(){
    const lines=['# Bitstream Bluffs sound-lab feedback',''];
    let tried=0;
    for(const [id,label] of labs){
      const entry=state[id];
      if(entry.verdict==='untried'&&!entry.note.trim())continue;
      tried++;
      lines.push('## '+label);
      lines.push('Verdict: '+labels[entry.verdict]);
      if(entry.note.trim())lines.push('Notes: '+entry.note.trim());
      lines.push('');
    }
    if(!tried)lines.push('No labs reviewed yet.');
    return lines.join('\n');
  }
  function update(){
    try{localStorage.setItem(STORAGE,JSON.stringify(state));}catch{}
    $('review-export').value=report();
    $('review-status').textContent='Saved locally in this browser · '+labs.filter(([id])=>
      state[id].verdict!=='untried'||state[id].note.trim()).length+' of '+labs.length+' notes started';
  }
  $('copy-review').addEventListener('click',async()=>{
    const content=report(),out=$('review-export');
    try{
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(content);
      else{out.focus();out.select();if(!document.execCommand('copy'))throw Error('Copy unsupported');}
      $('review-status').textContent='Copied! Paste into ChatGPT when you are ready.';
    }catch{
      out.focus();out.select();
      $('review-status').textContent='Clipboard unavailable; your report is selected above for manual copying.';
    }
  });
  $('clear-review').addEventListener('click',()=>{
    if(!confirm('Clear all ten locally saved sound-lab notes?'))return;
    for(const [id] of labs){
      state[id]={verdict:'untried',note:''};
      $('review-verdict-'+id).value='untried';
      $('review-note-'+id).value='';
    }
    update();
  });
  update();
})();
