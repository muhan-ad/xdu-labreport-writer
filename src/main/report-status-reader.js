'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{createHash}=require('node:crypto');
function numericScore(value){
 const text=String(value??'').normalize('NFKC').replace(/\s/g,'').replace(/[·•]/g,'.');
 if(!/^(?:\d{1,3})(?:\.\d{1,2})?(?:分)?$/.test(text))return null;
 const score=Number(text.replace(/分$/,''));return Number.isFinite(score)&&score>=0&&score<=100?score:null;
}
function agreedScore(texts){
 if(!Array.isArray(texts)||!texts.length)return null;
 const values=[];
 for(const text of texts){const raw=String(text).trim(),normalized=/^[oO0\s]+$/.test(raw)?raw.replace(/[oO]/g,'0'):raw;const tokens=normalized.split(/\s+/);if(tokens.length<2)return null;if(tokens.some(token=>!/^\d+(?:\.\d+)?$/.test(token)))return null;const parsed=tokens.map(numericScore).filter(value=>value!==null);values.push(...parsed);}
 return values.length>=2&&values.every(v=>v===values[0])?values[0]:null;
}
function agreedStatus(texts){
 // Product rule: any recognized 已 in a report status image means 已上传.
 if(Array.isArray(texts)&&texts.some(text=>String(text).normalize('NFKC').includes('已')))return '已上传';
 const found=new Set();
 for(const text of Array.isArray(texts)?texts:[]){const value=String(text).normalize('NFKC').replace(/\s/g,'');for(const status of ['已上传','未上传','已批改','未批改'])if(value.length>=status.length*2&&value.length%status.length===0&&status.repeat(value.length/status.length)===value)found.add(status);}
 return found.size===1?[...found][0]:'';
}
function createReportStatusReader({spawnProcess=spawn,platform=process.platform,timeoutMs=7000}={}){
 let child=null,buffer='',serial=0,generation=0;const pending=new Map(),cache=new Map(),inflight=new Map();
 function close(){generation++;cache.clear();inflight.clear();const current=child;child=null;buffer='';for(const p of pending.values()){clearTimeout(p.timer);p.resolve(null);}pending.clear();current?.kill();}
 function start(){
  if(child)return child;
  const exe=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const script=fs.readFileSync(path.join(__dirname,'report-status-reader.ps1'),'utf8');
  const current=spawnProcess(exe,['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});child=current;
  current.stdout.on('data',chunk=>{
   if(child!==current)return;buffer+=String(chunk);if(buffer.length>20000){close();return;}
   let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);try{const result=JSON.parse(line),job=pending.get(result.id);if(job){pending.delete(result.id);clearTimeout(job.timer);const status=agreedStatus(result.texts);job.resolve({score:status?null:agreedScore(result.scoreTexts??result.texts),status});}}catch{}}
  });
  current.stderr.on('data',()=>{});current.stdin.on('error',()=>{if(child===current)close();});
  current.once('error',()=>{if(child===current)close();});current.once('exit',()=>{if(child===current)close();});return current;
 }
 async function readOnce(bytes,threshold=0){
  if(platform!=='win32'||!Buffer.isBuffer(bytes)||bytes.length>100000)return null;
  try{return await new Promise(resolve=>{const current=start(),id=++serial,timer=setTimeout(()=>close(),timeoutMs);pending.set(id,{resolve,timer});try{current.stdin.write(JSON.stringify({id,image:bytes.toString('base64'),threshold})+'\n');}catch{close();}});}catch{return null;}
 }
 async function read(bytes){
  if(platform!=='win32'||!Buffer.isBuffer(bytes)||bytes.length>100000)return null;
  const key=createHash('sha256').update(bytes).digest('hex');if(cache.has(key))return cache.get(key);if(inflight.has(key))return inflight.get(key);
  const revision=generation,job=(async()=>{let result=await readOnce(bytes);if(result&&result.score===null&&!result.status&&revision===generation){const fallback=await readOnce(bytes,120);result={...result,status:fallback?.status||''};}if(result&&(result.score!==null||result.status)&&revision===generation){if(cache.size>=200)cache.clear();cache.set(key,result);}return result;})();
  inflight.set(key,job);try{return await job;}finally{if(inflight.get(key)===job)inflight.delete(key);}
 }
 return {read,recognize:async bytes=>(await read(bytes))?.score??null,warm:()=>{if(platform==='win32')try{start();}catch{}},close};
}
module.exports={numericScore,agreedScore,agreedStatus,createReportStatusReader};
