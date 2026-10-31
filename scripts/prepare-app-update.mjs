// Local candidate preparation only. No upload, installation or implicit key access.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
import {appSigningText,verifyAppManifest} from '../src/domain/app-update.ts';
const root=path.resolve(import.meta.dirname,'..'),arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const apk=path.resolve(arg('--apk')??path.join(root,'android/app/build/outputs/apk/debug/app-debug.apk'));
const sdk=process.env.ANDROID_HOME??'E:/tools/app-maker/android-sdk',buildTools=path.join(sdk,'build-tools/36.0.0'),java=path.join(process.env.JAVA_HOME??'', 'bin/java.exe');
function command(exe,args){const r=spawnSync(exe,args,{cwd:root,encoding:'utf8',maxBuffer:1024*1024});if(r.error)throw r.error;if(r.status!==0)throw Error('APK metadata/signature verification failed: '+r.stderr);return r.stdout;}
const badge=command(path.join(buildTools,'aapt.exe'),['dump','badging',apk]),signature=command(java,['-jar',path.join(buildTools,'lib/apksigner.jar'),'verify','--print-certs',apk]);
const pkg=badge.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/),min=badge.match(/sdkVersion:'(\d+)'/),certs=[...signature.matchAll(/certificate SHA-256 digest: ([a-f0-9]{64})/g)];
if(!pkg||pkg[1]!=='com.labmaker.app'||!min||certs.length!==1)throw Error('Unexpected APK identity, SDK or signer');
const hash=crypto.createHash('sha256');for await(const block of fs.createReadStream(apk))hash.update(block);
const manifest={kind:'lab-maker-mobile-app',schema:1,appId:'com.labmaker.app',version:pkg[3],versionCode:Number(pkg[2]),minAndroid:Number(min[1]),size:fs.statSync(apk).size,sha256:hash.digest('hex'),certificateSha256:certs[0][1],url:`https://labreport-1485394950.cos.ap-guangzhou.myqcloud.com/mobile-app/lab-maker-app-${pkg[3]}.apk`,notes:arg('--notes')?fs.readFileSync(path.resolve(arg('--notes')),'utf8'):'',signature:''};
const keyPath=arg('--key');
if(keyPath){
 if(manifest.certificateSha256==='57d6f58780b1cbce1457f31a6fb5756b847883d036c75c5a50d6ac07f1f0adc4')throw Error('Debug APK cannot become a signed production update candidate');
 manifest.signature=crypto.sign(null,Buffer.from(appSigningText(manifest)),fs.readFileSync(path.resolve(keyPath))).toString('base64');
 await verifyAppManifest(manifest,fs.readFileSync(path.join(root,'src/data/update-public-key.pem'),'utf8'));
}
const output=path.resolve(arg('--output')??path.join(root,'artifacts/app-update-candidates',manifest.version));if(fs.existsSync(output))throw Error('Candidate directory already exists; refusing overwrite');
fs.mkdirSync(output,{recursive:true});const name=keyPath?'mobile-app-manifest.json':'mobile-app-manifest.unsigned.json';fs.writeFileSync(path.join(output,name),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify({apk,uploadName:`lab-maker-app-${manifest.version}.apk`,manifest:name,signed:!!keyPath,debug:manifest.certificateSha256==='57d6f58780b1cbce1457f31a6fb5756b847883d036c75c5a50d6ac07f1f0adc4',published:false,installed:false,bytes:manifest.size,sha256:manifest.sha256,createdAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({version:manifest.version,output,signed:!!keyPath,published:false,installed:false}));
