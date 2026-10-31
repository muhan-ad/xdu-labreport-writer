import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {parseCredits} from '../src/domain/credits.ts';
test('credits preserve publisher text as inert data and return independent bounded entries',()=>{
 const input={items:[{name:' <b>名字</b> ',contribution:'贡献 & <img src=x onerror=alert(1)>'}]},result=parseCredits(input);assert.equal(result.items[0].name,'<b>名字</b>');assert.equal(result.items[0].contribution,input.items[0].contribution);result.items[0].name='changed';assert.notEqual(input.items[0].name,'changed');assert.deepEqual(parseCredits({items:[]}),{items:[]});
});
test('malformed or unbounded credit payloads reject without partially accepting a list',()=>{
 for(const bad of [null,[],{},'{', ' '.repeat(65537),{items:Array(201).fill({name:'a',contribution:'b'})},{items:[{name:'valid',contribution:'valid'},{name:'',contribution:'b'}]},{items:[{name:'a'.repeat(101),contribution:'b'}]},{items:[{name:'a',contribution:'b'.repeat(501)}]},{items:[{name:'a\0',contribution:'b'}]},{items:[null]}])assert.throws(()=>parseCredits(bad));
});
test('bundled thanks match shipped source archive and school help keeps original scoped questions',()=>{
 const sources=JSON.parse(fs.readFileSync(new URL('../public/report-runtime/report-sources.json',import.meta.url))),credits=JSON.parse(fs.readFileSync(new URL('../src/data/credits.json',import.meta.url)));assert.deepEqual(parseCredits(sources['common/credits.json']),parseCredits(credits));assert.equal(credits.items.length,6);
 const faq=JSON.parse(fs.readFileSync(new URL('../src/data/school-faq.json',import.meta.url)));assert.equal(faq.length,2);assert.equal(faq.flatMap(g=>g.items).length,11);assert.equal(new Set(faq.flatMap(g=>g.items.map(i=>i.id))).size,11);assert.ok(faq[0].items.some(i=>i.answer.includes('72小时')));assert.ok(!faq.flatMap(g=>g.items).some(i=>i.question.includes('仿真')));
});
