import {AIFeatures} from '../../src/features/ai.ts';
import {prepareOCRImage} from '../../src/platform/ocr-image.ts';
// @ts-ignore Development-only byte-for-byte desktop function snapshot.
import {toScanEffect} from './desktop-scan-reference.js';
import type {Experiment,RecordData} from '../../src/domain/types.ts';

function paper(width=400,height=240){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d')!;ctx.fillStyle='rgb(200,200,200)';ctx.fillRect(0,0,width,height);ctx.fillStyle='#111';ctx.fillRect(20,20,width*.1,height*.25);ctx.fillStyle='rgb(220,80,80)';ctx.fillRect(width*.6,height*.4,width*.15,height*.3);return canvas.toDataURL('image/png');}
async function pixel(url:string){const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);const value=[...ctx.getImageData(5,5,1,1).data];return {width:canvas.width,height:canvas.height,value};}
export async function imagePipelineChecks(){
 const original=paper(),signal=new AbortController().signal;
 const plain=await prepareOCRImage(original,false,signal),scan=await prepareOCRImage(original,true,signal),reference=await toScanEffect(original);
 const large=await prepareOCRImage(paper(3200,1800),true,signal);
 const transparent=document.createElement('canvas');transparent.width=transparent.height=20;
 const white=await prepareOCRImage(transparent.toDataURL('image/png'),false,signal);
 let cancelled=false;const abort=new AbortController();abort.abort();try{await prepareOCRImage(original,true,abort.signal);}catch{cancelled=true;}
 let corrupt=false;try{await prepareOCRImage('data:image/png;base64,bad',true,signal);}catch{corrupt=true;}
 return {exactDesktop:scan.dataUrl===reference,plain:await pixel(plain.dataUrl),scan:await pixel(scan.dataUrl),large:{width:large.width,height:large.height},transparent:await pixel(white.dataUrl),cancelled,corrupt,originalUnchanged:original===paper()};
}
export async function createOCRImageFixture(){
 const exp={id:'abcdef123456',name:'扫描增强与原图核对',sourceId:'测试',category:'mechanics',schema:{groups:[{name:'测量',fields:[{key:'v',label:'测量值',type:'number',required:true}]}]}} as Experiment;
 let doc:RecordData={version:1,experimentId:exp.id,date:'2026-10-26',updatedAt:new Date().toISOString(),draft:{v:''}},photo={path:'photos/abcdef123456/original.png',mime:'image/png',name:'original.png'},imageUrl=paper();
 const original=imageUrl;let calls=0,applies=0,pending=false,release:(()=>void)|undefined;const payloads:string[]=[];
 const view=new AIFeatures({context:()=>({exp,doc,photo,imageUrl,blocked:false}),apply:async(_source,draft)=>{applies++;doc={...doc,draft};},notice:()=>{}},{status:async()=>({hasKey:true}),complete:async(_slot,messages)=>{calls++;payloads.push((messages[1].content as any[])[1].image_url.url);if(pending)await new Promise<void>(resolve=>release=resolve);return {text:JSON.stringify({data:{v:4.2}}),elapsedMs:10};}});
 let blob='';await view.ocr();return {open:()=>view.ocr(),close:()=>view.close(),back:()=>view.back(),state:()=>({calls,applies,open:view.isOpen,originalUnchanged:imageUrl===original,photoPath:photo.path,draft:doc.draft}),payload:()=>pixel(payloads.at(-1)!),pending:()=>pending=true,release:()=>{pending=false;release?.();},replacePhoto:()=>{photo={...photo,path:'photos/abcdef123456/replacement.png'};imageUrl=paper(300,200);},largePhoto:()=>{photo={...photo,path:'photos/abcdef123456/large.png'};imageUrl=paper(2400,1600);},blobPhoto:async()=>{const bytes=await(await fetch(paper())).blob();blob=URL.createObjectURL(bytes);imageUrl=blob;photo={...photo,path:'photos/abcdef123456/blob.png'};},blobReadable:async()=>{const ok=(await fetch(blob)).ok;URL.revokeObjectURL(blob);return ok;}};
}
