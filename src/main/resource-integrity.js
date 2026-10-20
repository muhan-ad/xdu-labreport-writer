'use strict';
// Electron's regular fs treats app.asar as a virtual directory. Hash the physical file.
const fs=require(process.versions.electron?'original-fs':'node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOTS=['app.asar','物理实验','python-runtime','skills','course-selection','shared'];
const MANIFEST='resource-integrity.json';
function safeName(name){return typeof name==='string'&&name.length>0&&!name.includes('\\')&&!name.includes(':')&&!name.startsWith('/')&&!name.split('/').some(p=>!p||p==='.'||p==='..')&&ROOTS.includes(name.split('/')[0]);}
async function digest(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function buildManifest(resources,version){
 const files=[];
 async function visit(relative){
  const file=path.join(resources,...relative.split('/')),stat=await fs.promises.lstat(file);
  if(stat.isSymbolicLink())throw Error('资源目录含链接：'+relative);
  if(stat.isDirectory()){
   for(const entry of (await fs.promises.readdir(file)).sort())if(entry!=='__pycache__'&&!/\.py[co]$/i.test(entry))await visit(relative+'/'+entry);
  }else if(stat.isFile())files.push({path:relative,size:stat.size,sha256:await digest(file)});
  else throw Error('不支持的资源类型：'+relative);
 }
 for(const root of ROOTS)await visit(root);
 if(ROOTS.some(root=>!files.some(file=>file.path===root||file.path.startsWith(root+'/'))))throw Error('安装资源目录为空，不能生成完整性基准');
 const manifest={schema:1,appVersion:version,algorithm:'sha256',files};
 await fs.promises.writeFile(path.join(resources,MANIFEST),JSON.stringify(manifest,null,2)+'\n','utf8');return manifest;
}
async function checkResources(resources,version){
 let manifest;
 try{
  const file=path.join(resources,MANIFEST),stat=await fs.promises.lstat(file);
  if(stat.isSymbolicLink()||stat.size>20*1024*1024)throw Error('清单无效');
  manifest=JSON.parse(await fs.promises.readFile(file,'utf8'));
 }catch(e){return {ok:false,error:e.code==='ENOENT'?'资源校验清单缺失，无法核对完整资源，请使用完整安装包。':'资源校验清单无法读取，请使用完整安装包。',missing:e.code==='ENOENT'?[MANIFEST]:[]};}
 const names=new Set();
 if(manifest.schema!==1||manifest.appVersion!==version||manifest.algorithm!=='sha256'||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>50000||manifest.files.some(f=>!f||!safeName(f.path)||names.has(f.path)||!names.add(f.path)||!Number.isSafeInteger(f.size)||f.size<0||!/^[a-f0-9]{64}$/.test(f.sha256))||ROOTS.some(root=>![...names].some(n=>n===root||n.startsWith(root+'/'))))return {ok:false,error:'资源校验清单无效或与当前版本不一致，无法确认资源完整。',missing:[]};
 const missing=[],changed=[],unreadable=[],rejected=new Set();
 for(const file of manifest.files){
  try{
   // Reject directory links as well as file links; never hash a path outside this install.
   const parts=file.path.split('/');let target=resources;
   for(const part of parts){target=path.join(target,part);if(rejected.has(target))throw Error('linked resource');const stat=await fs.promises.lstat(target);if(stat.isSymbolicLink()){rejected.add(target);throw Error('linked resource');}}
   const before=await fs.promises.stat(target);
   if(!before.isFile()){unreadable.push(file.path);continue;}
   if(before.size!==file.size){changed.push(file.path);continue;}
   const actual=await digest(target),after=await fs.promises.stat(target);
   if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)unreadable.push(file.path);
   else if(actual!==file.sha256)changed.push(file.path);
  }catch(e){(e.code==='ENOENT'||e.code==='ENOTDIR'?missing:unreadable).push(file.path);}
 }
 return {ok:true,complete:!missing.length&&!changed.length&&!unreadable.length,total:manifest.files.length,missing,changed,unreadable};
}
module.exports={MANIFEST,ROOTS,buildManifest,checkResources};
