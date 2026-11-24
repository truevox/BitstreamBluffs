import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test.each(['0.0.0.0','::','192.168.1.1','100.100.100.1'])('private QA overlay rejects network-facing bind %s',host=>{
  const root=mkdtempSync(join(tmpdir(),'bsb291-private-test-'));
  try{
    mkdirSync(join(root,'packs'));
    writeFileSync(join(root,'catalog.json'),'{}');
    const child=spawnSync(process.execPath,[new URL('../../tools/music/serve-private-mixed-qa.mjs',import.meta.url).pathname],{
      env:{...process.env,BSB291_PRIVATE_AUDIO_ROOT:root,BSB291_HOST:host},encoding:'utf8',timeout:4000
    });
    expect(child.status).not.toBe(0);
    expect(child.stderr).toContain('Private QA media overlay must bind loopback only');
  }finally{rmSync(root,{recursive:true,force:true})}
});
