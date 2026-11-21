import fs from 'node:fs';import assert from 'node:assert/strict';
import {verifyDataPayload,dataRuntimeHash} from '../src/domain/data-package.ts';
import {DataUpdateStore} from '../src/domain/data-update-store.ts';
const root=new URL('../',import.meta.url),read=n=>JSON.parse(fs.readFileSync(new URL(n,root),'utf8'));
const base='https://labreport-1485394950.cos.ap-guangzhou.myqcloud.com';
async function get(url){const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)});assert.equal(r.status,200);return new Uint8Array(await r.arrayBuffer());}
const manifest=JSON.parse(new TextDecoder().decode(await get(base+'/mobile-data-manifest.json'))),bytes=await get(manifest.url);
const context={appVersion:read('package.json').version,currentVersion:'0.0.0',runtimeHash:await dataRuntimeHash(read('public/report-runtime/manifest.json')),experiments:read('src/data/catalog.json').experiments,publicKey:fs.readFileSync(new URL('src/data/update-public-key.pem',root),'utf8')};
const payload=await verifyDataPayload(bytes,manifest,context);assert.equal(payload.dataVersion,read('src/data/resource-release.json').dataVersion);
assert.deepEqual(payload.sources,read('public/report-runtime/report-sources.json'));
const slots=new Map(),store=new DataUpdateStore({read:async k=>slots.get(k)??null,write:async(k,v)=>{slots.set(k,v);},remove:async k=>{slots.delete(k);}},context);
assert.equal((await store.inspectManifest(manifest)).available,true);
await store.install({manifest,body:new TextDecoder().decode(bytes)},async p=>({complete:p.catalog.experiments.length===28}),new AbortController().signal);
assert.equal((await store.inspectManifest(manifest)).available,false);assert.equal((await store.load()).version,payload.dataVersion);
console.log(JSON.stringify({anonymousDownload:true,publisherSignature:true,sha256:manifest.sha256,experiments:payload.catalog.experiments.length,sourcesMatchBuiltin:true,simulatedStoreActivateAndReopen:true,deviceInstall:false}));
