// App-local preview fonts. Does not install or replace system/Word fonts.
const cacheName='lab-report-fonts-v1';
const serif='https://fonts.gstatic.com/s/notoserifsc/v36/H4cyBXePl9DZ0Xe7gG9cyOj7uK2-n-D2rd4FY7SCqyWv.ttf';
let pending:Promise<Array<{names:string[];bytes:ArrayBuffer}>>|undefined;
export function ensureReportFonts(){
 if(pending)return pending;
 pending=(async()=>{
  const result:Array<{names:string[];bytes:ArrayBuffer}>=[];
  for(const [url,names] of [[ '/report-runtime/LabMakerSansSC.ttf',['黑体','SimHei']], [serif,['宋体','SimSun']], ['https://fonts.gstatic.com/s/stixtwomath/v12/pONg1hwwL_6M9EkZySr_yteUi1o.ttf',['Cambria Math','STIX Two Math']]] as Array<[string,string[]]>){
   try{
    const cache=await caches.open(cacheName);let response=await cache.match(url);
    const valid=async(r:Response)=>{const bytes=await r.arrayBuffer();if(bytes.byteLength<1000||bytes.byteLength>32*1024*1024)throw Error('font size');await new FontFace('LabFontCheck',bytes).load();return bytes;};
    let bytes:ArrayBuffer|undefined;
    if(response)try{bytes=await valid(response);}catch{await cache.delete(url);}
    if(!bytes){response=await fetch(url,{signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error('font download');bytes=await valid(response.clone());await cache.put(url,response);}
    result.push({names,bytes});
   }catch{/* Offline: keep the platform fallback; retry missing fonts on next launch. */}
  }
  return result;
 })();return pending;
}
window.addEventListener('message',event=>{
 if(event.data?.type!=='report-preview-fonts-ready')return;
 const frame=[...document.querySelectorAll('iframe')].find(f=>f.contentWindow===event.source&&new URL(f.src,location.href).pathname==='/preview/index.html');
 if(!frame)return;
 void ensureReportFonts().then(fonts=>frame.contentWindow?.postMessage({type:'report-preview-fonts',fonts},'*'));
});
void ensureReportFonts();
