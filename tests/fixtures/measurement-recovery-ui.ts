import {privateStore} from '../../src/platform/storage.ts';
let fail=false,remaining:number|null=null;const write=privateStore.write.bind(privateStore);
privateStore.write=async(key,value)=>{if(key.startsWith('record-')){if(fail)return;if(remaining!==null){if(remaining===0)return;remaining--;}}await write(key,value);};
let pause=false,waiting=false,resume:(()=>void)|undefined;const read=privateStore.read.bind(privateStore);
privateStore.read=async key=>{if(pause&&key.startsWith('record-')){pause=false;waiting=true;await new Promise<void>(resolve=>{resume=resolve;});waiting=false;}return read(key);};
export function pauseNextRecordRead(){pause=true;}
export function isReadPaused(){return waiting;}
export function releaseRead(){resume?.();resume=undefined;}
export function blockWrites(value:boolean){fail=value;remaining=null;}
export function failAfterWrites(count:number){fail=false;remaining=count;}
export async function seedOCR(id:string){await privateStore.write(`ocr-${id}-a`,'original OCR');await privateStore.write(`ocr-${id}-b`,'backup OCR');}
export async function readOCR(id:string){return [await privateStore.read(`ocr-${id}-a`),await privateStore.read(`ocr-${id}-b`)];}
export async function start(){await import('../../src/main.ts');}
