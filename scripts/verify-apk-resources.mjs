// Uses the ZIP reader already pinned by the Capacitor build-tool lockfile. No extraction.
import yauzl from 'yauzl';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'),apk=path.resolve(process.argv[2]||path.join(root,'android/app/build/outputs/apk/debug/app-debug.apk'));
const zip=await new Promise((resolve,reject)=>yauzl.open(apk,{lazyEntries:true,autoClose:false},(error,zip)=>error?reject(error):resolve(zip)));
try{
 const entries=new Map();await new Promise((resolve,reject)=>{zip.on('error',reject);zip.on('entry',entry=>{if(entries.has(entry.fileName)){reject(Error('Duplicate APK entry'));return;}entries.set(entry.fileName,entry);zip.readEntry();});zip.on('end',resolve);zip.readEntry();});
 const stream=entry=>new Promise((resolve,reject)=>zip.openReadStream(entry,(error,input)=>error?reject(error):resolve(input)));
 const consume=async(entry,onChunk)=>{const input=await stream(entry);await new Promise((resolve,reject)=>{input.on('data',block=>{try{onChunk(block);}catch(e){reject(e);input.destroy();}});input.on('error',reject);input.on('end',resolve);});};
 const inventoryEntry=entries.get('assets/resource-integrity.json');assert.ok(inventoryEntry,'Resource inventory missing');assert.ok(inventoryEntry.uncompressedSize<8*1024*1024);
 const blocks=[];await consume(inventoryEntry,block=>blocks.push(block));const manifest=JSON.parse(Buffer.concat(blocks));
 assert.equal(manifest.schema,1);assert.equal(manifest.version,JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version);assert.ok(manifest.files.length>0&&manifest.files.length<=10000);
 const expected=new Set(manifest.files.map(f=>f.path));assert.equal(expected.size,manifest.files.length);
 const actual=new Set([...entries.keys()].filter(n=>!n.endsWith('/')&&n!=='assets/resource-integrity.json'&&(n.startsWith('assets/')||(n.startsWith('lib/')&&n.endsWith('.so')))));
 assert.deepEqual([...expected].sort(),[...actual].sort(),'APK resource coverage differs from inventory');
 const bridgeConfigEntry=entries.get('assets/capacitor.config.json');assert.ok(bridgeConfigEntry&&bridgeConfigEntry.uncompressedSize<65536,'Native bridge configuration missing or oversized');
 const bridgeConfigBlocks=[];await consume(bridgeConfigEntry,block=>bridgeConfigBlocks.push(block));
 assert.equal(JSON.parse(Buffer.concat(bridgeConfigBlocks)).loggingBehavior,'none','Native bridge argument logging must remain disabled for saved credentials and API keys');
 for(const f of manifest.files){const entry=entries.get(f.path);assert.equal(entry.uncompressedSize,f.bytes,f.path);const hash=crypto.createHash('sha256');let bytes=0;await consume(entry,block=>{bytes+=block.length;assert.ok(bytes<=f.bytes);hash.update(block);});assert.equal(bytes,f.bytes);assert.equal(hash.digest('hex'),f.sha256,f.path);}
 function* walk(dir){for(const name of fs.readdirSync(dir)){const f=path.join(dir,name);if(fs.statSync(f).isDirectory())yield* walk(f);else yield f;}}
 const sourcePairs=[...walk(path.join(root,'dist'))].map(f=>[f,'assets/public/'+path.relative(path.join(root,'dist'),f).replaceAll('\\','/')]);sourcePairs.push([path.join(root,'src/native/report-reader.js'),'assets/report-reader.js'],[path.join(root,'src/data/course-aliases.json'),'assets/report-aliases.json'],[path.join(root,'src/native/timetable-reader.js'),'assets/timetable-reader.js']);
 for(const [file,entry] of sourcePairs){const expectedHash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');assert.equal(manifest.files.find(f=>f.path===entry)?.sha256,expectedHash,'Built source mismatch: '+entry);}
 console.log(JSON.stringify({version:manifest.version,resourceFiles:manifest.files.length,resourceBytes:manifest.files.reduce((n,f)=>n+f.bytes,0),builtWebFiles:sourcePairs.length-3,complete:true}));
}finally{zip.close();}
