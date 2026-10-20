'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const integrity=require('../src/shared/report-integrity');
const source=fs.readFileSync(path.join(__dirname,'../src/renderer.js'),'utf8').replace(/\r\n/g,'\n'),start=source.indexOf('async function ensureCustomQuizAnswers(exp)'),end=source.indexOf('\n}\n',start)+2;
function harness(content, proceed=false){
 const log={textContent:''},events=[],toasts=[];
 const context={console,Set,Date,JSON,Object,String,reportIntegrity:integrity,skillsCache:[],customQuizRequestIds:new Set(),
 expCustomQuiz:()=>['测量原理是什么？'],loadSettings:()=>({hasApiKey:true,kbOnly:false}),
 getExperimentCalculationContext:async()=>({c_n:1,r_0:100,r_mohm:94.0195875}),
 $:()=>log,logEvent:s=>events.push(s),showToast:(...args)=>toasts.push(args),
 getAiStylePrompt:()=>'',expUserPrompt:()=>'',document:{querySelector:()=>null},
 window:{crypto:null,labAPI:{aiChat:async()=>({ok:true,content})}},appConfirm:async()=>proceed};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 return {context,log,events,toasts,run:()=>context.ensureCustomQuizAnswers({id:'电容与高电阻的测量'})};
}
test('conflicting answer can be left blank while another answer survives',async()=>{
 const h=harness('1. 原理？\n答：本次测得电阻10.48 MΩ。\n2. 方法？\n答：采用放电法。',true);const result=await h.run();
 assert.equal(result.stop,undefined);assert.equal(result.answers['1'],undefined);assert.deepEqual(JSON.parse(JSON.stringify(result.answers['2'])),['采用放电法。']);
 assert.match(h.events.join('\n'),/phase=numeric-validation.*question=1.*token=10.48/);
 assert.doesNotMatch(h.events.join('\n'),/本次测得|原理？/);
});
test('only explicit user stop ends report generation after a hard failure',async()=>{
 const h=harness('1. 原理？\n答：%%DATA:missing:%.2f%%',false);const result=await h.run();
 assert.equal(result.stop,true);assert.equal(result.reason,'user-stop');
});
test('uncertain values warn but preserve successful AI output without confirmation',async()=>{
 const h=harness('1. 原理？\n答：仪器精度为0.01 mV。');const result=await h.run();
 assert.equal(result.stop,undefined);assert.match(result.answers['1'][0],/0.01/);assert.match(h.events.join('\n'),/numeric-advisory/);
});
test('bound measured quantities pass unchanged and do not call API again',async()=>{
 const h=harness('1. 测量原理是什么？\n答：测得电阻 %%DATA:r_mohm:%.2f%% MΩ。');const result=await h.run();
 assert.equal(result.stop,undefined);assert.deepEqual(JSON.parse(JSON.stringify(result.answers)),{'1':['测得电阻 %%DATA:r_mohm:%.2f%% MΩ。']});
 assert.equal(h.events.length,0);
});
test('ordinary symbolic constants can explain a rejection; no relaxation of integrity guard',()=>{
 assert.doesNotThrow(()=>integrity.validateText('$Q(0)/Q_0=1$，这是初始条件。',{c_n:1}));
 assert.match(source,/cq.reason === 'user-stop'/);
});
