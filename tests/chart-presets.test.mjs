import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {chartGuide,validOfficialChart,assertOfficialChart} from '../src/domain/chart-presets.ts';
import {validReportSettings,defaultReportSettings} from '../src/domain/reports.ts';
const catalog=JSON.parse(fs.readFileSync(new URL('../src/data/catalog.json',import.meta.url))).experiments;
test('every experiment uses its explicit source guide; no fallback to another semester',()=>{
 for(const exp of catalog)assert.ok(chartGuide(exp),exp.sourceId);
 assert.equal(chartGuide({sourceId:'unknown'}),null);
 const one=chartGuide({sourceId:'光的偏振特性测量'}),two=chartGuide({sourceId:'光的偏振特性测量（第二学期）'});
 assert.deepEqual(one.charts.map(c=>c.id),['malus']);assert.deepEqual(two.charts.map(c=>c.id),['polar']);
});
test('preset configuration is optional and experiment scoped',()=>{
 const base=defaultReportSettings();assert.ok(validReportSettings(base));
 const selection={preset:'all',embed:false,section:'数据处理'};
 assert.ok(validReportSettings({...base,officialCharts:selection}));
 assert.doesNotThrow(()=>assertOfficialChart({sourceId:'RLC电路的稳态特性研究实验'},selection));
 assert.throws(()=>assertOfficialChart({sourceId:'三棱镜顶角的测量'},selection));
 assert.throws(()=>assertOfficialChart({sourceId:'RLC电路的稳态特性研究实验'},{...selection,preset:'polar'}));
 for(const bad of [null,[],{...selection,embed:1},{...selection,preset:'../test'},{...selection,section:''}])assert.equal(validOfficialChart(bad),false);
});
