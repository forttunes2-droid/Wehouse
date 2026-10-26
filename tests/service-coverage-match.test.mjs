import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['src/lib/serviceCoverageMatch.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {workerServesLocation,workerCoverageSearchText}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
test('service coverage is matched independently of the provider home/base address',()=>{
 const provider={state:'Nasarawa',city:'Lafia',coverage:[{state:'Nasarawa',lga:'Keffi',areas:['University area']}]};
 assert.equal(workerServesLocation(provider,'Nasarawa','Keffi'),true);assert.equal(workerServesLocation(provider,'Nasarawa','Lafia'),false);
 assert.match(workerCoverageSearchText(provider),/University area/);
 assert.equal(workerServesLocation({state:'Nasarawa',city:'Lafia'},'Nasarawa','Lafia'),false);
});
test('coverage matches one complete region/locality pair and supports current FCT labels',()=>{
 const provider={coverage:[{state:'Lagos',lga:'Ikeja'},{state:'Nasarawa',lga:'Keffi'}]};
 assert.equal(workerServesLocation(provider,'Nasarawa','Ikeja'),false);assert.equal(workerServesLocation(provider,'Lagos','Ikeja'),true);
 assert.equal(workerServesLocation({coverage:[{state:'FCT',lga:'AMAC'}]},'Abuja (FCT)','amac'),true);
 assert.equal(workerServesLocation(null,'Lagos','Ikeja'),false);assert.equal(workerServesLocation(null,'',''),true);
});
