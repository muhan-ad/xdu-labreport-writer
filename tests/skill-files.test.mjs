import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {skillFile,parseSkillFile,stageSkillFile} from '../src/domain/skill-files.ts';import {parseSkill,textHash} from '../src/domain/ai-library.ts';
const make=async changes=>{const s={name:'实验技能',description:'正文说明',scope:'plot',content:'保留公式 $B=K d$。\n不改变单位。',enabled:false,...changes};return {id:await textHash(s.scope+'\n'+s.content),...s};};
const clean=s=>{const value={...s};delete value.builtin;return value;};
test('all four bundled skills export as Markdown and round trip full content, metadata, scope and identity',async()=>{
 for(const s of JSON.parse(fs.readFileSync(new URL('../src/data/ai-skills.json',import.meta.url)))){const f=skillFile(s);assert.ok(f.name.endsWith('.md'));assert.deepEqual(await parseSkillFile(f.name,f.text),clean(s));}
});
test('quoted multiline metadata and disabled state survive Markdown export and literal YAML quotation imports',async()=>{
 const s=await make({name:'实验 "A"\\技能\n下一行',description:'说明："\\text{单位}"\n保留换行'}),file=skillFile(s);assert.deepEqual(await parseSkillFile(file.name,file.text),s);assert.equal((await parseSkill('x.md',"---\nname: 'It''s a skill'\nscope: plot\n---\n内容")).name,"It's a skill");
});
test('noncanonical content and long escaped metadata fall back to reimportable JSON without losing bytes',async()=>{
 for(const s of [await make({content:'\n保留前后空白\r\n'}),await make({content:'测'.repeat(20000),description:'\0'.repeat(1000)})]){const f=skillFile(s);assert.ok(f.name.endsWith('.json'));assert.ok(Buffer.byteLength(f.text)<=131072);assert.deepEqual(await parseSkillFile(f.name,f.text),s);}
});
test('JSON skill imports reject foreign formats, unknown fields, invalid scope and oversize before adoption',async()=>{
 const s=await make({content:'\n完整内容\n'}),file=skillFile(s),pack=JSON.parse(file.text);
 for(const p of [{...pack,format:'record'},{...pack,version:2},{...pack,apiKey:'must-not-import'},{...pack,skill:{...pack.skill,scope:'any'}},{...pack,skill:{...pack.skill,enabled:'false'}},{...pack,skill:{...pack.skill,extra:'x'}}])await assert.rejects(parseSkillFile('skill.json',JSON.stringify(p)));
 await assert.rejects(parseSkillFile('skill.json','x'.repeat(131073)),/128 KB/);await assert.rejects(parseSkillFile('skill.md','x'.repeat(65537)),/64 KB/);await assert.rejects(parseSkillFile('skill.json','{bad'),/无法读取/);
});
test('safe exported leaf names retain original skill names inside the file and never contain path delimiters',async()=>{
 for(const name of ['../实验/技能\\名称:*?','CON','...']){const s=await make({name}),f=skillFile(s);assert.equal(/[<>:"/\\|?*\x00-\x1f]/.test(f.name),false);assert.deepEqual(await parseSkillFile(f.name,f.text),s);}
});
test('native skill staging verifies exact text before sharing, keeps recipient-readable files and isolates failed staging',async()=>{
 const f=skillFile(await make()),files=new Map(),shared=[],removed=[];let badRead=false,failShare=false;
 const port={write:async(path,text)=>{files.set(path,text);return {uri:'content://test/'+path}},read:async path=>badRead?'bad':files.get(path),remove:async path=>{removed.push(path);files.delete(path)},share:async(uri,name)=>{shared.push({uri,name});if(failShare)throw Error('share uncertain')}};
 await stageSkillFile(f,port);assert.equal(shared.length,1);assert.equal(files.size,1);assert.ok([...files.keys()][0].endsWith('/'+f.name));badRead=true;await assert.rejects(stageSkillFile(f,port),/核对失败/);assert.equal(shared.length,1);assert.equal(files.size,1);assert.equal(removed.length,1);
 badRead=false;failShare=true;await assert.rejects(stageSkillFile(f,port),/share uncertain/);assert.equal(files.size,2);assert.equal(removed.length,1);assert.equal([...files.values()].every(text=>text===f.text),true);
});

test('Android share cancellation is localized without treating it as success or removing the staged file',async()=>{
 const file=skillFile(await make()),files=new Map();let removed=false;
 const port={write:async(p,t)=>{files.set(p,t);return {uri:'file:///cache/'+p}},read:async p=>files.get(p),remove:async()=>{removed=true},share:async()=>{throw Error('Share canceled')}};
 await assert.rejects(stageSkillFile(file,port),/^Error: 已取消分享$/);assert.equal(removed,false);assert.equal(files.size,1);
 port.share=async()=>{throw Error('storage unavailable')};await assert.rejects(stageSkillFile(file,port),/storage unavailable/);
});
