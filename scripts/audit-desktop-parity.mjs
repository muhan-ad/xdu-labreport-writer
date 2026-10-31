// Read only the static files already listed in the mobile source archive.
// Never traverse desktop user data or change the original application.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {patchMobileSources} from './lib/report-source-patches.mjs';
const root=path.resolve(import.meta.dirname,'..'),desktop=path.resolve(process.argv[2]??'E:/apps/xdu-labreport-writer-master'),sourceRoot=path.join(desktop,'物理实验/实验脚本'),out=path.join(root,'artifacts/verification/desktop-parity');fs.mkdirSync(out,{recursive:true});
const read=p=>fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n'),hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const catalog=JSON.parse(read(path.join(root,'src/data/catalog.json'))),templates=JSON.parse(read(path.join(root,'src/data/report-variants.json'))),archive=JSON.parse(read(path.join(root,'public/report-runtime/report-sources.json'))),live={},issues=[],experiments=[];
for(const name of Object.keys(archive)){
 const file=path.resolve(sourceRoot,...name.split('/')),relative=path.relative(sourceRoot,file);
 if(relative.startsWith('..')||path.isAbsolute(relative)||name.split('/').includes('data.json')||!/[.](py|json|md|txt)$/.test(name)){issues.push({name,reason:'static archive path not allowed'});continue;}
 try{live[name]=read(file);}catch{issues.push({name,reason:'desktop static file missing'});}
}
let patched={};try{patched=patchMobileSources(live);}catch(error){issues.push({name:'mobile source patches',reason:error.message});}
const sources=Object.keys(archive).map(name=>{
 const same=live[name]===archive[name],accepted=patched[name]===archive[name];if(!same&&!accepted)issues.push({name,reason:'desktop/mobile source drift beyond explicit patches'});
 return {name,desktopSha256:live[name]===undefined?null:hash(live[name]),mobileSha256:hash(archive[name]),status:same?'identical':accepted?'explicit-mobile-patch':'different'};
});
for(const exp of catalog.experiments){
 const schemaPath=path.join(sourceRoot,exp.sourceId,'schema.json'),variantsPath=path.join(sourceRoot,exp.sourceId,'variants.json');let schemaMatches=false,schemaHashMatches=false,variantsMatch=false,desktopSchemaMatches=false,desktopVariantsMatch=false;
 try{const raw=fs.readFileSync(schemaPath),desktopSchema=JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,'')),mobileSchema=JSON.parse(patched[exp.sourceId+'/schema.json']);desktopSchemaMatches=JSON.stringify(desktopSchema)===JSON.stringify(exp.schema);schemaMatches=JSON.stringify(mobileSchema)===JSON.stringify(exp.schema);schemaHashMatches=hash(raw)===exp.schemaHash;}catch{}
 try{const desktopVariants=JSON.parse(read(variantsPath)),mobileVariants=JSON.parse(patched[exp.sourceId+'/variants.json']);desktopVariantsMatch=JSON.stringify(desktopVariants)===JSON.stringify(templates[exp.id]);variantsMatch=JSON.stringify(mobileVariants)===JSON.stringify(templates[exp.id]);}catch{}
 if(!schemaMatches||!schemaHashMatches||!variantsMatch)issues.push({name:exp.sourceId,reason:'schema, source hash or variant catalog mismatch'});
 experiments.push({id:exp.id,name:exp.name,fields:exp.schema.groups.reduce((n,g)=>n+g.fields.length,0),schemaMatches,schemaHashMatches,variantsMatch,desktopSchemaMatches,desktopVariantsMatch});
}
const result={version:JSON.parse(read(path.join(root,'package.json'))).version,sourceVersion:catalog.sourceVersion,checkedAt:new Date().toISOString(),desktop,experiments,sources,issues,complete:issues.length===0,scope:'static source, schema, source hash and variant catalog parity; not native behavior, numeric correctness or device acceptance'};
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({complete:result.complete,experiments:experiments.length,fields:experiments.reduce((n,e)=>n+e.fields,0),sources:sources.length,identical:sources.filter(s=>s.status==='identical').length,explicitMobilePatches:sources.filter(s=>s.status==='explicit-mobile-patch').map(s=>s.name),issues},null,2));if(!result.complete)process.exitCode=1;
