import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const root=path.resolve('dist'),target=path.join(root,'web-resource-integrity.json');
const walk=(dir,prefix='')=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
 const relative=path.posix.join(prefix,entry.name),file=path.join(dir,entry.name);
 if(entry.isSymbolicLink())throw Error('Resource inventory cannot include symbolic links: '+relative);
 return entry.isDirectory()?walk(file,relative):entry.isFile()&&relative!=='web-resource-integrity.json'?[{path:relative,bytes:fs.statSync(file).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}]:[];
});
const files=walk(root).sort((a,b)=>a.path.localeCompare(b.path,'en'));
for(const required of ['index.html','report-worker.js','report-runtime/manifest.json','report-runtime/pyodide.asm.wasm'])if(!files.some(f=>f.path===required))throw Error('Required shared resource missing: '+required);
const {version}=JSON.parse(fs.readFileSync('package.json','utf8'));
fs.writeFileSync(target,JSON.stringify({schema:1,version,scope:'shared-web-resources',files}));
console.log(JSON.stringify({webResources:files.length,version}));
