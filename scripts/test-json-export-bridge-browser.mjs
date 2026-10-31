import assert from 'node:assert/strict';
import path from 'node:path';
import {openBrowserTest} from './browser-test-harness.mjs';

for (const platform of ['android','ios']) {
  const initScript = `(()=>{
    window.CapacitorCustomPlatform={name:${JSON.stringify(platform)}};
    window.fakeFiles={};window.fakeShares=[];window.badRead=false;
    const header=(name,methods)=>({name,methods:methods.map(name=>({name,rtype:'promise'}))});
    window.Capacitor={PluginHeaders:[header('Filesystem',['writeFile','readFile','deleteFile']),header('Share',['share'])],
      nativePromise:async(plugin,method,args)=>{
        if(plugin==='Filesystem'&&method==='writeFile'){window.fakeFiles[args.path]=args.data;return {uri:'file:///'+args.path};}
        if(plugin==='Filesystem'&&method==='readFile')return {data:window.badRead?'损坏':window.fakeFiles[args.path]};
        if(plugin==='Filesystem'&&method==='deleteFile'){delete window.fakeFiles[args.path];return {};}
        if(plugin==='Share'&&method==='share'){window.fakeShares.push(args);return {};}
        throw Error('Unexpected native call');
      }};
  })()`;
  const b=await openBrowserTest(path.resolve(import.meta.dirname,'..'),'tests/fixtures/json-export-ui.ts','<main></main>',{initScript});
  try {
    await b.evaluate("import('/test.mjs').then(m=>window.fixture=m)");
    await b.evaluate("Promise.all([fixture.run({实验:'甲'}),fixture.run({实验:'乙'})])");
    const result=await b.evaluate("({files:fakeFiles,shares:fakeShares})");
    assert.equal(Object.keys(result.files).length,2);assert.equal(result.shares.length,2);
    assert.notEqual(result.shares[0].files[0],result.shares[1].files[0]);
    assert.deepEqual(Object.values(result.files).map(x=>JSON.parse(x).实验).sort(),['乙','甲'].sort());
    await b.evaluate('window.badRead=true');
    const failed=await b.evaluate("fixture.run({实验:'丙'}).then(()=>false,e=>e.message.includes('核对失败'))");
    assert.equal(failed,true);assert.equal(await b.evaluate('fakeShares.length'),2);assert.equal(await b.evaluate('Object.keys(fakeFiles).length'),2);
    assert.equal(b.errors.length,0);
    console.log(JSON.stringify({platform,passed:3,scope:'production export with simulated Capacitor bridge'}));
  } finally {await b.close();}
}
