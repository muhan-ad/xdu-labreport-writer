import test from 'node:test';import assert from 'node:assert/strict';import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyAppManifest,appSigningText,appUpdateState,MAX_APK_BYTES} from '../src/domain/app-update.ts';
import {AppUpdateRequests} from '../src/platform/app-update-request.ts';
const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'pem'}),base={kind:'lab-maker-mobile-app',schema:1,appId:'com.labmaker.app',version:'1.0.1',versionCode:20,minAndroid:26,size:100,sha256:'a'.repeat(64),certificateSha256:'b'.repeat(64),url:'https://labreport-1485394950.cos.ap-guangzhou.myqcloud.com/mobile-app/lab-maker-app-1.0.1.apk',notes:'更新说明 <img>',signature:''};
const signed=(patch={})=>{const m={...base,...patch};m.signature=sign(null,Buffer.from(appSigningText(m)),keys.privateKey).toString('base64');return m;};
const installed={appId:'com.labmaker.app',version:'1.0.0',versionCode:19,android:26,certificateSha256:base.certificateSha256};
test('application update accepts a valid publisher signature with exact package binding',async()=>{const m=signed();assert.deepEqual(await verifyAppManifest(m,publicKey),m);assert.equal(appUpdateState(m,installed),'available');assert.equal(appUpdateState(m,{...installed,version:'1.0.1',versionCode:20}),'current');assert.equal(appUpdateState(m,{...installed,android:25}),'system-old');});
test('actual API 24 minimum is accepted for Android 7 devices',async()=>{const m=await verifyAppManifest(signed({minAndroid:24}),publicKey);assert.equal(appUpdateState(m,{...installed,android:24}),'available');});
test('tampered manifest, unknown fields and another signing key are rejected',async()=>{await assert.rejects(verifyAppManifest({...signed(),notes:'tampered'},publicKey));await assert.rejects(verifyAppManifest(signed({extra:true}),publicKey));const other=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});await assert.rejects(verifyAppManifest(signed(),other));});
test('APK source, bounds and version policy reject unsupported or downgrade paths',async()=>{
 for(const patch of [{size:MAX_APK_BYTES+1},{size:0},{version:'01.0.1'},{versionCode:0},{minAndroid:23},{sha256:'x'},{url:base.url+'?token=x'},{url:base.url.replace('myqcloud.com','evil.com')},{appId:'other.app'},{url:base.url.replace('1.0.1','1.0.2')}])await assert.rejects(verifyAppManifest(signed(patch),publicKey));
 assert.throws(()=>appUpdateState(signed(),{...installed,certificateSha256:'c'.repeat(64)}),/签名/);assert.throws(()=>appUpdateState(signed(),{...installed,versionCode:21}),/不一致/);
});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('app request uses explicit signed download arguments and isolates unrelated progress',async()=>{
 let handler,args,removed=0;const native={addListener:async(_,listener)=>{handler=listener;return {remove:async()=>{removed++;}};},cancel:async()=>{},download:async input=>{args=input;handler({id:'old',bytes:1,total:100});handler({id:input.id,bytes:2,total:100});handler({id:input.id,bytes:999,total:100});return {id:input.id,candidateId:input.id};}},values=[];
 await new AppUpdateRequests(native).request('download',signed(),new AbortController().signal,(...p)=>values.push(p));assert.deepEqual(values,[[2,100]]);assert.equal(args.sha256,base.sha256);assert.equal(args.certificateSha256,base.certificateSha256);assert.equal('notes' in args,false);assert.equal('signature' in args,false);assert.equal(removed,1);
});
test('abort before listener registration completes removes late listener and never starts native request',async()=>{
 const pending=deferred(),controller=new AbortController();let removed=0,called=0;const native={addListener:()=>pending.promise,cancel:async()=>{},manifest:async()=>{called++;}};
 const result=new AppUpdateRequests(native).request('manifest',null,controller.signal,()=>{});controller.abort();await assert.rejects(result,/停止/);pending.resolve({remove:async()=>{removed++;}});await Promise.resolve();await Promise.resolve();assert.equal(removed,1);assert.equal(called,0);
});
test('abort of active native request resolves locally while late reply cannot succeed',async()=>{
 const pending=deferred(),controller=new AbortController();let cancelled=0,handler;const native={addListener:async(_,h)=>{handler=h;return {remove:async()=>{}};},cancel:async()=>{cancelled++;},manifest:()=>pending.promise};let progress=0;
 const result=new AppUpdateRequests(native).request('manifest',null,controller.signal,()=>progress++);await Promise.resolve();await Promise.resolve();controller.abort();await assert.rejects(result,/停止/);pending.resolve({id:'late',found:true,body:'{}'});handler({id:'late',bytes:1,total:1});assert.equal(cancelled,1);assert.equal(progress,0);
});
