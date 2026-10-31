import {Filesystem,Directory} from '@capacitor/filesystem';
import {binaryBase64} from './reports.ts';
import {validPlotPng} from '../domain/ai-plot-resources.ts';
import type {AIPlotImage} from '../domain/ai-plot.ts';
const directory=Directory.LibraryNoCloud,root='lab-maker/v1/ai-plots';
const missing=(e:unknown)=>(e as {code?:string})?.code==='OS-PLUG-FILE-0008'||/does not exist|not found/i.test((e as Error)?.message??'');
function folder(id:string){if(!/^[a-f0-9]{12}$/.test(id))throw Error('绘图实验标识无效');return root+'/'+id;}
function path(id:string,imageId:string){if(!/^[a-f0-9-]{36}$/.test(imageId))throw Error('绘图文件标识无效');return folder(id)+'/'+imageId+'.png';}
async function digest(bytes:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.slice().buffer))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function readAIPlotImage(id:string,image:AIPlotImage){
  const file=path(id,image.id),stat=await Filesystem.stat({path:file,directory});
  if(stat.type!=='file'||stat.size!==image.bytes||stat.size>8*1024*1024)throw Error('已采用图表文件大小异常，请重新预览并采用');
  const raw=await Filesystem.readFile({path:file,directory}),bytes=typeof raw.data==='string'?Uint8Array.from(atob(raw.data),c=>c.charCodeAt(0)):new Uint8Array(await raw.data.arrayBuffer());
  if(!validPlotPng(bytes)||bytes.length!==image.bytes||await digest(bytes)!==image.sha256)throw Error('已采用图表未能核实，请重新预览并采用');
  return bytes;
}
export async function stageAIPlotImage(id:string,bytes:Uint8Array):Promise<AIPlotImage>{
  if(!validPlotPng(bytes))throw Error('图表 PNG 格式无效');
  const image={id:crypto.randomUUID(),sha256:await digest(bytes),bytes:bytes.length};
  await Filesystem.writeFile({path:path(id,image.id),directory,data:binaryBase64(bytes),recursive:true});
  await readAIPlotImage(id,image);return image;
}
export async function pruneAIPlotImages(id:string,keep?:string|string[]){
  const kept=typeof keep==='string'?[keep]:keep??[];
  if(kept.length>8||kept.some(id=>!/^[a-f0-9-]{36}$/.test(id)))throw Error('绘图文件标识无效');
  let entries;try{entries=await Filesystem.readdir({path:folder(id),directory});}catch(error){if(missing(error))return;throw error;}
  for(const entry of entries.files)if(/^[a-f0-9-]{36}\.png$/.test(entry.name)&&!kept.some(id=>entry.name===id+'.png')&&entry.type==='file')await Filesystem.deleteFile({path:folder(id)+'/'+entry.name,directory});
}
