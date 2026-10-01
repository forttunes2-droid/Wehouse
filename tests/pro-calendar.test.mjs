import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/proCalendar.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,TextEncoder});
test('calendar exports exclusive stay dates and escapes event injection',()=>{
 const text=exports.calendarText([{id:'home-1',title:'Place, A; B\nEND:VEVENT',start:'2026-10-03',end:'2026-10-05'}],new Date('2026-10-01T00:00:00Z'));
 assert.ok(text.includes('DTSTART;VALUE=DATE:20261003\r\nDTEND;VALUE=DATE:20261005'));
 assert.ok(text.includes('SUMMARY:Place\\, A\\; B\\nEND:VEVENT'));
 assert.equal(text.split('\r\n').filter(x=>x==='END:VEVENT').length,1);
});
test('calendar folds Unicode safely and omits invalid dates',()=>{
 const text=exports.calendarText([{id:'1',title:'屋'.repeat(90),start:'2026-10-03'},{id:'2',title:'invalid',start:'bad'}]);
 for(const line of text.split('\r\n')) assert.ok(new TextEncoder().encode(line).length<=75);
 assert.equal(text.split('\r\n').filter(x=>x==='BEGIN:VEVENT').length,1);
 assert.equal(text.replace(/\r\n /g,'').includes('SUMMARY:'+'屋'.repeat(90)),true);
});
