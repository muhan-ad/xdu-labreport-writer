'use strict';
(function(root){
 const ROOT='https://ehall.xidian.edu.cn/jwapp/sys/wdkb/modules/';
 const courseKeys=['KCM','KCH','KXH','SKZC','SKXQ','KSJC','JSJC','JASMC','XH'];
 const changeKeys=['KCM','KCH','KXH','TKLXDM','SKZC','XSKZC','SKXQ','XSKXQ','KSJC','JSJC','XKSJC','XJSJC','JASMC','XJASMC','SQSJ'];
 const paths=new Set(['jshkcb/dqxnxq.do','jshkcb/cxjcs.do','xskcb/xskcb.do','xskcb/xsdkkc.do','xskcb/cxxsllsywpk.do']);
 async function readTimetable(account,fetcher=fetch,onProgress=()=>{}){
  if(!/^\d{5,20}$/.test(account))throw Error('account_mismatch');
  async function rows(path,key,data){
   if(!paths.has(path))throw Error('school_format_changed');
   const result=[];let total=null;
   const step=['dqxnxq','cxjcs','xskcb','xsdkkc','cxxsllsywpk'].indexOf(key)+1;onProgress({stage:'reading',step,page:1});
   for(let page=1;page<=50;page++){
    onProgress({stage:'reading',step,page});
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);let response;
    try{response=await fetcher(ROOT+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},body:new URLSearchParams({...data,pageNumber:String(page),pageSize:'500'}),credentials:'include',redirect:'manual',signal:controller.signal});
     if(response.type==='opaqueredirect'||response.status===401||response.status===403)throw Error('needs_login');
     if(response.status===429)throw Error('rate_limited');if(!response.ok)throw Error('network_failed');
     const text=await response.text();if(text.length>8000000)throw Error('school_format_changed');let value;
     try{value=JSON.parse(text);}catch{throw Error('needs_login');}
     const info=value?.datas?.[key];if(!info||!Array.isArray(info.rows))throw Error('school_format_changed');
     if(info.extParams?.code!==undefined&&String(info.extParams.code)!=='1')throw Error('school_format_changed');
     if(total===null&&info.totalSize!==undefined){total=Number(info.totalSize);if(!Number.isFinite(total)||total<0||total>20000)throw Error('school_format_changed');}
     result.push(...info.rows);if(result.length>20000)throw Error('school_format_changed');
     if(total!==null&&result.length>=total)return result;
     if(info.rows.length<500){if(total!==null&&result.length<total)throw Error('school_format_changed');return result;}
    }finally{clearTimeout(timer);}
   }throw Error('school_format_changed');
  }
  const semester=String((await rows('jshkcb/dqxnxq.do','dqxnxq',{}))[0]?.DM||'');if(!/^\d{4}-\d{4}-[12]$/.test(semester))throw Error('school_format_changed');
  onProgress({stage:'authenticated',step:1});
  const parts=semester.split('-'),calendar=(await rows('jshkcb/cxjcs.do','cxjcs',{XN:parts[0]+'-'+parts[1],XQ:parts[2]}))[0];if(!calendar?.XQKSRQ)throw Error('school_format_changed');
  // Omit XH: read the browser's authenticated student's own timetable, then verify returned identity.
  const courses=await rows('xskcb/xskcb.do','xskcb',{XNXQDM:semester});
  if(!courses.length||courses.some(row=>!row.XH))throw Error('identity_unverified');
  if(courses.some(row=>String(row.XH)!==account))throw Error('account_mismatch');
  const changes=await rows('xskcb/xsdkkc.do','xsdkkc',{XNXQDM:semester,'*order':'-SQSJ'}),notArranged=await rows('xskcb/cxxsllsywpk.do','cxxsllsywpk',{XNXQDM:semester});
  onProgress({stage:'validating',step:5});
  const pick=(row,keys)=>Object.fromEntries(keys.filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));
  return {ok:true,account,semester,calendar:{XQKSRQ:calendar.XQKSRQ,XQJSRQ:calendar.XQJSRQ},courses:courses.map(row=>pick(row,courseKeys)),changes:changes.map(row=>pick(row,changeKeys)),notArranged:notArranged.map(row=>pick(row,['KCM','KCH']))};
 }
 root.TimetableReader={readTimetable};if(typeof module==='object')module.exports={readTimetable};
})(globalThis);
