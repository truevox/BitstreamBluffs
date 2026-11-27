import {requestSuspendBackupDownload} from '../../src/systems/savestate/suspendBackupDownload.js';

test('backup download requires a second gesture, preserves exact bytes and requests only a local file',async()=>{
 const original=new Uint8Array([0,1,254,255,128,4,17]);
 const events=[],blobs=[],links=[];
 const documentRef={body:{appendChild:link=>events.push('append')},
  createElement:tag=>{
   expect(tag).toBe('a');
   const link={style:{},click:()=>events.push('download'),remove:()=>events.push('remove')};
   links.push(link);return link;
  }};
 const urlRef={createObjectURL:blob=>{blobs.push(blob);return 'blob:test-backup';},
  revokeObjectURL:url=>events.push('revoke:'+url)};
 let revoke;
 const FakeBlob=class{constructor(parts,options){this.bytes=Uint8Array.from(parts[0]);this.type=options.type;}};
 const res=requestSuspendBackupDownload(original,{documentRef,urlRef,BlobCtor:FakeBlob,
  delayRevoke:fn=>{revoke=fn;},now:()=>new Date('2026-11-27T12:00:00Z')});
 expect(res).toEqual({ok:true,requested:true});
 expect(links[0].download).toBe('bitstream-bluffs-old-save-2026-11-27T12-00-00-000Z.bbsave');
 expect(links[0].href).toBe('blob:test-backup');
 expect(events).toEqual(['append','download','remove']);
 expect(blobs[0].bytes).toEqual(original);
 original.fill(0);
 expect(blobs[0].bytes).toEqual(new Uint8Array([0,1,254,255,128,4,17]));
 revoke();expect(events.at(-1)).toBe('revoke:blob:test-backup');
});

test('unavailable browser download never reports success',()=>{
 const bytes=new Uint8Array([1]);
 expect(requestSuspendBackupDownload(bytes,{documentRef:null})).toEqual({ok:false,code:'download-unavailable'});
 expect(requestSuspendBackupDownload(new Uint8Array([]))).toEqual({ok:false,code:'download-unavailable'});
 let clicked=false;
 const doc={body:{appendChild:()=>{}},createElement:()=>({
  style:{},remove:()=>{},click:()=>{clicked=true;throw Error('blocked');}})};
 expect(requestSuspendBackupDownload(bytes,{documentRef:doc,
  urlRef:{createObjectURL:()=>'/blob'},delayRevoke:()=>{}})).toEqual({ok:false,code:'download-unavailable'});
 expect(clicked).toBe(true);
});
