/** Private lab publisher, source audio and outputs excluded from Git. */
import {existsSync,mkdirSync,cpSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'../../..');
const source=join(root,'public/music-audition-kie');
const dest=join(root,'dist-music-audition');
if(!existsSync(dest))throw new Error('Existing audition build is required');
for(const file of ['task-a-option-1-full.mp3','task-a-option-2-full.mp3','option-1-full.mp3','option-2-full.mp3','maxi-original-vocal-full.mp3','v3-organ-reference-150-175.mp3']){
  if(!existsSync(join(source,file)))throw new Error('Missing private audio '+file);
}
mkdirSync(join(dest,'tools/music/audition-kie'),{recursive:true});
cpSync(join(root,'tools/music/audition-kie/index.html'),join(dest,'tools/music/audition-kie/index.html'));
cpSync(source,join(dest,'music-audition-kie'),{recursive:true});
console.log('Kie one-spin lab published, audio files',readdirSync(source).length);
