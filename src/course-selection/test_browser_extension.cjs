const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ext=path.join(__dirname,'../../browser-extension'),{readTimetable}=require(path.join(ext,'reader'));
const account='12345678901';
function fixture(overrides={}){const calls=[];const payloads={dqxnxq:[{DM:'2026-2027-1'}],cxjcs:[{XQKSRQ:'2026-09-07'}],xskcb:[{XH:account,KCM:'高数',KCH:'M',SKZC:'111',SKXQ:'4',KSJC:'7',JSJC:'8',password:'NEVER_EXPORT'}],xsdkkc:[],cxxsllsywpk:[],...overrides};
 const fetcher=async(url,options)=>{calls.push({url,options});const key=new URL(url).pathname.split('/').pop().split('.')[0];return {ok:true,status:200,text:async()=>JSON.stringify({datas:{[key]:{rows:payloads[key],totalSize:payloads[key].length}}})};};return {calls,fetcher};}
test('extension requests only fixed read-only school endpoints with browser credentials and exports narrow timetable fields',async()=>{
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
test('extension permissions exclude cookies, browser history and arbitrary site access',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(ext,'manifest.json'),'utf8'));assert.deepEqual(manifest.permissions,['storage']);assert.deepEqual(manifest.host_permissions,['https://ehall.xidian.edu.cn/*']);
});
test('untrusted websites, subframes, local ports without a bridge token and foreign navigation cannot invoke school reader',async()=>{
 const store={},sent=[];const context={console,Map,URL,TimetableReader:{readTimetable:async()=>{throw Error('reader must not run')}},importScripts(){},chrome:{storage:{session:{get:async key=>key?{[key]:store[key]}:store,set:async value=>Object.assign(store,value),remove:async key=>delete store[key]}},runtime:{onMessage:{addListener(){}}},tabs:{onRemoved:{addListener(){}},sendMessage:async(...args)=>sent.push(args),create:async()=>{}}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(ext,'background.js'),'utf8'),context);
 for(const sender of [{url:'https://evil.example/academic-connect',frameId:0,tab:{id:1}},{url:'http://127.0.0.1:1234/',frameId:0,tab:{id:1}},{url:'http://127.0.0.1:1234/academic-connect',frameId:1,tab:{id:1}}])assert.equal((await context.handle({type:'read-timetable',account},sender)).ok,false);
 const sender={url:'http://127.0.0.1:1234/academic-connect',frameId:0,tab:{id:1}};assert.equal((await context.handle({type:'bridge-hello',token:'wrong'},sender)).ok,false);
 assert.equal((await context.handle({type:'bridge-hello',token:'a'.repeat(43)},sender)).ok,true);
 assert.equal((await context.handle({type:'read-timetable',account},{...sender,url:'http://127.0.0.1:1235/academic-connect'})).ok,false);
 assert.equal(sent.length,0);
});
