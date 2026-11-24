import {createRequire} from 'node:module';
import {deflateRawSync} from 'node:zlib';
const require=createRequire(import.meta.url);
const {readPointerArchive}=require('../../.github/scripts/friday-event-zip.cjs');
const NAME='friday-event-pointer.json';
const crc32=(bytes)=>{let x=0xffffffff;for(const v of bytes){x^=v;for(let i=0;i<8;i++)x=(x>>>1)^((x&1)?0xedb88320:0);}return (x^0xffffffff)>>>0;};
function oneEntry(payload,{name=NAME,method=8,reportedSize=null,flags=0,corruptCrc=false,descriptorSignature=true}={}){
  const body=Buffer.from(typeof payload==='string'?payload:JSON.stringify(payload));
  const compressed=method===8?deflateRawSync(body):body;
  const filename=Buffer.from(name);
  const crc=(crc32(body)^(corruptCrc?1:0))>>>0;
  const local=Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(flags,6);
  local.writeUInt16LE(method,8);local.writeUInt32LE(crc,14);
  local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(filename.length,26);
  const central=Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
  central.writeUInt16LE(flags,8);central.writeUInt16LE(method,10);central.writeUInt32LE(crc,16);
  central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(reportedSize ?? body.length,24);
  central.writeUInt16LE(filename.length,28);
  let descriptor=Buffer.alloc(0);
  if(flags&8){
    local.writeUInt32LE(0,14);local.writeUInt32LE(0,18);local.writeUInt32LE(0,22);
    descriptor=Buffer.alloc(descriptorSignature?16:12);
    const n=descriptorSignature?4:0;
    if(descriptorSignature)descriptor.writeUInt32LE(0x08074b50,0);
    descriptor.writeUInt32LE(crc,n);descriptor.writeUInt32LE(compressed.length,n+4);
    descriptor.writeUInt32LE(body.length,n+8);
  }
  const centerOffset=local.length+filename.length+compressed.length+descriptor.length;
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);
  end.writeUInt32LE(central.length+filename.length,12);end.writeUInt32LE(centerOffset,16);
  return Buffer.concat([local,filename,compressed,descriptor,central,filename,end]);
}
const pointer={pr_number:174,event_name:'issue_comment',comment_id:456};

test('bounded one-entry ZIP accepts only authenticated-identity-shaped pointers',()=>{
 expect(readPointerArchive(oneEntry(pointer))).toEqual(pointer);
 expect(readPointerArchive(oneEntry(pointer,{method:0}))).toEqual(pointer);
 expect(readPointerArchive(oneEntry(pointer,{flags:8}))).toEqual(pointer);
 expect(readPointerArchive(oneEntry(pointer,{flags:8,descriptorSignature:false}))).toEqual(pointer);
});
test('never extracts ZIP, denies compressed bombs and lying uncompressed lengths',()=>{
 expect(()=>readPointerArchive(oneEntry('A'.repeat(20000)))).toThrow(/size cap/);
 expect(()=>readPointerArchive(oneEntry('A'.repeat(20000),{reportedSize:50}))).toThrow(/oversized|mismatch/);
});
test('denies path traversal, extra members, ZIP encryption, CRC mismatch, truncation',()=>{
 expect(()=>readPointerArchive(oneEntry(pointer,{name:'../../evil.json'}))).toThrow(/name/);
 const extra=oneEntry(pointer);extra.writeUInt16LE(2,extra.length-14);
 expect(()=>readPointerArchive(extra)).toThrow(/entry count/);
 expect(()=>readPointerArchive(oneEntry(pointer,{flags:1}))).toThrow(/unsupported/);
 const descriptorAttack=oneEntry(pointer,{flags:8});descriptorAttack[descriptorAttack.length-70]^=0xff;
 expect(()=>readPointerArchive(descriptorAttack)).toThrow();
 expect(()=>readPointerArchive(oneEntry(pointer,{corruptCrc:true}))).toThrow(/CRC/);
 expect(()=>readPointerArchive(oneEntry(pointer).subarray(0,50))).toThrow();
});
test('rejects dangerous or ambiguous JSON before privileged resolver',()=>{
 for(const p of [
  {...pointer,comment_id:0},{...pointer,extra:true},
  {pr_number:174,event_name:'pull_request',comment_id:3},
  {pr_number:174,event_name:'pull_request_review'},
  {pr_number:174,event_name:'issue_comment',comment_id:3,review_id:4},
 ]) expect(()=>readPointerArchive(oneEntry(p))).toThrow();
});
