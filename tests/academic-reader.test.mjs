import fs from 'node:fs';import vm from 'node:vm';import test from 'node:test';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../src/native/timetable-reader.js',import.meta.url),'utf8'),sandbox={URL,URLSearchParams,AbortController,setTimeout,clearTimeout};vm.createContext(sandbox);vm.runInContext(source,sandbox);const read=sandbox.TimetableReader.readTimetable,account='12345678901';
function fixture(overrides={}){const calls=[],data={dqxnxq:[{DM:'2026-2027-1'}],cxjcs:[{XQKSRQ:'2026-09-07'}],xskcb:[{XH:account,KCM:'高数',KCH:'M',SKZC:'111',SKXQ:'4',KSJC:'7',JSJC:'8',password:'FIXTURE_NOT_EXPORTED',SSOTicket:'FIXTURE_TICKET'}],xsdkkc:[],cxxsllsywpk:[],...overrides};const fetcher=async(url,options)=>{calls.push({url,options});const key=new URL(url).pathname.split('/').at(-1).split('.')[0];return {ok:true,status:200,text:async()=>JSON.stringify({datas:{[key]:{rows:data[key],totalSize:data[key].length}}})};};return {calls,fetcher};}
test('academic reader only uses five fixed read endpoints and exports narrow fields',async()=>{
 const f=fixture(),progress=[],r=await read(account,f.fetcher,p=>progress.push(p));assert.equal(f.calls.length,5);assert.equal(r.account,account);assert.doesNotMatch(JSON.stringify(r),/password|SSOTicket|FIXTURE_NOT_EXPORTED|FIXTURE_TICKET/);
 for(const c of f.calls){assert.equal(new URL(c.url).origin,'https://ehall.xidian.edu.cn');assert.equal(c.options.credentials,'include');assert.equal(c.options.method,'POST');assert.equal(c.options.body.has('XH'),false);assert.equal(c.options.redirect,'manual');}
 assert.deepEqual([...new Set(progress.filter(p=>p.stage==='reading').map(p=>p.step))],[1,2,3,4,5]);assert.equal(progress.at(-1).stage,'validating');assert.ok(!progress.some(p=>p.stage==='complete'));
});
test('wrong missing or empty authenticated identity cannot be imported',async()=>{
 for(const rows of [[{XH:'99999999999'}],[{KCM:'高数'}],[]])await assert.rejects(read(account,fixture({xskcb:rows}).fetcher),/account_mismatch|identity_unverified/);
 await assert.rejects(read('invalid',fixture().fetcher),/account_mismatch/);
});
test('expired authentication rate limiting and incomplete pagination reject success',async()=>{
 await assert.rejects(read(account,async()=>({status:401,ok:false})),/needs_login/);await assert.rejects(read(account,async()=>({status:429,ok:false})),/rate_limited/);
 await assert.rejects(read(account,async()=>({status:200,ok:true,text:async()=>'<html>login</html>'})),/needs_login/);
 await assert.rejects(read(account,async()=>({status:200,ok:true,text:async()=>JSON.stringify({datas:{dqxnxq:{rows:[{DM:'2026-2027-1'}],totalSize:2}}})})),/school_format_changed/);
});
test('pagination awaits every page and never returns partial course results',async()=>{
 const base=fixture(),pages=[];
 const fetcher=async(url,options)=>{if(!url.endsWith('xskcb/xskcb.do'))return base.fetcher(url,options);const page=Number(options.body.get('pageNumber'));pages.push(page);return {ok:true,status:200,text:async()=>JSON.stringify({datas:{xskcb:{rows:Array.from({length:page===1?500:1},(_,i)=>({XH:account,KCH:'C'+(page*500+i),KCM:'课程'})),totalSize:501}}})};};
 const result=await read(account,fetcher);assert.equal(result.courses.length,501);assert.deepEqual(pages,[1,2]);
});
