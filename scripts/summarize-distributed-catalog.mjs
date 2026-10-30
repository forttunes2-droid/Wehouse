import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {assessDistributedCatalog} from './lib/distributed-catalog-gates.mjs';
const reports=[];
for(let shard=0;shard<4;shard++){
 try{reports.push(JSON.parse(readFileSync(`test-results/distributed-catalog/catalog-shard-${shard}/hosted-test-catalog.json`,'utf8')));}
 catch{reports.push({shard_id:String(shard),status:'missing'});}
}
const result=assessDistributedCatalog(reports);
mkdirSync('test-results',{recursive:true});
writeFileSync('test-results/distributed-catalog-summary.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if(!result.passed)process.exitCode=1;
