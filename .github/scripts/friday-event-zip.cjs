'use strict';
/**
 * Untrusted GitHub artifact reader. Never extract to filesystem: parse ONE ZIP
 * entry with verified compressed/uncompressed caps, filename, metadata and
 * CRC32, then return bounded validated JSON. Runs only from trusted main.
 */
const {inflateRawSync} = require('node:zlib');
const {TextDecoder} = require('node:util');
const NAME = 'friday-event-pointer.json';
const MAX_ZIP = 4096;
const MAX_JSON = 1024;
const read32 = (b,p) => b.readUInt32LE(p);
const read16 = (b,p) => b.readUInt16LE(p);
const insist = (ok, message) => { if (!ok) throw new Error(`Untrusted review pointer archive: ${message}`); };

function crc32(bytes) {
  let crc=0xffffffff;
  for(const b of bytes){crc ^= b;for(let bit=0;bit<8;bit++)crc = (crc>>>1) ^ (crc & 1 ? 0xedb88320 : 0);}
  return (crc^0xffffffff)>>>0;
}
function readPointerArchive(archive) {
  insist(Buffer.isBuffer(archive) && archive.length>=52 && archive.length<=MAX_ZIP, 'compressed archive size');
  const b=archive;
  let end=-1;
  for(let i=b.length-22;i>=0;i--){
    if(read32(b,i)===0x06054b50 && i+22<=b.length && i+22+read16(b,i+20)===b.length){end=i;break;}
  }
  insist(end>=0,'missing valid ZIP end record');
  insist(read16(b,end+4)===0 && read16(b,end+6)===0,'spanned archive');
  insist(read16(b,end+8)===1 && read16(b,end+10)===1,'entry count must be exactly one');
  const size=read32(b,end+12), off=read32(b,end+16);
  insist(size>46 && off>=30 && off+size===end && off+46<=b.length,'central directory boundary');
  insist(read32(b,off)===0x02014b50,'central directory signature');
  const flags=read16(b,off+8),method=read16(b,off+10),crc=read32(b,off+16);
  const compressed=read32(b,off+20),uncompressed=read32(b,off+24);
  const nameLen=read16(b,off+28),extraLen=read16(b,off+30),commentLen=read16(b,off+32);
  const local=read32(b,off+42);
  insist((flags & ~(0x800|0x8))===0 && (method===0 || method===8),'unsupported/encrypted ZIP member');
  insist(compressed<=MAX_ZIP && uncompressed<=MAX_JSON,'member size cap');
  insist(read16(b,off+34)===0 && local===0,'ZIP disk or prefixed entry');
  insist(off+46+nameLen+extraLen+commentLen===end,'central member layout');
  insist(b.toString('utf8',off+46,off+46+nameLen)===NAME && nameLen===Buffer.byteLength(NAME),'unexpected ZIP member name');
  insist(read32(b,local)===0x04034b50,'local member signature');
  insist(read16(b,local+6)===flags && read16(b,local+8)===method,'local entry header mismatch');
  const ln=read16(b,local+26),le=read16(b,local+28);
  insist(ln===nameLen && b.toString('utf8',local+30,local+30+ln)===NAME,'local entry name mismatch');
  const start=local+30+ln+le;
  insist(start<=off && start+compressed<=off,'local compressed-data boundary');
  if(flags&0x8){
    // upload-artifact may stream its ZIP with a post-data CRC/size descriptor.
    // Accept ONLY the bounded classic 12/16-byte form matching central data.
    const ds=start+compressed, remaining=off-ds;
    insist(remaining===12||remaining===16,'descriptor boundary');
    const offset=remaining===16?4:0;
    if(remaining===16)insist(read32(b,ds)===0x08074b50,'descriptor signature');
    insist(read32(b,ds+offset)===crc && read32(b,ds+offset+4)===compressed &&
      read32(b,ds+offset+8)===uncompressed,'descriptor CRC/sizes mismatch');
  }else{
    insist(start+compressed===off,'local compressed-data boundary');
    insist(read32(b,local+14)===crc && read32(b,local+18)===compressed &&
      read32(b,local+22)===uncompressed,'local header CRC/sizes mismatch');
  }
  const data=b.subarray(start,start+compressed);
  let output;
  if(method===0)output=data;
  else {
    try{output=inflateRawSync(data,{maxOutputLength:MAX_JSON+1});}
    catch {throw new Error('Untrusted review pointer archive: invalid or oversized deflate data');}
  }
  insist(output.length===uncompressed && output.length<=MAX_JSON,'uncompressed byte length');
  insist(crc32(output)===crc,'CRC mismatch');
  let pointer;
  try{pointer=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(output));}
  catch {throw new Error('Untrusted review pointer archive: invalid UTF-8 JSON');}
  insist(pointer && typeof pointer==='object' && !Array.isArray(pointer),'pointer must be an object');
  const names=Object.keys(pointer).sort();
  const permitted=['pr_number','event_name','comment_id','review_id'];
  insist(names.every(k=>permitted.includes(k)),'unexpected pointer field');
  insist(Number.isSafeInteger(pointer.pr_number) && pointer.pr_number>0 && pointer.pr_number<=999999999,'bad PR number');
  insist(['pull_request','issue_comment','pull_request_review'].includes(pointer.event_name),'bad event name');
  if(pointer.event_name==='issue_comment') insist(Number.isSafeInteger(pointer.comment_id)&&pointer.comment_id>0&&pointer.review_id===undefined,'bad comment identity');
  else if(pointer.event_name==='pull_request_review') insist(Number.isSafeInteger(pointer.review_id)&&pointer.review_id>0&&pointer.comment_id===undefined,'bad review identity');
  else insist(pointer.comment_id===undefined && pointer.review_id===undefined,'unnecessary source identity');
  return pointer;
}
module.exports={readPointerArchive};
