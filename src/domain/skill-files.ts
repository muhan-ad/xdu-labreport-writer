import {parseSkill,textHash,validSkills,type Skill} from './ai-library.ts';
export interface SkillFile {name:string;mime:string;text:string;}
export const skillFileLimit=(name:string)=>name.toLowerCase().endsWith('.json')?131072:65536;
const bytes=(value:string)=>new TextEncoder().encode(value).length;
const metadata=(s:Skill)=>({name:s.name,description:s.description,scope:s.scope,content:s.content,enabled:s.enabled});
export function skillFile(skill:Skill):SkillFile{
 if(!validSkills([skill]))throw Error('技能内容无效，未导出');
 let stem=skill.name.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g,'_').slice(0,64).replace(/[. ]+$/g,'')||'AI技能';if(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem))stem='技能-'+stem;
 const text=['---','name: '+JSON.stringify(skill.name),'description: '+JSON.stringify(skill.description),'scope: '+skill.scope,'enabled: '+skill.enabled,'---',skill.content,''].join('\n');
 if(bytes(text)<=65536&&skill.name===skill.name.trim()&&skill.content===skill.content.trim()&&!skill.content.includes('\r'))return {name:stem+'.md',mime:'text/markdown;charset=utf-8',text};
 const json=JSON.stringify({format:'lab-maker-skill',version:1,skill:metadata(skill)},null,2);
 if(bytes(json)>131072)throw Error('技能文件过大，未导出');
 return {name:stem+'.json',mime:'application/json;charset=utf-8',text:json};
}
export async function parseSkillFile(name:string,raw:string):Promise<Skill>{
 if(name.toLowerCase().endsWith('.md'))return parseSkill(name,raw);
 if(!name.toLowerCase().endsWith('.json'))throw Error('请选择 Markdown 技能或导出的 JSON 技能文件');
 if(bytes(raw)>131072)throw Error('JSON 技能文件不能超过 128 KB');
 let pack;try{pack=JSON.parse(raw.replace(/^\uFEFF/,''));}catch{throw Error('JSON 技能文件无法读取');}
 const plain=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
 const keys=(x:Record<string,unknown>,allowed:string[])=>Object.keys(x).length===allowed.length&&Object.keys(x).every(k=>allowed.includes(k));
 if(!plain(pack)||!keys(pack,['format','version','skill'])||pack.format!=='lab-maker-skill'||pack.version!==1||!plain(pack.skill)||!keys(pack.skill,['name','description','scope','content','enabled']))throw Error('不是本应用导出的技能文件');
 const item=pack.skill,id=await textHash(String(item.scope)+'\n'+String(item.content)),skill={id,...item};
 if(!validSkills([skill])||!String(item.name).trim()||!String(item.content).trim())throw Error('技能名称、正文或适用范围无效');
 return skill as unknown as Skill;
}
export interface SkillExportPort {write:(path:string,text:string)=>Promise<{uri:string}>;read:(path:string)=>Promise<string>;remove:(path:string)=>Promise<void>;share:(uri:string,name:string)=>Promise<void>;}
export async function stageSkillFile(file:SkillFile,port:SkillExportPort){
 if(!file.name||/[\x00-\x1f/\\]/.test(file.name)||bytes(file.text)>131072)throw Error('技能文件名称或长度无效');
 const path=`exports/skill-${crypto.randomUUID()}/${file.name}`;let uri:string;
 try{const saved=await port.write(path,file.text);uri=saved.uri;if(!uri||await port.read(path)!==file.text)throw Error('技能文件写入核对失败');}
 catch(error){await port.remove(path).catch(()=>{});throw error;}
 // Receivers may still read the file after the share sheet returns or errors.
 try{await port.share(uri,file.name);}catch(error){
  if(error instanceof Error&&error.message==='Share canceled')throw Error('已取消分享');
  throw error;
 }
}
