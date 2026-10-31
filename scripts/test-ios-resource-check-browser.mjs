import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {openBrowserTest} from './browser-test-harness.mjs';
const root=path.resolve(import.meta.dirname,'..'),version=JSON.parse(fs.readFileSync('package.json','utf8')).version,out=path.join(root,'artifacts/verification/ios-resource-ui');fs.mkdirSync(out,{recursive:true});
const init=`(()=>{
 window.CapacitorCustomPlatform={name:'ios'};window.resourceMode='ok';window.reads=[];
 const files={'index.html':'首页','report-worker.js':'worker','report-runtime/manifest.json':'manifest','report-runtime/pyodide.asm.wasm':'wasm'};
 window.fetch=async(path,options={})=>{const name=decodeURIComponent(String(path).replace(/^\\.\\//,''));window.reads.push(name);
  if(name==='web-resource-integrity.json'){const entries=[];for(const [path,text] of Object.entries(files)){const bytes=new TextEncoder().encode(text),digest=await crypto.subtle.digest('SHA-256',bytes);entries.push({path,bytes:bytes.length,sha256:[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')})}return new Response(JSON.stringify({schema:1,version:${JSON.stringify(version)},scope:'shared-web-resources',files:entries}));}
  if(window.resourceMode==='slow'&&name==='index.html')return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
  if(window.resourceMode==='missing'&&name==='report-worker.js')return new Response('',{status:404});return new Response(files[name]??'',{status:name in files?200:404});
 };
})()`;
const b=await openBrowserTest(root,'tests/fixtures/ios-resource-check-ui.ts','<main id="app"><div id="resource-host"></div></main>',{initScript:init});
const click=action=>b.evaluate(`document.querySelector('[data-resource="${action}"]').click()`),ready=()=>b.wait("!document.querySelector('[data-resource=check]').disabled");
try{
 await b.evaluate("import('/test.mjs').then(m=>{window.fixture=m.openResourceCheck()})");await ready();assert.equal(await b.evaluate("document.querySelector('[data-resource=refresh]').hidden"),true);assert.match(await b.evaluate("document.querySelector('#resource-host').textContent"),/不包含系统与原生组件/);
 await click('check');await ready();assert.match(await b.evaluate("document.querySelector('#resource-result').textContent"),/共享资源完整/);assert.equal(await b.evaluate("document.querySelector('#resource-result').textContent.includes('4 / 4')"),true);
 await b.evaluate("resourceMode='missing'");await click('check');await ready();assert.match(await b.evaluate("document.querySelector('#resource-result').textContent"),/共享资源不完整/);assert.match(await b.evaluate("document.querySelector('#resource-result').textContent"),/report-worker.js/);
 await b.evaluate("resourceMode='slow';reads=[]");await click('check');await b.wait("reads.includes('index.html')");await click('cancel');await ready();assert.match(await b.evaluate("document.querySelector('#resource-result').textContent"),/已停止/);
 await b.evaluate("resourceMode='ok'");await click('check');await ready();assert.match(await b.evaluate("document.querySelector('#resource-result').textContent"),/共享资源完整/);
 for(const width of [320,390,768,1024]){await b.cdp('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:true});assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);const shot=await b.cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,`${width}.png`),Buffer.from(shot.data,'base64'));}
 assert.equal(b.errors.length,0);console.log(JSON.stringify({passed:5,scope:'iOS-labelled production UI and checker using simulated local assets; no iOS runtime'}));
}finally{await b.close()}
