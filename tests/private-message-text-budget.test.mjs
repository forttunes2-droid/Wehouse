import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync('src/lib/privateMessageText.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {assertPrivateMessageText}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('private text budget counts UTF-8 bytes before encryption, including emoji',()=>{
 assert.doesNotThrow(()=>assertPrivateMessageText('a'.repeat(32768)));
 assert.doesNotThrow(()=>assertPrivateMessageText('🏡'.repeat(8192)));
 assert.throws(()=>assertPrivateMessageText('a'.repeat(32769)),/Split it/);
 assert.throws(()=>assertPrivateMessageText('🏡'.repeat(8193)),/Split it/);
});
