import test from 'node:test';
import assert from 'node:assert/strict';
import {chartWidth,validChartWidth} from '../src/domain/chart-width.ts';
import {validChartSpec} from '../src/domain/charts.ts';
import {validOfficialChart} from '../src/domain/chart-presets.ts';
import {validAdoptedAIPlot} from '../src/domain/ai-plot.ts';
import {validPlotHistory} from '../src/domain/plot-history.ts';
import {Repository} from '../src/domain/repository.ts';
import {defaultReportSettings} from '../src/domain/reports.ts';
const id='abcdef123456',image={id:'12345678-1234-1234-1234-123456789abc',sha256:'a'.repeat(64),bytes:100};
const manual={x:'x',y:'y',kind:'line',title:'',xlabel:'',ylabel:'',caption:'图',section:'数据处理',embed:true};
const official={preset:'all',section:'数据处理',embed:true};
const ai={version:1,experimentId:id,sourceHash:'a'.repeat(64),requirement:'曲线',code:'print(DATA)',caption:'图',section:'数据处理',embed:true,image};
const history={id:image.id,experimentId:id,createdAt:'2026-10-26T00:00:00Z',sourceHash:ai.sourceHash,requirement:ai.requirement,code:ai.code,caption:ai.caption,section:ai.section,embed:true};
test('chart widths preserve old default and finite desktop range without accepting coercion',()=>{
 assert.equal(chartWidth(undefined),14);
 for(const width of [4,7.5,14,20])assert.equal(chartWidth(width),width);
 for(const width of [null,true,false,'7.5','',NaN,Infinity,-Infinity,0,3.99,20.01,{},[]]){assert.equal(validChartWidth(width),false);assert.throws(()=>chartWidth(width),/4–20/);}
});
test('manual, preset, adopted group and history all accept legacy widths and reject malformed additions',()=>{
 for(const [item,valid] of [[manual,validChartSpec],[official,validOfficialChart],[ai,validAdoptedAIPlot],[history,validPlotHistory]]){
  assert.equal(valid(item),true);
  for(const widthCm of [4,7.5,20])assert.equal(valid({...item,widthCm}),true);
  for(const widthCm of [null,true,'14',NaN,Infinity,3,21])assert.equal(valid({...item,widthCm}),false);
 }
});
test('width preferences and plot history survive repository readback without changing enabled state or figures',async()=>{
 const files=new Map(),repo=new Repository({read:async k=>files.get(k)??null,write:async(k,v)=>files.set(k,v),remove:async k=>files.delete(k)});
 const settings={...defaultReportSettings(),customCharts:[{...manual,widthCm:4}],officialCharts:{...official,widthCm:20},aiPlot:{...ai,widthCm:7.5,figures:[{image,caption:ai.caption,section:ai.section,embed:true}]}};
 await repo.saveReportSettings(id,settings);assert.deepEqual(await repo.loadReportSettings(id),settings);
 await repo.appendPlotHistory({...history,widthCm:7.5});assert.equal((await repo.readPlotHistory(id,history.id)).widthCm,7.5);
});
