import {scanPixels} from '../domain/ocr-image.ts';

/** One 1600px working canvas; original stored photo is never overwritten. */
export async function prepareOCRImage(url:string,enhance:boolean,signal:AbortSignal){
 const image=new Image(),canvas=document.createElement('canvas');
 const guard=()=>{if(signal.aborted)throw Error('图片处理已停止');};
 const abort=()=>{image.src='';};
 signal.addEventListener('abort',abort,{once:true});
 try{
  guard();image.src=url;
  await image.decode();guard();
  if(!image.naturalWidth||!image.naturalHeight)throw Error('照片无法读取，请重新添加');
  const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
  canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const context=canvas.getContext('2d',{willReadFrequently:enhance});if(!context)throw Error('照片无法处理，请重新添加');
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  // Yield before the bounded pixel pass, allowing navigation/cancellation to win.
  await new Promise(resolve=>setTimeout(resolve,0));guard();
  if(enhance){const data=context.getImageData(0,0,canvas.width,canvas.height);scanPixels(data.data);context.putImageData(data,0,0);}
  guard();const dataUrl=canvas.toDataURL('image/jpeg',.9);guard();
  return {dataUrl,width:canvas.width,height:canvas.height,enhanced:enhance};
 }catch(error){guard();throw Error(error instanceof DOMException?'照片无法读取，请重新添加':(error as Error).message||'照片无法处理，请重新添加');}
 finally{signal.removeEventListener('abort',abort);image.src='';canvas.width=canvas.height=1;}
}
