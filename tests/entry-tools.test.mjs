import test from 'node:test';import assert from 'node:assert/strict';
import {editNumericToken,viewportInsets} from '../src/domain/entry-tools.ts';
test('sign editing preserves draft precision, selected digits and explicit plus',()=>{
 assert.deepEqual(editNumericToken('12.3400',2,5,'sign'),{value:'-12.3400',start:3,end:6});
 assert.deepEqual(editNumericToken('-12',0,3,'sign'),{value:'12',start:0,end:2});
 assert.deepEqual(editNumericToken('+12',1,3,'sign'),{value:'-12',start:1,end:3});
});
test('exponent inserts at selection, avoids duplicate e and supports empty signed drafts',()=>{
 assert.deepEqual(editNumericToken('12',1,1,'exponent-token'),{value:'1e2',start:2,end:2});
 assert.deepEqual(editNumericToken('1.23',1,3,'exponent-token'),{value:'1e3',start:2,end:2});
 assert.deepEqual(editNumericToken('1e-3',0,0,'exponent-token'),{value:'1e-3',start:2,end:2});
 assert.equal(editNumericToken('',0,0,'exponent-token').value,'1e');
 assert.equal(editNumericToken('-',1,1,'exponent-token').value,'-1e');
 assert.equal(editNumericToken('1E3',1,2,'exponent-token').value,'1e3');
});
test('entry tools never truncate long numbers to fit maxlength',()=>{
 const value='1'.repeat(100);for(const token of ['sign','exponent-token'])assert.equal(editNumericToken(value,50,50,token).value,value);
});
test('visual-only keyboard adds gap, native resize adds none, panning accounts for top and zoom is untouched',()=>{
 assert.deepEqual(viewportInsets(844,360,0,1),{top:0,bottom:484,height:360});
 assert.deepEqual(viewportInsets(360,360,0,1),{top:0,bottom:0,height:360});
 assert.deepEqual(viewportInsets(844,360,30,1),{top:30,bottom:454,height:360});
 assert.equal(viewportInsets(844,360,0,2),null);assert.equal(viewportInsets(844,NaN,0,1),null);
});
