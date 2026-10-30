import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/PropertySiteOffers.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:()=>({})});
const item={id:'unit-offer',title:'Flat A',unit_id:'physical-flat',price:25000,currency:'NGN',bedrooms:0,sub_type:'short_let',space_scope:'entire_unit',space_label:'Flat A',home_style:'apartment'};
const page={listing_id:'source',grouped:true,items:[item],has_more:false,next_id:null};
test('grouped offers accept explicit empty and matching published pages',()=>{
 assert.equal(exports.siteOfferPage(page,'source').items.length,1);
 assert.equal(exports.siteOfferPage({...page,items:[]},'source').items.length,0);
 assert.equal(exports.siteOfferPage({...page,items:[],grouped:false},'source').grouped,false);
});
test('grouped offer receipts reject stale source, invalid prices and missing pagination',()=>{
 for(const value of [null,{}, {...page,listing_id:'another'}, {...page,has_more:true},{...page,items:[item,item]},...[{price:NaN},{price:-1},{currency:null},{space_label:{}},{space_scope:'unknown'},{bedrooms:-1},{id:'source'}].map(change=>({...page,items:[{...item,...change}]}))])assert.throws(()=>exports.siteOfferPage(value,'source'));
});
test('guest and signed-in home details use the same grouped offer panel',()=>{
 const core=fs.readFileSync('src/pages/ListingDetailCore.tsx','utf8');assert.match(core,/<PropertySiteOffers key=\{listing.id\} listingId=\{listing.id\}/);
 assert.match(fs.readFileSync('src/App.tsx','utf8'),/onOpenListing=\{goToDetail\}/);
 assert.match(fs.readFileSync('src/components/GuestBrowseEntry.tsx','utf8'),/onOpenListing=\{id=>setTarget/);
});
