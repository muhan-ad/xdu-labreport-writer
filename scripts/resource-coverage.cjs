'use strict';
const fs=require('node:fs'),path=require('node:path');
const matcher=require('minimatch'),match=matcher.minimatch||matcher;
module.exports=async(project,resources,pkg)=>{
 for(const rule of pkg.build.extraResources){
  const patterns=rule.filter||['**/*'];let count=0;
  async function walk(relative){
   const source=path.join(project,rule.from,relative),stat=await fs.promises.lstat(source);
   if(stat.isSymbolicLink())throw Error('构建资源不应包含链接：'+source);
   if(stat.isDirectory()){for(const name of await fs.promises.readdir(source))if(name!=='__pycache__')await walk(relative?relative+'/'+name:name);return;}
   if(/\.py[co]$/i.test(relative))return;
   const included=patterns.filter(p=>!p.startsWith('!')).some(p=>match(relative,p,{dot:true}));
   const excluded=patterns.filter(p=>p.startsWith('!')).some(p=>match(relative,p.slice(1),{dot:true}));
   if(!included||excluded)return;
   const target=path.join(resources,rule.to,relative);
   if(!(await fs.promises.stat(target).catch(()=>null))?.isFile())throw Error('打包资源缺失：'+rule.to+'/'+relative);
   count++;
  }
  await walk('');if(!count)throw Error('资源来源为空：'+rule.from);
 }
};
