import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';import fs from 'node:fs';
import {parseSkill,skillPrompt,validSkills,textHash} from '../src/domain/ai-library.ts';import {Repository} from '../src/domain/repository.ts';
import {defaultReportSettings,detachAIHistory,validReportSettings} from '../src/domain/reports.ts';
const make=()=>{const data=new Map();return {data,repo:new Repository({read:async k=>data.get(k)??null,write:async(k,v)=>{data.set(k,v)},remove:async k=>{data.delete(k)}})};};const exp='abcdef123456',other='123456abcdef';
const entry=async(experimentId=exp)=>({id:crypto.randomUUID(),experimentId,kind:'polish',section:'结论',createdAt:new Date().toISOString(),source:'{"draft":{"x":"1"}}',sourceHash:await textHash('{"draft":{"x":"1"}}'),text:'保持实测结果与公式。',original:'原文',questions:[]});
test('skills preserve complete body, parse explicit plot scope, reject invalid headers/size and cannot inject plot-only or disabled skills into report requests',async()=>{
 const report=await parseSkill('写作.md','---\nname: "写作"\ndescription: 描述:保留冒号\n---\n'+('正文'.repeat(1500))+'<b>text</b>'),plot=await parseSkill('图.md','---\nname: 图\nscope: plot\n---\nPLOT_ONLY_MARKER');assert.equal(report.name,'写作');assert.equal(report.description,'描述:保留冒号');assert.ok(skillPrompt([report,plot],'report').endsWith('<b>text</b>'));assert.ok(!skillPrompt([report,plot],'report').includes('PLOT_ONLY_MARKER'));assert.equal(skillPrompt([{...report,enabled:false},plot],'report'),'');assert.equal((await parseSkill('另一个名字.md',report.content)).id,report.id);
 await assert.rejects(parseSkill('a.txt','text'));await assert.rejects(parseSkill('a.md','---\nname: missing'));await assert.rejects(parseSkill('a.md','---\nscope: shell\n---\ntext'));await assert.rejects(parseSkill('a.md','x'.repeat(65537)));assert.equal(validSkills([report,report]),false);
});
test('all four original builtin skills retain their original normalized Markdown body and report/plot division',()=>{const skills=JSON.parse(fs.readFileSync('src/data/ai-skills.json'));assert.equal(skills.length,4);assert.equal(skills.filter(s=>s.scope==='plot').length,2);const root='E:/apps/xdu-labreport-writer-master/skills';const originals=fs.readdirSync(root).filter(n=>n.endsWith('.md')).map(n=>fs.readFileSync(root+'/'+n,'utf8').replace(/\r\n?/g,'\n').replace(/^---\n[\s\S]*?\n---\n/,'').trim());assert.deepEqual(skills.map(s=>s.content).sort(),originals.sort());});
test('skills persist disabled/deleted state and recover an intact preference copy',async()=>{const {data,repo}=make(),skill=await parseSkill('a.md','正文');await repo.saveSkills([skill]);await repo.saveSkills([{...skill,enabled:false}]);assert.equal((await repo.loadSkills([]))[0].enabled,false);await repo.saveSkills([]);assert.deepEqual(await repo.loadSkills([skill]),[]);const keys=[...data.keys()];data.set(keys.find(k=>k.endsWith('-a')),'broken');assert.ok(Array.isArray(await repo.loadSkills([skill])));});
test('history uses independent records, restores an intact copy, rejects cross-experiment access and cleans only the selected experiment',async()=>{const {data,repo}=make(),a=await entry(),b=await entry(other);await repo.appendAIHistory(a);await repo.appendAIHistory(b);assert.equal((await repo.listAIHistory(exp)).length,1);assert.equal((await repo.readAIHistory(exp,a.id)).text,a.text);await assert.rejects(repo.readAIHistory(other,a.id),/不存在/);data.set(`history-item-${exp}-${a.id}-a`,'broken');assert.equal((await repo.readAIHistory(exp,a.id)).source,a.source);await repo.deleteAIHistory(exp,[a.id]);assert.deepEqual(await repo.listAIHistory(exp),[]);assert.equal((await repo.listAIHistory(other))[0].id,b.id);await assert.rejects(repo.appendAIHistory({...a,text:'x'.repeat(100001)}));});
test('full history reset can remove orphaned/corrupt indexes without touching another experiment or preferences',async()=>{const {data,repo}=make(),a=await entry();await repo.appendAIHistory(a);data.set(`history-${exp}-a`,'broken');data.set(`history-${exp}-b`,'broken');data.set('record-'+exp+'-a','measurement');data.set('ai-skills-a','skills');await repo.clearAIHistory(exp,async()=>{for(const key of [...data.keys()])if(key.startsWith(`history-${exp}-`)||key.startsWith(`history-item-${exp}-`))data.delete(key);});assert.deepEqual(await repo.listAIHistory(exp),[]);assert.equal(data.get('record-'+exp+'-a'),'measurement');assert.equal(data.get('ai-skills-a'),'skills');});

test('deleting old or selected history preserves newer imports, unrelated sections and all non-AI settings',()=>{
 const old=crypto.randomUUID(),quiz=crypto.randomUUID(),polish=crypto.randomUUID();
 const settings={...defaultReportSettings(),variants:{实验原理:2},disabledSections:['实验方法'],embedPhoto:false,ai:{source:'source',customQuiz:{questions:['问题'],answers:{1:['回答']}},polish:{结论:'当前结论',实验原理:'旧版无历史关联的内容'},historyRefs:{quiz,polish:{结论:polish}}}};
 const snapshot=structuredClone(settings);
 assert.deepEqual(detachAIHistory(settings,old),settings);
 const withoutQuiz=detachAIHistory(settings,quiz);
 assert.equal(withoutQuiz.ai.customQuiz,undefined);assert.deepEqual(withoutQuiz.ai.polish,settings.ai.polish);assert.equal(withoutQuiz.ai.historyRefs.quiz,undefined);
 const withoutPolish=detachAIHistory(settings,polish);
 assert.equal(withoutPolish.ai.polish.结论,undefined);assert.deepEqual(withoutPolish.ai.customQuiz,settings.ai.customQuiz);
 const cleared=detachAIHistory(settings);
 assert.deepEqual(cleared.ai,{source:'source',polish:{实验原理:'旧版无历史关联的内容'}});
 assert.equal(validReportSettings(cleared),true);assert.deepEqual(cleared.variants,settings.variants);assert.deepEqual(cleared.disabledSections,settings.disabledSections);assert.equal(cleared.embedPhoto,false);
 assert.deepEqual(settings,snapshot);
 const linkedOnly=structuredClone(settings);delete linkedOnly.ai.polish.实验原理;
 assert.equal(detachAIHistory(linkedOnly).ai,undefined);
 const legacy={...defaultReportSettings(),ai:{source:'source',polish:{结论:'旧版内容'}}};assert.deepEqual(detachAIHistory(legacy),legacy);
});

test('full clear invalidates queued history writes and later results can be saved normally',async()=>{
 const {data,repo}=make(),a=await entry();
 const pending=repo.appendAIHistory(a);
 const reset=repo.clearAIHistory(exp,async()=>{for(const key of [...data.keys()])if(key.startsWith(`history-${exp}-`)||key.startsWith(`history-item-${exp}-`))data.delete(key);});
 await assert.rejects(pending,/已失效/);await reset;
 assert.deepEqual(await repo.listAIHistory(exp),[]);
 await repo.appendAIHistory(a);assert.equal((await repo.readAIHistory(exp,a.id)).text,a.text);
});
