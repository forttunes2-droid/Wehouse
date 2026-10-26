import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogRamp,freePlanCatalogRamp} from '../scripts/lib/catalog-ramp.mjs';
test('higher capacity stages retain all lower stages and bounded dwell times',()=>{
 assert.deepEqual(catalogRamp().map(([rate])=>rate),[1,5,10,25,50,100,200]);
 const higher=catalogRamp('1000');
 assert.deepEqual(higher.map(([rate])=>rate),[1,5,10,25,50,100,200,500,1000]);
 assert.ok(higher.every(([,seconds])=>seconds===30));
 assert.equal(catalogRamp('500').at(-1)[0],500);
});
test('a typo cannot start an unbounded or arbitrarily large hosted load',()=>{
 for(const value of ['0','Infinity','1000000','1000junk','',null])assert.throws(()=>catalogRamp(value),/ceiling/);
});

test('shared Free checks default to one request/second and reject oversized or distributed runs',()=>{
 assert.deepEqual(freePlanCatalogRamp(),[[1,30]]);
 assert.deepEqual(freePlanCatalogRamp('10'),[[1,30],[5,30],[10,30]]);
 for(const value of ['200','500','1000','Infinity','1000000',''])assert.throws(()=>freePlanCatalogRamp(value),/Hosted Free/);
 for(const shard of ['0','1','2','3'])assert.throws(()=>freePlanCatalogRamp('1',shard),/one generator/);
});
