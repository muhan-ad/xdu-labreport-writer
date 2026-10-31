export interface IntegrityWarning {code:string;message:string;}
export const reportIntegrity:{inspectText:(text:string,data:Record<string,unknown>)=>{text:string;warnings:IntegrityWarning[]};validateText:(text:string,data:Record<string,unknown>,onWarning?:(warnings:IntegrityWarning[])=>void)=>string;parameterizeText:(text:string,data:Record<string,unknown>)=>string;};
