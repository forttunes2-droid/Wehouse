import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';

test('vendored email-domain policy matches its reviewed upstream blob and safe domain format',()=>{
 const root=new URL('../supabase/data/email-domain-policy/',import.meta.url);
 // Git's blob identity includes the original terminal LF.
 const source=readFileSync(new URL('disposable_email_blocklist.conf',root),'utf8').replaceAll('\r\n','\n');
 const metadata=JSON.parse(readFileSync(new URL('source.json',root),'utf8'));
 const bytes=Buffer.from(source.endsWith('\n')?source:source+'\n');
 assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),metadata.git_blob_sha);
 const domains=source.trim().split('\n');
 assert.equal(domains.length,metadata.domains);
 assert.equal(new Set(domains).size,domains.length);
 for(const domain of domains)assert.match(domain,/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/);
 for(const preserved of ['gmail.com','hotmail.com','privaterelay.appleid.com','mozmail.com','duck.com','simplelogin.com'])assert.ok(!domains.includes(preserved));
});
