/** Music Lab's IN-MEMORY ONLY source-stem audition levels.
 * Never persisted and never applied to the shared main-game director.
 * "melody" refers to the selected biome voice (not original vocals).
 */
export const LAB_STEMS=Object.freeze(['drums','bass','guitar','piano','other','melody']);
export const LAB_MIX_PRESETS=Object.freeze([
  Object.freeze({id:'mute',label:'MUTE',gain:0}),
  Object.freeze({id:'duck',label:'DUCK',gain:.35}),
  Object.freeze({id:'normal',label:'NORMAL',gain:1}),
  Object.freeze({id:'boost',label:'BOOST',gain:1.35}),
]);
export const LAB_MAX_GAIN=1.35;

export function freshLabLevels(){
  return Object.fromEntries(LAB_STEMS.map(role=>[role,1]));
}

export function labGainFor(role,levels,solo='ALL'){
  if(!LAB_STEMS.includes(role))return 0;
  if(solo!=='ALL'&&solo!==role.toUpperCase())return 0;
  const value=levels?.[role];
  return Number.isFinite(value)?Math.max(0,Math.min(LAB_MAX_GAIN,value)):1;
}

/** Mutates ONLY the caller's isolated director; never shared AudioSynth. */
export function applyLabStemLevels(lab,levels,solo='ALL'){
  if(!lab?.mixer||!lab.pack)return false;
  for(const role of LAB_STEMS){
    const level=labGainFor(role,levels,solo);
    if(role==='melody'){
      const active=lab._activeVoiceFor(lab.pack);
      for(const key of lab.gains.keys()){
        if(key.startsWith('voice:'))
          lab.mixer.setGain(key,key===active?level:0,{time:.07});
      }
    }else{
      // This uses user input gain; source's separate motion gain stays intact.
      // StemMusicDirector keeps replacement source user gain in sync.
      lab.setStemGain(role,level);
    }
  }
  return true;
}

export function gainLabel(value){
  const preset=LAB_MIX_PRESETS.find(p=>p.gain===value);
  return preset?`${preset.label} (${value.toFixed(2)}x)`:`${value.toFixed(2)}x`;
}
