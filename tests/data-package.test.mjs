import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';import path from 'node:path';import fs from 'node:fs';
import {makeMobileDataPackage,signMobileDataManifest} from '../scripts/lib/mobile-data-package.mjs';
import {verifyDataManifest,verifyDataPayload,dataHash,dataLayoutHash,manifestSigningText,stableJson,compareDataVersion} from '../src/domain/data-package.ts';
const root=path.resolve(import.meta.dirname,'..'),keys=crypto.generateKeyPairSync('ed25519'),pub=keys.publicKey.export({type:'spki',format:'pem'}),privatePem=keys.privateKey.export({type:'pkcs8',format:'pem'});
const pack=await makeMobileDataPackage(root,{dataVersion:'1.0.1',minAppVersion:'0.40.0',notes:'测试发布，未上线'}),context={appVersion:'0.40.0',currentVersion:'1.0.0',runtimeHash:pack.manifest.runtimeHash,experiments:pack.payload.catalog.experiments,publicKey:pub};
const sign=m=>signMobileDataManifest(m,privatePem,pub),manifest=sign(pack.manifest);
async function signedPayload(payload){const bytes=new TextEncoder().encode(stableJson(payload)),m=sign({...pack.manifest,size:bytes.length,sha256:await dataHash(bytes)});return {bytes,m};}

test('signed data credits may update, but malformed entries never activate as a partial list',async()=>{
 const payload=structuredClone(pack.payload);payload.sources['common/credits.json']=JSON.stringify({items:[{name:'更新贡献者',contribution:'新实验模板'}]});const valid=await signedPayload(payload);const read=await verifyDataPayload(valid.bytes,valid.m,context);assert.match(read.sources['common/credits.json'],/更新贡献者/);
 payload.sources['common/credits.json']=JSON.stringify({items:[{name:'正常',contribution:'正常'},{name:'',contribution:'错误'}]});const invalid=await signedPayload(payload);await assert.rejects(verifyDataPayload(invalid.bytes,invalid.m,context),/致谢/);
});

test('complete current mobile data package verifies its signature, real 28-experiment layout, templates and font',async()=>{
 const verified=await verifyDataManifest(manifest,context),payload=await verifyDataPayload(pack.bytes,verified,context);
 assert.equal(payload.catalog.experiments.length,28);assert.equal(Object.keys(payload.sources).length,173);assert.equal(Object.keys(payload.variants).length,28);assert.ok(pack.bytes.length<3*1024*1024);assert.equal(verified.layoutHash,await dataLayoutHash(context.experiments));
 verified.notes='changed locally';assert.equal(manifest.notes,'测试发布，未上线');
 assert.equal(stableJson({b:2,a:1}),stableJson({a:1,b:2}));
});
test('unsigned desktop manifests and tampered signed metadata cannot authorize a mobile update',async()=>{
 await assert.rejects(verifyDataManifest(pack.manifest,context));
 await assert.rejects(verifyDataManifest({dataVersion:'1.0.1',signature:manifest.signature},context));
 for(const patch of [{notes:'tampered'},{sha256:'a'.repeat(64)},{signature:'A'.repeat(86)+'=='},{url:manifest.url.replace('data-1.0.1','other')}])await assert.rejects(verifyDataManifest({...manifest,...patch},context));
 const other=crypto.generateKeyPairSync('ed25519');await assert.rejects(verifyDataManifest(manifest,{...context,publicKey:other.publicKey.export({type:'spki',format:'pem'})}),/签名/);
 assert.throws(()=>signMobileDataManifest(pack.manifest,privatePem,other.publicKey.export({type:'spki',format:'pem'})),/不匹配/);
});
test('version, runtime, layout and fixed download source gates reject incompatible packages',async()=>{
 for(const patch of [{dataVersion:'1.0.0'},{dataVersion:'01.0.1'},{minAppVersion:'1.0.0'},{runtimeHash:'f'.repeat(64)},{layoutHash:'f'.repeat(64)},{size:8*1024*1024+1},{adapterVersion:2}])await assert.rejects(verifyDataManifest(sign({...pack.manifest,...patch}),context));
 for(const url of ['http://labreport-1485394950.cos.ap-guangzhou.myqcloud.com/mobile-data/data.json','https://example.com/mobile-data/data.json',manifest.url+'?other=1',manifest.url+'#x','https://user@labreport-1485394950.cos.ap-guangzhou.myqcloud.com/mobile-data/data.json',manifest.url.replace('/mobile-data/','/../')])await assert.rejects(verifyDataManifest(sign({...pack.manifest,url}),context),/来源/);
 assert.equal(compareDataVersion('1.10.0','1.9.9'),1);assert.equal(compareDataVersion('1.0.1','1.0.1'),0);
});
test('payload bytes remain bound to signed metadata, exact UTF-8 and strict mobile envelope',async()=>{
 const corrupt=pack.bytes.slice();corrupt[corrupt.length-2]^=1;await assert.rejects(verifyDataPayload(corrupt,manifest,context),/摘要/);
 const p={...pack.payload,extra:true},bad=await signedPayload(p);await assert.rejects(verifyDataPayload(bad.bytes,bad.m,context),/协议/);
 const malformed=new Uint8Array([255,254]),m=sign({...pack.manifest,size:2,sha256:await dataHash(malformed)});await assert.rejects(verifyDataPayload(malformed,m,context),/UTF-8/);
 const foreign=await signedPayload({...pack.payload,dataVersion:'2.0.0'});await assert.rejects(verifyDataPayload(foreign.bytes,foreign.m,context),/清单不一致/);
});
test('even signed source trees reject traversal, unknown roots, missing common components and mismatched schemas',async()=>{
 const e=context.experiments[0];
 for(const alter of [p=>{p.sources['common/../evil.py']='pass';},p=>{p.sources['common/native.exe']='native';},p=>{p.sources['unknown/generate.py']='pass';},p=>{delete p.sources['common/docx_omml.py'];},p=>{delete p.sources[e.sourceId+'/generate.py'];},p=>{p.sources[e.sourceId+'/schema.json']='{"groups":[]}';},p=>{p.catalog.experiments[0].schemaHash='0'.repeat(64);}]){
  const p=structuredClone(pack.payload);alter(p);const {bytes,m}=await signedPayload(p);await assert.rejects(verifyDataPayload(bytes,m,context));
 }
});
test('UI templates and runtime template archive must be the same experiment and content',async()=>{
 const e=context.experiments[0];for(const alter of [p=>{p.variants[e.id].实验原理[0]='mismatch';},p=>{delete p.variants[e.id];},p=>{p.variants.other={实验原理:['foreign']};},p=>{p.variants[e.id].实验原理=[''];p.sources[e.sourceId+'/variants.json']=JSON.stringify(p.variants[e.id]);}]){
  const p=structuredClone(pack.payload);alter(p);const {bytes,m}=await signedPayload(p);await assert.rejects(verifyDataPayload(bytes,m,context),/模板|正文/);
 }
 const p=structuredClone(pack.payload);p.fontBase64='A'.repeat(1200);const bad=await signedPayload(p);await assert.rejects(verifyDataPayload(bad.bytes,bad.m,context),/字体/);
});
test('manifest canonicalization is stable and packaged publishing key is public-only',()=>{
 const reordered=Object.fromEntries(Object.entries(manifest).reverse());assert.equal(manifestSigningText(reordered),manifestSigningText(manifest));
 const production=fs.readFileSync(path.join(root,'src/data/update-public-key.pem'),'utf8');assert.match(production,/BEGIN PUBLIC KEY/);assert.doesNotMatch(production,/PRIVATE/);assert.equal(crypto.createPublicKey(production).asymmetricKeyType,'ed25519');
});
