import {compareDataVersion,stableJson,DATA_HOST} from './data-package.ts';
import {verifyPublisherSignature} from './publisher-signature.ts';
export const MAX_APK_BYTES=150*1024*1024;
export interface AppManifest{kind:'lab-maker-mobile-app';schema:1;appId:'com.labmaker.app';version:string;versionCode:number;minAndroid:number;size:number;sha256:string;certificateSha256:string;url:string;notes:string;signature:string;}
export interface InstalledApp{appId:string;version:string;versionCode:number;android:number;certificateSha256:string;}
export function appSigningText(manifest:AppManifest){const {signature,...body}=manifest;return stableJson(body);}
function base64(value:string){if(!/^[A-Za-z0-9+/]+={0,2}$/.test(value)||value.length>512)throw Error('应用更新签名格式无效');try{return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}catch{throw Error('应用更新签名格式无效');}}
export async function verifyAppManifest(raw:unknown,publicKey:string):Promise<AppManifest>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('应用更新清单无效');const m=raw as AppManifest;
 const fields=['kind','schema','appId','version','versionCode','minAndroid','size','sha256','certificateSha256','url','notes','signature'];
 if(Object.keys(m).length!==fields.length||Object.keys(m).some(k=>!fields.includes(k))||m.kind!=='lab-maker-mobile-app'||m.schema!==1||m.appId!=='com.labmaker.app')throw Error('此更新不适用于本应用');
 compareDataVersion(m.version,m.version);
 if(!Number.isInteger(m.versionCode)||m.versionCode<1||m.versionCode>2100000000||!Number.isInteger(m.minAndroid)||m.minAndroid<24||m.minAndroid>100||!Number.isSafeInteger(m.size)||m.size<1||m.size>MAX_APK_BYTES||typeof m.notes!=='string'||m.notes.length>8000||![m.sha256,m.certificateSha256].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)))throw Error('应用更新版本、大小或摘要无效');
 let url:URL;try{url=new URL(m.url);}catch{throw Error('应用更新地址无效');}
 if(url.href!==m.url||url.protocol!=='https:'||url.hostname!==DATA_HOST||url.port||url.username||url.password||url.search||url.hash||url.pathname!==`/mobile-app/lab-maker-app-${m.version}.apk`)throw Error('应用更新来源不正确');
 const signature=base64(m.signature);if(signature.length!==64)throw Error('应用更新签名长度无效');
 let verified:boolean;try{verified=await verifyPublisherSignature(base64(publicKey.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g,'')),signature,new TextEncoder().encode(appSigningText(m)));}catch{throw Error('当前环境无法核对应用更新发布签名');}
 if(!verified)throw Error('应用更新发布签名验证失败');
 return structuredClone(m);
}
export function appUpdateState(manifest:AppManifest,installed:InstalledApp):'current'|'available'|'system-old'{
 if(installed.appId!==manifest.appId||installed.certificateSha256!==manifest.certificateSha256)throw Error('更新包签名与当前安装来源不同，不能覆盖安装');
 const order=compareDataVersion(manifest.version,installed.version);
 if(order<=0&&manifest.versionCode<=installed.versionCode)return 'current';
 if(order<=0||manifest.versionCode<=installed.versionCode)throw Error('应用更新版本号与构建号不一致');
 return installed.android<manifest.minAndroid?'system-old':'available';
}
