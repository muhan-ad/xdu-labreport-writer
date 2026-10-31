export function plotResourceNames(lock:unknown,code=''){
  const packages=(lock as {packages?:Record<string,{file_name:string;depends:string[]}>})?.packages;
  if(!packages||typeof packages!=='object')throw Error('绘图依赖清单无效');
  const seen=new Set<string>(),files=new Set(['pyodide.js','pyodide.asm.js','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json','LabMakerSansSC.ttf','ai_plot.py']);
  const visit=(name:string)=>{
    if(seen.has(name))return;seen.add(name);
    const item=packages[name];
    if(!item||!Array.isArray(item.depends)||typeof item.file_name!=='string'||!/^[a-zA-Z0-9_.-]+$/.test(item.file_name))throw Error('缺少本机绘图依赖：'+name);
    files.add(item.file_name);for(const dependency of item.depends){if(typeof dependency!=='string')throw Error('绘图依赖名称无效');visit(dependency);}
  };
  for(const name of ['numpy','matplotlib','pillow'])visit(name);
  for(const name of ['scipy','pandas'])if(new RegExp('\\b'+name+'\\b').test(code))visit(name);
  return [...files];
}
export function validPlotPng(bytes:Uint8Array){
  if(bytes.byteLength<33||bytes.byteLength>8*1024*1024)return false;
  if(![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')return false;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=view.getUint32(16),height=view.getUint32(20);
  return width>0&&height>0&&width<=2200&&height<=1600;
}
