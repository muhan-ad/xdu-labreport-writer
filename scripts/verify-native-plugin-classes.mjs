import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import yauzl from 'yauzl';
const root=path.resolve(import.meta.dirname,'..'),apk=path.resolve(process.argv[2]||path.join(root,'android/app/build/outputs/apk/debug/app-debug.apk'));
const main=fs.readFileSync(path.join(root,'android/app/src/main/java/com/labmaker/app/MainActivity.java'),'utf8');
const expected=[...new Set([...main.matchAll(/registerPlugin\(([A-Za-z0-9_]+)\.class\)/g)].map(m=>m[1]).concat(['MobileAppDownload','MobileAppPolicy','SchoolAccountVault','SchoolAccountStorage','SchoolSavedLogin','AcademicAuthority','AcademicSession','AcademicTimetable','AcademicWebPolicy','AcademicCache','AcademicCacheStorage','ReportExport','ReportFilePolicy','ReportStageVerifier','FeedbackUpload','ContributionUpload','APIModels','AIConfiguration','AIStreamReader','ResourceCacheReset','MobileDataDownload']))].map(n=>'Lcom/labmaker/app/'+n+';');
const bundled=JSON.parse(fs.readFileSync(path.join(root,'android/app/src/main/assets/capacitor.plugins.json'),'utf8'));
for(const plugin of bundled){assert.match(plugin.classpath,/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/);expected.push('L'+plugin.classpath.replaceAll('.','/')+';');}
const zip=await new Promise((resolve,reject)=>yauzl.open(apk,{lazyEntries:true,autoClose:false},(e,z)=>e?reject(e):resolve(z)));
const found=new Set();let dexFiles=0;
try{
 const entries=[];await new Promise((resolve,reject)=>{zip.on('error',reject);zip.on('entry',e=>{if(/^classes\d*\.dex$/.test(e.fileName))entries.push(e);zip.readEntry();});zip.on('end',resolve);zip.readEntry();});
 for(const entry of entries){
  assert.ok(entry.uncompressedSize>112&&entry.uncompressedSize<=64*1024*1024,'Unexpected DEX size');
  const input=await new Promise((resolve,reject)=>zip.openReadStream(entry,(e,s)=>e?reject(e):resolve(s))),blocks=[];let length=0;
  await new Promise((resolve,reject)=>{input.on('data',b=>{length+=b.length;if(length>entry.uncompressedSize){input.destroy();reject(Error('DEX overflow'));}else blocks.push(b);});input.on('error',reject);input.on('end',resolve);});
  const data=Buffer.concat(blocks);assert.equal(data.subarray(0,4).toString(),'dex\n');dexFiles++;
  const strings=data.readUInt32LE(0x3c),types=data.readUInt32LE(0x44),count=data.readUInt32LE(0x60),definitions=data.readUInt32LE(0x64);
  assert.ok(definitions+count*32<=data.length);
  for(let i=0;i<count;i++){
   const typeIndex=data.readUInt32LE(definitions+i*32),stringIndex=data.readUInt32LE(types+typeIndex*4);let offset=data.readUInt32LE(strings+stringIndex*4),steps=0;
   while(data[offset++]&128){assert.ok(++steps<5,'Invalid DEX string length');}
   const end=data.indexOf(0,offset);assert.ok(end>=offset&&end-offset<65536);found.add(data.subarray(offset,end).toString('utf8'));
  }
 }
 for(const descriptor of expected)assert.ok(found.has(descriptor),'Native class definition missing: '+descriptor);
 assert.ok(!found.has('Lcom/labmaker/app/NativeFileReceiverActivity;'),'Local acceptance receiver must not enter a delivery APK');
 assert.ok(!found.has('Lcom/labmaker/app/NativeInstallerActivity;'),'Local acceptance installer must not enter a delivery APK');
 console.log(JSON.stringify({dexFiles,nativeDefinitionsChecked:expected.length,classes:expected.map(n=>n.slice(1,-1).replaceAll('/','.')),complete:true}));
}finally{zip.close();}
