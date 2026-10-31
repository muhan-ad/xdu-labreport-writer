// Native chooser -> external-UID FileProvider reader -> real Android file picker.
// Test data only, all main-app writes redirected to a unique namespace.
import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {android,connectAndroid,pause} from './lib/android-cdp.mjs';
import {parseHTML} from 'linkedom';
const out='artifacts/verification/native-skill-files-'+Date.now();fs.mkdirSync(out,{recursive:true});
const namespace='acceptance-skills-'+crypto.randomUUID(),receiver='com.labmaker.app.acceptance';
const folder='LabMakerSkills-'+crypto.randomUUID().slice(0,8),downloads='/sdcard/Download/'+folder;
const hierarchy='/data/local/tmp/'+folder+'.xml',checks=[];let c,installed=false,files=[];
const hook=`(()=>{const original=Capacitor.nativePromise;window.__skillAcceptance={original,shares:[]};Capacitor.nativePromise=function(plugin,method,args={}){if(plugin==='Filesystem'){args={...args};for(const k of ['path','to','from'])if(typeof args[k]==='string'&&!args[k].startsWith('file:'))args[k]=${JSON.stringify(namespace)}+'/'+args[k]}else if(plugin==='Share'){if(method==='share')window.__skillAcceptance.shares.push(args)}else if(plugin!=='App')return Promise.reject(Error('External operation blocked in local file acceptance'));return original.call(this,plugin,method,args)}})()`;
const top=()=>android('shell','dumpsys','activity','activities').toString();
async function uiNodes(){android('shell','uiautomator','dump',hierarchy);const xml=android('exec-out','cat',hierarchy).toString();return [...parseHTML(xml).document.querySelectorAll('node')];}
async function tapLabel(label,rootOnly=false){const labels=Array.isArray(label)?label:[label];for(let i=0;i<10;i++){const nodes=await uiNodes(),node=nodes.find(n=>(!rootOnly||n.closest('[resource-id$=roots_list]'))&&(labels.includes(n.getAttribute('text'))||labels.includes(n.getAttribute('content-desc'))));if(node){const m=node.getAttribute('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);assert.ok(m);android('shell','input','tap',String(Math.round((+m[1]+ +m[3])/2)),String(Math.round((+m[2]+ +m[4])/2)));return;}await pause(200)}throw Error('Native UI label missing: '+label);}
async function waitTop(pattern){for(let i=0;i<80;i++){if(pattern.test(top()))return;await pause(150)}throw Error('Native activity did not open: '+pattern);}
async function importNative(name,kind='skill'){
 const input=kind==='skill'?'#skill-files':'[data-library-file]',button=kind==='skill'?'[data-skill=import]':'[data-library=import]';
 await c.ev(`(()=>{const input=document.querySelector(${JSON.stringify(input)});${process.argv.includes('--diagnose-any-file')?"input.accept='*/*';":''}input.addEventListener('change',()=>{window.__skillAcceptance.selected=[...input.files].map(f=>({name:f.name,type:f.type,size:f.size}))},{once:true,capture:true})})()`);
 await c.call('Runtime.evaluate',{expression:`document.querySelector(${JSON.stringify(button)}).click()`,userGesture:true});
 await waitTop(/topResumedActivity=[^\n]*documentsui/);
 // Select only this run's synthetic file from Downloads, never browse account files.
 await pause(350);await tapLabel(['显示根目录','Show roots']);await pause(350);await tapLabel(['下载','Downloads'],true);await pause(350);await tapLabel(folder);await pause(350);await tapLabel(name);
 await c.wait(kind==='skill'?"!document.querySelector('[data-skill=import]').disabled":"document.querySelector('#modal').open");
}
async function stageFile(name,text){fs.writeFileSync(out+'/'+name,text);android('push',out+'/'+name,downloads+'/'+name);files.push(name);android('shell','am','broadcast','-a','android.intent.action.MEDIA_SCANNER_SCAN_FILE','-d','file://'+downloads+'/'+name);await pause(1500);}
async function receiveExport(id,label,kind='skill'){
 android('shell','run-as',receiver,'rm','-f','files/received-file.json');
 if(kind==='skill'){await c.ev(`document.querySelector('[data-skill-id="${id}"] details').open=true`);await c.click(`[data-skill=export][data-id="${id}"]`)}else await c.click(`[data-library=${id}]`);
 await waitTop(/topResumedActivity=[^\n]*ChooserActivity/);await pause(350);fs.writeFileSync(out+'/'+label+'-chooser.png',android('exec-out','screencap','-p'));await tapLabel('本地文件验收');
 await waitTop(/topResumedActivity=[^\n]*NativeFileReceiverActivity/);
 const receipt=JSON.parse(android('exec-out','run-as',receiver,'cat','files/received-file.json').toString());assert.equal(receipt.ok,true,receipt.error);assert.equal(receipt.readGrant,true);
 const text=Buffer.from(receipt.base64,'base64').toString('utf8');fs.writeFileSync(out+'/'+label+'-receiver.json',JSON.stringify({...receipt,base64:undefined,bytes:Buffer.byteLength(text),sha256:crypto.createHash('sha256').update(text).digest('hex')},null,2));
 android('shell','input','keyevent','KEYCODE_BACK');await c.wait(kind==='skill'?"!document.querySelector('[data-skill=import]').disabled":"!document.querySelector('[data-library=import]').disabled");return {name:receipt.name,text};
}
try{
 assert.equal(android('shell','pm','list','packages','--user','0',receiver).toString().trim(),'','Acceptance package already installed');
 android('install','android/app/build/outputs/apk/acceptance/app-acceptance.apk');installed=true;
 android('shell','input','keyevent','KEYCODE_WAKEUP');android('shell','wm','dismiss-keyguard');android('shell','am','start','-n','com.labmaker.app/.MainActivity');
 c=await connectAndroid(9263);await c.ev(hook);
 if(!process.argv.includes('--variants-only')){
 await c.ev("location.hash='/ai-skills'");await c.wait("!!document.querySelector('[data-skill-id]')&&!document.querySelector('[data-skill=import]').disabled");
 const id=await c.ev("document.querySelector('[data-skill-id]').dataset.skillId");
 await c.click(`[data-skill-toggle="${id}"]`);await c.wait(`!document.querySelector('[data-skill-toggle="${id}"]').checked&&!document.querySelector('[data-skill=import]').disabled`);
 const received=await receiveExport(id,'markdown'),exported=received.text;assert.match(received.name,/\.md$/);assert.match(exported,/enabled: false/);
 checks.push('Real Share chooser grants an external UID read access; UTF-8 Markdown and original filename arrive intact');
 android('shell','mkdir','-p',downloads);const name='roundtrip-'+folder.slice(-8)+'.md';await stageFile(name,exported);
 await c.click(`[data-skill=delete][data-id="${id}"]`);await c.wait("document.querySelector('#modal').open");await c.click('[data-dialog-confirm]');await c.wait(`!document.querySelector('[data-skill-id="${id}"]')`);
 await importNative(name);await c.wait(`!!document.querySelector('[data-skill-id="${id}"]')`);assert.equal(await c.ev(`document.querySelector('[data-skill-toggle="${id}"]').checked`),false);
 fs.writeFileSync(out+'/selected-file.json',JSON.stringify(await c.ev('window.__skillAcceptance.selected'),null,2));
 checks.push('Actual Android DocumentsUI import restores exported skill identity and disabled state after deletion');
 const custom={name:'往返公式与空白',description:'第一行\n第二行',scope:'plot',content:'\n公式 $B=K_b d$ 与 \\frac{1}{2}。\r\n保留两端空白。\n',enabled:false};
 const customId=crypto.createHash('sha256').update(custom.scope+'\n'+custom.content).digest('hex');
 const customFile='custom-'+folder.slice(-8)+'.json';await stageFile(customFile,JSON.stringify({format:'lab-maker-skill',version:1,skill:custom}));await importNative(customFile);await c.wait(`!!document.querySelector('[data-skill-id="${customId}"]')`);
 const jsonExport=await receiveExport(customId,'json');assert.equal(jsonExport.name,custom.name+'.json');assert.deepEqual(JSON.parse(jsonExport.text).skill,custom);
 checks.push('Native JSON picker and external-UID export preserve CRLF, formula backslashes, multiline metadata, plot scope and disabled state');
 const count=await c.ev("document.querySelectorAll('[data-skill-id]').length");const invalidFile='invalid-'+folder.slice(-8)+'.json';await stageFile(invalidFile,'{"format":"foreign"}');await importNative(invalidFile);await c.wait("document.querySelector('#toast').textContent.includes('不是本应用导出')");assert.equal(await c.ev("document.querySelectorAll('[data-skill-id]').length"),count);
 checks.push('Unsupported JSON selected through the native picker is rejected without changing the library');
 await c.call('Runtime.evaluate',{expression:"document.querySelector('[data-skill=import]').click()",userGesture:true});await waitTop(/topResumedActivity=[^\n]*documentsui/);for(let i=0;i<6&&/topResumedActivity=[^\n]*documentsui/.test(top());i++){android('shell','input','keyevent','KEYCODE_BACK');await pause(250)}await waitTop(/topResumedActivity=[^\n]*com.labmaker.app\//);assert.equal(await c.ev("document.querySelectorAll('[data-skill-id]').length"),count);
 await c.ev(`document.querySelector('[data-skill-id="${customId}"] details').open=true`);await c.click(`[data-skill=export][data-id="${customId}"]`);await waitTop(/topResumedActivity=[^\n]*ChooserActivity/);android('shell','input','keyevent','KEYCODE_BACK');await c.wait("document.querySelector('#toast').textContent==='已取消分享'&&!document.querySelector('[data-skill=import]').disabled");
 checks.push('Native file picker and share cancellation return to usable controls without altering skills');
 // Reload the home page, then reapply storage isolation before mounting the skills view.
 await c.ev("location.hash='/home'");await c.call('Page.reload');await c.wait("!!document.querySelector('.app-header')&&typeof Capacitor?.nativePromise==='function'");await c.ev(hook);await c.ev("location.hash='/ai-skills'");await c.wait(`!!document.querySelector('[data-skill-id="${customId}"]')&&!document.querySelector('[data-skill=import]').disabled`);assert.equal(await c.ev(`document.querySelector('[data-skill-toggle="${id}"]').checked`),false);assert.equal(await c.ev(`document.querySelector('[data-skill-toggle="${customId}"]').checked`),false);
 checks.push('Full WebView reload reads the imported skill bodies and disabled state from real Android private storage');
 }
 if(process.argv.includes('--variants-only')||process.argv.includes('--variants')){
  const exp=JSON.parse(fs.readFileSync('src/data/catalog.json')).experiments[0],base=JSON.parse(fs.readFileSync('src/data/report-variants.json'))[exp.id];
  const desktop={实验原理:['本地文件往返验收 '+base.实验原理[0]]},name='自建变体_'+exp.sourceId+'.json';
  android('shell','mkdir','-p',downloads);await stageFile(name,JSON.stringify(desktop));await c.ev("location.hash='/variant-library'");await c.wait("!!document.querySelector('[data-library=import]')&&!document.querySelector('[data-library=import]').disabled");
  const rowCount=()=>c.ev("document.querySelectorAll('[data-library-list] article').length");assert.equal(await rowCount(),0);
  await importNative(name,'variant');await c.click('#modal [data-dialog-close]');await c.wait("!document.querySelector('[data-library=import]').disabled");assert.equal(await rowCount(),0);
  checks.push('Real desktop variant file reaches import confirmation; cancelling writes no archive');
  await importNative(name,'variant');await c.click('#modal [data-dialog-confirm]');await c.wait("document.querySelectorAll('[data-library-list] article').length===1&&!document.querySelector('[data-library=import]').disabled");
  const mobile=await receiveExport('export-all','variant-mobile','variant'),mobilePack=JSON.parse(mobile.text);assert.equal(mobilePack.type,'lab-maker-variant-library');assert.equal(mobilePack.entries.length,1);assert.equal(mobilePack.entries[0].text,desktop.实验原理[0]);
  const legacy=await receiveExport('export-desktop','variant-desktop','variant');assert.equal(legacy.name,name);assert.deepEqual(JSON.parse(legacy.text),desktop);
  checks.push('Real external-UID shares preserve complete mobile archive and original desktop filename/chapter/formulas');
  await c.click('[data-library=delete]');await c.wait("document.querySelector('#modal').open");await c.click('#modal [data-dialog-confirm]');await c.wait("document.querySelectorAll('[data-library-list] article').length===0&&!document.querySelector('[data-library=import]').disabled");
  const mobileName='archive-'+folder.slice(-8)+'.json';await stageFile(mobileName,mobile.text);await importNative(mobileName,'variant');await c.click('#modal [data-dialog-confirm]');await c.wait("document.querySelectorAll('[data-library-list] article').length===1&&!document.querySelector('[data-library=import]').disabled");
  await importNative(mobileName,'variant');await c.click('#modal [data-dialog-confirm]');await c.wait("!document.querySelector('[data-library=import]').disabled");assert.equal(await rowCount(),1);
  checks.push('Native mobile archive reimport restores a deleted entry and repeated import deduplicates it');
  await c.click('[data-library=view]');await c.wait("document.querySelector('dialog[aria-label=自建变体详情]').open");assert.equal(await c.ev("document.querySelector('dialog[aria-label=自建变体详情] pre').textContent"),desktop.实验原理[0]);await c.click('[data-library-detail=use]');await c.wait("document.querySelector('#modal').open");await c.click('#modal [data-dialog-confirm]');await c.wait("document.querySelector('[data-library-detail-status]').textContent.includes('已选用')");
  const settings=await c.ev(`Promise.all(['a','b'].map(slot=>Capacitor.nativePromise('Filesystem','readFile',{directory:'LIBRARY_NO_CLOUD',path:'lab-maker/v1/options-${exp.id}-'+slot+'.json',encoding:'utf8'}).then(r=>JSON.parse(r.data),()=>null))).then(rows=>rows.filter(Boolean).sort((a,b)=>b.revision-a.revision)[0]?.payload)`);assert.ok(settings.customVariants.实验原理.some(v=>v.text===desktop.实验原理[0]));
  checks.push('Imported native archive preview and explicit adoption persist the exact text as a report candidate');
  await c.click('[data-library-detail=close]');await c.ev("location.hash='/home'");await c.call('Page.reload');await c.wait("!!document.querySelector('.app-header')&&typeof Capacitor?.nativePromise==='function'");await c.ev(hook);await c.ev("location.hash='/variant-library'");await c.wait("document.querySelectorAll('[data-library-list] article').length===1&&!document.querySelector('[data-library=import]').disabled");
  checks.push('Full WebView reload restores the native variant archive');
 }
 fs.writeFileSync(out+'/results.json',JSON.stringify({version:JSON.parse(fs.readFileSync('package.json')).version,namespace,checks,externalReceiver:true,nativeFilePicker:true,diagnosticOnly:process.argv.includes('--diagnose-any-file'),schoolMutations:0,paidApiCalls:0},null,2));console.log(JSON.stringify({passed:checks.length,out}));
}catch(error){fs.writeFileSync(out+'/failure.json',JSON.stringify({error:error.message,completedChecks:checks},null,2));fs.writeFileSync(out+'/failure.png',android('exec-out','screencap','-p'));try{fs.writeFileSync(out+'/failure-ui.xml',(await uiNodes()).map(n=>n.outerHTML).join('\n'))}catch{}throw error;}
finally{
 for(let i=0;i<6&&/topResumedActivity=[^\n]*(ChooserActivity|documentsui|NativeFileReceiverActivity)/.test(top());i++){android('shell','input','keyevent','KEYCODE_BACK');await pause(200)}
 if(c){await c.ev(`(()=>{if(window.__skillAcceptance){Capacitor.nativePromise=window.__skillAcceptance.original;delete window.__skillAcceptance}return Promise.allSettled(['LIBRARY_NO_CLOUD','CACHE'].map(directory=>Capacitor.nativePromise('Filesystem','rmdir',{directory,path:${JSON.stringify(namespace)},recursive:true})))})()`).catch(()=>{});await c.call('Page.reload').catch(()=>{});c.close()}
 if(installed)android('uninstall',receiver);
 for(const name of files)android('shell','rm','--',downloads+'/'+name);if(files.length)android('shell','rmdir',downloads);
 android('shell','rm','-f',hierarchy);android('shell','am','start','-n','com.labmaker.app/.MainActivity');
}
