import catalog from '../../src/data/catalog.json';
import type {Experiment} from '../../src/domain/types.ts';
import {fields,makeDraft,convert} from '../../src/domain/model.ts';
import {reviewOCR,applyOCR} from '../../src/domain/ocr.ts';
import {OCRReviewEditor} from '../../src/features/ocr-review.ts';

export function createPartialRowsFixture(index:number){
 const cases=(catalog.experiments as Experiment[]).flatMap(exp=>fields(exp.schema).filter(f=>f.type==='matrix'&&f.variableRows).map(field=>({exp,field})));
 const {exp,field}=cases[index],rows=Array.from({length:field.minFilledRows!},(_,r)=>Array.from({length:field.cols!},(_,c)=>r*10+c));
 const review=reviewOCR(exp.schema,JSON.stringify({data:{[field.key]:rows}}));
 document.querySelector('#app')!.innerHTML='<section class="panel"><h1></h1><div id="partial-editor"></div></section>';
 document.querySelector('h1')!.textContent=exp.name;
 const editor=new OCRReviewEditor(exp.schema,review,()=>{});editor.mount(document.querySelector('#partial-editor')!);
 return {rows:field.rows,cols:field.cols,measured:rows.length,unit:field.unit??'',values:()=>convert(exp.schema,applyOCR(exp.schema,makeDraft(exp.schema),editor.corrected(),editor.selected(),true)).data[field.key],leave:()=>editor.leave()};
}
