import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {android,connectAndroid,pause} from './lib/android-cdp.mjs';
import {recordBlank} from '../src/domain/model.ts';import {defaultReportSettings,reportFilename} from '../src/domain/reports.ts';

const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const pkg='com.labmaker.app.acceptance';let installed=false;
const out='artifacts/verification/native-report-share-'+version+'-'+Date.now();fs.mkdirSync(out,{recursive:true});
const namespace='acceptance-share-'+crypto.randomUUID();
const exp=JSON.parse(fs.readFileSync('src/data/catalog.json','utf8')).experiments[0];
const source=fs.readFileSync('artifacts/verification/upload-source.docx');
const docs=[source,Buffer.concat([source,Buffer.from('version-two')])];
const reports=docs.map(()=>({version:1,experimentId:exp.id,generation:crypto.randomUUID(),createdAt:new Date().toISOString(),name:reportFilename(exp.name),formulaCount:0,sections:{},charts:[],snapshot:{record:recordBlank(exp),profile:{name:'本地测试',studentId:'001234',className:'测试'},photoPath:null,settings:defaultReportSettings()}}));
let c;
const top=()=>android('shell','dumpsys','activity','activities').toString();
async function chooser(){for(let i=0;i<80;i++){if(/topResumedActivity=[^\n]*(ChooserActivity|ResolverActivity)/.test(top()))return;await pause(150)}throw Error('System share sheet did not open')}
try {
 assert.equal(android('shell','pm','list','packages',pkg).toString().trim(),'');android('install','android/app/build/outputs/apk/acceptance/app-acceptance.apk');installed=true;
 android('shell','am','start','-n',pkg+'/com.labmaker.app.MainActivity');
 for(let i=0;i<50;i++){try{c=await connectAndroid(9284,0,pkg);await c.wait("!!document.querySelector('.app-header')");break}catch(e){c?.close();c=null;if(i===49)throw e;await pause(200)}}
 await c.ev(`(()=>{const original=Capacitor.nativePromise;window.__shareAcceptance={original,paths:[],uris:[]};Capacitor.nativePromise=function(plugin,method,args={}){if(plugin==='Filesystem'){args={...args};if(method==='writeFile'&&args.path?.startsWith('report-exports/'))window.__shareAcceptance.paths.push(args.path);for(const k of ['path','from','to'])if(typeof args[k]==='string'&&!args[k].startsWith('file:'))args[k]=${JSON.stringify(namespace)}+'/'+args[k]}else if(plugin==='Share'&&method==='share')window.__shareAcceptance.uris.push(args.files[0]);else if(plugin!=='App')return Promise.reject(Error('External operation blocked'));return original.call(this,plugin,method,args)}})()`);
 const file=async(method,args)=>c.ev(`Capacitor.nativePromise('Filesystem',${JSON.stringify(method)},${JSON.stringify(args)})`);
 const write=async(path,data,directory='LIBRARY_NO_CLOUD')=>file('writeFile',{path,directory,data:Buffer.from(data).toString('base64'),recursive:true});
 const envelope=async(report,revision)=>{const payload=JSON.stringify(report),value=JSON.stringify({revision,payload:report,digest:crypto.createHash('sha256').update(payload).digest('hex')});for(const slot of ['a','b'])await write(`lab-maker/v1/report-${exp.id}-${slot}.json`,value)};
 for(let i=0;i<2;i++)await write(`lab-maker/v1/reports/${exp.id}/${reports[i].generation}/report.docx`,docs[i]);
 await envelope(reports[0],Date.now());
 await c.ev("location.hash='/settings'");await c.wait("!!document.querySelector('[data-action=report-manager]')");await c.click('[data-action=report-manager]');await c.wait(`!!document.querySelector('[data-managed=share][data-id="${exp.id}"]')&&!document.querySelector('[data-managed=refresh]').disabled`);
 async function share(){await c.click(`[data-managed=share][data-id="${exp.id}"]`);await chooser();android('shell','input','keyevent','KEYCODE_BACK');await c.wait("!document.querySelector('[data-managed=refresh]').disabled")}
 await share();await envelope(reports[1],Date.now()+10000);await c.click('[data-managed=refresh]');await c.wait("!document.querySelector('[data-managed=refresh]').disabled");await share();
 const observed=await c.ev('({paths:__shareAcceptance.paths,uris:__shareAcceptance.uris})');assert.equal(observed.paths.length,2);assert.notEqual(observed.paths[0],observed.paths[1]);assert.notEqual(observed.uris[0],observed.uris[1]);
 for(let i=0;i<2;i++){const r=await file('readFile',{path:observed.paths[i],directory:'CACHE'});assert.deepEqual(Buffer.from(r.data,'base64'),docs[i]);}
 fs.writeFileSync(out+'/results.json',JSON.stringify({version,passed:3,scope:'real Android UI and Filesystem with isolated data; share chooser cancelled',schoolMutations:0,paidApiCalls:0},null,2));console.log(JSON.stringify({passed:3,out}));
} finally {
 for(let i=0;i<3&&/topResumedActivity=[^\n]*(ChooserActivity|ResolverActivity)/.test(top());i++){android('shell','input','keyevent','KEYCODE_BACK');await pause(150)}
 if(c){await c.ev(`(()=>{if(!window.__shareAcceptance)return;const previous=window.__shareAcceptance.original;Capacitor.nativePromise=previous;delete window.__shareAcceptance;return Promise.allSettled(['LIBRARY_NO_CLOUD','CACHE'].map(directory=>previous.call(Capacitor,'Filesystem','rmdir',{directory,path:${JSON.stringify(namespace)},recursive:true})))})()`).catch(()=>{});await c.call('Page.reload').catch(()=>{});c.close()}
 if(installed)android('uninstall',pkg);
}
