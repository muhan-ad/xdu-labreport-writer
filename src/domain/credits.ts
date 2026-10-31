export interface Credits {items:{name:string;contribution:string}[];}
// This file is data even when delivered inside a signed source package.
export function parseCredits(value:unknown):Credits {
 if(typeof value==='string'){if(value.length>65536)throw Error('致谢名单过大');try{value=JSON.parse(value);}catch{throw Error('致谢名单格式无效');}}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('致谢名单格式无效');
 const items=(value as Record<string,unknown>).items;if(!Array.isArray(items)||items.length>200)throw Error('致谢名单格式无效');
 const clean=(v:unknown,max:number)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))throw Error('致谢条目格式无效');return v.trim();};
 return {items:items.map(item=>{if(!item||typeof item!=='object'||Array.isArray(item))throw Error('致谢条目格式无效');return {name:clean(item.name,100),contribution:clean(item.contribution,500)};})};
}
