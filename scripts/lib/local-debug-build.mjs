import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function project(root){const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,gradle=fs.readFileSync(path.join(root,'android/app/build.gradle'),'utf8');const code=Number(gradle.match(/\bversionCode\s+(\d+)/)?.[1]);if(!/^\d+\.\d+\.\d+$/.test(version)||gradle.match(/\bversionName\s+"([^"]+)"/)?.[1]!==version||!Number.isSafeInteger(code)||code<1)throw Error('Source and Android versions disagree');return {version,code};}
export function inspectApk(file){const sdk=process.env.ANDROID_HOME??'E:/tools/app-maker/android-sdk',output=execFileSync(path.join(sdk,'build-tools/36.0.0/aapt.exe'),['dump','badging',file],{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});const m=output.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);if(!m)throw Error('Cannot verify APK identity');return {appId:m[1],versionCode:Number(m[2]),version:m[3]};}
function identity(root,file,inspect){const wanted=project(root),actual=inspect(file);if(actual.appId!=='com.labmaker.app'||actual.version!==wanted.version||actual.versionCode!==wanted.code)throw Error('APK identity or version differs from current source');return actual;}
function localPath(root,relative){if(!/^artifacts\/preview\/lab-maker-app-\d+\.\d+\.\d+(?:-[a-f0-9]{12})?-debug\.apk$/.test(relative))throw Error('Invalid local build path');const file=path.join(root,relative),parent=fs.realpathSync(path.join(root,'artifacts/preview'));if(path.dirname(fs.realpathSync(file))!==parent)throw Error('Build file escapes preview directory');return file;}
export function registerDebugBuild(root,source,certificateSha256,inspect=inspectApk){
 if(!/^[a-f0-9]{64}$/.test(certificateSha256))throw Error('Missing verified signing certificate');
 const actual=identity(root,source,inspect),digest=sha(source),bytes=fs.statSync(source).size;if(bytes<1||bytes>150*1024*1024)throw Error('Invalid APK size');
 const preview=path.join(root,'artifacts/preview');fs.mkdirSync(preview,{recursive:true});let relative=`artifacts/preview/lab-maker-app-${actual.version}-debug.apk`,target=path.join(root,relative);
 if(fs.existsSync(target)&&sha(localPath(root,relative))!==digest){relative=`artifacts/preview/lab-maker-app-${actual.version}-${digest.slice(0,12)}-debug.apk`;target=path.join(root,relative);}
 if(!fs.existsSync(target))fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);
 if(sha(localPath(root,relative))!==digest)throw Error('Existing preview differs; original file retained');
 const receipt={format:'lab-maker-local-debug-v1',...actual,apk:relative,bytes,sha256:digest,certificateSha256,createdAt:new Date().toISOString(),scope:'Automated local build checks only; device acceptance and release approval remain separate'};
 const temporary=path.join(preview,'current-build.tmp-'+crypto.randomUUID());fs.writeFileSync(temporary,JSON.stringify(receipt,null,2),{flag:'wx'});fs.renameSync(temporary,path.join(preview,'current-build.json'));return receipt;
}
export function resolveDebugBuild(root,inspect=inspectApk){
 const marker=path.join(root,'artifacts/preview/current-build.json');if(!fs.existsSync(marker))throw Error('No current build record; run Build-Android.cmd. Legacy APK will not be selected');if(fs.statSync(marker).size>16384)throw Error('Build record too large');
 const receipt=JSON.parse(fs.readFileSync(marker,'utf8'));if(receipt.format!=='lab-maker-local-debug-v1'||!/^[a-f0-9]{64}$/.test(receipt.sha256)||!/^[a-f0-9]{64}$/.test(receipt.certificateSha256)||!Number.isSafeInteger(receipt.bytes))throw Error('Invalid local build record');
 const file=localPath(root,receipt.apk);if(fs.statSync(file).size!==receipt.bytes||sha(file)!==receipt.sha256)throw Error('APK changed or corrupt; rebuild first');const actual=identity(root,file,inspect);if(actual.version!==receipt.version||actual.versionCode!==receipt.versionCode||actual.appId!==receipt.appId)throw Error('Build record identity mismatch');return receipt;
}
