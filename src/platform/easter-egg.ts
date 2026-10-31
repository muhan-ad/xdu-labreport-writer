import {Capacitor} from '@capacitor/core';
import {emptyEggStats,validEggStats,officialEggLink,type EggStats} from '../domain/easter-egg.ts';
export const easterEgg={
 load(){try{const value=JSON.parse(localStorage.getItem('easter-egg-stats')??'null');return validEggStats(value)?value:emptyEggStats();}catch{return emptyEggStats();}},
 save(stats:EggStats){if(!validEggStats(stats))throw Error('计数无效');localStorage.setItem('easter-egg-stats',JSON.stringify({count:stats.count,last:stats.last,effects:stats.effects}));},
 async audio(signal:AbortSignal){const response=await fetch('/easter-egg/do-not-click.mp3',{signal,credentials:'omit'});if(!response.ok)throw Error('彩蛋音频未能读取');const bytes=new Uint8Array(await response.arrayBuffer());if(signal.aborted||bytes.length!==76536)throw Error('彩蛋音频不完整');const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');if(digest!=='f6fe9d00f696ecda0b9fea7b4d12fc05b2af765d97aab0e192b801817b7cd681')throw Error('彩蛋音频未能核实');let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return {ok:true,mime:'audio/mpeg',data:btoa(binary)};},
 async open(url:string){if(url!==officialEggLink)throw Error('彩蛋链接无效');if(Capacitor.isNativePlatform()){const {Browser}=await import('@capacitor/browser');await Browser.open({url,toolbarColor:'#15803d'});}else window.open(url,'_blank','noopener,noreferrer');}
};
