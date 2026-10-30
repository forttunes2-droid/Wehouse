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
 const guest=fs.readFileSync('src/components/GuestBrowseEntry.tsx','utf8');
 assert.match(guest,/profile=\{null\}/);
 for (const file of ['src/pages/Search.tsx','src/pages/HotelsHome.tsx','src/pages/ListingDetailCore.tsx','src/pages/HotelDetailExperience.tsx']) {
  const source=fs.readFileSync(file,'utf8');assert.match(source,/publicPropertyImages/);
 }
 const hotel=fs.readFileSync('src/pages/HotelDetailExperience.tsx','utf8');assert.match(hotel,/images: publicPropertyImages\(room.images\)/);
 const listing=fs.readFileSync('src/pages/ListingDetailCore.tsx','utf8');assert.match(listing,/videos=\{publicPropertyImages\(listing.videos\)\}/);
});

test('guest public sign-in screens use the canonical shell copy and one action',()=>{
 const guest=fs.readFileSync('src/components/GuestBrowseEntry.tsx','utf8');
 assert.match(guest,/Sign in to continue/);
 assert.doesNotMatch(guest,/Privacy Policy|Terms of Service/);
 const login=fs.readFileSync('src/pages/Login.tsx','utf8');
 assert.match(login,/onOpenLegal\("terms_of_service"\)/);
 assert.match(login,/onOpenLegal\("privacy_policy"\)/);
 assert.doesNotMatch(guest,/GuestProductPreview|guestProductCopy|content\.steps\.map/);
 assert.doesNotMatch(guest,/The summary returned no data\.|Your matching preferences stay private\./);
});

test('signed-out roommate and home-service prompts stay concise',()=>{
 const guest=fs.readFileSync('src/components/GuestBrowseEntry.tsx','utf8');
 assert.match(guest,/Sign in to find a roommate/);
 assert.match(guest,/Sign in to find a professional/);
 assert.doesNotMatch(guest,/Payment stays paused|plan a Long Let together/);
 assert.doesNotMatch(guest,/content\.points\.map/);
});
