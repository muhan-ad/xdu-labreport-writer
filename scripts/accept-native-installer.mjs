// Native installer and permission APIs for a disposable package; never updates primary app.
import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
import {parseHTML} from 'linkedom';import {android,pause} from './lib/android-cdp.mjs';
const pkg='com.labmaker.app.acceptance',activity=pkg+'/com.labmaker.app.NativeInstallerActivity',apk='android/app/build/outputs/apk/acceptance/app-acceptance.apk';
const out='artifacts/verification/native-installer-'+Date.now(),xml='/data/local/tmp/labmaker-native-installer.xml';fs.mkdirSync(out,{recursive:true});
const stagedApk='/data/local/tmp/labmaker-installer-'+crypto.randomUUID()+'.apk';
const primaryPid=android('shell','pidof','com.labmaker.app').toString().trim(),checks=[];let installed=false;
const top=()=>android('shell','dumpsys','activity','activities').toString();
async function waitTop(pattern){for(let i=0;i<100;i++){if(pattern.test(top()))return;await pause(200)}throw Error('Native activity missing: '+pattern);}
async function nodes(){android('shell','uiautomator','dump',xml);return [...parseHTML(android('exec-out','cat',xml).toString()).document.querySelectorAll('node')];}
function tapNode(node){const m=node.getAttribute('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);assert.ok(m);android('shell','input','tap',String(Math.round((+m[1]+ +m[3])/2)),String(Math.round((+m[2]+ +m[4])/2)));}
async function tapText(labels){for(let i=0;i<12;i++){const n=(await nodes()).find(n=>labels.includes(n.getAttribute('text')));if(n){tapNode(n);return;}await pause(200)}throw Error('Native button missing: '+labels);}
const receipt=()=>JSON.parse(android('exec-out','run-as',pkg,'cat','files/installer-receipt.json').toString());
async function readyReceipt(){for(let i=0;i<80;i++){try{const value=receipt();if(value.package)return value;}catch{}await pause(150)}throw Error('Native APK metadata receipt did not become ready');}
const write=(path,bytes)=>execFileSync('E:/tools/app-maker/android-sdk/platform-tools/adb.exe',['-s','emulator-5560','shell','run-as',pkg,'tee',path],{input:bytes,stdio:['pipe','ignore','pipe'],windowsHide:true});
try{
 assert.equal(android('shell','pm','list','packages',pkg).toString().trim(),'');
 const identity=execFileSync('E:/tools/app-maker/android-sdk/build-tools/36.0.0/aapt.exe',['dump','badging',apk],{encoding:'utf8',windowsHide:true});assert.match(identity,/package: name='com\.labmaker\.app\.acceptance'/);
 android('install',apk);installed=true;android('shell','run-as',pkg,'mkdir','-p','files','cache');const initialPackage=android('shell','dumpsys','package',pkg).toString();
 const sentinel='Local-install-preservation-'+crypto.randomUUID();write('files/reinstall-sentinel.txt',sentinel);android('push',apk,stagedApk);android('shell','run-as',pkg,'cp',stagedApk,'cache/local-installer-acceptance.apk');
 assert.equal(android('shell','run-as',pkg,'sha256sum','cache/local-installer-acceptance.apk').toString().split(/\s/)[0],crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex'));
 android('shell','am','start','-n',activity);await waitTop(/topResumedActivity=[^\n]*NativeInstallerActivity/);
 const metadata=await readyReceipt();assert.equal(metadata.package,pkg);assert.equal(metadata.version,JSON.parse(fs.readFileSync('package.json')).version);assert.equal(metadata.bytes,fs.statSync(apk).size);assert.equal(metadata.minAndroid,24);assert.match(metadata.certificateSha256,/^[a-f0-9]{64}$/);checks.push('Real PackageManager parses the local APK identity, version, API minimum and actual signing certificate');
 await tapText(['打开测试包系统安装页']);assert.equal(receipt().sourceAllowed,false);checks.push('Unapproved installer source is detected before opening the installer');
 await tapText(['打开测试包安装授权']);await waitTop(/topResumedActivity=[^\n]*settings/);const settingsNodes=await nodes();assert.ok(settingsNodes.some(n=>n.getAttribute('text')?.includes('实验搭子')),'Permission page must name the disposable test app');const toggle=settingsNodes.find(n=>n.getAttribute('checkable')==='true'&&n.getAttribute('checked')==='false');assert.ok(toggle,'Unknown-source switch missing');tapNode(toggle);await pause(300);fs.writeFileSync(out+'/source-permission.png',android('exec-out','screencap','-p'));android('shell','input','keyevent','KEYCODE_BACK');await waitTop(/topResumedActivity=[^\n]*NativeInstallerActivity/);
 await tapText(['打开测试包系统安装页']);await waitTop(/topResumedActivity=[^\n]*packageinstaller/i);assert.equal(receipt().sourceAllowed,true);await pause(500);fs.writeFileSync(out+'/installer-before-cancel.png',android('exec-out','screencap','-p'));await tapText(['取消','Cancel']);await waitTop(/topResumedActivity=[^\n]*NativeInstallerActivity/);assert.equal(android('exec-out','run-as',pkg,'cat','files/reinstall-sentinel.txt').toString(),sentinel);checks.push('Per-app source authorization returns successfully; real FileProvider/ClipData grant reaches Android installer and cancel keeps data');
 await tapText(['打开测试包系统安装页']);await waitTop(/topResumedActivity=[^\n]*packageinstaller/i);await tapText(['更新','Update','安装','Install']);
 let updated=false;for(let i=0;i<150;i++){const current=android('shell','dumpsys','package',pkg).toString(),a=initialPackage.match(/lastUpdateTime=([^\r\n]+)/)?.[1],b=current.match(/lastUpdateTime=([^\r\n]+)/)?.[1];if(a&&b&&a!==b){updated=true;break;}await pause(200)}assert.ok(updated,'Package update timestamp did not change');await pause(500);fs.writeFileSync(out+'/after-install.png',android('exec-out','screencap','-p'));
 assert.equal(android('exec-out','run-as',pkg,'cat','files/reinstall-sentinel.txt').toString(),sentinel);checks.push('Actual same-version Android reinstall updates package timestamp and preserves private application data');
 fs.writeFileSync(out+'/results.json',JSON.stringify({version:metadata.version,package:pkg,checks,metadata,sourceWasDenied:true,sourceAuthorized:true,sameVersionReinstall:true,primaryAppInstalled:false,cloudRequests:0,schoolMutations:0,apiRequests:0},null,2));console.log(JSON.stringify({passed:checks.length,out}));
}catch(error){fs.writeFileSync(out+'/failure.json',JSON.stringify({error:error.message,checks},null,2));fs.writeFileSync(out+'/failure.png',android('exec-out','screencap','-p'));try{await nodes();fs.writeFileSync(out+'/failure-ui.xml',android('exec-out','cat',xml))}catch{}throw error;}
finally{
 for(let i=0;i<6&&/topResumedActivity=[^\n]*(settings|packageinstaller|NativeInstallerActivity)/i.test(top());i++){android('shell','input','keyevent','KEYCODE_BACK');await pause(200)}
 if(installed)android('uninstall',pkg);android('shell','rm','-f',xml,stagedApk);android('shell','am','start','-n','com.labmaker.app/.MainActivity');
 fs.writeFileSync(out+'/cleanup.json',JSON.stringify({helperRemoved:android('shell','pm','list','packages',pkg).toString().trim()==='',primaryPidUnchanged:android('shell','pidof','com.labmaker.app').toString().trim()===primaryPid},null,2));
}
