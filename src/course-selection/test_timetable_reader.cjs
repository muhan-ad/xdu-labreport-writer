const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {readTimetable}=require('./timetable_reader');
const account='12345678901';
function fixture(overrides={}){const calls=[];const payloads={dqxnxq:[{DM:'2026-2027-1'}],cxjcs:[{XQKSRQ:'2026-09-07'}],xskcb:[{XH:account,KCM:'高数',KCH:'M',SKZC:'111',SKXQ:'4',KSJC:'7',JSJC:'8',password:'NEVER_EXPORT'}],xsdkkc:[],cxxsllsywpk:[],...overrides};
 const fetcher=async(url,options)=>{calls.push({url,options});const key=new URL(url).pathname.split('/').pop().split('.')[0];return {ok:true,status:200,text:async()=>JSON.stringify({datas:{[key]:{rows:payloads[key],totalSize:payloads[key].length}}})};};return {calls,fetcher};}
test('dedicated Edge requests only fixed read-only school endpoints with browser credentials and exports narrow timetable fields',async()=>{
 const f=fixture(),result=await readTimetable(account,f.fetcher);assert.equal(f.calls.length,5);assert.equal(result.account,account);assert.doesNotMatch(JSON.stringify(result),/NEVER_EXPORT|password/);
 for(const c of f.calls){assert.equal(new URL(c.url).hostname,'ehall.xidian.edu.cn');assert.equal(c.options.credentials,'include');assert.equal(c.options.body.has('XH'),false);}
 assert.equal(result.courses[0].XH,account);
});
test('wrong or unverifiable browser account never imported',async()=>{
 await assert.rejects(readTimetable(account,fixture({xskcb:[{XH:'999999999'}]}).fetcher),/account_mismatch/);
 await assert.rejects(readTimetable(account,fixture({xskcb:[{KCM:'高数'}]}).fetcher),/identity_unverified/);
 await assert.rejects(readTimetable(account,fixture({xskcb:[]}).fetcher),/identity_unverified/);
});
test('login and rate-limit failures do not claim success',async()=>{
 await assert.rejects(readTimetable(account,async()=>({ok:false,status:401})),/needs_login/);
 await assert.rejects(readTimetable(account,async()=>({ok:false,status:429})),/rate_limited/);
 await assert.rejects(readTimetable(account,async()=>({ok:true,status:200,text:async()=>'<html>login</html>'})),/needs_login/);
});
test('reader emits actual request stages; completion waits for application validation',async()=>{
 const f=fixture(),progress=[];await readTimetable(account,f.fetcher,p=>progress.push(p));
 assert.deepEqual([...new Set(progress.filter(p=>p.stage==='reading').map(p=>p.step))],[1,2,3,4,5]);
 assert.ok(progress.some(p=>p.stage==='authenticated'));assert.equal(progress.at(-1).stage,'validating');assert.ok(!progress.some(p=>p.stage==='complete'));
 const failed=[];await assert.rejects(readTimetable(account,async()=>({ok:false,status:401}),p=>failed.push(p)),/needs_login/);assert.ok(!failed.some(p=>p.stage==='authenticated'));
});
