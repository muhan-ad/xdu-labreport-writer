import assert from 'node:assert/strict';import fs from 'node:fs';import {openBrowserTest} from './browser-test-harness.mjs';
const out='artifacts/verification/report-platform-routing';fs.mkdirSync(out,{recursive:true});const results=[];
for(const platform of ['ios','android','web']){
 const init=`window.CapacitorCustomPlatform={name:${JSON.stringify(platform)}};window.calls=[];window.mode='ok';window.Capacitor={PluginHeaders:[{name:'Filesystem',methods:['readFile','writeFile','deleteFile'].map(name=>({name,rtype:'promise'}))},{name:'Share',methods:[{name:'share',rtype:'promise'}]},{name:'LabReportFiles',methods:['open','directoryStatus','chooseDirectory','saveToDirectory'].map(name=>({name,rtype:'promise'}))}],nativePromise:async(p,m,a)=>{calls.push({p,m,a});if(p==='Filesystem'&&m==='readFile'){if(mode==='missing')throw Error('does not exist');return {data:'UEsDBA=='};}if(p==='Filesystem'&&m==='writeFile')return {uri:mode==='no-uri'?'':'file:///cache/'+a.path};if(p==='Filesystem'&&m==='deleteFile')return {};if(p==='Share'){if(mode==='cancel')throw Error('Share canceled');return {activityType:'example'};}if(p==='LabReportFiles'&&m==='directoryStatus')return {configured:true,writable:true,name:'mock'};if(p==='LabReportFiles'&&m==='saveToDirectory')return {name:a.name,bytes:4,verified:true};if(p==='LabReportFiles'&&m==='open')return {};throw Error('unexpected bridge '+p+' '+m)}};`;
 const b=await openBrowserTest(process.cwd(),'tests/fixtures/report-platform-routing.ts','<main></main>',{initScript:init});try{
  await b.evaluate("import('/test.mjs').then(m=>{window.api=m;return true})");
  if(platform==='ios'){
   await b.evaluate('api.open()');let calls=await b.evaluate('window.calls');assert.deepEqual(calls.map(x=>x.p+':'+x.m),['Filesystem:readFile','Filesystem:writeFile','Share:share']);assert.equal(calls[1].a.data,'UEsDBA==');assert.ok(calls[2].a.files[0].startsWith('file:///cache/report-exports/'));assert.ok(!calls.some(x=>x.p==='LabReportFiles'));
   await b.evaluate('calls.length=0');const saved=await b.evaluate('api.save()');assert.deepEqual(saved,{mode:'share'});calls=await b.evaluate('calls');assert.equal(calls.at(-1).p,'Share');
   await b.evaluate("calls.length=0;mode='cancel'");assert.match(await b.evaluate("api.save().then(()=>'',e=>e.message)"),/已取消分享/);assert.equal((await b.evaluate('calls')).filter(x=>x.p==='Share').length,1);
   await b.evaluate("calls.length=0;mode='missing'");assert.match(await b.evaluate("api.open().then(()=>'',e=>e.message)"),/does not exist/);assert.equal((await b.evaluate('calls')).length,1);results.push('iOS routes through system share and never reports verified save, including cancel and missing file');
  }else if(platform==='android'){
   await b.evaluate('api.open()');assert.deepEqual((await b.evaluate('calls')).map(x=>x.p+':'+x.m),['LabReportFiles:open']);await b.evaluate('calls.length=0');const saved=await b.evaluate('api.save()');assert.equal(saved.mode,'saved');assert.equal(saved.verified,true);assert.deepEqual((await b.evaluate('calls')).map(x=>x.m),['directoryStatus','saveToDirectory']);results.push('Android keeps native open and verified directory save');
  }else{assert.match(await b.evaluate("api.open().then(()=>'',e=>e.message)"),/保存/);assert.match(await b.evaluate("api.save().then(()=>'',e=>e.message)"),/分享/);results.push('unsupported web does not pretend to save');}
  if(platform!=='web'){
   await b.evaluate("calls.length=0;mode='ok';Promise.all([api.share(),api.share(),api.chart(1),api.chart(9)])");
   const writes=(await b.evaluate('calls')).filter(x=>x.p==='Filesystem'&&x.m==='writeFile');
   assert.equal(writes.length,4);assert.equal(new Set(writes.map(x=>x.a.path)).size,4);
   assert.deepEqual(writes.filter(x=>x.a.path.startsWith('chart-exports/')).map(x=>x.a.data).sort(),['AQID','CQID']);
   assert.ok(writes.filter(x=>x.a.path.startsWith('report-exports/')).every(x=>x.a.path.endsWith('/示例报告.docx')));
   await b.evaluate("calls.length=0;mode='cancel'");assert.match(await b.evaluate("api.chart(1).then(()=>'',e=>e.message)"),/已取消分享/);
   await b.evaluate("calls.length=0;mode='no-uri'");assert.match(await b.evaluate("api.share().then(()=>'',e=>e.message)"),/分享文件准备失败/);const failed=await b.evaluate('calls');assert.ok(failed.some(x=>x.m==='deleteFile'));assert.ok(!failed.some(x=>x.p==='Share'));
   results.push(platform+' isolates same-name report and chart shares; cancelled chart reports Chinese feedback');
  }
  assert.equal(b.errors.length,0);
 }finally{await b.close()}
}
fs.writeFileSync(out+'/results.json',JSON.stringify({results,scope:'browser mock native bridges; no iOS device or real external destination'},null,2));console.log(JSON.stringify({passed:results.length,out}));
