export interface Skill {id:string;name:string;description:string;scope:'report'|'plot';content:string;enabled:boolean;builtin?:boolean;}
export async function textHash(text:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function skillMetadata(value:string){
 const text=value.trim();
 if(text.startsWith('"')&&text.endsWith('"')){try{const decoded=JSON.parse(text);if(typeof decoded==='string')return decoded;}catch{}return text.slice(1,-1);}
 if(text.startsWith("'")&&text.endsWith("'"))return text.slice(1,-1).replace(/''/g,"'");
 return text;
}
export async function parseSkill(filename:string,raw:string):Promise<Skill>{
 if(!filename.toLowerCase().endsWith('.md')||new TextEncoder().encode(raw).length>65536)throw Error('请选择不超过 64 KB 的 Markdown 技能文件');
 const text=raw.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');let content=text,meta:Record<string,string>={};
 if(text.startsWith('---\n')){const match=text.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);if(!match)throw Error('技能文件头部未闭合');content=match[2];for(const line of match[1].split('\n')){const i=line.indexOf(':');if(i>0)meta[line.slice(0,i).trim()]=skillMetadata(line.slice(i+1));}}
 content=content.trim();const name=(meta.name||filename.replace(/\.md$/i,'')).trim(),description=meta.description||'',scope=meta.scope||'report';
 if(!name||name.length>100||description.length>1000||!content||content.length>20000||!['report','plot'].includes(scope))throw Error('技能名称、正文或适用范围无效（范围须为 report 或 plot）');
 return {id:await textHash(scope+'\n'+content),name,description,scope:scope as Skill['scope'],content,enabled:meta.enabled!=='false'};
}
export function validSkills(raw:unknown):raw is Skill[]{return Array.isArray(raw)&&raw.length<=100&&new Set(raw.map(x=>x?.id)).size===raw.length&&new TextEncoder().encode(JSON.stringify(raw)).length<=1500000&&raw.every(s=>s&&/^[a-f0-9]{64}$/.test(s.id)&&typeof s.name==='string'&&s.name.length>0&&s.name.length<=100&&typeof s.description==='string'&&s.description.length<=1000&&['report','plot'].includes(s.scope)&&typeof s.content==='string'&&s.content.length>0&&s.content.length<=20000&&typeof s.enabled==='boolean');}
export function skillPrompt(skills:Skill[],scope:Skill['scope']){return skills.filter(s=>s.enabled&&s.scope===scope).map(s=>`【技能：${s.name}】\n${s.content}`).join('\n\n');}
export interface AIHistoryEntry {id:string;experimentId:string;kind:'quiz'|'polish';section:string;createdAt:string;source:string;sourceHash:string;text:string;original:string;questions:string[];}
export type AIHistorySummary=Pick<AIHistoryEntry,'id'|'kind'|'section'|'createdAt'|'sourceHash'>;
export function validHistorySummary(x:unknown):x is AIHistorySummary{const r=x as AIHistorySummary;return !!r&&typeof r.id==='string'&&/^[a-f0-9-]{36}$/.test(r.id)&&['quiz','polish'].includes(r.kind)&&typeof r.section==='string'&&r.section.length<=100&&typeof r.createdAt==='string'&&Number.isFinite(Date.parse(r.createdAt))&&typeof r.sourceHash==='string'&&/^[a-f0-9]{64}$/.test(r.sourceHash);}
export function validHistoryEntry(x:unknown):x is AIHistoryEntry{const r=x as AIHistoryEntry;return validHistorySummary(r)&&typeof r.experimentId==='string'&&/^[a-f0-9]{12}$/.test(r.experimentId)&&typeof r.source==='string'&&r.source.length<=200000&&typeof r.text==='string'&&r.text.length>0&&r.text.length<=100000&&typeof r.original==='string'&&r.original.length<=100000&&Array.isArray(r.questions)&&r.questions.length<=12&&r.questions.every(q=>typeof q==='string'&&q.length<=1000)&&new TextEncoder().encode(JSON.stringify(r)).length<=1024*1024;}
