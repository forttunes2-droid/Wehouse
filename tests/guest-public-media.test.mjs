import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/publicPropertyMedia.ts','utf8'), { compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 } }).outputText, { exports, URL, Set });
const { publicPropertyImages }=exports;
const plain=value=>JSON.parse(JSON.stringify(value));
test('signed-out media accepts published URLs, deduplicated',()=>{
 const url='https://test.supabase.co/storage/v1/object/public/listing-images/hotel.jpg';
 assert.deepEqual(plain(publicPropertyImages([url,url,'https://images.example.test/home.png'])),[url,'https://images.example.test/home.png']);
});
test('signed-out media never passes private upload paths or signed storage URLs to gallery',()=>{
 const invalid=['partner/upload.jpg','field/upload.jpg','data:image/png;base64,AA','blob:https://test/one','javascript:alert(1)','https://user:secret@example.test/image.jpg','https://test.supabase.co/storage/v1/object/sign/listing-candidates/a.jpg?token=fake','https://test.supabase.co/storage/v1/object/authenticated/listing-images/a.jpg','https://test.supabase.co/storage/v1/render/image/sign/listing-images/a.jpg','https://test.supabase.co/storage/v1/object/public/listing-candidates/a.jpg',null,7,{}];
 assert.deepEqual(plain(publicPropertyImages(invalid)),[]);
 assert.deepEqual(plain(publicPropertyImages(null)),[]);
});
test('all signed-out property and room projections filter media before shared gallery',()=>{
 const source=fs.readFileSync('src/components/GuestBrowseEntry.tsx','utf8');
 assert.equal((source.match(/images: publicPropertyImages\(item.images\)/g)||[]).length,2);
 assert.match(source,/images: publicPropertyImages\(room.images\)/);
});
