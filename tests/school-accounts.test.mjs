import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {parseSchoolAccounts,schoolSystem} from '../src/domain/school-accounts.ts';
test('account summaries accept explicit school systems and locked rows but never password-bearing or duplicate responses',()=>{
 const account={id:crypto.randomUUID(),system:'course',account:'12345678',label:'选课测试',locked:false};
 assert.deepEqual(parseSchoolAccounts({accounts:[account]}),[account]);
 const locked={...account,id:crypto.randomUUID(),system:'report',account:'',label:'无法解密的账号',locked:true};assert.deepEqual(parseSchoolAccounts({accounts:[account,locked]}),[account,locked]);
 for(const row of [{...account,password:'must not reach UI'},{...account,system:'simulation'},{...account,id:'../escape'},{...account,account:''},{...locked,account:'12345678'},{...account,locked:'false'}])assert.throws(()=>parseSchoolAccounts({accounts:[row]}));
 assert.throws(()=>parseSchoolAccounts({accounts:[account,account]}));assert.throws(()=>parseSchoolAccounts({accounts:Array(51).fill(account)}));assert.equal(schoolSystem('academic'),true);assert.equal(schoolSystem('quiz'),false);
});
