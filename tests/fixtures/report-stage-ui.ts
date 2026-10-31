import {stageReport} from '../../src/platform/reports.ts';
export const stage=(id:string,generation:string)=>stageReport(id,generation,{docx:new Uint8Array([80,75,3,4,20]),charts:[{name:'测试图',bytes:new Uint8Array([137,80,78,71,1,2])}],metadata:{name:'测试',formulaCount:0,sections:{},log:''}});
