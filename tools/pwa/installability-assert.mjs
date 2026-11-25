/** Pure validation of Chromium's actual installability diagnostics. */
export function assertInstallability(manifest,report,{allowIncognito=false}={}){
 if(!manifest||!Array.isArray(manifest.errors))throw Error('Missing manifest diagnostics');
 if(manifest.errors.length)throw Error('Manifest errors: '+JSON.stringify(manifest.errors));
 if(!report||!Array.isArray(report.installabilityErrors))throw Error('Missing Chromium installability diagnostics');
 const rejected=report.installabilityErrors.filter(e=>!e||typeof e.errorId!=='string'||!(allowIncognito&&e.errorId==='in-incognito'));
 if(rejected.length)throw Error('Chromium installability errors: '+JSON.stringify(rejected));
 return {allowedIncognito:report.installabilityErrors.length-rejected.length};
}
