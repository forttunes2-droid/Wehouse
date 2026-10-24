import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogRamp} from '../scripts/lib/catalog-ramp.mjs';
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
