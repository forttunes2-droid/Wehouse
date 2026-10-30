import {readFileSync,readdirSync,realpathSync,statSync,existsSync} from 'node:fs';
import path from 'node:path';

type PackageMetadata={name?:string;version?:string;license?:string;licenses?:{type:string}[];repository?:string|{url?:string};author?:string|{name?:string}};
/** Build-time source inventory only. No package code is executed or fetched. */
export function bundledLicences(ids:Iterable<string>,root=process.cwd()){
 const modulesRoot=realpathSync(path.join(root,'node_modules'));
 const upstream=JSON.parse(readFileSync(path.join(root,'docs/licenses/upstream-package-notices.json'),'utf8')) as {records:{packages:string[];licence:string;file:string;source:string;blob_sha:string}[]};
 const packages=new Map<string,{name:string;version:string;licence:string;source:string;notices:string;noticeFiles:string[];evidence:string}>();
 for(const id of ids){
  const normalized=id.replaceAll('\\','/').replace(/^\0/,'').split('?')[0],marker='/node_modules/';
  const start=normalized.lastIndexOf(marker);if(start<0)continue;
  const rest=normalized.slice(start+marker.length).split('/'),count=rest[0].startsWith('@')?2:1;
  const directory=path.resolve(normalized.slice(0,start+marker.length),...rest.slice(0,count));
  if(!existsSync(path.join(directory,'package.json')))continue;
  const real=realpathSync(directory);
  if(real!==modulesRoot&&!real.startsWith(modulesRoot+path.sep))throw Error('Bundled package is outside the dependency root');
  const meta=JSON.parse(readFileSync(path.join(real,'package.json'),'utf8')) as PackageMetadata;
  if(!meta.name||!meta.version)throw Error('Bundled package identity is missing');
  const key=meta.name+'@'+meta.version;if(packages.has(key))continue;
  const files=readdirSync(real).filter(name=>/^(licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(name)&&statSync(path.join(real,name)).isFile()).sort();
  const texts=files.map(name=>{
   const file=realpathSync(path.join(real,name));if(!file.startsWith(real+path.sep)||statSync(file).size>1_000_000)throw Error('Invalid licence file for '+key);
   return name+'\n\n'+readFileSync(file,'utf8').replaceAll('\r\n','\n').trim();
  });
  let licence=meta.license||meta.licenses?.map(item=>item.type).join(' OR ')||'',evidence='package licence files';
  if(!texts.length){
   const supplement=upstream.records.find(item=>item.packages.includes(key)&&item.licence===licence);
   if(supplement){
    const directory=realpathSync(path.join(root,'docs/licenses')),file=realpathSync(path.join(directory,supplement.file));
    if(!file.startsWith(directory+path.sep))throw Error('Invalid upstream notice location');
    texts.push('Upstream notice: '+supplement.source+'\nPinned licence blob: '+supplement.blob_sha+'\n\n'+readFileSync(file,'utf8').replaceAll('\r\n','\n').trim());
    evidence='pinned upstream notice for this exact package version';
   }
  }
  // Vendored D3/InternMap notices are distributed inside victory-vendor rather
  // than beside its root metadata. Preserve these in addition to its MIT wrapper.
  if(meta.name==='victory-vendor'&&existsSync(path.join(real,'lib-vendor'))){
   for(const child of readdirSync(path.join(real,'lib-vendor'),{withFileTypes:true}).filter(item=>item.isDirectory())){
    const file=path.join(real,'lib-vendor',child.name,'LICENSE');
    if(existsSync(file)&&statSync(file).isFile())texts.push('lib-vendor/'+child.name+'/LICENSE\n\n'+readFileSync(file,'utf8').replaceAll('\r\n','\n').trim());
   }
  }
  if(!texts.length||!licence){
   const readme=readdirSync(real).find(name=>/^readme(?:\.[^.]+)?$/i.test(name)&&statSync(path.join(real,name)).isFile());
   const text=readme?readFileSync(path.join(real,readme),'utf8'):'';
   const declared=text.match(/(?:^|\n)#{1,4}\s+Licen[cs]e\s*\n+([\s\S]*?)(?=\n#{1,4}\s|$)/i)?.[1]?.trim();
   if(!licence&&declared&&/^(MIT|ISC)\b/.test(declared))licence=declared.match(/^(MIT|ISC)\b/)![1];
   if(!texts.length&&declared){texts.push(readme+' · Licence declaration\n\n'+declared);evidence='publisher README licence declaration';}
  }
  if(!licence||!texts.length)throw Error('Licence evidence is missing for bundled package '+key);
  const source='https://registry.npmjs.org/'+meta.name+'/-/'+meta.name.split('/').at(-1)+'-'+meta.version+'.tgz';
  packages.set(key,{name:meta.name,version:meta.version,licence,source,notices:texts.join('\n\n'),noticeFiles:files,evidence});
 }
 const result={format:1,scope:'npm libraries included in this build',packages:[...packages.values()].sort((a,b)=>a.name.localeCompare(b.name,'en')||a.version.localeCompare(b.version,'en'))};
 if(JSON.stringify(result).length>8_000_000)throw Error('The bundled licence inventory exceeds its document budget');
 return result;
}
