import {Capacitor} from '@capacitor/core';import {Filesystem,Directory,Encoding} from '@capacitor/filesystem';import {Share} from '@capacitor/share';
import {stageSkillFile,type SkillFile} from '../domain/skill-files.ts';
export async function exportSkillFile(file:SkillFile){
 if(Capacitor.isNativePlatform()){
  await stageSkillFile(file,{write:(path,text)=>Filesystem.writeFile({path,directory:Directory.Cache,data:text,encoding:Encoding.UTF8,recursive:true}),read:async path=>{const result=await Filesystem.readFile({path,directory:Directory.Cache,encoding:Encoding.UTF8});return typeof result.data==='string'?result.data:'';},remove:path=>Filesystem.deleteFile({path,directory:Directory.Cache}),share:async(uri,name)=>{await Share.share({title:name,files:[uri],dialogTitle:'导出技能文件'});}});
 }else{
  const url=URL.createObjectURL(new Blob([file.text],{type:file.mime}));try{const link=document.createElement('a');link.download=file.name;link.href=url;link.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),30000);}
 }
}
