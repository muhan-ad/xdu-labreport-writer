'use strict';
const atomic=require('./atomic-store');
const {SYSTEMS,getSystem}=require('./school-systems');
// Storage paths and credential priority intentionally match the previous school window.
function createSchoolAccounts({credentials,preferencesFile}){
 let enabled=true;
 try{enabled=atomic.readJson(preferencesFile,{}).autoFillEnabled!==false;}catch{}
 return {
  getAutoFillEnabled:()=>enabled,
  async accountSettings(action,payload={}){
   try{
    const id=payload.systemId||'course';getSystem(id);
    if(action==='status')return {ok:true,...await credentials.status(id),autoFillEnabled:enabled,systems:SYSTEMS.map(({id,name})=>({id,name}))};
    if(action==='save')return {ok:true,...await credentials.save({username:payload.username,password:payload.password},id),message:'账号密码已加密保存'};
    if(action==='delete')return {ok:true,...credentials.remove(id),message:'已删除保存的账号密码'};
    if(action==='set-auto-fill'&&typeof payload.enabled==='boolean'){
     atomic.writeFile(preferencesFile,JSON.stringify({autoFillEnabled:payload.enabled}),'utf8');enabled=payload.enabled;return {ok:true,autoFillEnabled:enabled};
    }
    return {ok:false,error:'不支持的账号管理操作'};
   }catch{return {ok:false,error:'账号配置未能更新，请检查输入或系统加密是否可用'};}
  },
  async courseLogin(){
   if(!enabled)return {enabled:false};
   for(const id of ['course','report']){
    const status=await credentials.status(id);
    if(status.corrupt)throw Error('学校账号存储无法读取，请在登录设置中重新保存');
    if(status.configured){if(!status.available)throw Error('系统加密不可用');return {enabled:true,credentials:await credentials.get(id),source:id};}
   }
   return {enabled:true,credentials:null};
  }
 };
}
module.exports={createSchoolAccounts};
