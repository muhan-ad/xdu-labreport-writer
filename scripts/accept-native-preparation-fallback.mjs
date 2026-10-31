import fs from 'node:fs';import assert from 'node:assert/strict';import {android,connectAndroid,pause} from './lib/android-cdp.mjs';
const output='artifacts/verification/native-preparation-fallback-099';fs.mkdirSync(output,{recursive:true});
const catalog=JSON.parse(fs.readFileSync('src/data/catalog.json','utf8'));
const id=name=>catalog.experiments.find(e=>e.name===name).id;
let c;
try {
 android('shell','am','start','-n','com.labmaker.app/.MainActivity');
 for(let i=0;i<50;i++){try{c=await connectAndroid(9283,0);await c.wait("!!document.querySelector('.app-header')");break}catch(error){c?.close();c=null;if(i===49)throw error;await pause(200)}}
 await c.ev(`(()=>{const original=Capacitor.nativePromise;window.__preparationTest={original,urls:[]};Capacitor.nativePromise=function(plugin,method,args){if(plugin==='Browser'&&method==='open'){window.__preparationTest.urls.push(args.url);return Promise.resolve({})}if(!['Filesystem','App'].includes(plugin))return Promise.reject(Error('External operation blocked'));return original.call(this,plugin,method,args)}})()`);
 const open=async name=>{await c.ev(`location.hash=${JSON.stringify('#/experiment/'+id(name))}`);await c.wait("!!document.querySelector('[data-action=prepare]')")};
 await open('劈尖干涉');await c.click('[data-action=prepare]');await c.wait("document.querySelector('#modal').open");
 assert.match(await c.ev("document.querySelector('#modal').textContent"),/暂未匹配/);
 fs.writeFileSync(output+'/fallback.png',android('exec-out','screencap','-p'));
 await c.click('#modal [data-dialog-close]');assert.equal(await c.ev('__preparationTest.urls.length'),0);
 await c.click('[data-action=prepare]');await c.wait("document.querySelector('#modal').open");await c.click('#modal [data-dialog-confirm]');await c.wait('__preparationTest.urls.length===1');
 assert.equal(await c.ev('__preparationTest.urls[0]'),'https://wlsyzx.xidian.edu.cn/expe/index.html');
 await open('光的偏振特性测量（第二学期）');await c.click('[data-action=prepare]');await c.wait('__preparationTest.urls.length===2');
 assert.equal(await c.ev('__preparationTest.urls[1]'),'https://wlsyzx.xidian.edu.cn/expe/experiment.html?id=5');
 fs.writeFileSync(output+'/results.json',JSON.stringify({checks:4,scope:'real Android UI, mocked Browser.open',schoolWrites:0},null,2));console.log(JSON.stringify({passed:4,output}));
} finally {if(c){await c.ev("if(window.__preparationTest){Capacitor.nativePromise=window.__preparationTest.original;delete window.__preparationTest}").catch(()=>{});c.close()}}
