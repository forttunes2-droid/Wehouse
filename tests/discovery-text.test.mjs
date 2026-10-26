import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['src/lib/discoveryText.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {matchesDiscoveryText,homeDiscoveryFields}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
test('search words match across fields without requiring an exact phrase or order',()=>{
 assert.equal(matchesDiscoveryText(['Garden Lodge','Keffi','Nasarawa'],'  KEFFI   garden '),true);
 assert.equal(matchesDiscoveryText(['Ada','Cleaner','Keffi'],'Keffi Ada clean'),true);
 assert.equal(matchesDiscoveryText(['Garden Lodge','Keffi'],'Garden Lagos'),false);
 assert.equal(matchesDiscoveryText(['Garden Lodge'],'%'),false);
 assert.equal(matchesDiscoveryText(['anything'],'   '),true);
});
test('home layout and rental words use explicit listing facts',()=>{
 const home={title:'Hilltop',city:'Abuja',home_style:'penthouse',bedrooms:3,sub_type:'short_let'};
 assert.equal(matchesDiscoveryText(homeDiscoveryFields(home),'Abuja penthouse 3 bed'),true);
 assert.equal(matchesDiscoveryText(homeDiscoveryFields(home),'long let'),false);
 assert.equal(matchesDiscoveryText(homeDiscoveryFields({...home,bedrooms:0}),'studio'),true);
 assert.equal(matchesDiscoveryText(homeDiscoveryFields({...home,bedrooms:0,space_scope:'private_room'}),'studio'),false);
});
