'use strict';
importScripts('reader.js');
const APP_URL='https://ehall.xidian.edu.cn/appShow?appId=4770397878132218';
function localOrigin(sender){try{const u=new URL(sender.url);return sender.frameId===0&&u.protocol==='http:'&&u.hostname==='127.0.0.1'&&/^\d+$/.test(u.port)&&u.pathname==='/academic-connect'&&!u.username&&!u.password&&!u.search?u.origin:null;}catch{return null;}}
function schoolSender(sender){try{const u=new URL(sender.url);return sender.frameId===0&&u.protocol==='https:'&&u.hostname==='ehall.xidian.edu.cn'&&!u.port&&!u.username&&!u.password;}catch{return false;}}
const flights=new Map();
async function handle(message,sender){
 const origin=localOrigin(sender),key='bridge-'+sender.tab?.id;
 if(message?.type==='academic-login-ready'&&schoolSender(sender)){
  const entries=await chrome.storage.session.get(null);
  for(const [id,value]of Object.entries(entries))if(id.startsWith('bridge-')&&value.origin)chrome.tabs.sendMessage(Number(id.slice(7)),{type:'academic-login-ready'}).catch(()=>{});
  return {ok:true};
 }
 if(!origin||!Number.isInteger(sender.tab?.id))return {ok:false};
 const stored=(await chrome.storage.session.get(key))[key];
 if(message?.type==='bridge-hello'){
  const token=/^[A-Za-z0-9_-]{43}$/.test(message.token||'')?message.token:stored?.origin===origin?stored.token:null;
  if(!token)return {ok:false};
  await chrome.storage.session.set({[key]:{origin,token}});return {ok:true,token};
 }
 if(message?.type!=='read-timetable'||stored?.origin!==origin||!/^\d{5,20}$/.test(message.account||''))return {ok:false};
 if(flights.has(key))return flights.get(key);
 const task=(async()=>{
  try{const result=await TimetableReader.readTimetable(message.account);await chrome.storage.session.set({[key]:{...stored,openedLogin:false}});return result;}
  catch(error){const code=['needs_login','account_mismatch','identity_unverified','rate_limited','school_format_changed'].includes(error.message)?error.message:'network_failed';
   if(code==='needs_login'&&message.interactive&&!stored.openedLogin){await chrome.storage.session.set({[key]:{...stored,openedLogin:true}});await chrome.tabs.create({url:APP_URL});}
   return {ok:false,code};
  }
 })();flights.set(key,task);try{return await task;}finally{flights.delete(key);}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{handle(message,sender).then(respond,()=>respond({ok:false,code:'network_failed'}));return true;});
chrome.tabs.onRemoved.addListener(id=>{chrome.storage.session.remove('bridge-'+id);});
