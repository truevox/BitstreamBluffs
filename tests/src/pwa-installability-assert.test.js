import {assertInstallability} from '../../tools/pwa/installability-assert.mjs';
const clean={installabilityErrors:[]},manifest={errors:[]};
test('persistent Chromium must return zero manifest and installability errors',()=>{
 expect(assertInstallability(manifest,clean)).toEqual({allowedIncognito:0});
 expect(()=>assertInstallability(manifest,{installabilityErrors:[{errorId:'manifest-missing-suitable-icon',errorArguments:[]}]})).toThrow(/manifest-missing-suitable-icon/);
 expect(()=>assertInstallability({errors:[{critical:'broken manifest'}]},clean)).toThrow(/Manifest errors/);
 expect(()=>assertInstallability(manifest,{unsupported:'Page.getInstallabilityErrors'})).toThrow(/Missing Chromium/);
 expect(()=>assertInstallability(manifest,null)).toThrow(/Missing Chromium/);
});
test('ephemeral context permits ONLY Chromium incognito warning',()=>{
 const incognito={installabilityErrors:[{errorId:'in-incognito',errorArguments:[]}]};
 expect(assertInstallability(manifest,incognito,{allowIncognito:true})).toEqual({allowedIncognito:1});
 expect(()=>assertInstallability(manifest,incognito)).toThrow(/in-incognito/);
 expect(()=>assertInstallability(manifest,{installabilityErrors:[...incognito.installabilityErrors,{errorId:'not-installable'}]},{allowIncognito:true})).toThrow(/not-installable/);
 expect(()=>assertInstallability(manifest,{installabilityErrors:[{}]},{allowIncognito:true})).toThrow(/Chromium installability errors/);
});
