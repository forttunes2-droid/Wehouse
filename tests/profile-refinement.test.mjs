import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';
const read=path=>fs.readFileSync(path,'utf8');
function load(path){const exports={};vm.runInNewContext(ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Intl,Date});return exports;}
const help=load('src/lib/helpTargets.ts');
const record=(extra={})=>({subject_type:'hotel_booking',context_type:'hotel_booking',subject_id:'same-id',label:'Garden Lodge',status:'confirmed',...extra});
test('Help separates current records from history without deleting paid/refunded history',()=>{
 const records=[record(),record({subject_id:'cancelled',status:'cancelled'}),record({subject_id:'expired',status:'expired'}),record({subject_id:'refund',status:'refunded'})];
 assert.equal(help.filterHelpRecords(records,'',false).length,1);
 assert.equal(help.filterHelpRecords(records,'',true).length,4);
 assert.equal(help.paymentHelpTargets({payment_targets:records}).length,4);
 assert.equal(help.paymentHelpTargets({hotel_bookings:records}).length,0);
 assert.equal(records.length,4);
});
test('Help type identity prevents hotel and stay collision, deduplicates delivery and searches readable fields',()=>{
 const records=[record(),record(),record({subject_type:'hotel',context_type:'hotel_property'})];
 assert.equal(help.filterHelpRecords(records,'',true).length,2);
 assert.equal(help.filterHelpRecords(records,'HOTEL STAY',true).length,1);
 assert.equal(help.helpRecordType(record()),'Hotel stay');
 assert.equal(help.helpRecordType(record({context_type:'hotel_property'})),'Hotel');
 assert.equal(help.helpRecordStatus(record({status:'payment_pending'})),'Payment not completed');
});
test('Roommate editor has one state and save, in-place edits, neutral optional fields and one match summary',()=>{
 const editor=read('src/components/RoommatePreferencesPanel.tsx');
 assert.match(editor,/aria-label="Roommate preferences"/);
 assert.match(editor,/aria-expanded=\{open\}/);
 assert.doesNotMatch(editor,/type Step|setStep|1 of 3|"Continue"/);
 assert.equal((editor.match(/"Save preferences"/g)||[]).length,1);
 assert.match(editor,/setForm\(openedWith.current\);onCancel\(\)/);
 assert.match(editor,/roommateHousingError/);assert.match(editor,/roommatePreferenceError/);
 assert.match(editor,/<option value="">Not set<\/option>/);
 assert.doesNotMatch(editor,/"Skip"/);
 const profile=read('src/components/RoommatePublicProfile.tsx');
 assert.doesNotMatch(profile,/role="progressbar"|width:.*score|style=.*score/);
 assert.match(profile,/How matching works/);
 assert.match(profile,/comparedAnswers > 0/);
});
test('Worker profile and owner share a scoped post loader and grid without private-profile fetches',()=>{
 const profile=read('src/components/WorkerPublicProfile.tsx'),owner=read('src/components/WorkerShowcaseManager.tsx'),loader=read('src/hooks/useWorkerShowcase.ts');
 assert.match(profile,/useWorkerShowcase\(worker.user_id, false, !privateConversationMode\)/);
 assert.match(profile,/if \(privateConversationMode\) return;/);
 for(const text of [profile,owner])assert.match(text,/<WorkerShowcaseGrid/);
 assert.match(loader,/\.is\("deleted_at", null\)/);assert.match(loader,/if \(!owner\).*\.is\("hidden_at", null\)/);
 assert.match(loader,/range\(start, start \+ PAGE\)/);
 assert.match(loader,/latestIdentity.current !== identity/);
 assert.match(profile,/key=\{`\$\{props.worker.user_id\}:\$\{context\}`\}/);
 assert.match(owner,/key=\{props.profile.user_id\}/);
});
test('Worker viewer keeps media and controls separate and supports navigation without adding a feed',()=>{
 const viewer=read('src/components/WorkerShowcasePostViewer.tsx');
 assert.match(viewer,/nextLabel="Next work post"/);assert.match(viewer,/previousLabel="Previous work post"/);
 assert.match(viewer,/inert=\{commentsOpen\}/);assert.match(viewer,/touch-pan-x/);
 assert.match(viewer,/useMediaSwipe/);assert.match(viewer,/axis: "vertical"/);
 assert.match(viewer,/bg-\[#090B10\]/);assert.match(viewer,/current.current === id/);
 assert.match(read('src/components/ShowcaseMediaThumbnail.tsx'),/preload="metadata"/);
});
test('Coordinated release accepts verified boundary but rejects gaps and unapproved states',()=>{
 const result=spawnSync('python3',['tests/release-boundaries.py'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
