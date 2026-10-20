'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),atomic=require('./atomic-store');
const MAX_BYTES=48*1024*1024;
const signature=schema=>crypto.createHash('sha256').update(JSON.stringify(schema)).digest('hex');
const revisions=new Map();
const revision=dir=>revisions.get(path.resolve(dir))||0;
function invalidate(dir){const next=revision(dir)+1;revisions.set(path.resolve(dir),next);return next;}
function save(dir,state,schema,expectedRevision){
  if(expectedRevision!==undefined&&expectedRevision!==revision(dir))return {ok:false,stale:true,error:'识图缓存已清除，旧结果已丢弃'};
  if(!state||state.expId!==path.basename(dir)||!Array.isArray(state.fields))throw Error('识图结果不属于当前实验');
  const keys=new Set((schema.groups||[]).flatMap(g=>(g.fields||[]).map(f=>f.key)));
  const safe={expId:path.basename(dir),includeStudent:!!state.includeStudent};
  for(const key of ['dataUrl','originalDataUrl']){
    if(typeof state[key]!=='string'||!/^data:image\/(jpeg|png|webp|bmp);base64,[A-Za-z0-9+/]+=*$/.test(state[key]))throw Error('识图缓存图片无效');
    safe[key]=state[key];
  }
  safe.fields=state.fields.filter(f=>f&&keys.has(f.key)).map(f=>({key:f.key,value:f.value,status:f.status,reason:String(f.reason||'').slice(0,4096)}));
  if(!safe.fields.length)throw Error('没有可保存的识图字段');
  const student=value=>Object.fromEntries(['name','id','class'].filter(k=>typeof value?.[k]==='string').map(k=>[k,value[k].slice(0,256)]));
  safe.student=safe.includeStudent?student(state.student):null;
  safe.aiRaw={fields:Object.fromEntries(Object.entries(state.aiRaw?.fields||{}).filter(([k])=>keys.has(k)))};
  if(safe.includeStudent)safe.aiRaw.student=student(state.aiRaw?.student);
  safe.reviewControls=(state.reviewControls||[]).filter(c=>keys.has(c.key)).slice(0,10000).map(c=>({
    key:c.key,idx:c.idx,row:c.row,col:c.col,kind:c.kind,value:String(c.value||'').slice(0,4096),checked:!!c.checked}));
  safe.onlyEmpty=!!state.onlyEmpty;
  const record={version:1,schemaHash:signature(schema),savedAt:new Date().toISOString(),state:safe};
  const text=JSON.stringify(record);
  if(Buffer.byteLength(text)>MAX_BYTES)throw Error('识图结果缓存超过48MB');
  atomic.writeFile(path.join(dir,'.ocr-last-result.json'),text,'utf8',false);
  return {ok:true,savedAt:record.savedAt};
}
function read(dir,schema){
  const file=path.join(dir,'.ocr-last-result.json');
  if(!fs.existsSync(file))return {ok:true,record:null,revision:revision(dir)};
  if(fs.statSync(file).size>MAX_BYTES)throw Error('识图缓存过大');
  const record=atomic.readJson(file);
  if(record.version!==1||record.state?.expId!==path.basename(dir))throw Error('识图缓存来源不匹配');
  if(record.schemaHash!==signature(schema))return {ok:true,record:null,schemaChanged:true,revision:revision(dir)};
  return {ok:true,record,revision:revision(dir)};
}
module.exports={save,read,invalidate};
