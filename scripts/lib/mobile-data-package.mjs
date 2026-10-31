import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {dataHash,dataLayoutHash,dataRuntimeHash,stableJson,manifestSigningText,validateDataContents,compareDataVersion,MAX_DATA_BYTES,DATA_HOST} from '../../src/domain/data-package.ts';
export async function makeMobileDataPackage(root,{dataVersion,minAppVersion,notes=''}){
 compareDataVersion(dataVersion,dataVersion);compareDataVersion(minAppVersion,minAppVersion);
 if(typeof notes!=='string'||notes.length>8000)throw Error('更新说明超过 8000 字');
 const runtime=path.join(root,'public/report-runtime'),manifest=JSON.parse(fs.readFileSync(path.join(runtime,'manifest.json')));
 const read=name=>{const bytes=fs.readFileSync(path.join(runtime,name)),record=manifest.files[name];if(!record||record.bytes!==bytes.length||crypto.createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw Error('运行资源未核实：'+name);return bytes;};
 const catalog=JSON.parse(read('catalog.json')),sources=JSON.parse(read('report-sources.json')),font=read('LabMakerSansSC.ttf');
 if(stableJson(catalog)!==stableJson(JSON.parse(fs.readFileSync(path.join(root,'src/data/catalog.json')))))throw Error('源码实验目录与运行目录不一致，请先构建');
 const variants=JSON.parse(fs.readFileSync(path.join(root,'src/data/report-variants.json'))),runtimeHash=await dataRuntimeHash(manifest),layoutHash=await dataLayoutHash(catalog.experiments);
 const payload={kind:'lab-maker-mobile-data',schema:1,dataVersion,adapterVersion:1,runtimeHash,layoutHash,catalog,variants,sources,fontBase64:font.toString('base64')};
 await validateDataContents(payload,{runtimeHash,experiments:catalog.experiments});
 const bytes=new TextEncoder().encode(stableJson(payload));if(bytes.length>MAX_DATA_BYTES)throw Error('手机版数据包超过 8 MB');
 const unsigned={kind:'lab-maker-mobile-data',schema:1,dataVersion,minAppVersion,adapterVersion:1,runtimeHash,layoutHash,url:'https://'+DATA_HOST+'/mobile-data/data-'+dataVersion+'.json',size:bytes.length,sha256:await dataHash(bytes),notes};
 return {payload,bytes,manifest:unsigned};
}
export function signMobileDataManifest(manifest,key,publicKey){
 const privateKey=crypto.createPrivateKey(key),derived=crypto.createPublicKey(privateKey).export({type:'spki',format:'der'}),expected=crypto.createPublicKey(publicKey).export({type:'spki',format:'der'});
 if(privateKey.asymmetricKeyType!=='ed25519'||!derived.equals(expected))throw Error('签名私钥与应用发布公钥不匹配');
 return {...manifest,signature:crypto.sign(null,Buffer.from(manifestSigningText(manifest)),privateKey).toString('base64')};
}
