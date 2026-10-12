'use strict';
const path = require('path'), crypto = require('crypto');
const atomic = require('./atomic-store');
const {sameData} = require('../shared/report-integrity');
function createHistory(root) {
  const file = path.join(root, 'polish-history.json');
  const read = () => atomic.readJson(file, {version:1,records:[],applied:[],migrated:[]});
  const write = state => atomic.writeFile(file, JSON.stringify(state), 'utf8');
  function record(input, legacy = false) {
    if (!input || typeof input.expId !== 'string' || !input.expId || typeof input.polished !== 'string' || !input.polished.trim()) throw Error('润色记录无效');
    const result = {id:crypto.randomUUID(), expId:input.expId, expName:String(input.expName || input.expId), section:String(input.section || input.displayScope || '全文'), original:String(input.original || ''), polished:input.polished, createdAt:legacy ? null : new Date().toISOString(), sourceData:input.sourceData && typeof input.sourceData === 'object' ? JSON.parse(JSON.stringify(input.sourceData)) : null, imported:false, legacy};
    if (Buffer.byteLength(JSON.stringify(result)) > 1024*1024) throw Error('润色记录过大');
    if (!legacy && !result.sourceData) throw Error('润色结果缺少来源记录');
    return result;
  }
  function run(action, payload = {}) {
    const state = read();
    if (action === 'list') return {ok:true,...state};
    if (action === 'append') { const r=record(payload); state.records.push(r); write(state); return {ok:true,record:r}; }
    if (action === 'migrate') {
      for (const [expId, overrides] of Object.entries(payload.overrides || {})) {
        for (const [section, polished] of Object.entries(overrides || {})) {
          if (section === '__sourceData' || typeof polished !== 'string' || !polished.trim()) continue;
          const fingerprint=crypto.createHash('sha256').update(JSON.stringify([expId,section,polished,overrides.__sourceData || null])).digest('hex');
          if (state.migrated.includes(fingerprint)) continue;
          const applied=state.applied.find(x=>x.expId===expId && x.section===section);
          if (applied && state.records.some(x=>x.id===applied.id && x.polished===polished && sameData(x.sourceData,overrides.__sourceData || null))) {state.migrated.push(fingerprint);continue;}
          const r=record({expId,expName:payload.names?.[expId],section,polished,sourceData:overrides.__sourceData},true);
          state.records.push(r);state.migrated.push(fingerprint);
          if (!state.applied.some(x=>x.expId===expId && x.section===section)) {r.imported=true;state.applied.push({expId,section,id:r.id});}
        }
      }
    } else if (action === 'apply') {
      const r=state.records.find(x=>x.id===payload.id);
      if (!r) throw Error('润色记录不存在');
      r.imported=true;
      if (!payload.variant) {
        state.applied=state.applied.filter(x=>!(x.expId===r.expId && x.section===r.section));
        state.applied.push({expId:r.expId,section:r.section,id:r.id});
      }
    } else if (action === 'delete') {
      if (!(payload.all === true || typeof payload.expId === 'string' || typeof payload.id === 'string')) throw Error('请选择要删除的润色记录');
      const removed=state.records.filter(x=>payload.all===true || (payload.id ? x.id===payload.id : x.expId===payload.expId));
      const ids=new Set(removed.map(x=>x.id));
      const detached=state.applied.filter(x=>ids.has(x.id)).map(x=>{const r=removed.find(r=>r.id===x.id);return {...x,polished:r.polished,sourceData:r.sourceData};});
      state.records=state.records.filter(x=>!ids.has(x.id));state.applied=state.applied.filter(x=>!ids.has(x.id));
      write(state);return {ok:true,removed:removed.map(x=>x.id),detached};
    } else throw Error('不支持的润色历史操作');
    write(state);return {ok:true,...state};
  }
  return {run};
}
module.exports = {createHistory};
