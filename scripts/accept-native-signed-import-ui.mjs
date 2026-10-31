import fs from 'node:fs';import assert from 'node:assert/strict';import {build} from 'vite';import {android,connectAndroid,pause} from './lib/android-cdp.mjs';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version,pkg='com.labmaker.app.acceptance',out='artifacts/verification/native-signed-import-ui-'+version+'-'+Date.now();fs.mkdirSync(out,{recursive:true});
const built=await build({configFile:false,logLevel:'error',build:{write:false,minify:false,rollupOptions:{output:{inlineDynamicImports:true}},lib:{entry:'tests/fixtures/ios-signed-import-ui.ts',name:'SignedImportFixture',formats:['iife']}}});
const bundle=(Array.isArray(built)?built[0]:built).output.find(v=>v.type==='chunk'&&v.isEntry).code;let c,installed=false;
try{
 assert.equal(android('shell','pm','list','packages',pkg).toString().trim(),'');android('install','android/app/build/outputs/apk/acceptance/app-acceptance.apk');installed=true;android('shell','am','start','-n',pkg+'/com.labmaker.app.MainActivity');
 for(let i=0;i<70;i++){try{c=await connectAndroid(9286,0,pkg);await c.wait("!!document.querySelector('.app-header')");break}catch(e){c?.close();c=null;if(i===69)throw e;await pause(200)}}
 await c.ev(`(()=>{const old=Capacitor.nativePromise;Capacitor.nativePromise=function(p,m,a){if(!['Filesystem','App'].includes(p))return Promise.reject(Error('External operation blocked'));return old.call(this,p,m,a)}})()`);
 await c.ev("document.body.innerHTML='<main id=app><div id=updates-host></div></main>'");await c.ev(bundle+';window.fixtureModule=SignedImportFixture;true');await c.ev('fixtureModule.createImportFixture().then(v=>{window.fixture=v})');
 const ready=()=>c.wait("!document.querySelector('[data-update=status]').disabled",1200),click=a=>c.click(`[data-update=${a}]`),text=()=>c.ev("document.querySelector('[data-update-status]').textContent");await ready();
 await c.ev("fixture.pick('tampered')");await ready();assert.match(await text(),/签名/);assert.equal(await c.ev("document.querySelector('[data-update=apply]').hidden"),true);
 await c.ev("fixture.pick('good')");await ready();await click('apply');await ready();assert.match(await text(),/已准备/);assert.equal((await c.ev('fixture.status()')).version,'1.0.1');assert.equal(await c.ev('fixture.preflights()'),1);
 await c.ev('fixture.session()');await ready();await c.ev("fixture.pick('broken')");await ready();await click('apply');await ready();assert.match(await text(),/运行检查未通过/);assert.equal((await c.ev('fixture.status()')).version,'1.0.1');
 await click('restore');await ready();const result=await c.ev('fixture.status()');assert.equal(result.version,'0.0.0');assert.equal(result.highestVersion,'1.0.1');assert.equal(await c.ev("document.querySelector('[data-update=apply]').hidden"),true);assert.equal(await c.ev("document.querySelector('[data-update-summary]').textContent"),'');
 fs.writeFileSync(out+'/result.json',JSON.stringify({version,passed:4,scope:'isolated Android UID, actual filesystem and offline WASM, ephemeral publisher key',schoolWrites:0},null,2));console.log(JSON.stringify({passed:4,out}));
}finally{c?.close();if(installed)android('uninstall',pkg)}
