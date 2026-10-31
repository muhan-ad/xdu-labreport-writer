import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {fillDebugData,restoreDebugData,validDebugBackup} from '../src/domain/developer-tools.ts';
import {recordBlank,importMeasurements} from '../src/domain/model.ts';import {Repository} from '../src/domain/repository.ts';
const experiments=JSON.parse(fs.readFileSync(new URL('../src/data/catalog.json',import.meta.url))).experiments,samples=JSON.parse(fs.readFileSync(new URL('../src/data/test-measurements.json',import.meta.url)));
function setup(){const records=new Map(experiments.map(e=>[e.id,recordBlank(e)])),originals=structuredClone([...records]),events=[];let backup;const port={read:async e=>structuredClone(records.get(e.id)),write:async(e,r)=>{events.push('write:'+e.id);records.set(e.id,structuredClone(r));},interrupted:async()=>false,pending:async()=>{},backup:async value=>{events.push('backup');backup=structuredClone(value);}};return {records,originals,events,port,backup:()=>backup};}
test('all 28 samples validate before durable backup; round-trip restores originals exactly',async()=>{
 const f=setup();await fillDebugData(experiments,samples,f.port);assert.equal(f.events[0],'backup');assert.equal(f.events.length,29);assert.equal(validDebugBackup(experiments,f.backup()),true);
 assert.ok([...f.records.values()].every(r=>r.updatedAt));await restoreDebugData(experiments,f.backup(),f.port);assert.deepEqual([...f.records],f.originals);
});
test('existing nonempty drafts and dates are backed up and restored byte-for-byte at JSON level',async()=>{
 const f=setup();for(const exp of experiments.slice(0,3)){const record=f.records.get(exp.id);record.draft=importMeasurements(exp,samples[exp.id]);record.date='2026-10-19';record.updatedAt='previous-user-edit';}
 const original=JSON.stringify([...f.records]);await fillDebugData(experiments,samples,f.port);await restoreDebugData(experiments,f.backup(),f.port);assert.equal(JSON.stringify([...f.records]),original);
});
test('a malformed final sample or failed backup causes zero measurement mutations',async()=>{
 for(const backupFails of [false,true]){const f=setup(),bad=structuredClone(samples);if(backupFails)f.port.backup=async()=>{throw Error('disk full');};else bad[experiments.at(-1).id]={};await assert.rejects(fillDebugData(experiments,bad,f.port));assert.equal(f.events.filter(x=>x.startsWith('write:')).length,0);assert.deepEqual([...f.records],f.originals);}
});
test('write that changes disk then fails is included in rollback, not blindly retried',async()=>{
 const f=setup(),write=f.port.write;let calls=0;f.port.write=async(e,r)=>{await write(e,r);if(++calls===3)throw Error('ambiguous write');};
 await assert.rejects(fillDebugData(experiments,samples,f.port),/本次写入前的测量数据已恢复/);assert.deepEqual([...f.records],f.originals);assert.ok(f.backup());
});
test('rollback failure names unresolved experiment and keeps the full backup',async()=>{
 const f=setup(),write=f.port.write;let calls=0;f.port.write=async(e,r)=>{if(++calls>=3)throw Error('disk gone');await write(e,r);};
 await assert.rejects(fillDebugData(experiments,samples,f.port),error=>error.message.includes('未能恢复')&&error.message.includes(experiments[0].name));assert.equal(validDebugBackup(experiments,f.backup()),true);
});
test('readback mismatch rolls back; malformed restore backup never mutates',async()=>{
 const f=setup(),read=f.port.read;let writes=0;const write=f.port.write;f.port.write=async(e,r)=>{writes++;await write(e,r);};f.port.read=async e=>{const r=await read(e);if(writes===1&&r.updatedAt)r.updatedAt='mismatched';return r;};
 await assert.rejects(fillDebugData(experiments,samples,f.port),/回读不一致/);assert.deepEqual([...f.records],f.originals);
 const before=f.events.length;await assert.rejects(restoreDebugData(experiments,{version:1,createdAt:new Date().toISOString(),records:[]},f.port));assert.equal(f.events.length,before);
});
test('developer preference and two-copy backup survive a repository restart without modifying reports or photos',async()=>{
 const files=new Map([['report-untouched-a','private report'],['photo-untouched-a','private photo']]),store={read:async k=>files.get(k)??null,write:async(k,v)=>{files.set(k,v);},remove:async k=>{files.delete(k);}},repo=new Repository(store);
 assert.equal(await repo.loadDeveloperMode(),false);await repo.saveDeveloperMode(true);assert.equal(await new Repository(store).loadDeveloperMode(),true);
 const backup={version:1,createdAt:new Date().toISOString(),records:experiments.map(recordBlank)};await repo.saveDebugBackup(experiments,backup);assert.deepEqual(await new Repository(store).loadDebugBackup(experiments),backup);
 assert.ok(files.has('debug-backup-a')&&files.has('debug-backup-b'));files.set('debug-backup-a','corrupt');assert.deepEqual(await new Repository(store).loadDebugBackup(experiments),backup);
 files.set('debug-backup-b','corrupt');await assert.rejects(new Repository(store).loadDebugBackup(experiments));assert.equal(files.get('report-untouched-a'),'private report');assert.equal(files.get('photo-untouched-a'),'private photo');
 await repo.clearDebugBackup();assert.equal(await new Repository(store).loadDebugBackup(experiments),null);assert.equal(files.get('report-untouched-a'),'private report');
});
test('single-experiment backup restores only its scope and leaves later edits to other experiments intact',async()=>{
 const f=setup(),selected=experiments[0],other=experiments[1];await fillDebugData([selected],samples,f.port);
 assert.equal(validDebugBackup(experiments,f.backup()),true);assert.equal(f.backup().records.length,1);
 const edit=f.records.get(other.id);edit.draft=importMeasurements(other,samples[other.id]);edit.updatedAt='unrelated-edit';const untouched=structuredClone(edit);
 await restoreDebugData(experiments,f.backup(),f.port);assert.deepEqual(f.records.get(selected.id),f.originals[0][1]);assert.deepEqual(f.records.get(other.id),untouched);
});
test('pending-operation marker is durable across repository restart and recovery clears it',async()=>{
 const files=new Map(),store={read:async k=>files.get(k)??null,write:async(k,v)=>{files.set(k,v);},remove:async k=>{files.delete(k);}},repo=new Repository(store),before=experiments.map(recordBlank);
 await repo.saveDebugBackup(experiments,{version:1,createdAt:new Date().toISOString(),records:before});await repo.saveDebugOperation('fill');
 for(const exp of experiments.slice(0,3))await repo.save(exp,{...recordBlank(exp),draft:importMeasurements(exp,samples[exp.id])});
 const restarted=new Repository(store),port={read:async e=>(await restarted.load(e)).record,write:restarted.save.bind(restarted),backup:restarted.saveDebugBackup.bind(restarted,experiments),interrupted:()=>restarted.loadDebugInterrupted(),pending:p=>restarted.saveDebugOperation(p)};
 assert.equal(await restarted.loadDebugInterrupted(),true);await assert.rejects(fillDebugData(experiments,samples,port),/请先恢复/);
 await restoreDebugData(experiments,await restarted.loadDebugBackup(experiments),port);assert.equal(await new Repository(store).loadDebugInterrupted(),false);
 for(let i=0;i<experiments.length;i++)assert.deepEqual(await port.read(experiments[i]),before[i]);
});
test('marker cannot be persisted before mutation: no measurement writes occur',async()=>{
 const f=setup();f.port.pending=async()=>{throw Error('marker write failed');};await assert.rejects(fillDebugData(experiments,samples,f.port),/marker/);assert.deepEqual([...f.records],f.originals);assert.ok(f.backup());
});
test('failure clearing completion marker does not roll back already verified measurements',async()=>{
 const f=setup();f.port.pending=async phase=>{if(phase===null)throw Error('marker clear failed');};await assert.rejects(fillDebugData(experiments,samples,f.port),/测量数据已写入并核对/);assert.equal(f.events.filter(e=>e.startsWith('write:')).length,28);
});
test('failed recovery keeps the earlier interrupted state even if its own writes roll back',async()=>{
 const f=setup();await fillDebugData(experiments,samples,f.port);let pending=true,calls=0;f.port.interrupted=async()=>pending;f.port.pending=async phase=>{pending=phase!==null;};const write=f.port.write;f.port.write=async(e,r)=>{await write(e,r);if(++calls===2)throw Error('restore failed');};
 await assert.rejects(restoreDebugData(experiments,f.backup(),f.port));assert.equal(pending,true);
});
