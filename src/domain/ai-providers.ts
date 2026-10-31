/** Convenience presets, never an authority for account/model availability. */
export const aiProviders = [
  {id:'deepseek',name:'DeepSeek',endpoint:'https://api.deepseek.com',chat:['deepseek-flash','deepseek-v4-pro'],vision:['deepseek-flash']},
  {id:'mimo',name:'小米 MiMo',endpoint:'https://api.xiaomimimo.com/v1',chat:['mimo-v2.5','mimo-v2.5-pro'],vision:['mimo-v2.5']},
  {id:'siliconflow',name:'硅基流动',endpoint:'https://api.siliconflow.cn/v1',chat:[],vision:[]},
  {id:'bailian',name:'阿里云百炼（北京）',endpoint:'https://dashscope.aliyuncs.com/compatible-mode/v1',chat:['qwen-plus'],vision:['qwen3-vl-plus']},
] as const;
export type AIProviderId=typeof aiProviders[number]['id']|'custom';
export function providerForEndpoint(endpoint:string):AIProviderId {
  try{
    const url=new URL(endpoint.trim());if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)return 'custom';
    const normalized=url.origin+url.pathname.replace(/\/+$/,'');
    return aiProviders.find(p=>p.endpoint===normalized||(p.id==='deepseek'&&normalized===p.endpoint+'/v1'))?.id??'custom';
  }catch{return 'custom';}
}
export function providerDraft(id:string,slot:'chat'|'vision',current:{endpoint:string;model:string;key:string}){
  const provider=aiProviders.find(p=>p.id===id);
  if(!provider)return {...current};
  return {endpoint:provider.endpoint,model:provider[slot][0]??'',key:providerForExactEndpoint(current.endpoint,provider.endpoint)?current.key:''};
}
// Match native secret binding: trailing slashes are normalized, a different path is a new binding.
function providerForExactEndpoint(a:string,b:string){return a.trim().replace(/\/+$/,'')===b;}
