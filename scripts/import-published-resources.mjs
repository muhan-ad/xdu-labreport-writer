// Convert one verified desktop release to the mobile runtime. No local desktop tree or user files.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),arg=n=>process.argv[process.argv.indexOf(n)+1];
if(!process.argv.includes('--zip')||!process.argv.includes('--manifest'))throw Error('Specify --zip and --manifest');
const zip=path.resolve(arg('--zip')),m=JSON.parse(fs.readFileSync(arg('--manifest'),'utf8')),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const files=Object.fromEntries(Object.entries(m.files).sort(([a],[b])=>a<b?-1:a>b?1:0));
const signed={dataVersion:m.dataVersion,minAppVersion:m.minAppVersion,url:m.url,size:m.size,sha256:m.sha256,notes:m.notes||''};
if(m.removed?.length)signed.removed=[...new Set(m.removed)].sort();signed.files=files;
if(!crypto.verify(null,Buffer.from(JSON.stringify(signed)),fs.readFileSync(path.join(root,'src/data/update-public-key.pem')),Buffer.from(m.signature,'base64')))throw Error('Desktop release signature failed');
const bytes=fs.readFileSync(zip);if(bytes.length!==m.size||hash(bytes)!==m.sha256)throw Error('Desktop ZIP hash failed');
const python=process.env.LAB_MAKER_TEST_PYTHON||'E:/apps/xdu-labreport-writer-master/python-runtime/python.exe';
const read=spawnSync(python,['-c','import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); assert len(z.namelist())==len(set(z.namelist())); assert sum(x.file_size for x in z.infolist())<268435456; print(json.dumps({n:z.read(n).hex() for n in z.namelist()}))',zip],{encoding:'utf8',maxBuffer:32*1024*1024});
if(read.status!==0)throw Error(read.stderr);const archive=JSON.parse(read.stdout),sources={};
if(Object.keys(archive).length!==Object.keys(files).length)throw Error('Unexpected archive entries');
for(const [name,digest] of Object.entries(files)){
 const data=Buffer.from(archive[name]??'','hex');if(hash(data)!==digest)throw Error('Resource hash failed: '+name);
 if(name.split('/').some(p=>!p||p==='..'||p==='.')||name.includes('\\'))throw Error('Invalid resource path');
 if(name.startsWith('实验脚本/')&&/\.(py|json|md|txt)$/.test(name)&&!/^实验脚本\/[^/]+\/(data|sample|test-data)\.json$/.test(name))sources[name.slice('实验脚本/'.length)]=data.toString('utf8').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
}
const overlay=JSON.parse(fs.readFileSync(path.join(root,'scripts/lib/mobile-resource-overrides.json'),'utf8'));
for(const [name,entry] of Object.entries(overlay.files)){
 const base=sources[name];if((base===undefined?null:hash(Buffer.from(base)))!==entry.baseSha256)throw Error('Upstream changed; review mobile override: '+name);
 sources[name]=entry.text;
}
const catalog=JSON.parse(fs.readFileSync(path.join(root,'src/data/catalog.json'),'utf8'));
catalog.sourceVersion='desktop-data-'+m.dataVersion;
const variants={};for(const exp of catalog.experiments){
 exp.schema=JSON.parse(sources[exp.sourceId+'/schema.json']);exp.schemaHash=hash(Buffer.from(sources[exp.sourceId+'/schema.json']));
 variants[exp.id]=JSON.parse(sources[exp.sourceId+'/variants.json']);
}
const runtime=path.join(root,'public/report-runtime'),runtimeManifest=JSON.parse(fs.readFileSync(path.join(runtime,'manifest.json'),'utf8'));
fs.writeFileSync(path.join(runtime,'report-sources.json'),JSON.stringify(sources));
const body=fs.readFileSync(path.join(runtime,'report-sources.json'));runtimeManifest.files['report-sources.json']={bytes:body.length,sha256:hash(body)};
fs.writeFileSync(path.join(runtime,'manifest.json'),JSON.stringify(runtimeManifest,null,2));
fs.writeFileSync(path.join(root,'src/data/catalog.json'),JSON.stringify(catalog));
fs.writeFileSync(path.join(root,'src/data/report-variants.json'),JSON.stringify(variants));
const provenance={schema:1,dataVersion:m.dataVersion,sourceUrl:m.url,sourceSha256:m.sha256,mobileOverrides:Object.keys(overlay.files),overrideSha256:hash(fs.readFileSync(path.join(root,'scripts/lib/mobile-resource-overrides.json')))};
fs.writeFileSync(path.join(root,'src/data/resource-release.json'),JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({dataVersion:m.dataVersion,experiments:catalog.experiments.length,overrides:provenance.mobileOverrides.length}));
