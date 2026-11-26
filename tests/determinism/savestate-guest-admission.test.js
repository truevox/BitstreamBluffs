/** #242 / #69: one-shot untrusted guest state cannot enter trusted snapshots. */
import fs from 'node:fs';
import vm from 'node:vm';

function kit(){
 const sandbox={Phaser:{Physics:{Matter:{Matter:{}}}}};
 vm.runInNewContext(fs.readFileSync('tools/savestate-experiment/game-state-kit.js','utf8'),sandbox);
 return sandbox.__ssGameKit;
}

test('both new RunScene guest fields are explicitly classified, not silently skipped',()=>{
 const k=kit();
 expect(k.CLASS.guestPractice).toBe('CONFIG');
 expect(k.CLASS.guestPracticeTape).toBe('PRESENTATION');
 const report=k.classifyScene({guestPractice:false,guestPracticeTape:null});
 expect(report.unclassified).toEqual([]);
 expect(Array.from(report.CONFIG)).toEqual(['guestPractice']);
 expect(Array.from(report.PRESENTATION)).toEqual(['guestPracticeTape']);
});

test('capture refuses untrusted guest handoff before touching live Matter state',()=>{
 const k=kit();
 expect(()=>k.capture({guestPractice:true,guestPracticeTape:null})).toThrow(/guest practice is not savestate-admitted/);
 expect(()=>k.capture({guestPractice:false,guestPracticeTape:{mode:'normal'}})).toThrow(/guest practice is not savestate-admitted/);
});

test('restore refuses guest destination and forged guest-mode source before any world mutation',()=>{
 const k=kit(),basic={kind:'bb-runscene-diagnostic-snapshot',version:1,audit:[],config:{guestPractice:'false'}};
 expect(()=>k.restore({guestPractice:true,guestPracticeTape:null},basic,'full')).toThrow(/guest practice is not savestate-admitted/);
 expect(()=>k.restore({guestPractice:false,guestPracticeTape:{}},basic,'full')).toThrow(/guest practice is not savestate-admitted/);
 expect(()=>k.restore({guestPractice:false,guestPracticeTape:null},{...basic,config:{guestPractice:'true'}},'full')).toThrow(/guest practice is not savestate-admitted/);
 expect(()=>k.restore({guestPractice:false,guestPracticeTape:null},{...basic,config:{guestPractice:{spoof:true}}},'full')).toThrow(/guest practice is not savestate-admitted/);
});
