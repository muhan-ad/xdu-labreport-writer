import test from 'node:test';import assert from 'node:assert/strict';
import {aiProviders,providerForEndpoint,providerDraft} from '../src/domain/ai-providers.ts';
test('known providers resolve by exact HTTPS origin and API path, not substring',()=>{
 for(const p of aiProviders){assert.equal(providerForEndpoint(p.endpoint),p.id);assert.equal(providerForEndpoint(p.endpoint+'/'),p.id);}
 assert.equal(providerForEndpoint('https://api.deepseek.com/v1'),'deepseek');
 for(const url of ['http://api.deepseek.com','https://api.deepseek.com.evil.test','https://api.deepseek.com/custom','https://api.deepseek.com?key=secret','https://x@api.deepseek.com','https://api.deepseek.com#x','bad'])assert.equal(providerForEndpoint(url),'custom');
});
test('provider draft separates chat and vision model lists without guessing SiliconFlow availability',()=>{
 const old={endpoint:'https://old.test/v1',model:'old',key:'demo'};
 assert.equal(providerDraft('deepseek','chat',old).model,'deepseek-flash');assert.equal(providerDraft('deepseek','vision',old).model,'deepseek-flash');
 assert.equal(providerDraft('mimo','vision',old).model,'mimo-v2.5');assert.equal(providerDraft('bailian','chat',old).model,'qwen-plus');assert.equal(providerDraft('bailian','vision',old).model,'qwen3-vl-plus');
 assert.equal(providerDraft('siliconflow','vision',old).model,'');assert.deepEqual(providerDraft('custom','chat',old),old);assert.deepEqual(providerDraft('unknown','chat',old),old);
});
test('switching service endpoints clears typed key while same native binding preserves it',()=>{
 const old={endpoint:'https://api.deepseek.com/',model:'old',key:'demo-key'};
 assert.equal(providerDraft('deepseek','chat',old).key,'demo-key');assert.equal(providerDraft('mimo','chat',old).key,'');
 assert.equal(providerDraft('deepseek','chat',{...old,endpoint:old.endpoint+'v1'}).key,'');assert.equal(old.key,'demo-key');
});
