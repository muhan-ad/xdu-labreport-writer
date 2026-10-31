import {dataRuntimeHash,dataLayoutHash,dataHash,stableJson,manifestSigningText,verifyDataManifest,verifyDataPayload,type DataManifest,type DataPayload} from '../../src/domain/data-package.ts';
export async function makeBrowserDataPackage(mutate?:(p:DataPayload)=>void,portableTestSigner=false){
 const base='/report-runtime/',manifest=await (await fetch(base+'manifest.json')).json(),catalog=await (await fetch(base+'catalog.json')).json(),sources=await (await fetch(base+'report-sources.json')).json(),font=new Uint8Array(await (await fetch(base+'LabMakerSansSC.ttf')).arrayBuffer());
 let binary='';for(let i=0;i<font.length;i+=8192)binary+=String.fromCharCode(...font.subarray(i,i+8192));
 const runtimeHash=await dataRuntimeHash(manifest),layoutHash=await dataLayoutHash(catalog.experiments),variants=Object.fromEntries(catalog.experiments.map((e:{id:string;sourceId:string})=>[e.id,JSON.parse(sources[e.sourceId+'/variants.json'])]));
 const payload:DataPayload={kind:'lab-maker-mobile-data',schema:1,dataVersion:'1.0.1',adapterVersion:1,runtimeHash,layoutHash,catalog,variants,sources,fontBase64:btoa(binary)};mutate?.(payload);const bytes=new TextEncoder().encode(stableJson(payload));
 // An ephemeral test signer; its private key never leaves this browser execution.
 let publicBytes:Uint8Array,sign:(message:Uint8Array)=>Promise<Uint8Array>;
 if(portableTestSigner){const ed=await import('@noble/ed25519'),seed=crypto.getRandomValues(new Uint8Array(32)),raw=await ed.getPublicKeyAsync(seed);publicBytes=new Uint8Array([0x30,0x2a,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x03,0x21,0x00,...raw]);sign=message=>ed.signAsync(message,seed);}
 else{const keys=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']) as CryptoKeyPair;publicBytes=new Uint8Array(await crypto.subtle.exportKey('spki',keys.publicKey));sign=async message=>new Uint8Array(await crypto.subtle.sign({name:'Ed25519'},keys.privateKey,message as Uint8Array<ArrayBuffer>));}
 const publicKey='-----BEGIN PUBLIC KEY-----\n'+btoa(String.fromCharCode(...publicBytes))+'\n-----END PUBLIC KEY-----';
 const unsigned={kind:'lab-maker-mobile-data' as const,schema:1 as const,dataVersion:'1.0.1',minAppVersion:'0.40.0',adapterVersion:1 as const,runtimeHash,layoutHash,url:'https://labreport-1485394950.cos.ap-guangzhou.myqcloud.com/mobile-data/data-1.0.1.json',size:bytes.length,sha256:await dataHash(bytes),notes:'浏览器测试'};
 const signature=await sign(new TextEncoder().encode(manifestSigningText(unsigned)));
 const signed:DataManifest={...unsigned,signature:btoa(String.fromCharCode(...signature))},ctx={appVersion:'0.40.0',currentVersion:'1.0.0',runtimeHash,experiments:catalog.experiments,publicKey};
 return {bytes,signed,ctx,payload,envelope:{manifest:signed,body:new TextDecoder().decode(bytes)},resign:async(next:DataPayload)=>{const body=stableJson(next),nextBytes=new TextEncoder().encode(body),m={...unsigned,dataVersion:next.dataVersion,url:unsigned.url.replace('1.0.1',next.dataVersion),sha256:await dataHash(nextBytes),size:nextBytes.length},signature=await sign(new TextEncoder().encode(manifestSigningText(m)));return {body,manifest:{...m,signature:btoa(String.fromCharCode(...signature))}};}};
}
export async function verifyBrowserDataPackage(){
 const {bytes,signed,ctx}=await makeBrowserDataPackage();
 const verified=await verifyDataPayload(bytes,signed,ctx);if(verified.catalog.experiments.length!==28)throw Error('实验数量不一致');
 let tampered=false;try{await verifyDataManifest({...signed,notes:'changed'},ctx);}catch{tampered=true;}if(!tampered)throw Error('篡改签名说明未拒绝');
 const corrupt=bytes.slice();corrupt[0]^=1;let rejected=false;try{await verifyDataPayload(corrupt,signed,ctx);}catch{rejected=true;}if(!rejected)throw Error('篡改资源未拒绝');
 return {checks:['real browser Ed25519 signature and full 28-experiment source/font envelope verify','tampered signed manifest is rejected','tampered payload bytes are rejected'],bytes:bytes.length,experiments:verified.catalog.experiments.length};
}
