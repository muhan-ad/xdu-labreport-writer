'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createSchoolAccounts}=require('../src/main/school-accounts');
test('standalone account service preserves legacy preference and course/report credential priority',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'school-accounts-')),preferencesFile=path.join(dir,'preferences.json'),values=new Map([['report',{username:'test',password:'private'}]]);
 const credentials={status:async id=>({configured:values.has(id),available:true}),get:async id=>values.get(id),save:async(v,id)=>{values.set(id,v);return {configured:true};},remove:id=>{values.delete(id);return {configured:false};}};
 try{
  fs.writeFileSync(preferencesFile,JSON.stringify({autoFillEnabled:false}));let a=createSchoolAccounts({credentials,preferencesFile});assert.equal(a.getAutoFillEnabled(),false);assert.equal((await a.courseLogin()).enabled,false);
  assert.equal((await a.accountSettings('set-auto-fill',{enabled:true})).ok,true);a=createSchoolAccounts({credentials,preferencesFile});assert.equal((await a.courseLogin()).source,'report');
  await a.accountSettings('save',{systemId:'course',username:'course-test',password:'course-secret'});assert.equal((await a.courseLogin()).source,'course');
  const state=await a.accountSettings('status',{systemId:'course'});assert.equal(state.configured,true);assert.doesNotMatch(JSON.stringify(state),/course-secret|private|course-test/);
  assert.equal((await a.accountSettings('status',{systemId:'forged'})).ok,false);await a.accountSettings('delete',{systemId:'course'});assert.equal((await a.courseLogin()).source,'report');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
