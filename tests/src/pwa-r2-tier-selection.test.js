import {selectR2Tier as choose} from '../../tools/pwa/r2-tier-selection.mjs';
const both=[{lite:true,full:true},{lite:true,full:true}];
test('fresh High starts Lite, complete Full cannot promote during playing transport',()=>{
 expect(choose({mode:'high',required:both}).quality).toBe('lite');
 expect(choose({mode:'high',current:'lite',required:both})).toEqual({quality:'lite',reason:'await-stopped-boundary'});
 expect(choose({mode:'high',current:'lite',stopped:true,required:both}).quality).toBe('full');
});
test('never mix tiers or claim complete on missing group; stop is required before repair/switch',()=>{
 const partial=[both[0],{lite:true,full:false}];
 expect(choose({mode:'high',current:'lite',stopped:true,required:partial}).quality).toBe('lite');
 expect(choose({mode:'high',current:'full',required:partial})).toEqual({quality:null,reason:'active-tier-incomplete-stop-required'});
 expect(choose({mode:'space-saver',current:'full',required:both}).quality).toBe('full');
 expect(choose({mode:'space-saver',current:'full',stopped:true,required:both}).quality).toBe('lite');
 expect(choose({mode:'high',required:[]}).quality).toBeNull();
});
test('No Music immediately silences irrespective of playback boundary or retained assets',()=>{
 expect(choose({mode:'no-music',current:'full',required:both})).toEqual({quality:null,reason:'disabled'});
 expect(()=>choose({mode:'high',required:[{lite:1,full:true}]})).toThrow();
});
