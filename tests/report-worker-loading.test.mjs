import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {createHash,webcrypto} from 'node:crypto';
const source=fs.readFileSync(new URL('../public/report-worker.js',import.meta.url),'utf8');
async function run({corrupt,override}={}){
 const names=['pyodide.js','pyodide.asm.js','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json','a.whl','b.whl','c.whl','d.whl','report-sources.json','LabMakerSansSC.ttf','catalog.json','chart_preview.py','insert_chart.py','ai_plot.py','variant_edits.py','runner.py'];
 const bytes=Object.fromEntries(names.map(n=>[n,new TextEncoder().encode(n)])),files=Object.fromEntries(names.map(n=>[n,{sha256:createHash('sha256').update(bytes[n]).digest('hex')}]));
 let active=0,max=0;const fetched=[],written=[],unpacked=[],messages=[];const py={globals:new Map(),FS:{mkdirTree(){},writeFile:(path,value)=>written.push({path,value})},runPython:()=>'/site',runPythonAsync:async text=>text==='diagnose_runtime()'?JSON.stringify({complete:true}):undefined,loadPackage:async()=>{}};
 const self={location:{href:'https://localhost/report-worker.js'},postMessage:m=>messages.push(m)};
 const context=vm.createContext({self,URL,TextDecoder,Uint8Array,crypto:webcrypto,atob,importScripts:()=>{assert.ok(names.slice(0,5).every(n=>fetched.includes(n)))},loadPyodide:async()=>py,fetch:async url=>{const name=String(url).split('/').at(-1);if(name==='manifest.json')return {json:async()=>({files,pureWheels:['a.whl','b.whl','c.whl','d.whl']})};active++;max=Math.max(max,active);return {ok:true,arrayBuffer:async()=>{await new Promise(r=>setTimeout(r,name==='a.whl'?12:2));active--;fetched.push(name);return (name===corrupt?new TextEncoder().encode('bad'):bytes[name]).buffer}}}});
 py.unpackArchive=value=>unpacked.push(new TextDecoder().decode(value));vm.runInContext(source,context);await self.onmessage({data:{job:{mode:'diagnostic'},dataPackage:override}});return {max,fetched,written,unpacked,messages};
}
test('real worker installs verified wheels in manifest order and finishes diagnostic only after runtime files are ready',async()=>{
 const r=await run();assert.deepEqual(r.unpacked,['a.whl','b.whl','c.whl','d.whl']);assert.deepEqual(r.written.map(x=>x.path),['report-sources.json','LabMakerSansSC.ttf','catalog.json','chart_preview.py','insert_chart.py','ai_plot.py','variant_edits.py'].map(n=>'/lab/'+n));assert.equal(r.messages.at(-1).type,'diagnostic-result');assert.equal(r.messages.at(-1).diagnostic.complete,true);
});
test('real worker rejects a corrupt wheel before accepting a diagnostic result',async()=>{
 const r=await run({corrupt:'b.whl'});assert.equal(r.messages.at(-1).type,'error');assert.match(r.messages.at(-1).message,/校验失败.*b.whl/);assert.equal(r.messages.some(m=>m.type==='diagnostic-result'),false);assert.equal(r.unpacked.includes('b.whl'),false);
});
test('verified data-package overrides still replace source, catalog and font without fetching bundled equivalents',async()=>{
 const r=await run({override:{sources:{test:'source'},catalog:{test:'catalog'},fontBase64:Buffer.from('font').toString('base64')}});for(const n of ['report-sources.json','catalog.json','LabMakerSansSC.ttf'])assert.equal(r.fetched.includes(n),false);assert.equal(r.written.find(x=>x.path.endsWith('report-sources.json')).value,JSON.stringify({test:'source'}));assert.equal(new TextDecoder().decode(r.written.find(x=>x.path.endsWith('.ttf')).value),'font');assert.equal(r.messages.at(-1).type,'diagnostic-result');
});

