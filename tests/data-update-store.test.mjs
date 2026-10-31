import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';import path from 'node:path';
import {DataUpdateStore} from '../src/domain/data-update-store.ts';import {stableJson,dataHash} from '../src/domain/data-package.ts';import {makeMobileDataPackage,signMobileDataManifest} from '../scripts/lib/mobile-data-package.mjs';
const pack=await makeMobileDataPackage(path.resolve(import.meta.dirname,'..'),{dataVersion:'1.0.1',minAppVersion:'0.40.0'}),keys=crypto.generateKeyPairSync('ed25519'),pub=keys.publicKey.export({type:'spki',format:'pem'}),key=keys.privateKey.export({type:'pkcs8',format:'pem'}),context={appVersion:'0.40.0',currentVersion:'0.0.0',runtimeHash:pack.manifest.runtimeHash,experiments:pack.payload.catalog.experiments,publicKey:pub};
async function envelope(version='1.0.1',note=''){const p={...pack.payload,dataVersion:version},body=stableJson(p),bytes=new TextEncoder().encode(body);return {body,manifest:signMobileDataManifest({...pack.manifest,dataVersion:version,url:pack.manifest.url.replace('1.0.1',version),notes:note,size:bytes.length,sha256:await dataHash(bytes)},key,pub)};}
const okay=async()=>({complete:true,problems:[]}),signal=()=>new AbortController().signal;
function memory(){const data=new Map([['profile-a','personal'],['record-abcdef123456-a','measurements'],['accounts','secret not read']]),reads=[];let fail=()=>false;const store={read:async k=>{reads.push(k);return data.get(k)??null;},write:async(k,v)=>{if(fail(k))throw Error('模拟磁盘失败');data.set(k,v);},remove:async k=>{data.delete(k);}};return {data,reads,store,repo:new DataUpdateStore(store,context),fail:fn=>fail=fn};}

test('inspect and runtime failure never publish or touch personal records, and unused stage is removed',async()=>{
 const {repo,data,reads}=memory(),candidate=await envelope();assert.equal((await repo.load()).version,'0.0.0');await repo.inspect(candidate);assert.equal(data.size,3);
 await assert.rejects(repo.install(candidate,async()=>({complete:false,problems:['syntax']}),signal()),/运行检查/);assert.equal((await repo.load()).version,'0.0.0');assert.equal(data.size,3);assert.ok(reads.every(k=>k.startsWith('data-')));assert.equal(data.get('accounts'),'secret not read');
});
test('verified dual-copy publication survives reopening and source data is kept separate',async()=>{
 const m=memory(),candidate=await envelope(),result=await m.repo.install(candidate,okay,signal());assert.equal(result.committed,true);assert.equal(result.degraded,false);
 const restored=await new DataUpdateStore(m.store,context).load();assert.equal(restored.version,'1.0.1');assert.equal(restored.payload.catalog.experiments.length,28);assert.equal(m.data.get('profile-a'),'personal');assert.equal((await m.repo.status()).highestVersion,'1.0.1');
});
test('a damaged active bundle falls back to previous verified bundle; both broken falls back to builtin explicitly',async()=>{
 const m=memory(),first=await envelope(),second=await envelope('1.0.2');await m.repo.install(first,okay,signal());await m.repo.install(second,okay,signal());for(const slot of ['a','b'])m.data.set('data-bundle-'+second.manifest.sha256+'-'+slot,'broken');
 const previous=await m.repo.load();assert.equal(previous.version,'1.0.1');assert.match(previous.warning,/上一份/);for(const slot of ['a','b'])m.data.set('data-bundle-'+first.manifest.sha256+'-'+slot,'broken');const builtin=await m.repo.load();assert.equal(builtin.payload,null);assert.match(builtin.warning,/内置/);
});
test('floor writes must finish before pointer publication; identical candidate remains retryable',async()=>{
 const m=memory(),first=await envelope(),second=await envelope('1.0.2');await m.repo.install(first,okay,signal());m.fail(k=>k==='data-floor-b');await assert.rejects(m.repo.install(second,okay,signal()));assert.equal((await m.repo.load()).version,'1.0.1');m.fail(()=>false);await m.repo.install(second,okay,signal());assert.equal((await m.repo.load()).version,'1.0.2');
});
test('one pointer write failure is a committed degraded update rather than a false failed transaction',async()=>{
 const m=memory();m.fail(k=>k==='data-active-b');const result=await m.repo.install(await envelope(),okay,signal());assert.equal(result.committed,true);assert.equal(result.degraded,true);assert.equal((await m.repo.load()).version,'1.0.1');
});
test('restoring builtin retains anti-rollback floor and can be repeated after corrupt pointers',async()=>{
 const m=memory();await m.repo.install(await envelope('1.0.2'),okay,signal());await m.repo.restoreBuiltin();assert.equal((await m.repo.load()).version,'0.0.0');assert.equal((await m.repo.status()).highestVersion,'1.0.2');await assert.rejects(m.repo.inspect(await envelope()),/较旧/);for(const slot of ['a','b'])m.data.set('data-active-'+slot,'broken');await m.repo.restoreBuiltin();assert.equal((await m.repo.load()).version,'0.0.0');assert.equal((await m.repo.status()).highestVersion,'1.0.2');
});
test('stop or restore queued during preflight invalidates old work before commit',async()=>{
 for(const restore of [false,true]){const m=memory(),controller=new AbortController();let release,entered;const started=new Promise(r=>entered=r),pending=m.repo.install(await envelope(),async()=>{entered();await new Promise(r=>release=r);return {complete:true};},controller.signal);await started;let reset;if(restore)reset=m.repo.restoreBuiltin();else controller.abort();release();await assert.rejects(pending,/停止/);if(reset)await reset;assert.equal((await m.repo.load()).version,'0.0.0');assert.equal([...m.data.keys()].filter(k=>k.startsWith('data-bundle')).length,0);}
});
test('pruning retains current and previous bundles only and cannot erase live bundle on cancelled repeat',async()=>{
 const m=memory();for(const version of ['1.0.1','1.0.2','1.0.3'])await m.repo.install(await envelope(version),okay,signal());assert.equal([...m.data.keys()].filter(k=>k.startsWith('data-bundle')).length,4);const controller=new AbortController();await assert.rejects(m.repo.install(await envelope('1.0.3'),async()=>{controller.abort();return {complete:true};},controller.signal));assert.equal((await m.repo.load()).version,'1.0.3');
});
test('cancellation after the commit boundary completes the verified publication instead of claiming rollback',async()=>{
 const m=memory(),controller=new AbortController(),result=await m.repo.install(await envelope(),okay,controller.signal,()=>controller.abort());assert.equal(controller.signal.aborted,true);assert.equal(result.committed,true);assert.equal((await m.repo.load()).version,'1.0.1');
});
test('uncertain pointer writes retain old active data and a durable high-water mark, then retry safely',async()=>{
 const m=memory();await m.repo.install(await envelope(),okay,signal());const next=await envelope('1.0.2');m.fail(k=>k.startsWith('data-active-'));await assert.rejects(m.repo.install(next,okay,signal()),/待核实/);assert.equal((await m.repo.load()).version,'1.0.1');assert.equal((await m.repo.status()).highestVersion,'1.0.2');m.fail(()=>false);await m.repo.install(next,okay,signal());assert.equal((await m.repo.load()).version,'1.0.2');
});
test('corrupt protection records never authorize a reset or downgrade while current resources remain readable',async()=>{
 const m=memory();await m.repo.install(await envelope(),okay,signal());for(const slot of ['a','b'])m.data.set('data-floor-'+slot,'broken');assert.equal((await m.repo.load()).version,'1.0.1');assert.match((await m.repo.status()).warning,/保护状态/);await assert.rejects(m.repo.inspect(await envelope('1.0.2')),/未能读取/);await m.repo.restoreBuiltin();assert.equal((await m.repo.load()).version,'0.0.0');await assert.rejects(m.repo.inspect(await envelope('1.0.2')),/未能读取/);
});
test('reapplying the same verified release preserves the previous working release for recovery',async()=>{
 const m=memory(),first=await envelope(),second=await envelope('1.0.2');await m.repo.install(first,okay,signal());await m.repo.install(second,okay,signal());await m.repo.install(second,okay,signal());for(const slot of ['a','b'])m.data.set('data-bundle-'+second.manifest.sha256+'-'+slot,'broken');assert.equal((await m.repo.load()).version,'1.0.1');
});
test('restoring with one failed pointer write is committed and repairable without losing the protection floor',async()=>{
 const m=memory();await m.repo.install(await envelope(),okay,signal());m.fail(k=>k==='data-active-b');const reset=await m.repo.restoreBuiltin();assert.equal(reset.committed,true);assert.equal(reset.degraded,true);assert.equal((await m.repo.load()).version,'0.0.0');assert.equal((await m.repo.status()).highestVersion,'1.0.1');m.fail(()=>false);assert.equal((await m.repo.restoreBuiltin()).degraded,false);
});
