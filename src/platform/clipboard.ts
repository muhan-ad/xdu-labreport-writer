import {Capacitor,registerPlugin} from '@capacitor/core';
import {Clipboard} from '@capacitor/clipboard';
const native=registerPlugin<{copyText(input:{text:string}):Promise<void>}>('LabReportFiles');
export async function copyReportText(text:string){if(!text.trim()||text.length>100000)throw Error('没有可复制的正文或正文过长');if(Capacitor.getPlatform()==='android')return native.copyText({text});try{if(Capacitor.getPlatform()==='ios')await Clipboard.write({string:text});else{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(text);}}catch{throw Error('未能复制，请长按文本框选择复制');}}
