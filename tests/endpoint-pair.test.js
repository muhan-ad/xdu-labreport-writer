const test = require('node:test');
const assert = require('node:assert/strict');
const {removeEndpointPair} = require('../src/shared/data-validation');
for (const [key, pairedMatrix] of [['D_x','Udx'], ['D_y','Udy'], ['D_m','Im']]) {
  test(`${key}: remove both ends and keep all three rows aligned`, () => {
    const field = {key, pairedMatrix, minLength:3};
    const data = {[key]:[-3,-2,-1,0,1,2,3], [pairedMatrix]:[0,10,20].map(n => Array.from({length:7}, (_,i)=>n+i))};
    assert.equal(removeEndpointPair(field,data),true);
    assert.deepEqual(data[key],[-2,-1,0,1,2]);
    assert.deepEqual(data[pairedMatrix],[[1,2,3,4,5],[11,12,13,14,15],[21,22,23,24,25]]);
    assert.equal(removeEndpointPair(field,data),true);
    const snapshot = JSON.stringify(data);
    assert.equal(removeEndpointPair(field,data),false);
    assert.equal(JSON.stringify(data),snapshot);
    data[key]=[1,2,3,4];
    assert.equal(removeEndpointPair(field,data),false);
  });
}
